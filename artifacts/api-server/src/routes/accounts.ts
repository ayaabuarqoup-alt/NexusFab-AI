import { Router } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { ActivateAccountBody, ChangePasswordBody, InviteStaffBody, UpdateStaffBody } from "@workspace/api-zod";
import { requireFactory, requireRoles, loginLimit, verifyPassword, tokenHash, clearSession } from "../middlewares/factory-auth";
import { audit, decrypt, encrypt, hashPassword } from "../lib/vault";
import { OperationError } from "./operations";
import { approvedRoles, type DatabaseClient } from "../lib/roles";

const router = Router();
const privateAccount: import("express").RequestHandler = (_req,res,next) => {
  if (res.locals.userId === "demo") { res.status(403).json({code:"DEMO_ACCOUNT"}); return; }
  next();
};
// All account changes lock the same tenant row as operational mutations; audit and
// credential changes commit together. Role checks repeat under that lock.
async function accountChange<T>(actor: Record<string, any>, fn: (client: DatabaseClient, record: (action: string, target: string, detail?: string) => void) => Promise<T>, ownerOnly = true) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT payload FROM factory_vaults WHERE id=$1 FOR UPDATE", [actor.factory]);
    const user = await client.query(`SELECT u.active,u.role,u.roles,u.password_hash,s.active_role FROM factory_users u
      JOIN factory_sessions s ON s.user_id=u.id AND s.factory_id=u.factory_id
      WHERE u.id=$1 AND u.factory_id=$2 AND s.id=$3 AND s.expires_at>NOW()`, [actor.userId,actor.factory,actor.sessionId]);
    if (!user.rows[0]?.active || !user.rows[0]?.password_hash ||
      !approvedRoles(user.rows[0]).includes(user.rows[0].active_role) ||
      (ownerOnly && user.rows[0].active_role !== "owner")) throw new OperationError("FORBIDDEN",403);
    const vault = decrypt(actor.factory, rows[0].payload);
    const result = await fn(client, (action,target,detail="") => audit(vault,{userId:actor.userId,userName:actor.userName},action,target,detail));
    await client.query("UPDATE factory_vaults SET payload=$1 WHERE id=$2", [encrypt(actor.factory,vault),actor.factory]);
    await client.query("COMMIT"); return result;
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
async function invitation(client: DatabaseClient, userId: string) {
  const token = randomBytes(32).toString("hex"), expiresAt = new Date(Date.now()+86400000).toISOString();
  await client.query("DELETE FROM factory_invites WHERE user_id=$1", [userId]);
  await client.query("INSERT INTO factory_invites(id,user_id,expires_at) VALUES($1,$2,$3)", [tokenHash(token),userId,expiresAt]);
  return {token,expiresAt};
}

