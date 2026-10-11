import type { RequestHandler, Response } from "express";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const cookie = "nexus_session";
export function clearSession(res: Response) { res.clearCookie(cookie, { path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" }); }
export async function createSession(res: Response, tenant: string) {
  const token = randomBytes(32).toString("hex");
  await pool.query("DELETE FROM factory_sessions WHERE expires_at < NOW()");
  await pool.query("INSERT INTO factory_sessions(id,factory_id,expires_at) VALUES($1,$2,$3)",
    [tokenHash(token), tenant, new Date(Date.now() + 12 * 3600 * 1000)]);
  res.cookie(cookie, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 * 1000 });
}
export const readSession: RequestHandler = async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  const token = req.cookies?.[cookie];
  if (typeof token === "string" && /^[a-f0-9]{64}$/.test(token)) {
    const { rows } = await pool.query(
      "SELECT v.id,v.name FROM factory_sessions s JOIN factory_vaults v ON v.id=s.factory_id WHERE s.id=$1 AND s.expires_at > NOW()", [tokenHash(token)]);
    if (rows[0]) { res.locals.factory = rows[0].id; res.locals.factoryName = rows[0].name; }
  }
  next();
};
export const requireFactory: RequestHandler = (_req, res, next) => {
  if (!res.locals.factory) { res.status(401).json({ error: "Sign in required", code: "UNAUTHORIZED" }); return; }
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
const attempts = new Map<string, { count: number; until: number }>();
export const loginLimit: RequestHandler = (req, res, next) => {
  const now = Date.now();
  for (const [key, item] of attempts) if (item.until < now) attempts.delete(key);
  const key = req.ip || "unknown";
  const item = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
  item.count++; attempts.set(key, item);
  if (item.count > 15) { res.status(429).json({ error: "Too many attempts. Try later.", code: "RATE_LIMITED" }); return; }
  next();
};
export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const value = scryptSync(password, salt!, 64);
  const expected = Buffer.from(hash!, "hex");
  return expected.length === value.length && timingSafeEqual(expected, value);
}
