import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { migrateAccounts } from "../lib/accounts";
import { audit, decrypt, encrypt } from "../lib/vault";
import { tokenHash } from "../middlewares/factory-auth";

const [factory, username, output, confirm] = process.argv.slice(2);
if (!factory || !username || !output || confirm !== "--revoke-existing-access") {
  console.error("Usage: tsx artifacts/api-server/src/cli/recover-owner.ts FACTORY_ID OWNER_USERNAME /private/path/invitation.txt --revoke-existing-access");
  process.exit(1);
}
await writeFile(output,"",{mode:0o600,flag:"wx"});
await migrateAccounts();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const found = await client.query("SELECT payload FROM factory_vaults WHERE id=$1 FOR UPDATE",[factory]);
  const user = await client.query("SELECT id FROM factory_users WHERE factory_id=$1 AND username=$2 AND role='owner' AND active=true",[factory,username]);
  if (!found.rowCount || !user.rowCount) throw new Error("Active owner not found");
  const id = user.rows[0].id, token = randomBytes(32).toString("hex");
  await client.query("UPDATE factory_users SET password_hash=NULL WHERE id=$1",[id]);
  await client.query("DELETE FROM factory_sessions WHERE user_id=$1",[id]);
  await client.query("DELETE FROM factory_invites WHERE user_id=$1",[id]);
  await client.query("INSERT INTO factory_invites(id,user_id,expires_at) VALUES($1,$2,NOW()+interval '24 hours')",[tokenHash(token),id]);
  const vault = decrypt(factory,found.rows[0].payload);
  audit(vault,{userId:"workspace-administrator",userName:"Workspace administrator"},"owner_recovery",id);
  await client.query("UPDATE factory_vaults SET payload=$1 WHERE id=$2",[encrypt(factory,vault),factory]);
  await writeFile(output,token+"\n",{mode:0o600});
  await client.query("COMMIT");
  console.log("Owner access revoked; recovery invitation written to private file. Share securely and delete after delivery.");
} catch(e) {await client.query("ROLLBACK"); throw e;} finally {client.release(); await pool.end();}
