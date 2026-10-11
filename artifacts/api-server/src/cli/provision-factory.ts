import { migrateAccounts, provisionFactory } from "../lib/accounts";
import { pool } from "@workspace/db";
import { writeFile } from "node:fs/promises";

const [id, name, username, ownerName, output] = process.argv.slice(2);
if (!id || !name || !username || !ownerName || !output) {
  console.error("Usage: pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/cli/provision-factory.ts FACTORY_ID FACTORY_NAME OWNER_USERNAME OWNER_NAME /private/path/invitation.txt");
  process.exit(1);
}
try {
  // Reserve output first; never overwrite a credential file.
  await writeFile(output, "", {mode:0o600,flag:"wx"});
  await migrateAccounts();
  const token = await provisionFactory(id,name,username.toLowerCase(),ownerName);
  await writeFile(output,token+"\n",{mode:0o600});
  console.log("Factory provisioned. Private invitation written to the requested file; expires in 24 hours. Share securely with its owner, then delete the file.");
} finally { await pool.end(); }
