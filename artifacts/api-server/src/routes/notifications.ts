import { Router } from "express";
import { pool } from "@workspace/db";
import { UpdateNotificationSettingsBody } from "@workspace/api-zod";
import { requireFactory, requireRoles } from "../middlewares/factory-auth";
import { audit, loadVault, mutateVault } from "../lib/vault";
import { notificationSettings, validEmail } from "../lib/notifications";
import { factoryEvents } from "../lib/realtime";
import { approvedRoles } from "../lib/roles";
import { OperationError } from "./operations";
const router = Router();
router.use(requireFactory);
router.get("/events", async (_req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  let closed = false, chain = Promise.resolve();
  const send = (data: object) => { if (!closed) res.write(`data: ${JSON.stringify(data)}\n\n`); };
  const validate = async () => {
    const { rows } = await pool.query(`SELECT s.active_role,u.role,u.roles,s.user_id FROM factory_sessions s
      LEFT JOIN factory_users u ON u.id=s.user_id AND u.factory_id=s.factory_id
      WHERE s.id=$1 AND s.factory_id=$2 AND s.expires_at>NOW() AND
      ((u.active=true AND u.password_hash IS NOT NULL) OR (s.user_id IS NULL AND $3::boolean))`,
      [res.locals.sessionId, res.locals.factory, process.env.NODE_ENV !== "production"]);
    const user = rows[0];
    if (!user || user.active_role !== res.locals.role || (user.user_id && !approvedRoles(user).includes(user.active_role))) {
      send({ type: "session" }); res.end(); return false;
    }
    return true;
  };
  const onUpdate = (event: { factoryId: string; notificationId?: string }) => {
    if (closed || event.factoryId !== res.locals.factory) return;
    chain = chain.then(async () => {
      if (closed || !(await validate())) return;
      send({ type: "refresh" });
      if (event.notificationId && ["owner", "quality_inspector", "production_planner"].includes(res.locals.role)) {
        const n = (await loadVault(res.locals.factory)).notifications?.find(n => n.id === event.notificationId);
        if (n?.recipientIds.includes(res.locals.userId)) send({ type: "alert", notificationId: n.id });
      }
    }).catch(() => { if (!closed) res.end(); });
  };
  factoryEvents.on("update", onUpdate);
  const heartbeat = setInterval(() => {
    chain = chain.then(async () => { if (!closed && await validate()) res.write(": heartbeat\n\n"); })
      .catch(() => { if (!closed) res.end(); });
  }, 15000);
  res.on("close", () => { closed = true; clearInterval(heartbeat); factoryEvents.off("update", onUpdate); });
  send({ type: "refresh" });
});
router.get("/notifications", requireRoles("owner", "quality_inspector", "production_planner"), async (_req, res) => {
  const v = await loadVault(res.locals.factory);
  const read = await pool.query("SELECT notification_id FROM factory_notification_reads WHERE factory_id=$1 AND user_id=$2", [res.locals.factory, res.locals.userId]);
  const seen = new Set(read.rows.map(r => r.notification_id));
  const deliveries = await pool.query("SELECT notification_id,status FROM factory_email_outbox WHERE factory_id=$1", [res.locals.factory]);
  res.json((v.notifications ?? []).filter(n => n.recipientIds.includes(res.locals.userId)).map(n => {
    const statuses = deliveries.rows.filter(d => d.notification_id === n.id).map(d => d.status === "sending" ? "pending" : d.status);
    let emailStatus = !n.emailEnabled ? "disabled" : !statuses.length ? "blocked" : new Set(statuses).size === 1 ? statuses[0] : "partial";
    if (emailStatus === "cancelled") emailStatus = "blocked";
    const { recipientIds: _ids, emailEnabled: _enabled, ...safe } = n;
    return { ...safe, read: seen.has(n.id), emailStatus };
  }));
});
router.post("/notifications/:id/read", requireRoles("owner", "quality_inspector", "production_planner"), async (req, res) => {
  await mutateVault(res.locals.factory, async (v, client) => {
    const n = v.notifications?.find(n => n.id === req.params.id && n.recipientIds.includes(res.locals.userId));
    if (!n) throw new OperationError("NOT_FOUND", 404);
    const result = await client.query("INSERT INTO factory_notification_reads(id,user_id,factory_id,notification_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [`${res.locals.userId}:${n.id}`, res.locals.userId, res.locals.factory, n.id]);
    if (result.rowCount) audit(v, { userId: res.locals.userId, userName: res.locals.userName }, "notification_read", n.id);
  }, { userId: res.locals.userId, sessionId: res.locals.sessionId, roles: ["owner", "quality_inspector", "production_planner"] });
  res.json({ message: "Marked read" });
});
router.get("/notification-settings", requireRoles("owner"), async (_req, res) => { res.json(await notificationSettings(res.locals.factory)); });
router.patch("/notification-settings", requireRoles("owner"), async (req, res) => {
  const p = UpdateNotificationSettingsBody.safeParse(req.body);
  if (!p.success) throw new OperationError("INVALID_INPUT");
  if (res.locals.userId === "demo") throw new OperationError("DEMO_ACCOUNT", 403);
  await mutateVault(res.locals.factory, async (v, client) => {
    await client.query("UPDATE factory_vaults SET email_alerts_enabled=$1 WHERE id=$2", [p.data.enabled, res.locals.factory]);
    audit(v, { userId: res.locals.userId, userName: res.locals.userName }, "email_alerts_configured", res.locals.factory, String(p.data.enabled));
  }, { userId: res.locals.userId, sessionId: res.locals.sessionId, roles: ["owner"] });
  res.json(await notificationSettings(res.locals.factory));
});
router.get("/email-deliveries", requireRoles("owner"), async (_req, res) => {
  const { rows } = await pool.query(`SELECT o.id,o.notification_id AS "notificationId",u.name AS "recipientName",o.email,o.status,o.attempts,
    o.last_error AS "lastError",o.updated_at AS "updatedAt" FROM factory_email_outbox o JOIN factory_users u ON u.id=o.user_id
    WHERE o.factory_id=$1 ORDER BY o.updated_at DESC`, [res.locals.factory]);
  res.json(rows.map(r => ({ ...r, updatedAt: r.updatedAt.toISOString() })));
});
router.post("/email-deliveries/:id/retry", requireRoles("owner"), async (req, res) => {
  await mutateVault(res.locals.factory, async (v, client) => {
    const { rows } = await client.query(`SELECT o.*,u.email AS current_email,u.role,u.roles,u.active,u.password_hash,f.email_alerts_enabled
      FROM factory_email_outbox o JOIN factory_users u ON u.id=o.user_id JOIN factory_vaults f ON f.id=o.factory_id
      WHERE o.id=$1 AND o.factory_id=$2 FOR UPDATE OF o`, [req.params.id, res.locals.factory]);
    const row = rows[0];
    if (!row) throw new OperationError("NOT_FOUND",404);
    if (!["failed", "blocked"].includes(row.status)) throw new OperationError("EMAIL_RETRY_UNSAFE",409);
    if (!row.email_alerts_enabled) throw new OperationError("EMAIL_DISABLED",409);
    if (!row.active || !row.password_hash || !approvedRoles(row).some(r => ["owner","quality_inspector","production_planner"].includes(r))) throw new OperationError("FORBIDDEN",403);
    if (!validEmail(row.current_email)) throw new OperationError("INVALID_EMAIL");
    await client.query("UPDATE factory_email_outbox SET status='pending',email=$1,attempts=0,last_error='',next_attempt=NOW(),updated_at=NOW() WHERE id=$2", [row.current_email, row.id]);
    audit(v, { userId: res.locals.userId, userName: res.locals.userName }, "email_retry_requested", row.id);
  }, { userId: res.locals.userId, sessionId: res.locals.sessionId, roles: ["owner"] });
  res.json({ message: "Retry queued" });
});
export default router;
