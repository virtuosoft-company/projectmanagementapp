import type { Metadata } from "next";
import { AddMemberDialog } from "@/components/admin/add-member-dialog";
import { TeamStats } from "@/components/admin/team-stats";
import { UsersTable } from "@/components/admin/users-table";
import { getAddableUsers, getTeamMembers } from "@/lib/admin";
import { hasPermission, requirePage, viewerSupervises } from "@/lib/session";

export const metadata: Metadata = { title: "Team Members" };

/**
 * The workspace roster: everyone an owner or admin has added to this workspace.
 *
 * Distinct from Administration → Users, which lists *every* account in the
 * system so an admin can find someone who is not a member yet. Here, holding a
 * `WorkspaceMember` row is the entry condition — `getTeamMembers` filters to it
 * — so nobody appears who was not deliberately added.
 *
 * Read-only by design: `UsersTable` is rendered with both permission flags off,
 * so it drops the selection checkboxes, the role dropdown and the row actions.
 * Managing people stays on the Administration screen, which is where the
 * permission to do it is granted. Passing the flags rather than a second
 * component means the roster and the directory cannot drift apart.
 */
export default async function TeamMembersPage() {
  // Every role may see who is on the team — the same rule the sidebar applies
  // by putting this under Navigation rather than Administration.
  const viewer = await requirePage("team-members");

  const canInvite = await hasPermission("members.invite");
  const supervises = await viewerSupervises();

  const [members, addable] = await Promise.all([
    getTeamMembers(viewer.workspaceId),
    // Only owners and admins see the dialog, so only they need its candidates.
    canInvite ? getAddableUsers(viewer.workspaceId) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold leading-tight tracking-tight">Team Members</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone added to this workspace by an owner or admin
          </p>
        </div>

        {/*
          Gated on the same permission the action re-checks server-side. Adding
          people is the one management action offered here — changing roles and
          disabling accounts stay on Administration → Users.
        */}
        {canInvite ? (
          <AddMemberDialog
            users={addable.map((user) => ({
              id: user.id,
              name: user.name,
              email: user.email,
            }))}
          />
        ) : null}
      </div>

      {/*
        The figures are for whoever is responsible for the team, not for
        everybody on it. The roster below is the same screen for both.
      */}
      {supervises ? <TeamStats members={members} /> : null}

      <UsersTable
        users={members}
        canInvite={false}
        canAssignRoles={false}
        customRoles={[]}
        canManageRoles={false}
        canDelete={false}
        linkNames
        currentUserId={viewer.id}
      />
    </div>
  );
}
