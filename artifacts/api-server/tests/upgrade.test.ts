import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { pool } from "@workspace/db";
import app from "../src/app";
import { migrateAccounts } from "../src/lib/accounts";
import { loadVault, type Log, type Vault } from "../src/lib/vault";
import { analyzeRecords } from "../src/lib/analyst";

const suffix = randomUUID().slice(0, 8);
const tenants = [`upgrade_${suffix}_a`, `upgrade_${suffix}_b`, `upgrade_${suffix}_race`];
const password = randomUUID();
const cookies: string[] = [];
let server: ReturnType<typeof app.listen>;
let base: string;
async function request(path: string, method = "GET", body?: unknown, cookie?: string) {
  const response = await fetch(base + path, { method,
    headers: { "content-type": "application/json", "x-forwarded-for": `upgrade-${suffix}`, ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
before(async () => {
  await migrateAccounts();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
after(async () => {
  for (const id of tenants) {
    await pool.query("DELETE FROM factory_sessions WHERE factory_id=$1", [id]);
    await pool.query("DELETE FROM factory_invites WHERE user_id IN (SELECT id FROM factory_users WHERE factory_id=$1)", [id]);
    await pool.query("DELETE FROM factory_users WHERE factory_id=$1", [id]);
    await pool.query("DELETE FROM factory_vaults WHERE id=$1", [id]);
  }
  const { tokenHash } = await import("../src/middlewares/factory-auth");
  await pool.query("DELETE FROM factory_login_attempts WHERE id=$1", [tokenHash(`upgrade-${suffix}`)]);
  server?.close(); await pool.end();
});
test("public registration creates empty encrypted factories and owner sessions", async () => {
  for (const tenantId of tenants.slice(0, 2)) {
    const result = await request("/auth/register", "POST", { tenantId, factoryName: `Factory ${tenantId}`, password });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.role, "owner"); assert.equal(result.data.factory, tenantId);
    assert.ok(result.cookie); cookies.push(result.cookie!);
    const vault = await loadVault(tenantId);
    assert.deepEqual(vault.jobs, []); assert.deepEqual(vault.logs, []);
    assert.equal(vault.audit?.[0]?.action, "factory_registered");
    const raw = await pool.query("SELECT payload FROM factory_vaults WHERE id=$1", [tenantId]);
    assert.ok(!raw.rows[0].payload.includes("factory_registered"));
    const session = await request("/auth/session", "GET", undefined, result.cookie);
    assert.equal(session.data.factory, tenantId);
  }
});
test("duplicate/concurrent registration never adopts an existing factory or creates orphan users", async () => {
  const body = { tenantId: tenants[2], factoryName: "Concurrent fixture", password };
  const results = await Promise.all([request("/auth/register", "POST", body), request("/auth/register", "POST", body)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const count = await pool.query("SELECT count(*)::int AS count FROM factory_users WHERE factory_id=$1", [tenants[2]]);
  assert.equal(count.rows[0].count, 1);
  const duplicate = await request("/auth/register", "POST", { ...body, tenantId: tenants[0] });
  assert.equal(duplicate.status, 409); assert.equal(duplicate.data.code, "FACTORY_UNAVAILABLE");
});
test("registration rejects weak passwords, malformed IDs and reserved demo IDs", async () => {
  for (const [tenantId, secret] of [["UPPER-ID", password], ["ab", password], ["valid_tenant_id", "short"], ["factory_carton", password]]) {
    const result = await request("/auth/register", "POST", { tenantId, factoryName: "Fixture", password: secret });
    assert.ok([400, 409].includes(result.status));
  }
});
test("new factories keep operational records and analyst evidence isolated", async () => {
  const job = await request("/jobs", "POST", { name: `Private order ${suffix}`, machineId: "m1", target: 100,
    startDate: "2026-10-11", dueDate: "2026-10-12", startTime: "08:00" }, cookies[0]);
  assert.equal(job.status, 200);
  const log = await request("/logs", "POST", { jobId: job.data.id, staff: "Operator",
    date: "2026-10-11", time: "10:00", goodQty: 90, rejects: 10, downtimeMinutes: 12, reason: "Alignment" }, cookies[0]);
  assert.equal(log.status, 200, JSON.stringify(log.data));
  const answer = await request("/analyst", "POST", { question: "What caused downtime?", language: "en", jobId: job.data.id }, cookies[0]);
  assert.equal(answer.status, 200);
  assert.equal(answer.data.intent, "bottlenecks"); assert.equal(answer.data.sourceCount, 1);
  assert.equal(answer.data.evidence[0].id, log.data.id);
  assert.ok(answer.data.answerEn.includes(log.data.id)); assert.ok(answer.data.answerAr.includes(log.data.id));
  const foreign = await request("/analyst", "POST", { question: "What caused downtime?", language: "en", jobId: job.data.id }, cookies[1]);
  assert.equal(foreign.data.sourceCount, 0); assert.deepEqual(foreign.data.evidence, []);
  assert.ok(!foreign.data.answer.includes(job.data.name));
  const dispatch = await request(`/jobs/${job.data.id}/dispatch`, "POST", undefined, cookies[1]);
  assert.equal(dispatch.status, 404);
  const badDate = await request("/analyst", "POST", { question: "summary", language: "en", fromDate: "2026-02-30" }, cookies[0]);
  assert.equal(badDate.status, 400);
});

const log = (id: string, date: string, goodQty: number, rejects: number, downtimeMinutes: number): Log => ({
  id, date, goodQty, rejects, downtimeMinutes, jobId: "job-a", machineId: "m1", staff: "Operator A",
  time: "09:15", reason: "Recorded alignment issue", qcStatus: "pending", qcNote: "", createdAt: `${date}T09:15:00Z`,
});
const fixture: Vault = { jobs: [], logs: [log("source-a", "2026-10-10", 90, 10, 10), log("source-b", "2026-10-11", 80, 20, 20)] };
test("analyst calculates factual totals, date scopes and evidence without treating missing days as zero", () => {
  const result = analyzeRecords(fixture, { question: "financial losses", language: "en" });
  assert.ok(result.answerEn.includes("$195.00")); assert.equal(result.sourceCount, 2);
  const scoped = analyzeRecords(fixture, { question: "summary 2026-10-11", language: "en" });
  assert.equal(scoped.sourceCount, 1); assert.equal(scoped.evidence[0]?.id, "source-b");
  assert.ok(scoped.answerEn.includes("$130.00"));
  const trend = analyzeRecords(fixture, { question: "hidden failure trends", language: "en" });
  assert.equal(trend.intent, "trends"); assert.ok(trend.answerEn.includes("2 records"));
  assert.ok(trend.answerEn.includes("cannot establish hidden failures"));
  assert.throws(() => analyzeRecords(fixture, { question: "summary", language: "en", fromDate: "2026-10-12", toDate: "2026-10-10" }));
});
test("operator yield is not misrepresented as labor efficiency and unsupported questions decline", () => {
  const answer = analyzeRecords(fixture, { question: "operator efficiency", language: "en" });
  assert.equal(answer.intent, "operators"); assert.ok(answer.answerEn.includes("85.00%"));
  assert.ok(answer.answerEn.includes("cannot be determined or fairly ranked"));
  const unsupported = analyzeRecords(fixture, { question: "What is tomorrow's weather?", language: "ar" });
  assert.equal(unsupported.intent, "unsupported"); assert.equal(unsupported.sourceCount, 0);
  assert.deepEqual(unsupported.evidence, []); assert.equal(unsupported.answer, unsupported.answerAr);
  for (const [question, intent] of [["لخّص هذا النطاق.", "summary"], ["قارن عائد المشغّلين.", "operators"], ["كيف يتجه الإنتاج اليومي؟", "trends"]]) {
    assert.equal(analyzeRecords(fixture, { question: question!, language: "ar" }).intent, intent);
  }
});
