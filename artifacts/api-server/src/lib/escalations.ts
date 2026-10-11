import { pool } from "@workspace/db";
import { audit, loadVault, mutateVault, type Vault } from "./vault";
import { enqueueAlert } from "./notifications";
import type { DatabaseClient } from "./roles";
import { logger } from "./logger";

// Schedule state and notification/outbox writes commit together under the factory lock.
// Coalesce missed daily reminders after an outage rather than sending a backlog.
export async function processEscalations(factoryId: string, now = new Date()) {
  const due = (v: Vault) => (v.issues ?? []).filter(i => i.status === "open" &&
    ["high", "critical"].includes(i.severity) && i.escalationDeadline &&
    i.nextReminderAt && Date.parse(i.nextReminderAt) <= +now);
  if (!due(await loadVault(factoryId)).length) return;
  await mutateVault(factoryId, async (v, client) => {
    for (const issue of due(v)) {
      await enqueueAlert(v, client, factoryId, {
        kind: "production_issue", targetId: issue.id, title: issue.title,
        message: `Overdue issue / مشكلة متأخرة: ${issue.escalationDeadline}. ${issue.assignedToName ?? "Unassigned / غير مسندة"}`,
        actorName: "Escalation / التصعيد", escalationDeadline: issue.escalationDeadline!,
      });
      issue.lastEscalatedAt = now.toISOString();
      issue.nextReminderAt = new Date(+now + 24 * 60 * 60 * 1000).toISOString();
      audit(v, { userId: "system", userName: "Escalation" }, "issue_escalated", issue.id, issue.escalationDeadline!);
    }
  });
}

export async function cancelEscalationEmails(v: Vault, client: DatabaseClient, factoryId: string, issueId: string) {
  const ids = (v.notifications ?? []).filter(n => n.targetId === issueId && n.escalationDeadline).map(n => n.id);
  await client.query(`UPDATE factory_email_outbox SET status='cancelled',last_error='ESCALATION_STOPPED',updated_at=NOW()
    WHERE factory_id=$1 AND notification_id=ANY($2::text[])
    AND (status IN ('pending','blocked','failed') OR (status='sending' AND last_error<>'PROVIDER_IN_FLIGHT'))`, [factoryId, ids]);
}

export function startEscalationWorker() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const { rows } = await pool.query("SELECT id FROM factory_vaults");
      for (const row of rows) {
        try { await processEscalations(row.id); }
        catch { logger.error("Factory escalation processing failed; persisted schedule retained"); }
      }
    } finally { busy = false; }
  };
  const run = () => void tick().catch(() => logger.error("Escalation scheduler failed"));
  const timer = setInterval(run, 30_000);
  run();
  return () => clearInterval(timer);
}
