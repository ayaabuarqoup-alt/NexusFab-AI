import { pool } from "@workspace/db";
import { decrypt } from "./vault";
import { validEmail } from "./notifications";
import { approvedRoles } from "./roles";
import { EmailFailure, findSentAlert, sendAlertEmail, type AlertEmail } from "./alert-email";
import { factoryEvents } from "./realtime";
import { logger } from "./logger";
import type { DatabaseClient } from "./roles";

export interface OutboxRecord { id: string; factory_id: string; notification_id: string; user_id: string; email: string; attempts: number }
async function finish(row: OutboxRecord, status: string, code = "", providerId: string | null = null, delay = 120) {
  await pool.query(`UPDATE factory_email_outbox SET status=$1,last_error=$2,provider_id=COALESCE($3,provider_id),
    next_attempt=NOW()+($4::int * interval '1 second'),updated_at=NOW() WHERE id=$5 AND status IN ('sending','uncertain')`,
    [status, code, providerId, delay, row.id]);
  await pool.query("SELECT pg_notify('nexus_updates',$1)", [JSON.stringify({ factoryId: row.factory_id })]);
}
export async function deliverEmail(row: OutboxRecord, send: (email: AlertEmail) => Promise<string> = sendAlertEmail) {
  const snapshot = await pool.query("SELECT payload FROM factory_vaults WHERE id=$1", [row.factory_id]);
  const escalation = snapshot.rows[0] && decrypt(row.factory_id, snapshot.rows[0].payload).notifications
    ?.find(n => n.id === row.notification_id)?.escalationDeadline;
  if (!escalation) {
    const message = await prepareEmail(row, pool);
    if (message) await sendAndRecord(row, message, send);
    return;
  }
  // Serialize only validation and the start of an attempt with resolution.
  // Never await provider I/O while holding the factory lock.
  const client = await pool.connect();
  let delivery: Promise<{ error?: unknown }> | undefined;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT payload FROM factory_vaults WHERE id=$1 FOR UPDATE", [row.factory_id]);
    const v = rows[0] ? decrypt(row.factory_id, rows[0].payload) : undefined;
    const n = v?.notifications?.find(n => n.id === row.notification_id);
    const issue = v?.issues?.find(i => i.id === n?.targetId);
    const job = await client.query("SELECT status,last_error FROM factory_email_outbox WHERE id=$1 AND factory_id=$2", [row.id, row.factory_id]);
    if (job.rows[0]?.status !== "sending" || job.rows[0]?.last_error === "PROVIDER_IN_FLIGHT") return;
    if (!issue || issue.status !== "open" || issue.escalationDeadline !== escalation) {
      await finish(row, "cancelled", "ESCALATION_STOPPED");
      return;
    }
    const message = await prepareEmail(row, client, true);
    if (!message) return;
    // Persist the in-flight boundary before calling the provider. Cancellation
    // must not mislabel a possibly accepted attempt as an unsent cancellation.
    // This uses a separate commit so a crash/rollback cannot erase that boundary.
    await pool.query("UPDATE factory_email_outbox SET last_error='PROVIDER_IN_FLIGHT',updated_at=NOW() WHERE id=$1 AND status='sending'", [row.id]);
    delivery = sendAndRecord(row, message, send).then(() => ({}), error => ({ error }));
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
  const outcome = await delivery;
  if (outcome?.error) throw outcome.error;
}
async function prepareEmail(row: OutboxRecord, client: DatabaseClient, escalation = false): Promise<AlertEmail | undefined> {
  const { rows } = await client.query(`SELECT u.email,u.active,u.password_hash,u.roles,u.role,f.email_alerts_enabled,f.payload,f.name
    FROM factory_users u JOIN factory_vaults f ON f.id=u.factory_id WHERE u.id=$1 AND f.id=$2`, [row.user_id, row.factory_id]);
  const user = rows[0];
  if (!user || !user.active || !user.password_hash || !approvedRoles(user).some(r => (escalation ? ["owner", "quality_inspector"] : ["owner", "quality_inspector", "production_planner"]).includes(r))) {
    await finish(row, "cancelled", "RECIPIENT_NO_LONGER_APPROVED"); return;
  }
  if (!user.email_alerts_enabled) { await finish(row, "blocked", "EMAIL_DISABLED"); return; }
  if (!validEmail(user.email) || user.email !== row.email) { await finish(row, "blocked", "RECIPIENT_EMAIL_CHANGED"); return; }
  const n = decrypt(row.factory_id, user.payload).notifications?.find(n => n.id === row.notification_id && n.recipientIds.includes(row.user_id));
  if (!n) { await finish(row, "cancelled", "NOTIFICATION_NOT_FOUND"); return; }
  return { id: row.id, recipient: row.email, factoryName: user.name,
    title: n.title, message: n.message, actorName: n.actorName, createdAt: n.createdAt };
}
async function sendAndRecord(row: OutboxRecord, message: AlertEmail, send: (email: AlertEmail) => Promise<string>) {
  try {
    const providerId = await send(message);
    await finish(row, "sent", "", providerId);
  } catch (error) {
    const failure = error instanceof EmailFailure ? error : new EmailFailure("SEND_RESULT_UNKNOWN", true);
    const status = failure.uncertain ? "uncertain" : failure.retryable && row.attempts < 5 ? "pending" : "failed";
    await finish(row, status, failure.code, null, status === "pending" ? Math.min(300, 15 * 2 ** row.attempts) : 120);
  }
}
export async function processEmailBatch(send: (email: AlertEmail) => Promise<string> = sendAlertEmail) {
  for (let i = 0; i < 3; i++) {
    const { rows } = await pool.query<OutboxRecord>(`UPDATE factory_email_outbox SET status='sending',attempts=attempts+1,
      next_attempt=NOW()+interval '2 minutes',updated_at=NOW()
      WHERE id=(SELECT id FROM factory_email_outbox WHERE status='pending' AND next_attempt<=NOW()
        ORDER BY next_attempt FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id,factory_id,notification_id,user_id,email,attempts`);
    if (!rows[0]) return;
    await deliverEmail(rows[0], send);
  }
}
async function reconcileUncertainEmails() {
  const { rows } = await pool.query<OutboxRecord>(`UPDATE factory_email_outbox SET status='uncertain',
    next_attempt=NOW()+interval '2 minutes',updated_at=NOW()
    WHERE id=(SELECT id FROM factory_email_outbox WHERE
      (status='sending' OR (status='uncertain' AND last_error NOT IN ('SEND_RESULT_UNCONFIRMED','SENT_LOOKUP_UNAVAILABLE')))
      AND next_attempt<=NOW() ORDER BY next_attempt FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id,factory_id,notification_id,user_id,email,attempts`);
  if (!rows[0]) return;
  try {
    const messageId = await findSentAlert(rows[0].id);
    await finish(rows[0], messageId ? "sent" : "uncertain", messageId ? "" : "SEND_RESULT_UNCONFIRMED", messageId);
  } catch { await finish(rows[0], "uncertain", "SENT_LOOKUP_UNAVAILABLE"); }
}
export function startEmailWorker() {
  let busy = false, lastRun = 0;
  const tick = async () => {
    // Cap each worker at 36 sends/minute; normal event-triggered sends start immediately.
    if (busy || Date.now() - lastRun < 5000) return;
    busy = true; lastRun = Date.now();
    try { await processEmailBatch(); await reconcileUncertainEmails(); }
    catch { logger.error("Email queue processing failed; persistent jobs will be recovered"); }
    finally { busy = false; }
  };
  factoryEvents.on("update", tick);
  const timer = setInterval(() => void tick(), 5000);
  void tick();
  return () => { clearInterval(timer); factoryEvents.off("update", tick); };
}
