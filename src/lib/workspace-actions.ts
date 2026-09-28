"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ensureWorkspaceRoles } from "@/lib/default-roles";
import { resolveMemberRole } from "@/lib/resolve-role";
import { requireAccount, viewerCan } from "@/lib/session";
import {
  type CreateWorkspaceInput,
  createWorkspaceSchema,
  firstError,
} from "@/lib/validations";

export type CreateWorkspaceResult = { ok: boolean; error?: string; workspaceId?: string };

export async function createWorkspaceAction(input: CreateWorkspaceInput): Promise<CreateWorkspaceResult> {
  const user = await requireAccount();

  const memberships = await prisma.workspaceMember.count({ where: { userId: user.id } });
  // `viewerCan` rather than `can(user.role, …)`: `user.role` is the base enum
  // from the JWT, so a custom role that narrows `workspace.create` away would
  // still pass here — while the sidebar entry and the /workspaces button, both
  // of which go through `hasPermission`, are already hidden for that person.
  // The two must agree, and the resolver is the side that knows the narrowing.
  //
  // Someone with no memberships at all is signing up: they are creating their
  // first workspace and become its admin, so there is no role to check yet.
  if (memberships > 0 && !(await viewerCan("workspace.create"))) {
    return { ok: false, error: "Only an admin can create a workspace." };
  }

  const parsed = createWorkspaceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const clash = await prisma.workspace.findUnique({ where: { slug: data.slug } });
  if (clash) return { ok: false, error: "That workspace URL is already taken." };

  const workspace = await prisma.$transaction(async (tx) => {
    const created = await tx.workspace.create({
      data: { name: data.name, slug: data.slug },
    });
    await tx.workspaceMember.create({
      data: { workspaceId: created.id, userId: user.id, role: "ADMIN" },
    });
    await tx.user.update({ where: { id: user.id }, data: { lastWorkspaceId: created.id } });
    // A new workspace starts with the default roles, so the Roles screen is
    // usable from the first visit rather than empty but for Admin.
    await ensureWorkspaceRoles(tx, created.id);
    return created;
  });

  return { ok: true, workspaceId: workspace.id };
}

export type DeleteWorkspaceResult = {
  ok: boolean;
  error?: string;
  /** Where the caller should move to, when they deleted the one they were in. */
  nextWorkspaceId?: string | null;
};

/**
 * Delete a workspace, provided it is empty of projects.
 *
 * **Ownership is checked against the target**, not against the session's
 * current workspace. `requirePermission` would ask "is this person an admin
 * *here*", which is the wrong question when the card being deleted belongs to
 * a different workspace — an admin of A who merely belongs to B could
 * otherwise delete B from A's session.
 *
 * The emptiness rule is what makes this safe to expose at all: deleting cascades
 * to every project, task, time entry, message and custom role inside. By
 * refusing while any project remains, the destructive reach is limited
 * to memberships and the workspace row itself, and the person is made to
 * dismantle the contents deliberately first.
 */
export async function deleteWorkspaceAction(
  workspaceId: string,
): Promise<DeleteWorkspaceResult> {
  const user = await requireAccount();

  // `resolveMemberRole` rather than reading `membership.role` and passing it to
  // `can()`: the stored enum is only the *base* role, so a custom role that
  // narrows `workspace.delete` away would still have passed. It resolves the
  // membership in the **target** workspace, which is the whole point of doing
  // this by hand instead of through `viewerCan` — that one answers for the
  // workspace the session is currently in.
  //
  // It returns null when the membership is gone, so this is also the
  // membership check; no separate query is needed.
  const resolved = await resolveMemberRole(workspaceId, user.id);
  if (!resolved) return { ok: false, error: "That workspace no longer exists." };

  if (!resolved.permissions.includes("workspace.delete")) {
    return { ok: false, error: "Only an admin of that workspace can delete it." };
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      name: true,
      _count: {
        select: {
          projects: true,
          // Disabled accounts cannot sign in, so they are not people who would
          // lose access — they do not count as a reason to refuse.
          members: { where: { user: { disabledAt: null } } },
        },
      },
    },
  });
  if (!workspace) return { ok: false, error: "That workspace no longer exists." };

  const projects = workspace._count.projects;
  // The caller is a member too, and they are the one asking — so only *other*
  // active people block the delete.
  const others = workspace._count.members - 1;

  if (projects > 0 || others > 0) {
    const blockers = [
      projects > 0 ? `${projects} ${projects === 1 ? "project" : "projects"}` : null,
      others > 0 ? `${others} other active ${others === 1 ? "user" : "users"}` : null,
    ].filter(Boolean);

    return {
      ok: false,
      error: `${workspace.name} still has ${blockers.join(" and ")}. Remove ${
        blockers.length > 1 ? "them" : "those"
      } before deleting it.`,
    };
  }

  // Where to land afterwards, read *before* the delete removes the membership.
  const fallback = await prisma.workspaceMember.findFirst({
    where: { userId: user.id, workspaceId: { not: workspaceId } },
    orderBy: { joinedAt: "asc" },
    select: { workspaceId: true },
  });

  await prisma.workspace.delete({ where: { id: workspaceId } });

  // Stops the next sign-in resuming into a workspace that is gone.
  if (user.workspaceId === workspaceId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastWorkspaceId: fallback?.workspaceId ?? null },
    });
  }

  revalidatePath("/workspaces");
  revalidatePath("/dashboard");
  return { ok: true, nextWorkspaceId: fallback?.workspaceId ?? null };
}
