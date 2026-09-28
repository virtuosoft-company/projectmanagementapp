/**
 * Sidebar navigation data
 *
 * Kept apart from the component so the role filtering is plain, testable data:
 * which sections and items a given role sees, before any rendering happens.
 */

import {
  Building2,
  CalendarDays,
  Clock,
  FileText,
  FolderKanban,
  Hash,
  LayoutDashboard,
  Layout,
  Palette,
  ListTodo,
  Megaphone,
  MessageSquare,
  Sheet,
  ShieldCheck,
  Timer,
  User,
  UserCog,
  UserMinus,
  UserPlus,
  Users
} from "lucide-react";
import {
  PROJECT_FEATURE_KEYS,
  type Project,
  type ProjectFeature
} from "@/lib/domain";
import { APP_PAGES, type AppPage, type Permission } from "@/lib/permissions";

/**
 * Page key per nav href, so an item that corresponds to an assignable page is
 * filtered by that assignment.
 *
 * Derived from `APP_PAGES` rather than written out again: the two lists drifted
 * before — Team Members and Display & Appearance were admin-only here while
 * `APP_PAGES` had them open to everyone — and a lookup cannot drift.
 */
const PAGE_BY_HREF = new Map<string, AppPage>(
  APP_PAGES.map((page) => [page.href, page.key as AppPage]),
);

export interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  /**
   * The assignable page this item opens, when it is not simply `href`.
   *
   * Set it for a sub-route that belongs to a listed page — "Add Users" lives
   * under Users — so the two appear and disappear together.
   */
  page?: AppPage;
  /**
   * The permission this item needs, for the things that are **not** assignable
   * pages: a project's own sub-pages, which are switched on per project rather
   * than handed out per role.
   *
   * There is deliberately no `roles` list any more. One used to sit here and
   * was filtered against the base role on the session token — which is both
   * stale until the token is re-minted and blind to a custom role's narrowing,
   * so a role with `time.log` removed still saw a project's Time Tracking
   * link and was bounced by the page behind it.
   */
  permission?: Permission;
  /** Set on a project row, so the sidebar can offer its feature picker. */
  projectId?: string;
  children?: NavItem[];
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

function baseSections(): NavSection[] {
  return [
    {
      title: "Navigation",
      items: [
        { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
        { title: "Team Members", href: "/team-members", icon: Users },
        { title: "Projects", href: "/projects", icon: FolderKanban },
        { title: "Calendar", href: "/projects/calendar", icon: CalendarDays },
        { title: "Messages", href: "/messages", icon: MessageSquare },
      ]
    },
    // {
    //   title: "Team Members",
    //   items: [
    //   ],
    // },
    {
      title: "Administration",
      items: [
        { title: "Users", href: "/admin/users", icon: UserCog },
        {
          title: "Add Users",
          href: "/admin/users/new",
          icon: UserPlus,
          // Not an assignable page of its own — it comes and goes with Users.
          page: "users"
        },
        { title: "Roles", href: "/admin/users/roles", icon: ShieldCheck },
        {
          title: "Removal History",
          href: "/admin/users/history",
          icon: UserMinus,
          // Part of Users, like Add Users — no assignment of its own.
          page: "users",
        },
        { title: "Workspaces", href: "/workspaces", icon: Building2 },
        {title: "Timesheet", href: "/projects/timesheet", icon: Clock},
      ]
    },
    {
      title: "Settings",
      items: [
        { title: "Profile", href: "/profile", icon: User },
        {
          title: "Display & Appearance",
          href: "/settings/appearance",
          icon: Palette
        },
      ]
    },
  ];
}

/**
 * The sub-page each optional feature maps to. Keyed by `ProjectFeature`, so a
 * new feature key fails to compile here rather than silently rendering nothing.
 */
const FEATURE_ITEMS: Record<
  ProjectFeature,
  { title: string; segment: string; icon: NavItem["icon"]; permission?: Permission }
> = {
  tasks: { title: "Tasks", segment: "tasks", icon: ListTodo },
  campaigns: { title: "Campaigns", segment: "campaigns", icon: Megaphone },
  // Still typed, but absent from PROJECT_FEATURES — so it is never offered in
  // the picker and never appears in the nav. The route remains reachable by URL
  // for any project that already had it stored.
  "landing-pages": {
    title: "Landing Pages",
    segment: "landing-pages",
    icon: Layout
  },
  "time-tracking": {
    title: "Time Tracking",
    segment: "time-tracking",
    icon: Timer,
    // Logging time is `time.log`. Checked against the resolved permission set,
    // so a custom role that narrowed it away loses the link as well as the page.
    permission: "time.log",
  },
  // Still typed, but absent from PROJECT_FEATURES — never offered in the
  // picker and never shown in the nav. The route stays reachable by URL for
  // any project that already had it stored.
  timesheet: { title: "Timesheet", segment: "timesheet", icon: Clock },
  "excel-sheet": {
    title: "Excel Sheets",
    segment: "excel-sheet",
    icon: Sheet
  },
  // Retired from PROJECT_FEATURES, so nothing reaches this entry — the filter
  // above only maps keys the picker still offers. Kept because the Record is
  // keyed by ProjectFeature and the type still has it.
  report: { title: "Reports", segment: "report", icon: FileText, permission: "reports.view" }
};

/**
 * One entry per project, expanding to Overview plus whichever optional pages
 * that project has switched on. `projectId` marks these rows so the sidebar can
 * give them the "＋" feature picker instead of a plain expand chevron.
 */
function projectSection(
  projects: Pick<Project, "id" | "name" | "features">[],
): NavSection {
  return {
    title: "Projects",
    items: projects.map((project) => ({
      title: project.name,
      href: `/projects/project/${project.id}`,
      icon: Hash,
      projectId: project.id,
      children: [
        // Overview is the project itself, so it is never optional.
        {
          title: "Overview",
          href: `/projects/project/${project.id}`,
          icon: FolderKanban
        },
        // Listed in PROJECT_FEATURES order rather than the stored order, so the
        // sidebar reads the same whichever order they were switched on.
        ...PROJECT_FEATURE_KEYS.filter((key) => project.features.includes(key)).map((key) => {
          const item = FEATURE_ITEMS[key];
          return {
            title: item.title,
            href: `/projects/project/${project.id}/${item.segment}`,
            icon: item.icon,
            permission: item.permission,
          };
        }),
      ]
    }))
  };
}

/**
 * Bottom tab bar shown below `lg` — the handful of destinations reached most
 * often. Filtered by the same rules as the sidebar.
 */
export const bottomTabItems: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Projects", href: "/projects", icon: FolderKanban },
  { title: "Tasks", href: "/projects/tasks", icon: ListTodo },
  { title: "Messages", href: "/messages", icon: MessageSquare },
  { title: "People", href: "/team-members", icon: Users },
];

