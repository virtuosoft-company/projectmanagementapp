import { type Role } from "@/lib/domain";

/**
 * The permission matrix rendered on /settings, in machine-readable form. This
 * is the single source of truth for authorization: the settings table and every
 * `can()` check read from it.
 *
 * Roles use the app's lowercase vocabulary; `lib/session.ts` converts the
 * database enum once, at the session boundary.
 */
export const PERMISSIONS = {
  "projects.view": ["admin", "manager", "member", "viewer", "guest"],
  "projects.create": ["admin", "manager", "member"],
  "projects.edit": ["admin", "manager", "member"],
  "projects.delete": ["admin"],
  "tasks.manage": ["admin", "manager", "member"],
  // Calendar events. Separate from `tasks.manage` because an event is aimed at
  // people rather than at work: creating one puts a notification in somebody
  // else’s bell and a commitment in their day.
  "events.manage": ["admin", "manager", "member"],
  "time.log": ["admin", "manager", "member"],
  // Correcting or removing *other people's* time entries. Everyone may fix
  // their own; changing someone else's is a supervisory act, and it moves what
  // the reports and invoices say.
  "time.manage": ["admin", "manager"],
  "reports.view": ["admin", "manager", "member", "viewer"],
  "members.invite": ["admin"],
  // Granting and changing what someone may do, matching who
  // may add a user in the first place.
  "roles.manage": ["admin"],
  // Permanently deleting an account is not a permission change: it destroys
  // their time entries and task history, so it stays with admins.
  "members.delete": ["admin"],
  "workspace.create": ["admin"],
  "workspace.settings": ["admin"],
  // Deleting a workspace destroys everything inside it, so it sits with the
  // admin — and the action additionally requires admin of the *target*
  // workspace, not merely of the one the session is currently in.
  "workspace.delete": ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

/**
 * Never held by a custom role, whatever its base role allows.
 *
 * `roles.manage` is the escalation route: a holder could edit their own role
 * and grant themselves everything, so the narrowing that makes custom roles
 * safe would not bind them.
 *
 * `members.invite` is the same shape of hole one step out. It is admin-only in
 * the matrix, so a role inheriting from MANAGER or below can never reach it —
 * but a role inheriting from ADMIN could, and whoever held it could then create
 * accounts without being the workspace's admin.
 *
 * One list, because this was previously three: a `REFUSED` const used only when
 * seeding default roles, a `FORBIDDEN_IN_CUSTOM_ROLES` const applied only when
 * a role is saved, and nothing at all at resolution — so a row already in the
 * database, or one edited by hand, kept whatever it held.
 */
export const NEVER_IN_CUSTOM_ROLE: Permission[] = ["roles.manage", "members.invite"];

/** Human labels, in the order the settings table lists them. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "projects.view": "View projects",
  "projects.create": "Create projects",
  "projects.edit": "Edit projects",
  "projects.delete": "Delete projects",
  "tasks.manage": "Manage tasks",
  "events.manage": "Manage calendar events",
  "time.log": "Log time",
  "time.manage": "Edit anyone's time entries",
  "reports.view": "View reports",
  "members.invite": "Invite members",
  "roles.manage": "Manage roles & permissions",
  "members.delete": "Delete accounts",
  "workspace.create": "Create workspaces",
  "workspace.settings": "Workspace settings",
  "workspace.delete": "Delete workspaces",
};

export const ROLES: Role[] = ["admin", "manager", "member", "viewer", "guest"];

/**
 * The one role that cannot be edited or deleted.
 *
 * Admin is the workspace's floor. It is the only role holding `roles.manage`
 * that cannot itself be edited, and the last-admin guards mean a workspace
 * always keeps one — so there is always somebody who can restore any other
 * role that was edited or deleted by mistake.
 *
 * Every other role is a `CustomRole` row: editable, deletable, and bounded by
 * the base role it inherits from. The enum values still exist as those
 * ceilings, but they are no longer roles you hold directly.
 */
export const FIXED_ROLES: Role[] = ["admin"];

export function isFixedRole(role: string): boolean {
  return (FIXED_ROLES as string[]).includes(role);
}

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

/** Whether a role is granted a permission. */
export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Every permission a role holds — handy for passing a set to client components. */
export function permissionsFor(role: Role): Permission[] {
  return PERMISSION_KEYS.filter((permission) => can(role, permission));
}

/** `admin` -> `Admin`, for display. */
export function roleLabel(role: Role) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

// ============================================================================
// PAGES PER ROLE
// ============================================================================

/**
 * The app's pages, keyed to the permission each one's gate enforces (see the
 * `requirePermission` call in the matching `page.tsx`).
 *
 * `permission: null` marks a page every role may reach — the gate there is
 * `requireUser`, and the controls inside are gated individually.
 *
 * Project sub-pages are deliberately absent: those are per-*project* features
 * on `Project.features`, which is a different question from what a role may
 * reach.
 */
export const APP_PAGES = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", permission: null },
  { key: "projects", label: "All Projects", href: "/projects", permission: null },
  { key: "tasks", label: "Tasks", href: "/projects/tasks", permission: null },
  { key: "calendar", label: "Calendar", href: "/projects/calendar", permission: null },
  { key: "team-members", label: "Team Members", href: "/team-members", permission: null },
  { key: "messages", label: "Messages", href: "/messages", permission: null },
  {
    key: "analytics",
    label: "Analytics",
    href: "/projects/analytics",
    permission: "reports.view",
  },
  {
    key: "time-tracking",
    label: "Time Tracking",
    href: "/projects/time-tracking",
    permission: "time.log",
  },
  {
    key: "timesheet",
    label: "Timesheet",
    href: "/projects/timesheet",
    permission: "time.log",
  },
  { key: "users", label: "Users", href: "/admin/users", permission: "members.invite" },
  { key: "roles", label: "Roles", href: "/admin/users/roles", permission: "workspace.settings" },
  { key: "settings", label: "Settings", href: "/settings", permission: "workspace.settings" },
  { key: "profile", label: "Profile", href: "/profile", permission: null },
  {
    key: "appearance",
    label: "Display & Appearance",
    href: "/settings/appearance",
    permission: null,
  },
  { key: "workspaces", label: "Workspaces", href: "/workspaces", permission: null },
] as const satisfies readonly {
  key: string;
  label: string;
  href: string;
  permission: Permission | null;
}[];

