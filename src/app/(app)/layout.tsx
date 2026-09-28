import { SessionProvider } from "next-auth/react";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import {
  getMember,
  getNotifications,
  getOverdueTasks,
  getProjects,
  getUnreadMessageCount,
  getRunningTimer,
  getUserWorkspaces,
} from "@/lib/queries";
import {
  getViewerPages,
  getViewerPermissions,
  hasPermission,
  projectScope,
  requireUser,
} from "@/lib/session";


export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Every route in this group is behind auth. `proxy.ts` redirects anonymous
  // requests early; this is the check that actually enforces it.
  const user = await requireUser();
  const session = await auth();
  const [
    projects,
    overdue,
    workspaces,
    canCreateWorkspace,
    canManageFeatures,
    canLogTime,
    pages,
    permissions,
    runningTimer,
    notifications,
    profile,
    unreadMessages,
  ] = await Promise.all([
    getProjects(user.workspaceId, await projectScope()),
    getOverdueTasks(user.workspaceId),
    getUserWorkspaces(user.id),
    // Resolved through the viewer’s actual role — a custom role that narrows
    // this away hides the control, matching what the action would allow.
    hasPermission("workspace.create"),
    hasPermission("workspace.settings"),
    // The header timer's pause/stop controls are `time.log` actions, so they
    // follow the same permission the time-tracking pages are gated on.
    hasPermission("time.log"),
    // The role's assigned pages, which is what the nav is built from. Reading
    // it here means the sidebar and `requirePage` answer from one resolution
    // of the role per request — `getViewerRole` is `cache()`d.
    getViewerPages(),
    // The resolved permission set, for the project sub-page links. Same cached
    // role resolution as `getViewerPages`, so this costs no extra query.
    getViewerPermissions(),
    // Read here rather than per page, so the header can show it everywhere.
    getRunningTimer(user.workspaceId, user.id),
    getNotifications(user.workspaceId, user.id),
    // The shell shows the viewer's own name, email and photo. The session
    // carries the copy the JWT was minted with at sign-in, so editing your
    // profile left the sidebar showing the old one until the next sign-in;
    // this row is current.
    getMember(user.workspaceId, user.id),
    // The Messages badge. Counted here rather than on the Messages page itself
    // because the sidebar is rendered for every route in this group.
    getUnreadMessageCount(user.workspaceId, user.id),
  ]);

  return (
    /*
     * The server session is handed to the provider rather than letting it fetch
     * one. Without it `useSession()` starts in `loading`, and next-auth's
     * `update()` returns immediately and does nothing while loading — which is
     * how the workspace switcher could appear to work and change nothing.
     */
    <SessionProvider session={session}>
      <AppShell
        user={{
          ...user,
          name: profile?.name ?? user.name,
          email: profile?.email ?? user.email,
          image: profile?.image ?? user.image,
        }}
        projects={projects.map(({ id, name, features }) => ({ id, name, features }))}
        projectCount={projects.length}
        workspaces={workspaces}
        pages={pages}
        permissions={permissions}
        canCreateWorkspace={canCreateWorkspace}
        canManageFeatures={canManageFeatures}
        // Sidebar count badges, resolved server-side rather than polled.
        badges={{ "/projects/tasks": overdue.length, "/messages": unreadMessages }}
        runningTimer={runningTimer}
        canLogTime={canLogTime}
        notifications={notifications.items}
        unreadNotifications={notifications.unread}
      >
        {children}
      </AppShell>
    </SessionProvider>
  );
}
