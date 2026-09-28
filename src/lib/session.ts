
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { Role, Theme } from "@/lib/domain";
import { roleToDomain, themeToDomain } from "@/lib/mappers";
import { prisma } from "@/lib/prisma";
import {
  resolveBaseRole,
  supervisesPeople,
  type AppPage,
  type Permission,
  type ResolvedRole,
} from "@/lib/permissions";
import { resolveMemberRole } from "@/lib/resolve-role";

/**
 * A signed-in account, which may not belong to a workspace yet.
 *
 * Both `workspaceId` and `role` are null in exactly one situation: the account
 * exists and the password checked out, but it holds no `WorkspaceMember` row.
 * That is the state `/onboarding` resolves.
 */
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  /** The workspace this session is scoped to — see the switcher in AppSidebar. */
  workspaceId: string | null;
  /** Role *within* `workspaceId`; null when there is no workspace. */
  role: Role | null;
};

/**
 * A session that is inside a workspace.
 *
 * `requireUser` and `requirePermission` return this, so the ~50 pages and
 * actions behind them keep receiving a plain `string` workspaceId and a real
 * role — the nullability stops at this boundary rather than spreading.
 */
export type ActiveSessionUser = SessionUser & { workspaceId: string; role: Role };

/**
 * The verified session for this request.
 *
 * `proxy.ts` only does a cheap cookie check; this is the real gate, and every
 * page or action that touches protected data must call it. Wrapped in `cache()`
 * so several callers in one render share a single verification.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;

  return {
    id: session.user.id,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    image: session.user.image,
    workspaceId: session.user.workspaceId,
    // The JWT carries the database enum; the app speaks lowercase.
    role: session.user.role ? roleToDomain[session.user.role] : null,
  };
});

/**
 * A signed-in account, workspace or not. Only onboarding should use this —
 * everything else wants `requireUser`, which guarantees a workspace.
 */
export async function requireAccount(returnTo?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect(returnTo ? `/signin?from=${encodeURIComponent(returnTo)}` : "/signin");
  }
  return user;
}

/**
 * Session user inside a workspace, or a redirect.
 *
 * Two ways out: no session at all sends you to sign-in; a session with no
 * workspace sends you to onboarding, which is the only screen that can create
 * the first one.
 */
export async function requireUser(returnTo?: string): Promise<ActiveSessionUser> {
  const user = await requireAccount(returnTo);
  if (!user.workspaceId || !user.role) redirect("/onboarding");
  return user as ActiveSessionUser;
}

/**
 * Session user, or a redirect away. Call in server actions and in pages whose
 * whole purpose requires the permission.
 *
 * Next's `forbidden()` / `unauthorized()` would express this better, but they
 * are still behind the experimental `authInterrupts` flag in this version, so
 * authorization stays on stable APIs.
 */
export async function requirePermission(permission: Permission): Promise<ActiveSessionUser> {
  const user = await requireUser();
  if (!(await viewerCan(permission))) {
    redirect(`/forbidden?need=${encodeURIComponent(permission)}`);
  }
  return user;
}

/** Non-throwing check, for conditional rendering. */
export async function hasPermission(permission: Permission): Promise<boolean> {
  return viewerCan(permission);
}

/**
 * The viewer's resolved role — base or custom.
 *
 * Everything authorization-related goes through this rather than reading
 * `user.role` directly, because a custom role's permissions are a narrowed
 * subset of its base role and only the resolver knows that subset. Reading the
 * enum alone would hand a custom-role holder their base role's full rights.
 */
export const getViewerRole = cache(async (): Promise<ResolvedRole | null> => {
  const user = await getSessionUser();
  if (!user?.workspaceId || !user.role) return null;

  // Falls back to the base role if the membership vanished mid-request.
  return (await resolveMemberRole(user.workspaceId, user.id)) ?? resolveBaseRole(user.role);
});

/**
 * Every permission the viewer actually holds.
 *
 * For callers that need the whole set at once — a list filtered in a synchronous
 * callback, say. Same source as `hasPermission`, so a custom role's narrowing
 * applies here too.
 */
export async function getViewerPermissions(): Promise<Permission[]> {
  const resolved = await getViewerRole();
  return resolved ? resolved.permissions : [];
}

/**
 * Whether the viewer supervises people — an admin or a manager.
 *
 * For the handful of things that are neither a permission nor a page: the
 * project roster, for one, which only somebody responsible for who is on a
 * project has a reason to see.
 */
export async function viewerSupervises(): Promise<boolean> {
  const resolved = await getViewerRole();
  return resolved ? supervisesPeople(resolved) : false;
}

/** Whether the viewer holds a permission, honouring a custom role's narrowing. */
export async function viewerCan(permission: Permission): Promise<boolean> {
  const resolved = await getViewerRole();
  return resolved ? resolved.permissions.includes(permission) : false;
}

/**
 * The pages assigned to the viewer's role.
 *
 * The sidebar renders exactly this list, and `requirePage` refuses anything
 * outside it — so what the nav offers and what a URL actually opens are the
 * same set, read from one place.
 */
export async function getViewerPages(): Promise<AppPage[]> {
  const resolved = await getViewerRole();
  return resolved ? resolved.pages : [];
}

/** Whether the viewer's role was assigned a page. */
export async function viewerHasPage(page: AppPage): Promise<boolean> {
  return (await getViewerPages()).includes(page);
}

/**
 * Session user, or a redirect away, gated on an **assigned page** rather than
 * on a permission.
 *
 * This is the gate for anything listed in `APP_PAGES`. Which pages a role
 * reaches is assigned by an admin and stored per role, so asking the
 * permission matrix instead would contradict the assignment: a role given
 * Analytics without `reports.view` would have the page in its sidebar and be
 * bounced on arrival.
 *
 * Being let in is not permission to act. Every control on the far side is
 * still gated on `hasPermission`, and every server action re-checks, so a page
 * handed to a role that holds none of its permissions opens read-only.
 */
export async function requirePage(page: AppPage): Promise<ActiveSessionUser> {
  const user = await requireUser();
  if (!(await viewerHasPage(page))) {
    redirect(`/forbidden?page=${encodeURIComponent(page)}`);
  }
  return user;
}

/**
 * Which projects the viewer should be shown, as the `memberId` argument to
 * `getProjects`.
 *
 * Returns their id for most people — they see only projects they were added to.
 * Returns `undefined` for owners and admins, who see every project in the
 * workspace: they are responsible for it, and scoping them the same way hid a
 * workspace's own projects from the person who owns it, which reads as the
 * sidebar being broken rather than as a rule being applied.
 *
 * One helper rather than the check repeated at each call site, so the sidebar
 * and the pages it links to can never disagree about what exists.
 */
export async function projectScope(): Promise<string | undefined> {
  const user = await getSessionUser();
  if (!user) return undefined;
  return (await viewerCan("workspace.settings")) ? undefined : user.id;
}

/**
 * The signed-in person's theme, straight from their account row.
 *
 * Read on the server so the class is on `<html>` in the first response: there
 * is no client library reading localStorage after hydration, and therefore no
 * flash of the wrong theme. Signed-out pages get the default.
 */
export const getViewerTheme = cache(async (): Promise<Theme> => {
  const user = await getSessionUser();
  if (!user) return "light";

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { theme: true },
  });

  return row ? themeToDomain[row.theme] : "light";
});
