import { pgTable, text, timestamp, bigint, index } from "drizzle-orm/pg-core";
import { factoryUsers } from "./nexus";

export const factoryPasskeys = pgTable("factory_passkeys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => factoryUsers.id, { onDelete: "cascade" }),
  rpId: text("rp_id").notNull(),
  publicKey: text("public_key").notNull(),
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  transports: text("transports").array().notNull().default([]),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, t => [index("factory_passkeys_user_idx").on(t.userId)]);

export const factoryPasskeyChallenges = pgTable("factory_passkey_challenges", {
  id: text("id").primaryKey(),
  challenge: text("challenge").notNull(),
  purpose: text("purpose").notNull(),
  origin: text("origin").notNull(),
  rpId: text("rp_id").notNull(),
  userId: text("user_id").references(() => factoryUsers.id, { onDelete: "cascade" }),
  sessionId: text("session_id"),
  name: text("name"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
