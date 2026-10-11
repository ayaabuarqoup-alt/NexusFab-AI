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
// Express trusts one proxy hop. Unique synthetic addresses keep these tests
// independent of preview traffic and other regression runs.
const clientAddresses = new Set<string>();
function newClientAddress() {
  const hex = randomUUID().replaceAll("-", "");
  const address = `fd00:${hex.match(/.{4}/g)!.slice(0, 7).join(":")}`;
  clientAddresses.add(address);
  return address;
}
const defaultClientAddress = newClientAddress();
let server: ReturnType<typeof app.listen>;
let base: string;
const jobInput = { name: "Regression run", machineId: "m1", target: 10, startDate: "2026-10-11", dueDate: "2026-10-12", startTime: "08:00" };
const logInput = (jobId: string, goodQty = 10) => ({ jobId, staff: "Test operator", date: "2026-10-11", time: "09:00", goodQty, rejects: 0, downtimeMinutes: 0, reason: "" });
async function request(path: string, method = "GET", body?: unknown, cookie = cookies[0], headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json", "x-forwarded-for": defaultClientAddress, ...(cookie ? { cookie } : {}), ...headers },
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
    assert.equal((await request("/auth/role", "POST", { role: "owner" }, cookies.at(-1))).status, 200);
  }
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  try {
    await pool.query("DELETE FROM factory_login_attempts WHERE id = ANY($1::text[])",
      [[...clientAddresses].map(tokenHash)]);
    await pool.query("DELETE FROM factory_sessions WHERE factory_id = ANY($1::text[])", [tenants]);
    await pool.query("DELETE FROM factory_users WHERE factory_id = ANY($1::text[])", [tenants]);
    await pool.query("DELETE FROM factory_vaults WHERE id = ANY($1::text[])", [tenants]);
  } finally { await pool.end(); }
});

test("mutation origin checks reject forged requests without changing factory data", async () => {
  const origin = new URL(base).origin;
  const before = await loadVault(tenants[0]!);
  for (const headers of [
    { origin: "https://attacker.invalid" },
    { origin: "not a URL" },
    { origin: "null" },
    { origin: "https://" },
    { origin: `${origin}.attacker.invalid` },
    { "sec-fetch-site": "cross-site" },
    { origin, "sec-fetch-site": "cross-site" },
    // Only the first forwarded host is accepted, not any host in the list.
    { origin: "https://attacker.invalid", "x-forwarded-host": "factory.example, attacker.invalid" },
  ] as Record<string, string>[]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await request("/jobs", method, jobInput, cookies[0], headers);
      assert.equal(r.status, 403, `${method} ${JSON.stringify(headers)}`);
      assert.equal(r.body.code, "FORBIDDEN");
      assert.equal(r.response.headers.get("set-cookie"), null);
    }
  }
  assert.deepEqual(await loadVault(tenants[0]!), before);

  // Forged login requests must be rejected before they consume a login attempt.
  const ip = newClientAddress();
  const denied = await request("/auth/login", "POST", { username: tenants[0], password }, "",
    { origin: "https://attacker.invalid", "x-forwarded-for": ip });
  assert.equal(denied.status, 403);
  assert.equal((await pool.query("SELECT id FROM factory_login_attempts WHERE id=$1", [tokenHash(ip)])).rowCount, 0);
});

test("same-origin, proxy-host and headerless mutations pass; safe methods bypass origin enforcement", async () => {
  for (const headers of [
    {},
    { origin: new URL(base).origin, "sec-fetch-site": "same-origin" },
    { origin: "https://factory.example", "x-forwarded-host": " factory.example , proxy.internal" },
  ] as Record<string, string>[]) {
    // Logout with no cookie is a harmless real mutation endpoint.
    assert.equal((await request("/auth/logout", "POST", undefined, "", headers)).status, 200);
  }
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    const r = await fetch(`${base}/auth/session`, {
      method, headers: { origin: "malformed origin", "sec-fetch-site": "cross-site" },
    });
    assert.equal(r.status, 200, method);
    await r.arrayBuffer();
  }
});

