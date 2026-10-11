import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const factoryVaults = pgTable("factory_vaults", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  payload: text("payload").notNull(),
});

export const factorySessions = pgTable("factory_sessions", {
  id: text("id").primaryKey(),
  factoryId: text("factory_id").notNull().references(() => factoryVaults.id),
  userId: text("user_id").references(() => factoryUsers.id),
  activeRole: text("active_role"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const factoryUsers = pgTable("factory_users", {
  id: text("id").primaryKey(),
  factoryId: text("factory_id").notNull().references(() => factoryVaults.id),
  username: text("username").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  roles: text("roles").array(),
  passwordHash: text("password_hash"),
  active: boolean("active").notNull().default(true),
});
export const factoryInvites = pgTable("factory_invites", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => factoryUsers.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const factoryLoginAttempts = pgTable("factory_login_attempts", {
  id: text("id").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", {withTimezone:true}).notNull(),
});
