import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { encrypt, hashPassword } from "./vault";
import { tokenHash } from "../middlewares/factory-auth";
import { InviteStaffBody } from "@workspace/api-zod";

// Additive and idempotent, including for existing encrypted installations.
export async function migrateAccounts() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS factory_users (
      id text PRIMARY KEY, factory_id text NOT NULL REFERENCES factory_vaults(id),
      username text NOT NULL UNIQUE, name text NOT NULL,
      role text NOT NULL CHECK (role IN ('owner','operator','quality_inspector','production_planner')),
      password_hash text, active boolean NOT NULL DEFAULT true);
    ALTER TABLE factory_sessions ADD COLUMN IF NOT EXISTS user_id text REFERENCES factory_users(id);
    CREATE TABLE IF NOT EXISTS factory_invites (
      id text PRIMARY KEY, user_id text NOT NULL REFERENCES factory_users(id),
      expires_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS factory_login_attempts (
      id text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
    ALTER TABLE factory_users DROP CONSTRAINT IF EXISTS factory_users_role_check;
    ALTER TABLE factory_users ADD CONSTRAINT factory_users_role_check CHECK (role IN ('owner','operator','quality_inspector','production_planner'));
  `);
}

// Local administrator only. No public factory-creation endpoint.
export async function provisionFactory(id: string, name: string, username: string, ownerName: string) {
  const owner = InviteStaffBody.safeParse({username,name:ownerName,role:"owner"});
  if (!/^[a-z0-9_-]{3,80}$/.test(id) || !owner.success || !name.trim() || name.length > 100 || !ownerName.trim()) throw new Error("Invalid factory or owner details (names must be 1–100 characters)");
  const client = await pool.connect();
  const token = randomBytes(32).toString("hex"), userId = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO factory_vaults(id,name,password_hash,payload) VALUES($1,$2,$3,$4)", [id, name, hashPassword(randomBytes(32).toString("hex")), encrypt(id, { jobs: [], logs: [] })]);
    await client.query("INSERT INTO factory_users(id,factory_id,username,name,role) VALUES($1,$2,$3,$4,'owner')", [userId,id,username,ownerName.trim()]);
    await client.query("INSERT INTO factory_invites(id,user_id,expires_at) VALUES($1,$2,NOW()+interval '24 hours')", [tokenHash(token),userId]);
    await client.query("COMMIT");
    return token;
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}
