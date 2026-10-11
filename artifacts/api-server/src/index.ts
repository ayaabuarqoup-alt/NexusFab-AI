import app from "./app";
import { logger } from "./lib/logger";
import { seedFactories } from "./lib/vault";
import { migrateAccounts } from "./lib/accounts";
import { startRealtime } from "./lib/realtime";
import { startEmailWorker } from "./lib/email-worker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await migrateAccounts();
await seedFactories();
const stopRealtime = await startRealtime();
const stopEmailWorker = startEmailWorker();
process.once("SIGTERM", () => { stopEmailWorker(); void stopRealtime().finally(() => process.exit(0)); });
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