test("login attempts allow 15, block 16 and later, isolate clients, and reset after expiry", async () => {
  const ip = newClientAddress();
  const headers = { "x-forwarded-for": ip };
  const invalid = { username: tenants[0], password: `${password}-wrong` };
  const valid = { username: tenants[0], password };
  const started = Date.now();
  // Both input-validation failures and bad credentials consume the same limit.
  for (let attempt = 1; attempt <= 15; attempt++) {
    const r = await request("/auth/login", "POST", attempt === 1 ? {} : invalid, "", headers);
    assert.equal(r.status, attempt === 1 ? 400 : 401, `attempt ${attempt}`);
    assert.equal(r.response.headers.get("retry-after"), null);
    assert.equal(r.response.headers.get("set-cookie"), null);
  }
  const { rows: [bucket] } = await pool.query("SELECT * FROM factory_login_attempts WHERE id=$1", [tokenHash(ip)]);
  assert.equal(bucket.count, 15);
  const expires = new Date(bucket.expires_at).getTime();
  assert(expires >= started + 900_000 && expires <= Date.now() + 900_000);
  for (const body of [valid, invalid]) {
    const r = await request("/auth/login", "POST", body, "", headers);
    assert.equal(r.status, 429);
    assert.equal(r.body.code, "RATE_LIMITED");
    assert.equal(r.response.headers.get("retry-after"), "900");
    assert.equal(r.response.headers.get("set-cookie"), null);
  }
  const { rows: [blocked] } = await pool.query("SELECT count,expires_at FROM factory_login_attempts WHERE id=$1", [tokenHash(ip)]);
  assert.equal(blocked.count, 17);
  assert.equal(new Date(blocked.expires_at).getTime(), expires, "blocked attempts do not extend the window");
  assert.equal((await request("/auth/login", "POST", valid, "",
    { "x-forwarded-for": newClientAddress() })).status, 200);
  // Move only this fixture's window into the past rather than waiting 15 minutes.
  await pool.query("UPDATE factory_login_attempts SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [tokenHash(ip)]);
  assert.equal((await request("/auth/login", "POST", valid, "", headers)).status, 200);
  const { rows: [reset] } = await pool.query("SELECT count,expires_at FROM factory_login_attempts WHERE id=$1", [tokenHash(ip)]);
  assert.equal(reset.count, 1);
  assert(new Date(reset.expires_at).getTime() > Date.now());
});

test("production login and logout issue matching Secure, HttpOnly, SameSite cookies", async () => {
  // Tests run sequentially. This changes cookie configuration only, not the
  // existing development pool or its disposable factory fixtures.
  const previous = process.env.NODE_ENV;
  const headers = { "x-forwarded-for": newClientAddress() };
  try {
    for (const mode of ["development", "production"]) {
      process.env.NODE_ENV = mode;
      const login = await request("/auth/login", "POST", { username: tenants[0], password }, "", headers);
      assert.equal(login.status, 200);
      const issued = login.response.headers.get("set-cookie")!;
      assert.match(issued, /^nexus_session=[a-f0-9]{64};/);
      assert.match(issued, /;\s*Max-Age=43200(?:;|$)/);
      const sessionCookie = issued.split(";")[0]!;
      assert.equal((await request("/auth/session", "GET", undefined, sessionCookie)).body.authenticated, true);
      const logout = await request("/auth/logout", "POST", undefined, sessionCookie);
      assert.equal(logout.status, 200);
      const cleared = logout.response.headers.get("set-cookie")!;
      assert.match(cleared, /^nexus_session=;/);
      assert.match(cleared, /;\s*Expires=Thu, 01 Jan 1970 00:00:00 GMT(?:;|$)/);
      for (const value of [issued, cleared]) {
        assert.match(value, /;\s*HttpOnly(?:;|$)/);
        assert.match(value, /;\s*SameSite=Lax(?:;|$)/);
        assert.match(value, /;\s*Path=\/(?:;|$)/);
        assert.equal(/;\s*Secure(?:;|$)/.test(value), mode === "production");
        assert.doesNotMatch(value, /;\s*Domain=/i);
      }
      assert.equal((await request("/auth/session", "GET", undefined, sessionCookie)).body.authenticated, false);
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
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
