import type { RequestHandler, Response } from "express";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import { approvedRoles, type DatabaseClient } from "../lib/roles";

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const cookie = "nexus_session";
export function clearSession(res: Response) { res.clearCookie(cookie, { path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" }); }
export async function createSession(res: Response, tenant: string, userId?: string, client: DatabaseClient = pool) {
  const token = randomBytes(32).toString("hex");
  await client.query("DELETE FROM factory_sessions WHERE expires_at < NOW()");
  await client.query("INSERT INTO factory_sessions(id,factory_id,expires_at,user_id) VALUES($1,$2,$3,$4)",
    [tokenHash(token), tenant, new Date(Date.now() + 12 * 3600 * 1000), userId || null]);
  res.cookie(cookie, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 * 1000 });
}
export const readSession: RequestHandler = async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  const token = req.cookies?.[cookie];
  if (typeof token === "string" && /^[a-f0-9]{64}$/.test(token)) {
    const { rows } = await pool.query(
      `SELECT v.id,v.name,u.id AS user_id,u.name AS user_name,u.email,u.role,u.roles,s.active_role
       FROM factory_sessions s JOIN factory_vaults v ON v.id=s.factory_id
       LEFT JOIN factory_users u ON u.id=s.user_id AND u.factory_id=s.factory_id
       WHERE s.id=$1 AND s.expires_at > NOW() AND
       ((u.active=true AND u.password_hash IS NOT NULL) OR (s.user_id IS NULL AND $2::boolean))`,
      [tokenHash(token), process.env.NODE_ENV !== "production"]);
    if (rows[0]) {
      res.locals.factory = rows[0].id; res.locals.factoryName = rows[0].name;
      res.locals.userId = rows[0].user_id || "demo";
      res.locals.userName = rows[0].user_name || "Development demo";
      res.locals.email = rows[0].email || "";
      res.locals.availableRoles = rows[0].user_id ? approvedRoles(rows[0]) : ["owner"];
      res.locals.role = res.locals.availableRoles.includes(rows[0].active_role) ? rows[0].active_role : "";
      res.locals.sessionId = tokenHash(token);
      res.locals.requiresRoleSelection = !res.locals.role;
    }
  }
  next();
};
export const requireRoles = (...roles: string[]): RequestHandler => (_req, res, next) => {
  if (!res.locals.factory) { res.status(401).json({code:"UNAUTHORIZED"}); return; }
  if (!res.locals.role) { res.status(403).json({code:"ROLE_SELECTION_REQUIRED"}); return; }
  if (!roles.includes(res.locals.role)) { res.status(403).json({code:"FORBIDDEN"}); return; }
  next();
};
export const requireFactory: RequestHandler = (_req, res, next) => {
  if (!res.locals.factory) { res.status(401).json({ error: "Sign in required", code: "UNAUTHORIZED" }); return; }
  if (!res.locals.role) { res.status(403).json({code:"ROLE_SELECTION_REQUIRED"}); return; }
  next();
};
export const sameOrigin: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
  const origin = req.get("origin");
  if (origin) {
    const allowed = [req.get("host"), req.get("x-forwarded-host")?.split(",")[0]?.trim()].filter(Boolean);
    try { if (!allowed.includes(new URL(origin).host)) { res.status(403).json({ error: "Origin not allowed", code: "FORBIDDEN" }); return; } }
    catch { res.status(403).json({ error: "Origin not allowed", code: "FORBIDDEN" }); return; }
  }
  if (req.get("sec-fetch-site") === "cross-site") { res.status(403).json({ error: "Origin not allowed", code: "FORBIDDEN" }); return; }
  next();
};
export const loginLimit: RequestHandler = async (req, res, next) => {
  // Shared across restarts and replicas; only a digest of the client address persists.
  await pool.query("DELETE FROM factory_login_attempts WHERE expires_at < NOW()");
  const { rows } = await pool.query(`INSERT INTO factory_login_attempts(id,count,expires_at)
    VALUES($1,1,NOW()+interval '15 minutes')
    ON CONFLICT(id) DO UPDATE SET count=factory_login_attempts.count+1
    RETURNING count`,[tokenHash(req.ip || "unknown")]);
  if (rows[0].count > 15) { res.setHeader("Retry-After","900"); res.status(429).json({ error: "Too many attempts. Try later.", code: "RATE_LIMITED" }); return; }
  next();
};
export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const value = scryptSync(password, salt!, 64);
  const expected = Buffer.from(hash!, "hex");
  return expected.length === value.length && timingSafeEqual(expected, value);
}
