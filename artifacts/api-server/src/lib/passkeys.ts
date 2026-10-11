import { pool } from "@workspace/db";
import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { tokenHash } from "../middlewares/factory-auth";
import { OperationError } from "../routes/operations";

const cookieName = "nexus_webauthn";
const cookieOptions = { path: "/api/auth/passkeys", httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };
export async function migratePasskeys() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS factory_passkeys (
      id text PRIMARY KEY, user_id text NOT NULL REFERENCES factory_users(id) ON DELETE CASCADE,
      rp_id text NOT NULL, public_key text NOT NULL, counter bigint NOT NULL DEFAULT 0,
      transports text[] NOT NULL DEFAULT '{}', name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(), last_used_at timestamptz);
    CREATE INDEX IF NOT EXISTS factory_passkeys_user_idx ON factory_passkeys(user_id);
    CREATE TABLE IF NOT EXISTS factory_passkey_challenges (
      id text PRIMARY KEY, challenge text NOT NULL, purpose text NOT NULL,
      origin text NOT NULL, rp_id text NOT NULL, user_id text REFERENCES factory_users(id) ON DELETE CASCADE,
      session_id text, name text, expires_at timestamptz NOT NULL);
  `);
}
export function relyingParty(req: Request) {
  const origin = req.get("origin");
  if (!origin) throw new OperationError("PASSKEY_ORIGIN_REQUIRED", 400);
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new OperationError("PASSKEY_ORIGIN_REQUIRED", 400); }
  const hosts = [req.get("host"), req.get("x-forwarded-host")?.split(",")[0]?.trim()];
  if (!hosts.includes(parsed.host) || parsed.origin !== origin ||
    (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" &&
      parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname)))) {
    throw new OperationError("PASSKEY_ORIGIN_REQUIRED", 400);
  }
  return { origin, rpId: parsed.hostname };
}
export async function saveChallenge(req: Request, res: Response, purpose: "register" | "login", challenge: string, name?: string) {
  const { origin, rpId } = relyingParty(req);
  await pool.query("DELETE FROM factory_passkey_challenges WHERE expires_at<NOW() OR id=$1",
    [tokenHash(String(req.cookies?.[cookieName] ?? ""))]);
  const token = randomBytes(32).toString("hex");
  await pool.query(`INSERT INTO factory_passkey_challenges
    (id,challenge,purpose,origin,rp_id,user_id,session_id,name,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()+interval '5 minutes')`,
    [tokenHash(token), challenge, purpose, origin, rpId, purpose === "register" ? res.locals.userId : null,
      purpose === "register" ? res.locals.sessionId : null, name ?? null]);
  res.cookie(cookieName, token, { ...cookieOptions, maxAge: 5 * 60000 });
}
export async function consumeChallenge(req: Request, res: Response, purpose: "register" | "login") {
  const { origin, rpId } = relyingParty(req);
  const token = req.cookies?.[cookieName];
  res.clearCookie(cookieName, cookieOptions);
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new OperationError("PASSKEY_CHALLENGE_EXPIRED", 400);
  // Consume before verification: even invalid responses cannot replay a ceremony.
  const { rows } = await pool.query("DELETE FROM factory_passkey_challenges WHERE id=$1 RETURNING *", [tokenHash(token)]);
  const row = rows[0];
  if (!row || new Date(row.expires_at).getTime() <= Date.now() || row.purpose !== purpose ||
    row.origin !== origin || row.rp_id !== rpId ||
    (purpose === "register" && (row.user_id !== res.locals.userId || row.session_id !== res.locals.sessionId))) {
    throw new OperationError("PASSKEY_CHALLENGE_EXPIRED", 400);
  }
  return row;
}
