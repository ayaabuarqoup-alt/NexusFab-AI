import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const factoryVaults = pgTable("factory_vaults", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  payload: text("payload").notNull(),
  emailAlertsEnabled: boolean("email_alerts_enabled").notNull().default(false),
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
  email: text("email").notNull().default(""),
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

export const factoryEmailOutbox = pgTable("factory_email_outbox", {
  id: text("id").primaryKey(),
  factoryId: text("factory_id").notNull().references(() => factoryVaults.id, { onDelete: "cascade" }),
  notificationId: text("notification_id").notNull(),
  userId: text("user_id").notNull().references(() => factoryUsers.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error").notNull().default(""),
  providerId: text("provider_id"),
  nextAttempt: timestamp("next_attempt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const factoryNotificationReads = pgTable("factory_notification_reads", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => factoryUsers.id, { onDelete: "cascade" }),
  factoryId: text("factory_id").notNull().references(() => factoryVaults.id, { onDelete: "cascade" }),
  notificationId: text("notification_id").notNull(),
});
