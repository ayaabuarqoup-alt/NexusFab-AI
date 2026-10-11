import { Router } from "express";
import { pool } from "@workspace/db";
import { LoginBody, LoginResponse, GetSessionResponse } from "@workspace/api-zod";
import { clearSession, createSession, loginLimit, tokenHash, verifyPassword } from "../middlewares/factory-auth";

const router = Router();
function session(res: import("express").Response) {
  return GetSessionResponse.parse({ authenticated: !!res.locals.factory, factory: res.locals.factory || "", factoryName: res.locals.factoryName || "", userId: res.locals.userId || "", userName: res.locals.userName || "", role: res.locals.role || "" });
}
router.get("/auth/session", (_req, res) => {
  res.json(session(res));
});
router.post("/auth/login", loginLimit, async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success || parsed.data.password.length > 256 || parsed.data.username.length > 100) {
    res.status(400).json({ error: "Invalid login input", code: "INVALID_INPUT" }); return;
  }
  const { rows } = await pool.query("SELECT u.id AS user_id,u.name AS user_name,u.role,u.active,u.password_hash,v.id,v.name FROM factory_users u JOIN factory_vaults v ON v.id=u.factory_id WHERE u.username=$1", [parsed.data.username.trim().toLowerCase()]);
  if (!rows.length && process.env.NODE_ENV !== "production") {
    const demo = await pool.query("SELECT id,name,password_hash FROM factory_vaults WHERE id=$1 AND id IN ('factory_carton','factory_plastics')", [parsed.data.username]);
    if (demo.rows[0]) rows.push({...demo.rows[0],active:true,user_id:null,role:"owner",user_name:"Development demo"});
  }
  // Equal-cost password check even for nonexistent usernames.
  const stored = rows[0]?.password_hash || "nexusfab-invalid-user:" + "00".repeat(64);
  const valid = verifyPassword(parsed.data.password, stored);
  if (!rows[0] || !valid || !rows[0].active || !rows[0].password_hash) { res.status(401).json({ error: "Invalid credentials", code: "INVALID_CREDENTIALS" }); return; }
  if (req.cookies?.nexus_session) await pool.query("DELETE FROM factory_sessions WHERE id=$1", [tokenHash(String(req.cookies.nexus_session))]);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM factory_vaults WHERE id=$1 FOR UPDATE",[rows[0].id]);
    if (rows[0].user_id) {
      const fresh = await client.query("SELECT active,password_hash,role FROM factory_users WHERE id=$1",[rows[0].user_id]);
      if (!fresh.rows[0]?.active || fresh.rows[0].password_hash !== stored) {
        await client.query("ROLLBACK");
        res.status(401).json({code:"INVALID_CREDENTIALS"}); return;
      }
      rows[0].role = fresh.rows[0].role;
    }
    await createSession(res, rows[0].id, rows[0].user_id, client);
    await client.query("COMMIT");
  } catch(e) {await client.query("ROLLBACK"); throw e;} finally {client.release();}
  res.json(LoginResponse.parse({ authenticated: true, factory: rows[0].id, factoryName: rows[0].name, userId: rows[0].user_id || "demo", userName: rows[0].user_name, role: rows[0].role }));
});
router.post("/auth/logout", async (req, res): Promise<void> => {
  if (req.cookies?.nexus_session) await pool.query("DELETE FROM factory_sessions WHERE id=$1", [tokenHash(String(req.cookies.nexus_session))]);
  clearSession(res); res.json({ message: "Signed out" });
});
export default router;
