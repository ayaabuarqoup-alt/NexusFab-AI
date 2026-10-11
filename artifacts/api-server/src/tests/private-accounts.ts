import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import app from "../app";
import { migrateAccounts, provisionFactory } from "../lib/accounts";
import { loadVault } from "../lib/vault";
import { tokenHash } from "../middlewares/factory-auth";
import { pool } from "@workspace/db";

// Tests the production-mode API against disposable tenants, not existing records.
assert.equal(process.env.NODE_ENV,"production","Run with NODE_ENV=production");
await migrateAccounts();
const suffix = randomBytes(6).toString("hex");
const tenants = [`test_${suffix}_a`,`test_${suffix}_b`];
const password = randomBytes(24).toString("base64url");
const otherPassword = randomBytes(24).toString("base64url");
const ip = `account-test-${suffix}`;
const longStaffName = "م".repeat(100);
const longOwnerName = "O".repeat(100);
const server = app.listen(0,"127.0.0.1");
await new Promise<void>(resolve => server.once("listening",resolve));
const address = server.address() as {port:number};
let authAttempts = 0;
async function call(path: string, method="GET", body?: unknown, cookie?: string, expected=200) {
  const credential = path.startsWith("/auth/") && method === "POST";
  const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`,{
    method,headers:{"Content-Type":"application/json","X-Forwarded-For":`${ip}-${credential ? Math.floor(authAttempts++ / 10) : "ops"}`,...(cookie?{Cookie:cookie}:{})},
    ...(body ? {body:JSON.stringify(body)} : {}),
  });
  const data: any = await response.json();
  assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(data)}`);
  return {data,cookie:response.headers.get("set-cookie")?.split(";")[0] ?? ""};
}
try {
  await assert.rejects(provisionFactory(tenants[0],"Disposable factory A",`${suffix}.owner`,"O".repeat(101)),/Invalid factory or owner details/);
  await assert.rejects(provisionFactory(tenants[0],"Disposable factory A",`${suffix}.owner`,"   "),/Invalid factory or owner details/);
  const token = await provisionFactory(tenants[0],"Disposable factory A",`${suffix}.owner`,longOwnerName);
  const secondToken = await provisionFactory(tenants[1],"Disposable factory B",`${suffix}.other`,"Other owner");
  await call("/auth/login","POST",{username:"factory_carton",password:"password123"},undefined,401);
  const legacy = randomBytes(32).toString("hex");
  await pool.query("INSERT INTO factory_sessions(id,factory_id,expires_at) VALUES($1,$2,NOW()+interval '1 hour')",[tokenHash(legacy),tenants[0]]);
  assert.equal((await call("/auth/session","GET",undefined,`nexus_session=${legacy}`)).data.authenticated,false);
  await call("/auth/activate","POST",{token,password:"short"},undefined,400);
  await call("/auth/activate","POST",{token,password});
  await call("/auth/activate","POST",{token,password},undefined,400);
  await call("/auth/activate","POST",{token:secondToken,password});
  const owner = await call("/auth/login","POST",{username:`${suffix}.owner`,password});
  assert.equal(owner.data.role,"owner");
  assert.ok(owner.data.userId);
  const other = await call("/auth/login","POST",{username:`${suffix}.other`,password});
  for (const role of ["operator","quality_inspector"]) {
    const invitation = await call("/staff","POST",{username:`${suffix}.${role}`,name:longStaffName,role},owner.cookie);
    await call("/auth/activate","POST",{token:invitation.data.token,password});
  }
  const operator = await call("/auth/login","POST",{username:`${suffix}.operator`,password});
  const inspector = await call("/auth/login","POST",{username:`${suffix}.quality_inspector`,password});
  await call("/staff","GET",undefined,operator.cookie,403);
  await call("/staff","POST",{username:"forbidden",name:"Forbidden",role:"owner"},inspector.cookie,403);
  await call(`/staff/${owner.data.userId}`,"PATCH",{role:"operator",active:false},owner.cookie,409);
  const today = new Date().toISOString().slice(0,10);
  const jobInput = {name:"Permission test",machineId:"m1",target:10,startDate:today,dueDate:today,startTime:"08:00"};
  await call("/jobs","POST",jobInput,inspector.cookie,403);
  const job = await call("/jobs","POST",jobInput,operator.cookie);
  const logInput = {jobId:job.data.id,staff:longStaffName,date:today,time:"09:00",goodQty:10,rejects:0,downtimeMinutes:0,reason:""};
  const log = await call("/logs","POST",logInput,operator.cookie);
  assert.equal(log.data.createdBy,operator.data.userId);
  assert.equal(log.data.staff,longStaffName);
  assert.equal((await call("/logs","GET",undefined,inspector.cookie)).data[0].staff,longStaffName);
  const ownerLog = await call("/logs","POST",{...logInput,staff:"Spoofed staff",goodQty:0,downtimeMinutes:1,reason:"Setup"},owner.cookie);
  assert.equal(ownerLog.data.staff,longOwnerName);
  await call(`/logs/${ownerLog.data.id}/quality`,"PATCH",{status:"approved",note:"Setup reviewed"},inspector.cookie);
  await call(`/jobs/${job.data.id}/dispatch`,"POST",{},operator.cookie,403);
  await call(`/jobs/${job.data.id}/dispatch`,"POST",{},owner.cookie,409);
  await call(`/logs/${log.data.id}/quality`,"PATCH",{status:"approved",note:"Spoofed",reviewedBy:owner.data.userId},operator.cookie,403);
  await call(`/logs/${log.data.id}/quality`,"PATCH",{status:"approved",note:"Cross tenant"},other.cookie,404);
  const review = await call(`/logs/${log.data.id}/quality`,"PATCH",{status:"approved",note:"Verified dimensions",reviewedBy:owner.data.userId},inspector.cookie);
  assert.equal(review.data.reviewedBy,inspector.data.userId);
  assert.equal(review.data.reviewerName,longStaffName);
  assert.ok(review.data.reviewedAt);
  const listed = (await call("/logs","GET",undefined,operator.cookie)).data.find((l:any)=>l.id===log.data.id);
  assert.equal(listed.staff,longStaffName);
  assert.equal(listed.reviewerName,longStaffName);
  assert.equal(listed.qcStatus,"approved");
  await call(`/logs/${log.data.id}/quality`,"PATCH",{status:"rejected",note:"Second review"},inspector.cookie,409);
  await call(`/jobs/${job.data.id}/dispatch`,"POST",{},owner.cookie);
  const audit = await call("/audit","GET",undefined,owner.cookie);
  assert.ok(audit.data.some((e:any) => e.action==="job_dispatched" && e.actorId===owner.data.userId));
  assert.ok(audit.data.some((e:any) => e.action==="quality_reviewed" && e.actorId===inspector.data.userId));
  assert.equal((await call("/jobs","GET",undefined,other.cookie)).data.length,0);
  await call(`/staff/${operator.data.userId}`,"PATCH",{role:"quality_inspector",active:true},other.cookie,404);
  await call(`/staff/${operator.data.userId}`,"PATCH",{role:"quality_inspector",active:true},owner.cookie);
  assert.equal((await call("/auth/session","GET",undefined,operator.cookie)).data.authenticated,false);
  const changed = await call("/auth/login","POST",{username:`${suffix}.operator`,password});
  assert.equal(changed.data.role,"quality_inspector");
  await call("/jobs","POST",jobInput,changed.cookie,403);
  const reset = await call(`/staff/${operator.data.userId}/reset`,"POST",{},owner.cookie);
  assert.equal((await call("/auth/session","GET",undefined,changed.cookie)).data.authenticated,false);
  await call("/auth/login","POST",{username:`${suffix}.operator`,password},undefined,401);
  await call("/auth/activate","POST",{token:reset.data.token,password:otherPassword});
  const resetLogin = await call("/auth/login","POST",{username:`${suffix}.operator`,password:otherPassword});
  await call(`/staff/${operator.data.userId}`,"PATCH",{role:"operator",active:false},owner.cookie);
  assert.equal((await call("/auth/session","GET",undefined,resetLogin.cookie)).data.authenticated,false);
  await call("/auth/login","POST",{username:`${suffix}.operator`,password:otherPassword},undefined,401);
  await call("/auth/password","POST",{currentPassword:password,password:otherPassword},owner.cookie);
  assert.equal((await call("/auth/session","GET",undefined,owner.cookie)).data.authenticated,false);
  await call("/auth/login","POST",{username:`${suffix}.owner`,password},undefined,401);
  await call("/auth/login","POST",{username:`${suffix}.owner`,password:otherPassword});
  const raw = await pool.query("SELECT payload FROM factory_vaults WHERE id=$1",[tenants[0]]);
  assert.ok(!raw.rows[0].payload.includes("Verified dimensions"));
  assert.equal((await loadVault(tenants[0])).jobs[0]?.status,"dispatched");
  console.log("PASS: production demo denial, private activation, roles, tenant isolation, review identity, encrypted audit, dispatch, role revocation, reset, disable and password change.");
} finally {
  server.close();
  await pool.query("DELETE FROM factory_sessions WHERE factory_id=ANY($1)",[tenants]);
  await pool.query("DELETE FROM factory_invites WHERE user_id IN (SELECT id FROM factory_users WHERE factory_id=ANY($1))",[tenants]);
  await pool.query("DELETE FROM factory_users WHERE factory_id=ANY($1)",[tenants]);
  await pool.query("DELETE FROM factory_vaults WHERE id=ANY($1)",[tenants]);
  await pool.query("DELETE FROM factory_login_attempts WHERE id=ANY($1)",[Array.from({length:20},(_,i)=>tokenHash(`${ip}-${i}`))]);
  await pool.end();
}
