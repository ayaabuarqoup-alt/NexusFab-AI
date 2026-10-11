import { Router } from "express";
import { pool } from "@workspace/db";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { PasskeyRegistrationOptionsBody, LoginResponse } from "@workspace/api-zod";
import { createSession, clearSession, loginLimit, requireFactory, tokenHash, verifyPassword } from "../middlewares/factory-auth";
import { audit, decrypt, encrypt, mutateVault } from "../lib/vault";
import { approvedRoles, roleNames } from "../lib/roles";
import { consumeChallenge, relyingParty, saveChallenge } from "../lib/passkeys";
import { OperationError } from "./operations";

const router = Router();
const requireAccount: import("express").RequestHandler = (_req, res, next) => {
  if (res.locals.userId === "demo") throw new OperationError("PASSKEY_UNAVAILABLE", 403);
  next();
};
const view = (r: { id: string; name: string; rp_id: string; created_at: Date; last_used_at: Date | null }) =>
  ({ id: r.id, name: r.name, rpId: r.rp_id, createdAt: r.created_at.toISOString(), lastUsedAt: r.last_used_at?.toISOString() ?? null });
router.get("/auth/passkeys", requireFactory, requireAccount, async (_req, res) => {
  const { rows } = await pool.query("SELECT id,name,rp_id,created_at,last_used_at FROM factory_passkeys WHERE user_id=$1 ORDER BY created_at DESC", [res.locals.userId]);
  res.json(rows.map(view));
});
router.delete("/auth/passkeys/:id", requireFactory, requireAccount, async (req, res) => {
  await mutateVault(res.locals.factory, async (v, client) => {
    const removed = await client.query("DELETE FROM factory_passkeys WHERE id=$1 AND user_id=$2 RETURNING name", [req.params.id, res.locals.userId]);
    if (!removed.rowCount) throw new OperationError("NOT_FOUND", 404);
    audit(v, { userId: res.locals.userId, userName: res.locals.userName }, "passkey_removed", res.locals.userId, removed.rows[0].name);
  }, { userId: res.locals.userId, sessionId: res.locals.sessionId, roles: [...roleNames] });
  res.json({ message: "Passkey removed" });
});
router.post("/auth/passkeys/register/options", requireFactory, requireAccount, loginLimit, async (req, res) => {
  const input = PasskeyRegistrationOptionsBody.safeParse(req.body);
  if (!input.success || !input.data.name.trim()) throw new OperationError("INVALID_INPUT");
  const { rpId } = relyingParty(req);
  const { rows } = await pool.query("SELECT username,password_hash FROM factory_users WHERE id=$1 AND factory_id=$2 AND active=true", [res.locals.userId, res.locals.factory]);
  if (!rows[0]?.password_hash || !verifyPassword(input.data.password, rows[0].password_hash)) throw new OperationError("INVALID_CREDENTIALS", 401);
  const keys = await pool.query("SELECT id,transports FROM factory_passkeys WHERE user_id=$1", [res.locals.userId]);
  if (keys.rowCount! >= 10) throw new OperationError("PASSKEY_LIMIT", 409);
  const options = await generateRegistrationOptions({
    rpName: "NexusFab AI", rpID: rpId, userID: new TextEncoder().encode(res.locals.userId),
    userName: rows[0].username, userDisplayName: res.locals.userName, attestationType: "none",
    excludeCredentials: keys.rows.map(k => ({ id: k.id, transports: k.transports })),
    authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
  });
  await saveChallenge(req, res, "register", options.challenge, input.data.name.trim());
  res.json(options);
});
router.post("/auth/passkeys/register/verify", requireFactory, requireAccount, async (req, res) => {
  const challenge = await consumeChallenge(req, res, "register");
  let verification;
  try {
    verification = await verifyRegistrationResponse({ response: req.body as RegistrationResponseJSON,
      expectedChallenge: challenge.challenge, expectedOrigin: challenge.origin, expectedRPID: challenge.rp_id, requireUserVerification: true });
  } catch { throw new OperationError("PASSKEY_INVALID", 400); }
  if (!verification.verified) throw new OperationError("PASSKEY_INVALID", 400);
  const key = verification.registrationInfo.credential;
  const result = await mutateVault(res.locals.factory, async (v, client) => {
    const count = await client.query("SELECT count(*)::int AS n FROM factory_passkeys WHERE user_id=$1", [res.locals.userId]);
    if (count.rows[0].n >= 10) throw new OperationError("PASSKEY_LIMIT", 409);
    const added = await client.query(`INSERT INTO factory_passkeys(id,user_id,rp_id,public_key,counter,transports,name)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING RETURNING *`,
      [key.id, res.locals.userId, challenge.rp_id, Buffer.from(key.publicKey).toString("base64"), key.counter, key.transports ?? [], challenge.name]);
    if (!added.rows[0]) throw new OperationError("PASSKEY_INVALID", 409);
    audit(v, { userId: res.locals.userId, userName: res.locals.userName }, "passkey_registered", res.locals.userId, challenge.name);
    return view(added.rows[0]);
  }, { userId: res.locals.userId, sessionId: res.locals.sessionId, roles: [...roleNames] });
  res.json(result);
});
router.post("/auth/passkeys/login/options", loginLimit, async (req, res) => {
  if (res.locals.factory) throw new OperationError("ALREADY_AUTHENTICATED", 409);
  const { rpId } = relyingParty(req);
  const options = await generateAuthenticationOptions({ rpID: rpId, userVerification: "required" });
  await saveChallenge(req, res, "login", options.challenge);
  res.json(options);
});
router.post("/auth/passkeys/login/verify", loginLimit, async (req, res) => {
  const challenge = await consumeChallenge(req, res, "login");
  const id = req.body?.id;
  if (typeof id !== "string" || id.length > 2048) throw new OperationError("PASSKEY_INVALID", 400);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // All account mutations lock the factory before the credential/user rows.
    const lookup = await client.query("SELECT u.factory_id FROM factory_passkeys p JOIN factory_users u ON u.id=p.user_id WHERE p.id=$1 AND p.rp_id=$2", [id, challenge.rp_id]);
    if (!lookup.rows[0]) throw new OperationError("PASSKEY_INVALID", 401);
    const factoryId = lookup.rows[0].factory_id;
    const factory = await client.query("SELECT payload,name FROM factory_vaults WHERE id=$1 FOR UPDATE", [factoryId]);
    const found = await client.query(`SELECT p.*,u.name AS user_name,u.email,u.role,u.roles,u.active,u.password_hash
      FROM factory_passkeys p JOIN factory_users u ON u.id=p.user_id WHERE p.id=$1 AND p.rp_id=$2 FOR UPDATE OF p`,
      [id, challenge.rp_id]);
    const key = found.rows[0];
    if (!key?.active || !key.password_hash) throw new OperationError("PASSKEY_INVALID", 401);
    if (req.body.response?.userHandle &&
      Buffer.from(req.body.response.userHandle, "base64url").toString("utf8") !== key.user_id) throw new OperationError("PASSKEY_INVALID", 401);
    let verification;
    try {
      verification = await verifyAuthenticationResponse({ response: req.body as AuthenticationResponseJSON,
        expectedChallenge: challenge.challenge, expectedOrigin: challenge.origin, expectedRPID: challenge.rp_id,
        requireUserVerification: true, credential: { id: key.id, publicKey: new Uint8Array(Buffer.from(key.public_key, "base64")),
          counter: Number(key.counter), transports: key.transports } });
    } catch { throw new OperationError("PASSKEY_INVALID", 401); }
    if (!verification.verified) throw new OperationError("PASSKEY_INVALID", 401);
    await client.query("UPDATE factory_passkeys SET counter=$1,last_used_at=NOW() WHERE id=$2", [verification.authenticationInfo.newCounter, id]);
    if (req.cookies?.nexus_session) await client.query("DELETE FROM factory_sessions WHERE id=$1", [tokenHash(String(req.cookies.nexus_session))]);
    await createSession(res, factoryId, key.user_id, client);
    const vault = decrypt(factoryId, factory.rows[0].payload);
    audit(vault, { userId: key.user_id, userName: key.user_name }, "login_succeeded", key.user_id, "Passkey (user verified)");
    await client.query("UPDATE factory_vaults SET payload=$1 WHERE id=$2", [encrypt(factoryId, vault), factoryId]);
    await client.query("SELECT pg_notify('nexus_updates',$1)", [JSON.stringify({ factoryId })]);
    await client.query("COMMIT");
    res.json(LoginResponse.parse({ authenticated: true, factory: factoryId, factoryName: factory.rows[0].name,
      userId: key.user_id, userName: key.user_name, email: key.email || "", role: "",
      availableRoles: approvedRoles(key), requiresRoleSelection: true }));
  } catch (error) { await client.query("ROLLBACK"); clearSession(res); throw error; }
  finally { client.release(); }
});
export default router;