export type AppPage = (typeof APP_PAGES)[number]["key"];

export const APP_PAGE_KEYS = APP_PAGES.map((page) => page.key) as AppPage[];

/** Every page a role reaches, from the permissions it holds. */
export function pagesForRole(role: Role): AppPage[] {
  return pagesForPermissions(permissionsFor(role));
}

/**
 * The same, from an explicit permission set.
 *
 * A custom role holds a *narrowed* subset of its base role, so its pages have
 * to be derived from that subset rather than from the base role — otherwise
 * removing `reports.view` from a custom role would still leave Analytics
 * reachable.
 */
export function pagesForPermissions(permissions: readonly Permission[]): AppPage[] {
  return APP_PAGES.filter(
    (page) => page.permission === null || permissions.includes(page.permission),
  ).map((page) => page.key);
}

// ============================================================================
// ROLE RESOLUTION (pure — the database-backed half lives in resolve-role.ts)
// ============================================================================

export type ResolvedRole = {
  /** The base role every role-based check should use. */
  effectiveRole: Role;
  permissions: Permission[];
  /**
   * The pages this role may reach.
   *
   * Assigned per role and stored, not derived from `permissions` — see the
   * `pages` column on `CustomRole`. The sidebar renders exactly this list and
   * `requirePage` enforces it; permissions remain the answer to what a holder
   * may *do* once a page is open.
   */
  pages: AppPage[];
  isCustom: boolean;
  /** Present only for a custom role — for display and for the roles screen. */
  customRole: { id: string; name: string; label: string } | null;
};

/**
 * Whether this role supervises people, rather than only doing the work.
 *
 * Admin or manager — the two who get the overseeing half of a screen: the
 * workspace dashboard rather than a personal one, the figures above a list,
 * the roster on a project.
 *
 * A role question rather than a permission, deliberately. A permission added
 * to the matrix is held by no existing custom role until an admin re-ticks it
 * one by one, which is how `events.manage` shipped granting nobody but Admin.
 * This has to be true for every manager on the day it lands.
 *
 * Reads `permissions` for the admin half: a custom role still holding
 * `workspace.settings` is an admin in every way that matters here.
 */
export function supervisesPeople(resolved: ResolvedRole): boolean {
  if (resolved.permissions.includes("workspace.settings")) return true;
  return resolved.effectiveRole === "manager";
}

/** Whether a name is one of the built-in roles rather than a custom one. */
export function isBaseRole(name: string): name is Role {
  return (ROLES as string[]).includes(name);
}

/**
 * A base role resolved from the matrix alone — no query, no custom row.
 *
 * In practice this is Admin, the one role held straight from the enum, plus
 * the fallback when a membership vanishes mid-request. Its pages come from the
 * matrix because there is no row to have assigned any: for Admin that is every
 * page, which is the same guarantee `FIXED_ROLES` exists to make.
 */
export function resolveBaseRole(role: Role): ResolvedRole {
  return {
    effectiveRole: role,
    permissions: permissionsFor(role),
    pages: pagesForRole(role),
    isCustom: false,
    customRole: null,
  };
}

/**
 * Keeps only the values that name a real page, in `APP_PAGES` order.
 *
 * Applied to anything read from the database or posted from a form: a stale
 * key from a page that has since been removed would otherwise sit in the list
 * forever, and an invented one must never reach the sidebar.
 */
export function sanitisePages(requested: readonly unknown[]): AppPage[] {
  return APP_PAGE_KEYS.filter((key) => requested.includes(key));
}

/**
 * Shapes a stored custom role into a `ResolvedRole`, applying its ceiling.
 *
 * The permissions returned are the **intersection** with what `inheritsFrom`
 * grants, not the stored list. Enforcing it here rather than trusting the row
 * means a permission that was valid when the role was saved, and later removed
 * from its base role, stops applying immediately — and a hand-edited database
 * row cannot grant more than the base role ever could.
 */
export function resolveCustomRole(row: {
  id: string;
  name: string;
  label: string;
  permissions: unknown;
  pages: unknown;
  inheritsFrom: Role;
}): ResolvedRole {
  const stored = Array.isArray(row.permissions) ? (row.permissions as string[]) : [];
  // Two ceilings, in this order: what the base role grants, then the refusals
  // above. Applying the second here rather than only when a role is saved is
  // what binds rows that already exist and rows edited outside the app.
  const ceiling = permissionsFor(row.inheritsFrom).filter(
    (permission) => !NEVER_IN_CUSTOM_ROLE.includes(permission),
  );
  const permissions = ceiling.filter((permission) => stored.includes(permission));

  return {
    effectiveRole: row.inheritsFrom,
    permissions,
    /*
     * No ceiling here, unlike permissions above: pages are assigned outright,
     * so a role can be given a page whose permission it lacks. It opens
     * read-only — every control inside is still gated on `permissions`.
     *
     * A row written before the column existed has null, and falls back to the
     * permission-derived list so it keeps exactly the pages it had.
     */
    pages: Array.isArray(row.pages) ? sanitisePages(row.pages) : pagesForPermissions(permissions),
    isCustom: true,
    customRole: { id: row.id, name: row.name, label: row.label },
  };
}
