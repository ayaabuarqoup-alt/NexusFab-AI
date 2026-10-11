import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { pool } from "@workspace/db";
import type { CreateJobResponse, CreateLogResponse, CreateIssueResponse, UpdateMachineStatusResponse, CreatePlanResponse, SaveOeeSettingBody } from "@workspace/api-zod";
import type { DatabaseClient } from "./roles";

export type Job = ReturnType<typeof CreateJobResponse.parse>;
export type Log = ReturnType<typeof CreateLogResponse.parse>;
export interface AuditEvent { id: string; actorId: string; actorName: string; action: string; targetId: string; at: string; detail: string }
export type Issue = ReturnType<typeof CreateIssueResponse.parse>;
export type MachineState = ReturnType<typeof UpdateMachineStatusResponse.parse>;
export interface FactoryNotification {
  id: string; kind: "production_issue" | "machine_status" | "production_status"; title: string; message: string;
  targetId: string; actorName: string; createdAt: string; recipientIds: string[]; emailEnabled: boolean;
}
export type ProductionPlan = ReturnType<typeof CreatePlanResponse.parse>;
export type OeeSetting = ReturnType<typeof SaveOeeSettingBody.parse>;
export interface MachineHistory { machineId: string; status: MachineState["status"]; at: string }
export interface Vault { jobs: Job[]; logs: Log[]; audit?: AuditEvent[]; issues?: Issue[]; machineStates?: MachineState[]; notifications?: FactoryNotification[]; plans?: ProductionPlan[]; oeeSettings?: OeeSetting[]; machineHistory?: MachineHistory[] }
export function audit(v: Vault, actor: { userId: string; userName: string }, action: string, targetId: string, detail = "") {
  (v.audit ??= []).unshift({ id: randomUUID(), actorId: actor.userId, actorName: actor.userName, action, targetId, at: new Date().toISOString(), detail });
}
const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error("SESSION_SECRET is required");
function key(tenant: string) { return createHmac("sha256", secret!).update(`nexusfab-vault:${tenant}`).digest(); }
export function encrypt(tenant: string, data: Vault) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(tenant), iv);
  cipher.setAAD(Buffer.from(tenant));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString("base64")).join(".");
}
export function decrypt(tenant: string, payload: string): Vault {
  const [iv, tag, data] = payload.split(".").map(p => Buffer.from(p, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", key(tenant), iv!);
  cipher.setAAD(Buffer.from(tenant)); cipher.setAuthTag(tag!);
  return JSON.parse(Buffer.concat([cipher.update(data!), cipher.final()]).toString());
}
export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export async function loadVault(tenant: string): Promise<Vault> {
  const { rows } = await pool.query("SELECT payload FROM factory_vaults WHERE id=$1", [tenant]);
  if (!rows[0]) throw new Error("Factory missing");
  return decrypt(tenant, rows[0].payload);
}
export async function mutateVault<T>(tenant: string, fn: (v: Vault, client: DatabaseClient) => T | Promise<T>, actor?: {userId: string; roles: string[]; sessionId: string}): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT payload FROM factory_vaults WHERE id=$1 FOR UPDATE", [tenant]);
    if (!rows[0]) throw new Error("Factory missing");
    if (actor && actor.userId !== "demo") {
      const user = await client.query(`SELECT u.active,u.role,u.roles,u.password_hash,s.active_role FROM factory_users u
        JOIN factory_sessions s ON s.user_id=u.id AND s.factory_id=u.factory_id
        WHERE u.id=$1 AND u.factory_id=$2 AND s.id=$3 AND s.expires_at>NOW()`,[actor.userId,tenant,actor.sessionId]);
      const { approvedRoles } = await import("./roles");
      if (!user.rows[0]?.active || !user.rows[0]?.password_hash || !actor.roles.includes(user.rows[0].active_role) ||
        !approvedRoles(user.rows[0]).includes(user.rows[0].active_role)) {
        const { OperationError } = await import("../routes/operations");
        throw new OperationError("FORBIDDEN",403);
      }
    }
    const vault = decrypt(tenant, rows[0].payload);
    const result = await fn(vault, client);
    await client.query("UPDATE factory_vaults SET payload=$1 WHERE id=$2", [encrypt(tenant, vault), tenant]);
    await client.query("SELECT pg_notify('nexus_updates',$1)", [JSON.stringify({ factoryId: tenant })]);
    await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function seedFactories() {
  // Published deployments must be provisioned with private accounts, not public demo credentials.
  if (process.env.NODE_ENV === "production") return;
  for (const [id, name, password, offset] of [
    ["factory_carton", "Carton Factory", "password123", 0],
    ["factory_plastics", "Plastics Factory", "secure456", 1],
  ] as const) {
    const found = await pool.query("SELECT id FROM factory_vaults WHERE id=$1", [id]);
    if (found.rowCount) continue;
    const today = new Date().toISOString().slice(0, 10);
    const jobs: Job[] = [
      { id: randomUUID(), name: "Production run 1042", machineId: "m1", target: 12000, startDate: today, dueDate: today, startTime: "08:00", status: "running", goodQty: 8400 + offset * 400, rejects: 160 },
      { id: randomUUID(), name: "Production run 1043", machineId: "m2", target: 6500, startDate: today, dueDate: today, startTime: "09:00", status: "running", goodQty: 4200, rejects: 85 },
      { id: randomUUID(), name: "Production run 1044", machineId: "m3", target: 8000, startDate: today, dueDate: today, startTime: "14:00", status: "planned", goodQty: 0, rejects: 0 },
    ];
    const logs: Log[] = jobs.slice(0, 2).map((j, index) => ({
      id: randomUUID(), jobId: j.id, machineId: j.machineId, staff: `Operator ${index + 1}`,
      date: today, time: index ? "11:30" : "10:00", goodQty: j.goodQty, rejects: j.rejects,
      downtimeMinutes: index ? 24 : 65, reason: index ? "Material changeover" : "Alignment adjustment",
      qcStatus: "pending", qcNote: "", createdAt: new Date().toISOString(),
    }));
    await pool.query("INSERT INTO factory_vaults(id,name,password_hash,payload) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [id, name, hashPassword(password), encrypt(id, { jobs, logs })]);
  }
}
