import {
  NEVER_IN_CUSTOM_ROLE,
  pagesForPermissions,
  permissionsFor,
  roleLabel,
  type AppPage,
} from "./permissions";
import type { Role } from "./domain";

/**
 * The roles every workspace starts with.
 *
 * Admin is not here: it is the one fixed role (see `FIXED_ROLES`) and is held
 * straight from the enum. The rest exist as `CustomRole` rows so a workspace
 * can retune or delete them, each bounded by the base role it inherits from —
 * which is what the Roles screen lists and edits.
 */
export const DEFAULT_ROLES: { role: Role; description: string }[] = [
  { role: "manager", description: "Leads projects and people without workspace-level settings." },
  { role: "member", description: "Does the work: projects, tasks and time tracking." },
  { role: "viewer", description: "Read-only access, including reports." },
  { role: "guest", description: "Sees projects only — typically an external client." },
];

/**
 * Never granted to a custom role, whatever its base allows.
 *
 * Re-exported from `permissions.ts` rather than listed again — it used to be a
 * second copy, and the copies disagreed: this one withheld a permission from a
 * seeded role that the Roles screen would then let an admin tick back on.
 */
const REFUSED: string[] = NEVER_IN_CUSTOM_ROLE;

/** What a default role starts with: its base role's permissions, minus the refused ones. */
export function defaultRolePermissions(role: Role): string[] {
  return (permissionsFor(role) as string[]).filter((permission) => !REFUSED.includes(permission));
}

/**
 * Never in a default role's starting page list, whatever its permissions imply.
 *
 * These four are the pages the sidebar has always treated as admin-only while
 * `APP_PAGES` left them open to everyone — the two disagreed, and the nav was
 * the stricter. Deriving the starting list from permissions alone would hand
 * them to every role the moment assignment started being enforced, so the
 * stricter reading wins.
 *
 * It is a *starting* list only: an admin can tick any of these on afterwards.
 */
const WITHHELD_BY_DEFAULT: AppPage[] = [
  "team-members",
  "workspaces",
  "timesheet",
  "appearance",
];

/**
 * The pages a default role starts with.
 *
 * Kept in step with the backfill in
 * `migrations/20260925140000_role_page_access` — a workspace created after
 * that migration must start with the same lists it wrote for the workspaces
 * that already existed. From here on the list is edited on the Roles screen
 * and no longer tracks permissions at all.
 */
export function defaultRolePages(role: Role): AppPage[] {
  return pagesForPermissions(
    permissionsFor(role).filter((permission) => !REFUSED.includes(permission)),
  ).filter((page) => !WITHHELD_BY_DEFAULT.includes(page));
}

/** Enough of the Prisma client for this to run inside a transaction or out of one. */
type Db = {
  customRole: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<{ id: string }>;
  };
  workspaceMember: {
    findFirst(args: unknown): Promise<{ userId: string } | null>;
    updateMany(args: unknown): Promise<unknown>;
  };
};

/**
 * Give a workspace its default roles, and put existing members on the one
 * matching the role they already hold.
 *
 * Idempotent, and deliberately additive: a role that is already there — even
 * renamed or retuned — is left exactly as it is, so a deploy never undoes a
 * workspace's own edits. Members already on a role are left alone too.
 *
 * Returns the roles it created, which is what the seeding script reports.
 */
export async function ensureWorkspaceRoles(db: Db, workspaceId: string): Promise<Role[]> {
  // Nullable in the schema, but stamping an author keeps an audit trail; the
  // workspace's earliest admin is the closest thing to one.
  const author = await db.workspaceMember.findFirst({
    where: { workspaceId, role: "ADMIN" },
    orderBy: { joinedAt: "asc" },
    select: { userId: true },
  });

  const created: Role[] = [];

  for (const { role, description } of DEFAULT_ROLES) {
    const existing = await db.customRole.findFirst({
      where: { workspaceId, name: role },
      select: { id: true },
    });

    let id = existing?.id;

    if (!id) {
      const row = await db.customRole.create({
        data: {
          workspaceId,
          name: role,
          label: roleLabel(role),
          description,
          permissions: defaultRolePermissions(role),
          pages: defaultRolePages(role),
          inheritsFrom: role.toUpperCase(),
          isActive: true,
          // Never a system role: that flag disables Edit and Delete, and these
          // are meant to be both.
          isSystem: false,
          createdById: author?.userId ?? null,
          updatedById: author?.userId ?? null,
        },
        select: { id: true },
      });
      id = row.id;
      created.push(role);
    }

    await db.workspaceMember.updateMany({
      where: { workspaceId, role: role.toUpperCase(), customRoleId: null },
      data: { customRoleId: id },
    });
  }

  return created;
}
