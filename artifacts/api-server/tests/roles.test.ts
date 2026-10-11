import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import app from "../src/app";
import { encrypt, hashPassword, loadVault, mutateVault } from "../src/lib/vault";
import { tokenHash } from "../src/middlewares/factory-auth";

const id = `roles_${randomUUID()}`, other = `${id}_other`;
const password = randomUUID(), staffUsername = `staff_${randomUUID()}`;
let server: ReturnType<typeof app.listen>, base: string;
let ownerCookie: string, staffCookie: string, staffId: string, jobId: string, logId: string;
async function req(path: string, method = "GET", body?: unknown, cookie = "", extraHeaders: Record<string, string> = {}) {
  const response = await fetch(base + path, { method,
    headers: { "content-type": "application/json", "x-forwarded-for": id, ...(cookie ? { cookie } : {}), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
before(async () => {
  for (const tenant of [id, other]) {
    await pool.query("INSERT INTO factory_vaults(id,name,password_hash,payload) VALUES($1,$2,$3,$4)",
      [tenant, "Role test factory", hashPassword(password), encrypt(tenant, { jobs: [], logs: [] })]);
    await pool.query("INSERT INTO factory_users(id,factory_id,username,name,role,password_hash) VALUES($1,$1,$1,'Role test owner','owner',$2)", [tenant, hashPassword(password)]);
  }
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.query("DELETE FROM factory_invites WHERE user_id IN (SELECT id FROM factory_users WHERE factory_id=ANY($1::text[]))", [[id, other]]);
  for (const table of ["factory_sessions", "factory_users"]) await pool.query(`DELETE FROM ${table} WHERE factory_id=ANY($1::text[])`, [[id, other]]);
  await pool.query("DELETE FROM factory_vaults WHERE id=ANY($1::text[])", [[id, other]]);
  await pool.query("DELETE FROM factory_login_attempts WHERE id=$1", [tokenHash(id)]);
  await pool.end();
});
test("password login requires explicit role choice even for one legacy approved role", async () => {
  const login = await req("/auth/login", "POST", { username: id, password });
  assert.equal(login.status, 200); ownerCookie = login.cookie;
  assert.equal(login.data.authenticated, true); assert.equal(login.data.role, "");
  assert.equal(login.data.requiresRoleSelection, true); assert.deepEqual(login.data.availableRoles, ["owner"]);
  for (const [path, method, data] of [
    ["/summary", "GET"], ["/jobs", "GET"], ["/logs", "GET"], ["/staff", "GET"], ["/audit", "GET"],
    ["/jobs", "POST", {}], ["/analyst", "POST", { question: "summary", language: "en" }],
  ] as const) {
    const denied = await req(path, method, data, ownerCookie);
    assert.equal(denied.status, 403, path); assert.equal(denied.data.code, "ROLE_SELECTION_REQUIRED");
  }
  assert.equal((await req("/auth/role", "POST", { role: "owner" })).status, 401);
  assert.equal((await req("/auth/role", "POST", { role: "admin" }, ownerCookie)).status, 400);
  assert.equal((await req("/auth/role", "POST", { role: "owner" }, ownerCookie, { origin: "https://evil.invalid" })).status, 403);
  const selected = await req("/auth/role", "POST", { role: "owner" }, ownerCookie);
  assert.equal(selected.status, 200); assert.equal(selected.data.role, "owner");
  assert.equal(selected.data.requiresRoleSelection, false);
  assert.equal((await req("/auth/session", "GET", undefined, ownerCookie)).data.role, "owner");
});
test("owners grant multiple roles through invitations, while users cannot self-grant", async () => {
  const invitation = await req("/staff", "POST", { username: staffUsername, name: "Multi-role staff", role: "operator", roles: ["operator", "quality_inspector"] }, ownerCookie);
  assert.equal(invitation.status, 200);
  assert.equal((await req("/auth/activate", "POST", { token: invitation.data.token, password })).status, 200);
  const login = await req("/auth/login", "POST", { username: staffUsername, password });
  staffCookie = login.cookie; staffId = login.data.userId;
  assert.deepEqual(login.data.availableRoles, ["operator", "quality_inspector"]);
  assert.equal(login.data.requiresRoleSelection, true);
  const denied = await req("/auth/role", "POST", { role: "owner", roles: ["owner"], factory: other }, staffCookie);
  assert.equal(denied.status, 403); assert.equal(denied.data.code, "ROLE_NOT_GRANTED");
  assert.equal((await req("/auth/session", "GET", undefined, staffCookie)).data.factory, id);
  const staff = await req("/staff", "GET", undefined, ownerCookie);
  assert.deepEqual(staff.data.find((u: { id: string }) => u.id === staffId).roles, ["operator", "quality_inspector"]);
  for (const roles of [[], ["operator", "operator"], ["superadmin"]]) {
    assert.equal((await req(`/staff/${staffId}`, "PATCH", { role: "operator", roles, active: true }, ownerCookie)).status, 400);
  }
});
test("only the selected role authorizes mutations; changing selection updates the shared session", async () => {
  assert.equal((await req("/auth/role", "POST", { role: "operator" }, staffCookie)).status, 200);
  const job = await req("/jobs", "POST", { name: "Role gate fixture", machineId: "m1", target: 10, startDate: "2026-10-11", dueDate: "2026-10-12", startTime: "08:00" }, staffCookie);
  assert.equal(job.status, 200); jobId = job.data.id;
  const log = await req("/logs", "POST", { jobId, date: "2026-10-11", time: "09:00", staff: "Spoof", goodQty: 10, rejects: 0, downtimeMinutes: 0, reason: "" }, staffCookie);
  assert.equal(log.status, 200); logId = log.data.id;
  assert.equal((await req(`/logs/${logId}/quality`, "PATCH", { status: "approved", note: "" }, staffCookie)).status, 403);
  assert.equal((await req("/staff", "GET", undefined, staffCookie)).status, 403);
  assert.equal((await req("/auth/role", "POST", { role: "quality_inspector" }, staffCookie)).status, 200);
  assert.equal((await req("/auth/session", "GET", undefined, staffCookie)).data.role, "quality_inspector");
  assert.equal((await req("/jobs", "POST", {}, staffCookie)).status, 403);
  assert.equal((await req(`/logs/${logId}/quality`, "PATCH", { status: "approved", note: "Checked" }, staffCookie)).status, 200);
  assert.equal((await req(`/jobs/${jobId}/dispatch`, "POST", {}, staffCookie)).status, 403);
  const before = await loadVault(id);
  await assert.rejects(mutateVault(id, v => { v.jobs.length = 0; }, {
    userId: staffId, sessionId: tokenHash(staffCookie.split("=")[1]!), roles: ["owner", "operator"],
  }), /FORBIDDEN/);
  assert.deepEqual(await loadVault(id), before);
});
test("changing owner-approved grants invalidates old sessions, blocks removed roles, and preserves tenant isolation", async () => {
  const foreignLogin = await req("/auth/login", "POST", { username: other, password });
  await req("/auth/role", "POST", { role: "owner" }, foreignLogin.cookie);
  assert.equal((await req(`/staff/${staffId}`, "PATCH", { role: "owner", roles: ["owner"], active: true }, foreignLogin.cookie)).status, 404);
  assert.equal((await req(`/staff/${staffId}`, "PATCH", { role: "quality_inspector", roles: ["quality_inspector"], active: true }, ownerCookie)).status, 200);
  assert.equal((await req("/auth/session", "GET", undefined, staffCookie)).data.authenticated, false);
  assert.equal((await req("/auth/role", "POST", { role: "quality_inspector" }, staffCookie)).status, 401);
  const login = await req("/auth/login", "POST", { username: staffUsername, password });
  staffCookie = login.cookie;
  assert.equal(login.data.role, ""); assert.deepEqual(login.data.availableRoles, ["quality_inspector"]);
  assert.equal((await req("/auth/role", "POST", { role: "operator" }, staffCookie)).status, 403);
  assert.equal((await req("/auth/role", "POST", { role: "quality_inspector" }, staffCookie)).status, 200);
  assert.equal((await req(`/staff/${staffId}`, "PATCH", { role: "quality_inspector", roles: ["quality_inspector"], active: false }, ownerCookie)).status, 200);
  assert.equal((await req("/logs", "GET", undefined, staffCookie)).status, 401);
});
