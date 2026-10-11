import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "playwright";
import { pool } from "@workspace/db";
import { encrypt, hashPassword } from "../src/lib/vault";
import { migrateAccounts } from "../src/lib/accounts";

const base = process.env.E2E_BASE_URL || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
if (!base) throw new Error("Set E2E_BASE_URL to the development preview");
const visible = (page: Page, id: string) => page.getByTestId(id).first().waitFor({ state: "visible", timeout: 20_000 });

test("signed-in production, reload, bilingual analyst, mobile RTL and cross-tab session regression", { timeout: 240_000 }, async () => {
  const id = `regression_browser_${randomUUID()}`;
  const password = randomUUID();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await migrateAccounts();
    await pool.query("INSERT INTO factory_vaults(id,name,password_hash,payload) VALUES($1,$2,$3,$4)",
      [id, "Browser regression fixture", hashPassword(password), encrypt(id, { jobs: [], logs: [] })]);
    await pool.query("INSERT INTO factory_users(id,factory_id,username,name,role,password_hash) VALUES($1,$1,$1,$2,'owner',$3)",
      [id, "Browser regression owner", hashPassword(password)]);
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/jobs`);
    await visible(page, "button-login");
    const login = async () => {
      await page.getByTestId("input-username").fill(id);
      await page.getByTestId("input-password").fill(password);
      const responsePromise = page.waitForResponse(r => r.url().endsWith("/api/auth/login") && r.request().method() === "POST");
      await page.getByTestId("button-login").click();
      const response = await responsePromise;
      assert.equal(response.status(), 200, `Temporary factory login returned HTTP ${response.status()}`);
      assert.equal((await response.json()).authenticated, true, "Temporary factory credentials must authenticate");
      try { await visible(page, "button-logout"); }
      catch (error) {
        const session = await page.evaluate(async () => (await fetch("/api/auth/session")).json());
        const ui = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, ids: [...document.querySelectorAll("[data-testid]")].map(e => e.getAttribute("data-testid")), path: location.pathname }));
        throw new Error(`Authenticated login did not render signed-in shell; session=${JSON.stringify(session)}, ui=${JSON.stringify(ui)}, loginError=${await page.getByTestId("text-login-error").allInnerTexts().catch(() => [])}; ${String(error)}`);
      }
    };
    await login();
    await page.goto(`${base}/jobs`);
    await visible(page, "input-job-name");
    await page.getByTestId("input-job-name").fill("Browser persisted job");
    await page.locator('[data-testid="select-machine"] option[value="m1"]').waitFor({ state: "attached", timeout: 20_000 });
    await page.getByTestId("select-machine").selectOption("m1");
    await page.getByTestId("input-target").fill("10");
    const today = new Date().toISOString().slice(0, 10);
    await page.getByTestId("input-start-date").fill(today);
    await page.getByTestId("input-due-date").fill(today);
    await page.getByTestId("input-start-time").fill("08:00");
    const created = page.waitForResponse(r => r.url().endsWith("/api/jobs") && r.request().method() === "POST");
    await page.getByTestId("button-create-job").click();
    const response = await created;
    assert.equal(response.status(), 200);
    const job = await response.json();
    await page.reload();
    const persistedJobs = await page.evaluate(async () => await (await fetch("/api/jobs")).json());
    assert(persistedJobs.some((item: { id: string }) => item.id === job.id), "Created job must persist in the jobs API after reload");
    try { await visible(page, `row-job-${job.id}`); }
    catch (error) {
      await page.screenshot({ path: "/tmp/nexusfab-after-job-reload.png", fullPage: true });
      const ids = await page.locator("[data-testid]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-testid")));
      throw new Error(`Persisted job is absent from rendered jobs list; page testids=${JSON.stringify(ids)}; pageErrors=${JSON.stringify(errors)}; ${String(error)}`);
    }
    assert.equal(await page.getByTestId(`button-dispatch-${job.id}`).isDisabled(), true, "Dispatch stays disabled until target is met");
    await page.screenshot({ path: "/tmp/nexusfab-browser-desktop.png", fullPage: true });
    await page.goto(`${base}/production`);
    await page.getByTestId("select-job").selectOption(job.id);
    await page.getByTestId("input-staff").fill("Browser operator");
    await page.getByTestId("input-good").fill("10");
    await page.getByTestId("input-date").fill(today);
    await page.getByTestId("input-time").fill("09:00");
    const logged = page.waitForResponse(r => r.url().endsWith("/api/logs") && r.request().method() === "POST");
    await page.getByTestId("button-submit-log").click();
    const logResponse = await logged;
    assert.equal(logResponse.status(), 200);
    const log = await logResponse.json();
    await page.reload();
    await visible(page, `row-log-${log.id}`);
    await page.goto(`${base}/jobs`);
    await visible(page, `button-dispatch-${job.id}`);
    const pendingLogs = await page.evaluate(async () => await (await fetch("/api/logs")).json());
    assert(pendingLogs.some((item: { id: string; qcStatus: string }) => item.id === log.id && item.qcStatus === "pending"), "New production log must remain pending QC");
    await page.waitForFunction((id) => {
      const button = document.querySelector(`[data-testid="button-dispatch-${id}"]`) as HTMLButtonElement | null;
      return button?.disabled === true;
    }, job.id, { timeout: 20_000 });
    assert.equal(await page.getByTestId(`button-dispatch-${job.id}`).isDisabled(), true, "Dispatch stays disabled while QC is pending");
    await page.goto(`${base}/quality`);
    await visible(page, `card-review-${log.id}`);
    await page.getByTestId(`input-note-${log.id}`).fill("Browser verified");
    await page.getByTestId(`button-approve-${log.id}`).click();
    await visible(page, `row-decision-${log.id}`);
    await page.reload();
    await visible(page, `row-decision-${log.id}`);
    await page.goto(`${base}/jobs`);
    await visible(page, `button-dispatch-${job.id}`);
    assert.equal(await page.getByTestId(`button-dispatch-${job.id}`).isDisabled(), false, "Dispatch is enabled after target and QC approval");
    const dispatched = page.waitForResponse(r => r.url().includes(`/api/jobs/${job.id}/dispatch`) && r.request().method() === "POST");
    await page.getByTestId(`button-dispatch-${job.id}`).click();
    const dispatchResponse = await dispatched;
    assert.equal(dispatchResponse.status(), 200);
    await page.waitForFunction((id) => document.querySelector(`[data-testid="status-job-${id}"]`)?.textContent?.toLowerCase().includes("dispatched"), job.id, { timeout: 20_000 });
    await visible(page, `status-job-${job.id}`);
    assert.match(await page.getByTestId(`status-job-${job.id}`).innerText(), /dispatched/i);
    await page.reload();
    await page.waitForFunction((id) => document.querySelector(`[data-testid="status-job-${id}"]`)?.textContent?.toLowerCase().includes("dispatched"), job.id, { timeout: 20_000 });
    await visible(page, `status-job-${job.id}`);
    assert.match(await page.getByTestId(`status-job-${job.id}`).innerText(), /dispatched/i);

    await page.goto(`${base}/copilot`);
    await page.getByTestId("input-question").fill("What is our output?");
    await page.getByTestId("button-ask").click();
    await visible(page, "text-answer-0");
    const en = await page.getByTestId("text-answer-0").innerText();
    await page.getByTestId("button-lang-ar").first().click();
    await page.waitForFunction(() => document.documentElement.dir === "rtl");
    const ar = await page.getByTestId("text-answer-0").innerText();
    assert.notEqual(ar, en);
    assert.match(ar, /[\u0600-\u06ff]/);
    await page.getByTestId("button-lang-en").first().click();
    assert.equal(await page.getByTestId("text-answer-0").innerText(), en);
    await page.getByTestId("button-lang-ar").first().click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dir === "rtl");
    await visible(page, "button-menu");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Mobile RTL must not overflow viewport");
    await page.screenshot({ path: "/tmp/nexusfab-browser-mobile-rtl.png", fullPage: true });
    await page.getByTestId("button-menu").click();
    await visible(page, "button-close-menu");
    await page.locator("div.fixed.inset-0.z-40 > div.absolute.inset-0").click({ position: { x: 25, y: 400 }, force: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByTestId("button-lang-en").first().click();

    const tab = await context.newPage();
    await tab.goto(`${base}/jobs`);
    await visible(tab, `row-job-${job.id}`);
    await page.getByTestId("button-logout").first().click();
    await visible(page, "button-login");
    await visible(tab, "button-login");
    assert.equal(await tab.getByTestId(`row-job-${job.id}`).count(), 0);
    await login();
    await visible(tab, "button-logout");
    await pool.query("UPDATE factory_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE factory_id=$1", [id]);
    // Exercise the actual polling interval in both open tabs, not a mocked session API.
    await Promise.all([page, tab].map(p => p.getByTestId("button-login").waitFor({ state: "visible", timeout: 135_000 })));
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser?.close();
    try {
      await pool.query("DELETE FROM factory_sessions WHERE factory_id=$1", [id]);
      await pool.query("DELETE FROM factory_users WHERE factory_id=$1", [id]);
      await pool.query("DELETE FROM factory_vaults WHERE id=$1", [id]);
    } finally { await pool.end(); }
  }
});
