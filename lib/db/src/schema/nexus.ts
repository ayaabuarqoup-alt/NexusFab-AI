import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const factoryVaults = pgTable("factory_vaults", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  payload: text("payload").notNull(),
});

export const factorySessions = pgTable("factory_sessions", {
  id: text("id").primaryKey(),
  factoryId: text("factory_id").notNull().references(() => factoryVaults.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
