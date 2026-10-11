import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID, generateKeyPairSync, createHash, sign } from "node:crypto";
import ExcelJS from "exceljs";
import { pool } from "@workspace/db";
import app from "../src/app";
import { migrateAccounts } from "../src/lib/accounts";
import { encrypt, hashPassword, type Vault } from "../src/lib/vault";
import { calculateKpis } from "../src/lib/kpis";
import { tokenHash } from "../src/middlewares/factory-auth";

const tenant = `premium_${randomUUID()}`, password = randomUUID(), cookies: Record<string,string> = {};
let server: ReturnType<typeof app.listen>, origin: string;
const challenges: string[] = [];
async function request(route: string, method = "GET", body?: unknown, role = "owner", ceremony = "") {
  const r = await fetch(origin + "/api" + route, { method, headers: { origin, "content-type":"application/json",
    cookie: [cookies[role], ceremony].filter(Boolean).join("; "), "x-forwarded-for": tenant },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie().map(c => c.split(";")[0]);
  for (const c of set) if(c.startsWith("nexus_webauthn=") && c.split("=")[1]) challenges.push(tokenHash(c.split("=")[1]));
  return { status:r.status, headers:r.headers, cookies:set, bytes:Buffer.from(await r.arrayBuffer()) };
}
const json = (r: { bytes: Buffer }) => JSON.parse(r.bytes.toString());
before(async()=>{
  await migrateAccounts();
  for(const id of [tenant,tenant+"_other"])await pool.query("INSERT INTO factory_vaults(id,name,password_hash,payload) VALUES($1,'Premium test',$2,$3)",[id,hashPassword(password),encrypt(id,{jobs:[],logs:[]})]);
  server=app.listen(0,"127.0.0.1");await once(server,"listening");origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  for(const role of ["owner","production_planner","operator","foreign"]) {
    await pool.query("INSERT INTO factory_users(id,factory_id,username,name,role,password_hash) VALUES($1,$2,$1,$3,$4,$5)",
      [`${tenant}_${role}`,role==="foreign"?tenant+"_other":tenant,role,role==="foreign"?"owner":role,hashPassword(password)]);
    const login=await request("/auth/login","POST",{username:`${tenant}_${role}`,password},role);
    cookies[role]=login.cookies.find(c=>c.startsWith("nexus_session="))!;
    await request("/auth/role","POST",{role:role==="foreign"?"owner":role},role);
  }
});
after(async()=>{
  server?.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
  await pool.query("DELETE FROM factory_passkey_challenges WHERE id=ANY($1::text[])",[challenges]);
  await pool.query("DELETE FROM factory_sessions WHERE factory_id=ANY($1::text[])",[[tenant,tenant+"_other"]]);
  await pool.query("DELETE FROM factory_users WHERE factory_id=ANY($1::text[])",[[tenant,tenant+"_other"]]);
  await pool.query("DELETE FROM factory_vaults WHERE id=ANY($1::text[])",[[tenant,tenant+"_other"]]);
  await pool.query("DELETE FROM factory_login_attempts WHERE id=$1",[tokenHash(tenant)]);
  await pool.end();
});
test("OEE measures actual intervals and refuses unknown coverage or impossible cycle rates",()=>{
  const v: Vault={jobs:[],logs:[{id:"l",jobId:"j",machineId:"m1",staff:"s",date:"2026-10-01",time:"12:00",goodQty:540,rejects:60,downtimeMinutes:90,reason:"",qcStatus:"pending",qcNote:"",createdAt:""}],
    oeeSettings:[{machineId:"m1",shiftStart:"08:00",shiftEnd:"16:00",idealCycleSeconds:30}],
    machineHistory:[["08:00","running"],["09:00","stopped"],["09:30","running"],["10:00","maintenance"],["11:00","running"]].map(([time,status])=>({machineId:"m1",at:`2026-10-01T${time}:00Z`,status:status as "running"}))};
  const calc=()=>calculateKpis(v,"2026-10-01","2026-10-01",Date.parse("2026-10-02T00:00:00Z"));
  const m=calc().machines[0];assert.equal(m.plannedMinutes,480);assert.equal(m.runningMinutes,390);
  assert.equal(m.availability,81.25);assert.equal(m.quality,90);assert.ok(Math.abs(m.oee!-56.25)<0.0001);
  v.oeeSettings![0].idealCycleSeconds=100;assert.equal(calc().machines[0].reason,"invalid_cycle_rate");
  v.machineHistory!.shift();assert.equal(calc().machines[0].reason,"incomplete_status");
  assert.equal(calc().machines[0].oee,null);
});
test("analytics and exports preserve permissions and produce real printable files",async()=>{
  assert.equal((await request("/analytics/kpis","GET",undefined,"operator")).status,403);
  assert.equal((await request("/analytics/oee-settings","PUT",{machineId:"m1",shiftStart:"08:00",shiftEnd:"16:00",idealCycleSeconds:1},"production_planner")).status,403);
  assert.equal((await request("/analytics/oee-settings","PUT",{machineId:"m1",shiftStart:"08:00",shiftEnd:"16:00",idealCycleSeconds:1})).status,200);
  assert.deepEqual(json(await request("/analytics/oee-settings","GET",undefined,"foreign")),[]);
  assert.equal((await request("/analytics/kpis?from=2026-02-30")).status,400);
  assert.equal((await request("/exports/audit/pdf","GET",undefined,"production_planner")).status,403);
  assert.equal((await request("/exports/plans/xlsx","GET",undefined,"operator")).status,403);
  const pdf=await request("/exports/reports/pdf");assert.equal(pdf.status,200);assert.equal(pdf.bytes.subarray(0,5).toString(),"%PDF-");
  const excel=await request("/exports/reports/xlsx","GET",undefined,"production_planner");assert.equal(excel.status,200);
  const book=new ExcelJS.Workbook();await book.xlsx.load(excel.bytes as never);assert.ok(book.getWorksheet("All production logs"));
  assert.ok(json(await request("/audit")).some((a:{action:string})=>a.action==="report_exported"));
});
test("passkey enrollment requires password and consumes invalid challenges once",async()=>{
  const invalid=await request("/auth/passkeys/register/options","POST",{name:"Tablet",password:"wrong"});
  assert.equal(invalid.status,401);
  const options=await request("/auth/passkeys/register/options","POST",{name:"Tablet",password});
  assert.equal(options.status,200);assert.equal(json(options).authenticatorSelection.userVerification,"required");
  const cookie=options.cookies.find(c=>c.startsWith("nexus_webauthn="))!;
  assert.equal((await request("/auth/passkeys/register/verify","POST",{},"owner",cookie)).status,400);
  assert.equal(json(await request("/auth/passkeys/register/verify","POST",{},"owner",cookie)).code,"PASSKEY_CHALLENGE_EXPIRED");
});
test("real signed passkey login selects no role, rejects replay and scopes credential deletion",async()=>{
  const {publicKey,privateKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"}), jwk=publicKey.export({format:"jwk"});
  const cose=Buffer.concat([Buffer.from("a5010203262001215820","hex"),Buffer.from(jwk.x!,"base64url"),Buffer.from("225820","hex"),Buffer.from(jwk.y!,"base64url")]);
  const id=Buffer.from(randomUUID()).toString("base64url"), userId=`${tenant}_operator`;
  await pool.query("INSERT INTO factory_passkeys(id,user_id,rp_id,public_key,name) VALUES($1,$2,'127.0.0.1',$3,'Test authenticator')",[id,userId,cose.toString("base64")]);
  const options=await request("/auth/passkeys/login/options","POST",undefined,"anonymous");
  assert.equal(options.status,200);
  const ceremony=options.cookies.find(c=>c.startsWith("nexus_webauthn="))!;
  const clientData=Buffer.from(JSON.stringify({type:"webauthn.get",challenge:json(options).challenge,origin,crossOrigin:false}));
  const authData=Buffer.concat([createHash("sha256").update("127.0.0.1").digest(),Buffer.from([5,0,0,0,1])]);
  const signed=sign("sha256",Buffer.concat([authData,createHash("sha256").update(clientData).digest()]),privateKey);
  const response={id,rawId:id,type:"public-key",clientExtensionResults:{},response:{clientDataJSON:clientData.toString("base64url"),authenticatorData:authData.toString("base64url"),signature:signed.toString("base64url"),userHandle:Buffer.from(userId).toString("base64url")}};
  const login=await request("/auth/passkeys/login/verify","POST",response,"anonymous",ceremony);
  assert.equal(login.status,200,login.bytes.toString());assert.equal(json(login).role,"");assert.equal(json(login).requiresRoleSelection,true);
  assert.equal((await request("/auth/passkeys/login/verify","POST",response,"anonymous",ceremony)).status,400);
  assert.equal((await request(`/auth/passkeys/${id}`,"DELETE",undefined,"foreign")).status,404);
  assert.equal((await request(`/auth/passkeys/${id}`,"DELETE",undefined,"operator")).status,200);
});
