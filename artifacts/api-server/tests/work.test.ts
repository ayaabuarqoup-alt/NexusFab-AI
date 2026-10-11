import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import app from "../src/app";
import { encrypt, hashPassword, loadVault } from "../src/lib/vault";
import { tokenHash } from "../src/middlewares/factory-auth";
import { deliverEmail } from "../src/lib/email-worker";
import { EmailFailure, encodeAlertEmail } from "../src/lib/alert-email";
import { startRealtime } from "../src/lib/realtime";
const tenant = `work_${randomUUID()}`, foreign = `${tenant}_foreign`, password = randomUUID();
let server: ReturnType<typeof app.listen>, base: string, stopLive: () => Promise<void>;
const cookies: Record<string,string> = {};
async function req(path: string, method = "GET", data?: unknown, role = "owner") {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", cookie: cookies[role] ?? "", "x-forwarded-for": tenant },
    body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: r.status, data: await r.json(), cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
before(async () => {
  for (const id of [tenant, foreign]) await pool.query("INSERT INTO factory_vaults(id,name,password_hash,payload) VALUES($1,'Test factory',$2,$3)", [id,hashPassword(password),encrypt(id,{jobs:[],logs:[]})]);
  for (const role of ["owner","operator","quality_inspector","foreign"]) {
    const id = `${tenant}_${role}`;
    await pool.query("INSERT INTO factory_users(id,factory_id,username,name,role,password_hash) VALUES($1,$2,$1,$3,$4,$5)",
      [id,role==="foreign"?foreign:tenant,role,role==="foreign"?"owner":role,hashPassword(password)]);
  }
  stopLive = await startRealtime();
  server=app.listen(0,"127.0.0.1"); await once(server,"listening");
  base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
  for (const role of ["owner","operator","quality_inspector","foreign"]) {
    const login=await req("/auth/login","POST",{username:`${tenant}_${role}`,password},role);
    cookies[role]=login.cookie;
    assert.equal((await req("/auth/role","POST",{role:role==="foreign"?"owner":role},role)).status,200);
  }
});
after(async () => {
  await stopLive();
  server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r()));
  await pool.query("DELETE FROM factory_sessions WHERE factory_id=ANY($1::text[])",[[tenant,foreign]]);
  await pool.query("DELETE FROM factory_users WHERE factory_id=ANY($1::text[])",[[tenant,foreign]]);
  await pool.query("DELETE FROM factory_vaults WHERE id=ANY($1::text[])",[[tenant,foreign]]);
  await pool.query("DELETE FROM factory_login_attempts WHERE id=$1",[tokenHash(tenant)]);
  await pool.end();
});
test("operator machine changes persist, create recipient-only live alerts, and never cross factories", async () => {
  const controller=new AbortController();
  const stream=await fetch(base+"/events",{headers:{cookie:cookies.owner},signal:controller.signal});
  const reader=stream.body!.getReader(), decoder=new TextDecoder();
  const alertPromise=(async()=>{let text=""; while(!text.includes('"type":"alert"')) {const chunk=await reader.read(); if(chunk.done)throw Error("Stream ended");text+=decoder.decode(chunk.value);} return text;})();
  const timeout=setTimeout(()=>controller.abort(),5000);
  try {
    assert.equal((await req("/machines/m1/status","PATCH",{status:"stopped",note:"Bearing failure"},"operator")).status,200);
    assert.match(await alertPromise,/"notificationId"/);
  } finally { clearTimeout(timeout); controller.abort(); }
  assert.equal((await req("/machines")).data[0].status,"stopped");
  assert.equal((await req("/machines", "GET",undefined,"foreign")).data[0].status,"unknown");
  assert.equal((await req("/notifications")).data.length,1);
  assert.equal((await req("/notifications","GET",undefined,"quality_inspector")).data.length,1);
  assert.equal((await req("/notifications","GET",undefined,"operator")).status,403);
  assert.equal((await req("/notifications","GET",undefined,"foreign")).data.length,0);
  await req("/machines/m1/status","PATCH",{status:"stopped",note:"Bearing failure"},"operator");
  assert.equal((await req("/notifications")).data.length,1);
  assert.equal((await req("/machines/m1/status","PATCH",{status:"maintenance",note:""},"operator")).status,400);
  assert.equal((await req("/machines/m1/status","PATCH",{status:"running",note:""},"quality_inspector")).status,403);
  await req("/machines/m1/status","PATCH",{status:"maintenance",note:"Repair scheduled"},"operator");
  assert.equal((await req("/notifications")).data.length,2);
});
let jobId: string;
test("work orders, QC, issue resolution, and shipping enforce active-role and approval gates",async()=>{
  const input={name:"Daily order",machineId:"m1",target:10,startDate:"2026-10-11",dueDate:"2026-10-11",startTime:"08:00"};
  const job=await req("/jobs","POST",input,"operator");assert.equal(job.status,200);jobId=job.data.id;
  assert.equal((await req(`/jobs/${jobId}`,"PATCH",{...input,name:"Updated order"},"operator")).status,200);
  assert.equal((await req(`/jobs/${jobId}`,"PATCH",input,"quality_inspector")).status,403);
  assert.equal((await req(`/jobs/${jobId}`,"PATCH",input,"foreign")).status,404);
  assert.equal((await req(`/jobs/${jobId}/shipping`,"PATCH",{status:"ready"},"operator")).status,409);
  const log=await req("/logs","POST",{jobId,staff:"Ignored",date:"2026-10-11",time:"09:00",goodQty:10,rejects:0,downtimeMinutes:0,reason:""},"operator");
  assert.equal(log.status,200);
  assert.equal((await req(`/jobs/${jobId}/shipping`,"PATCH",{status:"ready"},"operator")).status,409);
  assert.equal((await req(`/logs/${log.data.id}/quality`,"PATCH",{status:"approved",note:"Batch checked"},"quality_inspector")).status,200);
  assert.equal((await req(`/jobs/${jobId}/shipping`,"PATCH",{status:"ready"},"operator")).status,200);
  assert.equal((await req(`/jobs/${jobId}/shipping`,"PATCH",{status:"shipped"},"operator")).status,409);
  assert.equal((await req(`/jobs/${jobId}/dispatch`,"POST",undefined,"operator")).status,403);
  assert.equal((await req(`/jobs/${jobId}/dispatch`,"POST")).status,200);
  const delivered=await req(`/jobs/${jobId}/shipping`,"PATCH",{status:"delivered"},"operator");
  assert.equal(delivered.status,200);assert.equal(delivered.data.shippingStatus,"delivered");
  assert.equal((await req(`/jobs/${jobId}/shipping`,"PATCH",{status:"pending"},"operator")).status,409);
  const issue=await req("/issues","POST",{machineId:"m1",jobId,title:"Surface defect",description:"Inspect batch",severity:"high"},"quality_inspector");
  assert.equal(issue.status,200);
  assert.equal((await req(`/issues/${issue.data.id}/resolve`,"POST",{note:"Checked"},"operator")).status,403);
  assert.equal((await req(`/issues/${issue.data.id}/resolve`,"POST",{note:"Checked"},"foreign")).status,404);
  assert.equal((await req(`/issues/${issue.data.id}/resolve`,"POST",{note:"Checked"},"quality_inspector")).status,200);
  assert.equal((await req("/audit","GET",undefined,"operator")).status,403);
  assert.equal((await req("/audit","GET",undefined,"quality_inspector")).status,403);
  const audit=(await req("/audit")).data;
  assert.ok(audit.some((a:{action:string})=>a.action==="login_succeeded"));
  assert.ok(audit.some((a:{action:string;detail:string})=>a.action==="job_updated"&&a.detail.includes("Updated order")));
});
test("notification reads are per user; email settings and retries are admin-only",async()=>{
  const n=(await req("/notifications")).data[0];
  assert.equal((await req(`/notifications/${n.id}/read`,"POST")).status,200);
  assert.equal((await req("/notifications")).data[0].read,true);
  assert.equal((await req("/notifications","GET",undefined,"quality_inspector")).data[0].read,false);
  assert.equal((await req(`/notifications/${n.id}/read`,"POST",undefined,"foreign")).status,404);
  assert.equal((await req("/notification-settings","PATCH",{enabled:true},"operator")).status,403);
  assert.equal((await req("/notification-settings","PATCH",{enabled:true})).status,200);
  await req("/issues","POST",{machineId:"m1",title:"Email test",description:"No external email should be sent",severity:"normal"},"operator");
  const deliveries=(await req("/email-deliveries")).data;
  assert.equal(deliveries.length,2);assert.ok(deliveries.every((d:{status:string})=>d.status==="blocked"));
  assert.equal((await req(`/email-deliveries/${deliveries[0].id}/retry`,"POST")).status,400);
  assert.equal((await req("/email-deliveries","GET",undefined,"quality_inspector")).status,403);
});
test("email delivery records provider acceptance, uncertain responses, and revoked recipients without real mail",async()=>{
  const row=(await pool.query("SELECT * FROM factory_email_outbox WHERE factory_id=$1 LIMIT 1",[tenant])).rows[0];
  await pool.query("UPDATE factory_users SET email='recipient@example.invalid' WHERE id=$1",[row.user_id]);
  row.email="recipient@example.invalid"; row.attempts=1;
  const reset=()=>pool.query("UPDATE factory_email_outbox SET status='sending',email=$1,next_attempt=NOW()+interval '10 minutes' WHERE id=$2",[row.email,row.id]);
  await reset();
  await deliverEmail(row,async email=>{assert.equal(email.recipient,row.email);return "fake-provider-id";});
  assert.equal((await pool.query("SELECT status FROM factory_email_outbox WHERE id=$1",[row.id])).rows[0].status,"sent");
  await reset();
  await deliverEmail(row,async()=>{throw new EmailFailure("TIMEOUT",true);});
  assert.equal((await pool.query("SELECT status FROM factory_email_outbox WHERE id=$1",[row.id])).rows[0].status,"uncertain");
  assert.equal((await req(`/email-deliveries/${row.id}/retry`,"POST")).status,409);
  await reset();
  await pool.query("UPDATE factory_users SET active=false WHERE id=$1",[row.user_id]);
  await deliverEmail(row,async()=>{throw Error("must not send");});
  assert.equal((await pool.query("SELECT status FROM factory_email_outbox WHERE id=$1",[row.id])).rows[0].status,"cancelled");
  await pool.query("UPDATE factory_users SET active=true WHERE id=$1",[row.user_id]);
  const raw=Buffer.from(encodeAlertEmail({id:randomUUID(),recipient:row.email,factoryName:"Factory",title:"عنوان",message:"تفاصيل",actorName:"Inspector",createdAt:new Date().toISOString()},"sender@example.invalid"),"base64url").toString();
  assert.match(raw,/Content-Type: text\/plain; charset="UTF-8"/);
  assert.ok((await loadVault(tenant)).notifications!.length>=3);
});
