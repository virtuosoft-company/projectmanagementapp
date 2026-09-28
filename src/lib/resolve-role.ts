import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { roleToDomain } from "@/lib/mappers";
import { resolveBaseRole, resolveCustomRole, type ResolvedRole } from "@/lib/permissions";
import type { Role } from "@/lib/domain";

/**
 * The database-backed half of role resolution.
 *
 * The pure half — `resolveBaseRole`, `resolveCustomRole` and the ceiling they
 * enforce — lives in `lib/permissions.ts` beside the matrix it reads, so it can
 * be exercised without a database and imported from client components.
 *
 * Two kinds of role exist:
 *
 *   **Base roles** — the six values of the `Role` enum, built in, with
 *   permissions from the compile-time matrix. Resolving one is a pure function
 *   call; this module is only involved because the membership must be read to
 *   discover which kind it is.
 *
 *   **Custom roles** — rows in `CustomRole`, created by an owner or admin, with
 *   their own permission list and a mandatory `inheritsFrom` base role.
 */

/**
 * The resolved role for one membership.
 *
 * `cache()` dedupes this within a single request and no further. A longer-lived
 * cache would keep serving old permissions after an owner edited a role — stale
 * authorization is both easy to miss and hard to debug, and the query is a
 * single indexed primary-key lookup.
 */
export const resolveMemberRole = cache(
  async (workspaceId: string, userId: string): Promise<ResolvedRole | null> => {
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: {
        role: true,
        customRole: {
          select: {
            id: true,
            name: true,
            label: true,
            permissions: true,
            pages: true,
            inheritsFrom: true,
            isActive: true,
          },
        },
      },
    });

    if (!membership) return null;

    const base = roleToDomain[membership.role];

    /*
     * The row this membership points at, or — when it points at none — the
     * workspace's row of the same name.
     *
     * `ensureWorkspaceRoles` links the two when a workspace is seeded, but
     * every path that creates a membership or changes its base role afterwards
     * writes `role` alone and leaves `customRoleId` null. Those people resolved
     * straight from the compile-time matrix, so a role retuned on the Roles
     * screen did nothing for them: Member could have `projects.create` unticked
     * and still see the New Project button.
     *
     * Falling back by name fixes that for every such membership at once, and
     * for any future write path that forgets, rather than trusting five callers
     * to remember. Admin is unaffected — it is the one fixed role, has no row
     * to find, and `isFixedRole` keeps the name from ever being taken.
     */
    const custom =
      membership.customRole ??
      (await prisma.customRole.findUnique({
        where: { workspaceId_name: { workspaceId, name: base } },
        select: {
          id: true,
          name: true,
          label: true,
          permissions: true,
          pages: true,
          inheritsFrom: true,
          isActive: true,
        },
      }));

    // A deactivated role falls back to its base rather than locking the holder
    // out: deactivating is for retiring a role, not for silently stripping
    // access from whoever still holds it.
    if (!custom || !custom.isActive) return resolveBaseRole(base);

    return resolveCustomRole({
      id: custom.id,
      name: custom.name,
      label: custom.label,
      permissions: custom.permissions,
      pages: custom.pages,
      inheritsFrom: roleToDomain[custom.inheritsFrom],
    });
  },
);

/**
 * The workspace's role row for a base role name, or null when there is none.
 *
 * Used when a membership is created or its base role changed, so
 * `customRoleId` points at the row the Roles screen edits. Resolution no
 * longer *depends* on that link — `resolveMemberRole` falls back by name — but
 * the link is what the members-per-role counts are drawn from, so leaving it
 * null shows a role as held by nobody while people are in fact on it.
 *
 * Admin has no row by design and returns null, which is the correct link for
 * the one fixed role.
 */
export async function roleRowIdFor(workspaceId: string, role: Role): Promise<string | null> {
  const row = await prisma.customRole.findUnique({
    where: { workspaceId_name: { workspaceId, name: role } },
    select: { id: true },
  });
  return row?.id ?? null;
}
