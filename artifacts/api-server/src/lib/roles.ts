import type { PoolClient } from "@workspace/db";

export type DatabaseClient = Pick<PoolClient, "query">;
export const roleNames = ["owner", "operator", "quality_inspector"] as const;
export type Role = typeof roleNames[number];
export function approvedRoles(user: { roles?: string[] | null; role: string }): Role[] {
  // Legacy accounts keep their existing single grant; no implicit new access.
  return [...new Set(user.roles ?? [user.role])].filter((r): r is Role => roleNames.includes(r as Role));
}
