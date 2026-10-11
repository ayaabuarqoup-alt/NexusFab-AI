import { EventEmitter } from "node:events";
import { pool, type PoolClient } from "@workspace/db";
import { logger } from "./logger";

export const factoryEvents = new EventEmitter();
factoryEvents.setMaxListeners(0);
export async function startRealtime() {
  let stopped = false, client: PoolClient | undefined, retry: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (!stopped && !retry) retry = setTimeout(() => { retry = undefined; void connect(); }, 2500);
  };
  const connect = async () => {
    if (stopped) return;
    try {
      client = await pool.connect();
      client.on("notification", message => {
        if (message.channel !== "nexus_updates" || !message.payload) return;
        try {
          const event = JSON.parse(message.payload);
          if (typeof event.factoryId === "string") factoryEvents.emit("update", event);
        } catch { logger.warn("Invalid factory event ignored"); }
      });
      client.once("error", () => {
        client?.removeAllListeners("notification");
        client?.release(true); client = undefined;
        schedule();
      });
      await client.query("LISTEN nexus_updates");
    } catch {
      client?.release(true); client = undefined;
      logger.warn("Factory live updates disconnected; reconnecting");
      schedule();
    }
  };
  await connect();
  return async () => {
    stopped = true; clearTimeout(retry);
    if (client) { client.removeAllListeners("notification"); await client.query("UNLISTEN nexus_updates"); client.release(); client = undefined; }
  };
}