router.post("/auth/activate", loginLimit, async(req,res) => {
  const input = ActivateAccountBody.safeParse(req.body);
  if (!input.success) throw new OperationError("INVALID_INPUT");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Find tenant, then lock in the same order as all other account mutations.
    const lookup = await client.query("SELECT u.factory_id FROM factory_invites i JOIN factory_users u ON u.id=i.user_id WHERE i.id=$1", [tokenHash(input.data.token)]);
    if (!lookup.rows[0]) throw new OperationError("INVALID_INVITATION",400);
    const tenant = lookup.rows[0].factory_id;
    const vaultRow = await client.query("SELECT payload FROM factory_vaults WHERE id=$1 FOR UPDATE",[tenant]);
    const found = await client.query("SELECT u.id,u.name FROM factory_invites i JOIN factory_users u ON u.id=i.user_id WHERE i.id=$1 AND i.expires_at>NOW() AND u.active=true FOR UPDATE OF i,u", [tokenHash(input.data.token)]);
    if (!found.rows[0]) throw new OperationError("INVALID_INVITATION",400);
    const user = found.rows[0];
    await client.query("UPDATE factory_users SET password_hash=$1 WHERE id=$2", [hashPassword(input.data.password),user.id]);
    await client.query("DELETE FROM factory_invites WHERE user_id=$1",[user.id]);
    await client.query("DELETE FROM factory_sessions WHERE user_id=$1",[user.id]);
    const vault = decrypt(tenant,vaultRow.rows[0].payload);
    audit(vault,{userId:user.id,userName:user.name},"account_activated",user.id);
    await client.query("UPDATE factory_vaults SET payload=$1 WHERE id=$2",[encrypt(tenant,vault),tenant]);
    await client.query("COMMIT");
    res.json({message:"Account activated. Sign in."});
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally {client.release();}
});
router.post("/auth/password", requireFactory, privateAccount, loginLimit, async(req,res) => {
  const input = ChangePasswordBody.safeParse(req.body);
  if (!input.success) throw new OperationError("INVALID_INPUT");
  await accountChange(res.locals,async(client,record) => {
    const { rows } = await client.query("SELECT password_hash FROM factory_users WHERE id=$1",[res.locals.userId]);
    if (!verifyPassword(input.data.currentPassword,rows[0].password_hash)) throw new OperationError("INVALID_CREDENTIALS",400);
    await client.query("UPDATE factory_users SET password_hash=$1 WHERE id=$2",[hashPassword(input.data.password),res.locals.userId]);
    await client.query("DELETE FROM factory_sessions WHERE user_id=$1",[res.locals.userId]);
    await client.query("DELETE FROM factory_invites WHERE user_id=$1",[res.locals.userId]);
    record("password_changed",res.locals.userId);
  },false);
  clearSession(res); res.json({message:"Password changed. Sign in again."});
});
router.get("/staff",requireRoles("owner"),privateAccount,async(_req,res) => {
  const { rows } = await pool.query("SELECT id,username,name,role,COALESCE(roles,ARRAY[role]) AS roles,active,(password_hash IS NOT NULL) AS activated FROM factory_users WHERE factory_id=$1 ORDER BY name",[res.locals.factory]);
  res.json(rows);
});
router.post("/staff",requireRoles("owner"),privateAccount,async(req,res) => {
  const input = InviteStaffBody.safeParse(req.body);
  if (!input.success || !input.data.name.trim() || ["factory_carton","factory_plastics"].includes(input.data.username)) throw new OperationError("INVALID_INPUT");
  const roles = input.data.roles ?? [input.data.role];
  if (!roles.includes(input.data.role) || new Set(roles).size !== roles.length) throw new OperationError("INVALID_INPUT");
  try {
    const result = await accountChange(res.locals,async(client,record) => {
      const id = randomUUID();
      await client.query("INSERT INTO factory_users(id,factory_id,username,name,role,roles) VALUES($1,$2,$3,$4,$5,$6)",[id,res.locals.factory,input.data.username,input.data.name.trim(),roles[0],roles]);
      record("staff_invited",id,roles.join(","));
      return invitation(client,id);
    }); res.json(result);
  } catch(e) { if ((e as {code?:string}).code === "23505") throw new OperationError("USERNAME_TAKEN",409); throw e; }
});
router.patch("/staff/:id",requireRoles("owner"),privateAccount,async(req,res) => {
  const input = UpdateStaffBody.safeParse(req.body);
  if (!input.success) throw new OperationError("INVALID_INPUT");
  if (req.params.id === res.locals.userId) throw new OperationError("SELF_CHANGE_FORBIDDEN",409);
  const roles = input.data.roles ?? [input.data.role];
  if (!roles.includes(input.data.role) || new Set(roles).size !== roles.length) throw new OperationError("INVALID_INPUT");
  await accountChange(res.locals,async(client,record) => {
    const found = await client.query("SELECT id FROM factory_users WHERE id=$1 AND factory_id=$2",[req.params.id,res.locals.factory]);
    if (!found.rowCount) throw new OperationError("NOT_FOUND",404);
    await client.query("UPDATE factory_users SET role=$1,roles=$2,active=$3 WHERE id=$4",[roles[0],roles,input.data.active,req.params.id]);
    await client.query("DELETE FROM factory_sessions WHERE user_id=$1",[req.params.id]);
    await client.query("DELETE FROM factory_invites WHERE user_id=$1",[req.params.id]);
    record("staff_updated",String(req.params.id),`${roles.join(",")}; active=${input.data.active}`);
  }); res.json({message:"Staff updated"});
});
router.post("/staff/:id/reset",requireRoles("owner"),privateAccount,async(req,res) => {
  if (req.params.id === res.locals.userId) throw new OperationError("SELF_CHANGE_FORBIDDEN",409);
  const result = await accountChange(res.locals,async(client,record) => {
    const found = await client.query("SELECT id FROM factory_users WHERE id=$1 AND factory_id=$2 AND active=true",[req.params.id,res.locals.factory]);
    if (!found.rowCount) throw new OperationError("NOT_FOUND",404);
    await client.query("UPDATE factory_users SET password_hash=NULL WHERE id=$1",[req.params.id]);
    await client.query("DELETE FROM factory_sessions WHERE user_id=$1",[req.params.id]);
    record("password_reset",String(req.params.id));
    return invitation(client,String(req.params.id));
  }); res.json(result);
});
export default router;
