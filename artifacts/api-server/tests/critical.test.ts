import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import app from "../src/app";
import { pool } from "@workspace/db";
import { decrypt, encrypt, hashPassword, loadVault, mutateVault } from "../src/lib/vault";
import { tokenHash } from "../src/middlewares/factory-auth";
import { summarize } from "../src/lib/analytics";
import { migrateAccounts } from "../src/lib/accounts";

// Unique, empty fixtures only. Never reset or mutate the demo/live factories.
const tenants = [0, 1].map(() => `regression_${randomUUID()}`);
const password = randomUUID();
const cookies: string[] = [];
let server: ReturnType<typeof app.listen>;
let base: string;
const jobInput = { name: "Regression run", machineId: "m1", target: 10, startDate: "2026-10-11", dueDate: "2026-10-12", startTime: "08:00" };
const logInput = (jobId: string, goodQty = 10) => ({ jobId, staff: "Test operator", date: "2026-10-11", time: "09:00", goodQty, rejects: 0, downtimeMinutes: 0, reason: "" });
async function request(path: string, method = "GET", body?: unknown, cookie = cookies[0]) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), response };
}
async function ok(path: string, method = "GET", body?: unknown, cookie?: string) {
  const r = await request(path, method, body, cookie);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
before(async () => {
  await migrateAccounts();
  for (const id of tenants) {
    await pool.query("INSERT INTO factory_vaults(id,name,password_hash,payload) VALUES($1,$2,$3,$4)",
      [id, "Regression fixture", hashPassword(password), encrypt(id, { jobs: [], logs: [] })]);
    await pool.query("INSERT INTO factory_users(id,factory_id,username,name,role,password_hash) VALUES($1,$1,$1,$2,'owner',$3)",
      [id, "Regression owner", hashPassword(password)]);
  }
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api`;
  for (const username of tenants) {
    const r = await request("/auth/login", "POST", { username, password }, "");
    assert.equal(r.status, 200);
    cookies.push(r.response.headers.get("set-cookie")!.split(";")[0]!);
  }
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  try {
    await pool.query("DELETE FROM factory_sessions WHERE factory_id = ANY($1::text[])", [tenants]);
    await pool.query("DELETE FROM factory_users WHERE factory_id = ANY($1::text[])", [tenants]);
    await pool.query("DELETE FROM factory_vaults WHERE id = ANY($1::text[])", [tenants]);
  } finally { await pool.end(); }
});

test("signed-out denial on every protected read and mutation", async () => {
  for (const [path, method, body] of [
    ["/summary", "GET"], ["/jobs", "GET"], ["/logs", "GET"],
    ["/jobs", "POST", jobInput], ["/logs", "POST", logInput(randomUUID())],
    [`/logs/${randomUUID()}/quality`, "PATCH", { status: "approved", note: "ok" }],
    [`/jobs/${randomUUID()}/dispatch`, "POST"], ["/analyst", "POST", { question: "output", language: "en" }],
  ] as const) assert.equal((await request(path, method, body, "")).status, 401, path);
});

test("tenant reads, forged tenant fields, foreign mutations and analyst sources remain private", async () => {
  const job = await ok("/jobs", "POST", { ...jobInput, factory: tenants[1] });
  const log = await ok("/logs", "POST", logInput(job.id));
  assert.deepEqual(await ok(`/jobs?factory=${tenants[0]}`, "GET", undefined, cookies[1]), []);
  assert.deepEqual(await ok("/logs", "GET", undefined, cookies[1]), []);
  const { updatedAt, ...summary } = await ok("/summary", "GET", undefined, cookies[1]);
  const { updatedAt: _generated, ...emptySummary } = summarize({ jobs: [], logs: [] });
  assert(Number.isFinite(Date.parse(updatedAt)));
  assert.deepEqual(summary, emptySummary);
  for (const [path, method, body] of [
    ["/logs", "POST", logInput(job.id)],
    [`/logs/${log.id}/quality`, "PATCH", { status: "approved", note: "foreign" }],
    [`/jobs/${job.id}/dispatch`, "POST"],
  ] as const) assert.equal((await request(path, method, body, cookies[1])).status, 404);
  const answer = await ok("/analyst", "POST", { question: "output", language: "en" }, cookies[1]);
  assert.equal(answer.sourceCount, 0);
  assert.equal((await loadVault(tenants[0]!)).logs.find(l => l.id === log.id)?.qcStatus, "pending");
});

test("invalid quantities and calendar/time inputs do not change persisted data", async () => {
  const job = await ok("/jobs", "POST", jobInput);
  const before = await loadVault(tenants[0]!);
  for (const target of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.equal((await request("/jobs", "POST", { ...jobInput, target })).status, 400);
  }
  for (const patch of [{ startDate: "2026-02-30" }, { dueDate: "2026-10-10" }, { startTime: "24:00" }, { dueDate: "bad" }]) {
    assert.equal((await request("/jobs", "POST", { ...jobInput, ...patch })).status, 400);
  }
  for (const patch of [
    { goodQty: -1 }, { rejects: -1 }, { goodQty: 0.5 }, { goodQty: null },
    { downtimeMinutes: -1 }, { downtimeMinutes: 1441 }, { goodQty: Number.MAX_SAFE_INTEGER + 1 },
    { date: "2026-02-30" }, { date: "2026-10-10" },
    { time: "12:60" }, { goodQty: 0 }, { downtimeMinutes: 1, reason: "" },
  ]) assert.equal((await request("/logs", "POST", { ...logInput(job.id), ...patch })).status, 400, JSON.stringify(patch));
  assert.deepEqual(await loadVault(tenants[0]!), before);
});

test("concurrent vault writes persist, rollback is atomic, and ciphertext is tenant-bound", async () => {
  const job = await ok("/jobs", "POST", { ...jobInput, target: 100 });
  const logs = await Promise.all(Array.from({ length: 16 }, () => ok("/logs", "POST", logInput(job.id, 1))));
  assert.equal(new Set(logs.map(l => l.id)).size, 16);
  const vault = await loadVault(tenants[0]!);
  assert.equal(vault.jobs.find(j => j.id === job.id)?.goodQty, 16);
  assert.equal(vault.logs.filter(l => l.jobId === job.id).length, 16);
  await assert.rejects(mutateVault(tenants[0]!, v => { v.jobs.length = 0; throw new Error("rollback probe"); }));
  assert.deepEqual(await loadVault(tenants[0]!), vault);
  const { rows } = await pool.query("SELECT payload FROM factory_vaults WHERE id=$1", [tenants[0]]);
  const payload = rows[0].payload;
  assert(!payload.includes(job.name));
  assert.deepEqual(decrypt(tenants[0]!, payload), vault);
  assert.throws(() => decrypt(tenants[1]!, payload));
  const parts = payload.split(".");
  const bytes = Buffer.from(parts[2], "base64"); bytes[0] ^= 1;
  parts[2] = bytes.toString("base64");
  assert.throws(() => decrypt(tenants[0]!, parts.join(".")));
  assert.notEqual(encrypt(tenants[0]!, vault), encrypt(tenants[0]!, vault));
  // A separate HTTP read models a fresh client/reload rather than a client cache.
  assert.deepEqual(await ok("/jobs"), vault.jobs);
});

test("dispatch requires target AND every approval; QC and dispatch decisions are one-time", async () => {
  const job = await ok("/jobs", "POST", jobInput);
  const dispatch = () => request(`/jobs/${job.id}/dispatch`, "POST");
  assert.equal((await dispatch()).status, 409);
  const first = await ok("/logs", "POST", logInput(job.id, 5));
  const review = (id: string, status = "approved") => request(`/logs/${id}/quality`, "PATCH", { status, note: "Verified" });
  assert.equal((await review(first.id)).status, 200);
  assert.equal((await dispatch()).status, 409);
  const second = await ok("/logs", "POST", logInput(job.id, 5));
  assert.equal((await dispatch()).status, 409);
  const decisions = await Promise.all([review(second.id), review(second.id)]);
  assert.deepEqual(decisions.map(r => r.status).sort(), [200, 409]);
  assert.equal((await review(second.id, "rejected")).status, 409);
  const dispatches = await Promise.all([dispatch(), dispatch()]);
  assert.deepEqual(dispatches.map(r => r.status).sort(), [200, 409]);
  assert.equal((await request("/logs", "POST", logInput(job.id))).status, 409);
  const rejectedJob = await ok("/jobs", "POST", jobInput);
  const rejectedLog = await ok("/logs", "POST", logInput(rejectedJob.id));
  assert.equal((await review(rejectedLog.id, "rejected")).status, 200);
  assert.equal((await request(`/jobs/${rejectedJob.id}/dispatch`, "POST")).status, 409);
});

test("analyst replies include both languages for existing-answer switching", async () => {
  const en = await ok("/analyst", "POST", { question: "output", language: "en" });
  const ar = await ok("/analyst", "POST", { question: "output", language: "ar" });
  assert.equal(en.answer, en.answerEn);
  assert.equal(ar.answer, ar.answerAr);
  assert.equal(en.answerAr, ar.answerAr);
  assert.match(en.answerAr, /[\u0600-\u06ff]/);
  assert.notEqual(en.answerEn, en.answerAr);
});

test("expired sessions and logout revoke every client sharing that session", async () => {
  await pool.query("UPDATE factory_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
    [tokenHash(cookies[0]!.split("=")[1]!)]);
  for (let tab = 0; tab < 2; tab++) {
    assert.equal((await ok("/auth/session")).authenticated, false);
    assert.equal((await request("/jobs")).status, 401);
    assert.equal((await request("/jobs", "POST", jobInput)).status, 401);
  }
  await ok("/auth/logout", "POST", undefined, cookies[1]);
  for (let tab = 0; tab < 2; tab++) {
    assert.equal((await ok("/auth/session", "GET", undefined, cookies[1])).authenticated, false);
    assert.equal((await request("/logs", "GET", undefined, cookies[1])).status, 401);
  }
});
