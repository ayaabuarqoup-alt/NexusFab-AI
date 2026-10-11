import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import type { DatabaseClient } from "./roles";
import type { FactoryNotification, Vault } from "./vault";

export const validEmail = (email: string) => email.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(email);
export async function enqueueAlert(v: Vault, client: DatabaseClient, factoryId: string,
  input: Omit<FactoryNotification, "id" | "createdAt" | "recipientIds" | "emailEnabled">) {
  const { rows } = await client.query(`SELECT id,email FROM factory_users WHERE factory_id=$1 AND active=true
    AND password_hash IS NOT NULL AND COALESCE(roles,ARRAY[role]) && $2::text[]`, [factoryId,
      input.escalationDeadline ? ["owner", "quality_inspector"] : ["owner", "quality_inspector", "production_planner"]]);
  const settings = await client.query("SELECT email_alerts_enabled FROM factory_vaults WHERE id=$1", [factoryId]);
  const notification: FactoryNotification = { ...input, id: randomUUID(), createdAt: new Date().toISOString(),
    recipientIds: rows.map(r => r.id), emailEnabled: settings.rows[0].email_alerts_enabled };
  (v.notifications ??= []).unshift(notification);
  if (notification.emailEnabled) {
    const addresses = new Set<string>();
    for (const recipient of rows) {
      const email = recipient.email.trim().toLowerCase();
      if (email && addresses.has(email)) continue;
      if (email) addresses.add(email);
      await client.query(`INSERT INTO factory_email_outbox(id,factory_id,notification_id,user_id,email,status,last_error)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), factoryId, notification.id, recipient.id, email,
        validEmail(email) ? "pending" : "blocked", validEmail(email) ? "" : "MISSING_EMAIL"]);
    }
  }
  await client.query("SELECT pg_notify('nexus_updates',$1)", [JSON.stringify({ factoryId, notificationId: notification.id })]);
  return notification;
}
export async function notificationSettings(factoryId: string) {
  const settings = await pool.query("SELECT email_alerts_enabled FROM factory_vaults WHERE id=$1", [factoryId]);
  const recipients = await pool.query(`SELECT email FROM factory_users WHERE factory_id=$1 AND active=true
    AND password_hash IS NOT NULL AND COALESCE(roles,ARRAY[role]) && ARRAY['owner','quality_inspector','production_planner']::text[]`, [factoryId]);
  return { enabled: settings.rows[0].email_alerts_enabled, totalRecipients: recipients.rows.length,
    readyRecipients: recipients.rows.filter(r => validEmail(r.email)).length };
}
