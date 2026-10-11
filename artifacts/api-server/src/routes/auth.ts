import { Router } from "express";
import { pool } from "@workspace/db";
import { LoginBody, LoginResponse, GetSessionResponse } from "@workspace/api-zod";
import { clearSession, createSession, loginLimit, tokenHash, verifyPassword } from "../middlewares/factory-auth";

const router = Router();
router.get("/auth/session", (_req, res) => {
  res.json(GetSessionResponse.parse({ authenticated: !!res.locals.factory, factory: res.locals.factory || "", factoryName: res.locals.factoryName || "" }));
});
router.post("/auth/login", loginLimit, async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success || parsed.data.password.length > 256 || parsed.data.username.length > 100) {
    res.status(400).json({ error: "Invalid login input", code: "INVALID_INPUT" }); return;
  }
  const { rows } = await pool.query("SELECT id,name,password_hash FROM factory_vaults WHERE id=$1", [parsed.data.username]);
  // Equal-cost password check even for nonexistent usernames.
  const stored = rows[0]?.password_hash || "nexusfab-invalid-user:" + "00".repeat(64);
  const valid = verifyPassword(parsed.data.password, stored);
  if (!rows[0] || !valid) { res.status(401).json({ error: "Invalid credentials", code: "INVALID_CREDENTIALS" }); return; }
  if (req.cookies?.nexus_session) await pool.query("DELETE FROM factory_sessions WHERE id=$1", [tokenHash(String(req.cookies.nexus_session))]);
  await createSession(res, rows[0].id);
  res.json(LoginResponse.parse({ authenticated: true, factory: rows[0].id, factoryName: rows[0].name }));
});
router.post("/auth/logout", async (req, res): Promise<void> => {
  if (req.cookies?.nexus_session) await pool.query("DELETE FROM factory_sessions WHERE id=$1", [tokenHash(String(req.cookies.nexus_session))]);
  clearSession(res); res.json({ message: "Signed out" });
});
export default router;