/**
 * Whether one nav item should be shown.
 *
 * Three cases, in order:
 *
 *   An assignable page is decided by the assignment alone — that list is what
 *   `requirePage` enforces, so the nav offers exactly what the URL will open.
 *
 *   A project sub-page is decided by the permission its page gate asks for.
 *   These are switched on per project, not handed out per role, so there is no
 *   page key to consult.
 *
 *   Anything else — a project row itself — is shown to everyone who can see the
 *   project at all, which `getProjects` has already decided by scope.
 *
 * Both lists are resolved server-side from the database, so neither is the
 * stale base role that used to be read off the session token.
 */
function isVisible(
  item: NavItem,
  pages: readonly AppPage[],
  permissions: readonly Permission[],
): boolean {
  const page = item.page ?? PAGE_BY_HREF.get(item.href);
  if (page) return pages.includes(page);
  if (item.permission) return permissions.includes(item.permission);
  return true;
}

/** Tabs this viewer may see, with count badges merged in. */
export function visibleMobileTabs(
  pages: readonly AppPage[],
  permissions: readonly Permission[],
  badges: Record<string, number> = {},
): NavItem[] {
  return bottomTabItems
    .filter((item) => isVisible(item, pages, permissions))
    .map((item) => ({
      ...item,
      badge: badges[item.href] ? String(badges[item.href]) : item.badge
    }));
}

/**
 * Which tab a path belongs to.
 *
 * Prefix matching alone would light up both `/projects` and `/projects/tasks`
 * on the tasks page, so the longest matching href wins and only that one is
 * reported active.
 */
export function activeTabHref(pathname: string, tabs: NavItem[]): string | null {
  const matches = tabs.filter(
    (tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`),
  );
  if (matches.length === 0) return null;

  return matches.reduce((best, tab) => (tab.href.length > best.href.length ? tab : best)).href;
}

/**
 * The sections a viewer sees, with per-item and per-child filtering applied
 * and count badges merged in. Empty sections are dropped.
 *
 * `pages` is the role's assigned page list and `permissions` its resolved
 * permission set — the two things `requirePage` and `requirePermission`
 * enforce — so the sidebar offers exactly what the URLs behind it will open.
 *
 * Both used to be one base role read off the session token, which was stale
 * until the token was re-minted and blind to a custom role's narrowing: an item
 * would show and then bounce to /forbidden on arrival.
 */
export function visibleSections(
  pages: readonly AppPage[],
  permissions: readonly Permission[],
  projects: Pick<Project, "id" | "name" | "features">[],
  badges: Record<string, number> = {},
): NavSection[] {
  // Filter children as well as top-level items, so what this returns is exactly
  // what the viewer may see — the renderer never has to re-check.
  const prepare = (item: NavItem): NavItem => {
    const children = item.children
      ?.filter((child) => isVisible(child, pages, permissions))
      .map(prepare);

    return {
      ...item,
      badge: badges[item.href] ? String(badges[item.href]) : item.badge,
      children: children && children.length > 0 ? children : undefined
    };
  };

  return [...baseSections(), projectSection(projects)]
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isVisible(item, pages, permissions)).map(prepare)
    }))
    .filter((section) => section.items.length > 0);
}
