"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/domain";
import { roleToDb } from "@/lib/mappers";
import { requirePermission } from "@/lib/session";
import { roleRowIdFor } from "@/lib/resolve-role";
import { getMemberHoldings, type MemberHoldings } from "@/lib/admin";
import { publishToUsers } from "@/lib/live-events";
import { notify } from "@/lib/notifications";
import {
  addMemberSchema,
  type CreateUserInput,
  createUserSchema,
  firstError,
  type RemoveMemberInput,
  removeMemberSchema,
  setDisabledSchema,
  updateRoleSchema,
  type UpdateUserInput,
  updateUserSchema,
} from "@/lib/validations";

export type ActionResult = { ok: boolean; error?: string };

function refresh() {
  revalidatePath("/admin/users");
  revalidatePath("/admin/users/roles");
  // The roster reads the same data, so role changes, disables and deletes have
  // to invalidate it too — not just the directory they were performed from.
  revalidatePath("/team-members");
  revalidatePath("/settings");
}

/**
 * What `roles.manage` alone must not allow.
 *
 * Changing your own role is how someone ends up locked out of the screen they
 * were standing on, and it is never the intended click — another admin can do
 * it instead. The last-admin guards below cover the rest.
 *
 * Returns an error to surface, or null when the change is allowed.
 */
function guardRoleChange(
  actor: { id: string; role: Role },
  targetUserId: string,
): ActionResult | null {
  if (actor.id === targetUserId) {
    return { ok: false, error: "You cannot change your own role." };
  }
  return null;
}

/** Admin count for a workspace, restricted to accounts that can still sign in. */
async function activeAdminCount(workspaceId: string) {
  return prisma.workspaceMember.count({
    where: { workspaceId, role: "ADMIN", user: { disabledAt: null } },
  });
}

/** Create an account and add it to the caller's workspace. Admins only. */
export async function createUserAction(input: CreateUserInput): Promise<ActionResult> {
  const actor = await requirePermission("members.invite");

  // The form validated with this same schema; parsing again is what actually
  // protects the database, since a client can post anything.
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) return { ok: false, error: "Someone already uses that email." };

  await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: `${data.firstName} ${data.lastName}`,
        email: data.email,
        phone: data.phone || null,
        designation: data.designation || null,
        monthlyHours: data.monthlyHours,
        passwordHash: await bcrypt.hash(data.password, 12),
        disabledAt: data.active ? null : new Date(),
        lastWorkspaceId: actor.workspaceId,
      },
    });
    await tx.workspaceMember.create({
      data: {
        workspaceId: actor.workspaceId,
        userId: created.id,
        role: roleToDb[data.role as Role],
        // Linked to the workspace’s row for that role, so the Roles screen
        // counts them and its edits are theirs.
        customRoleId: await roleRowIdFor(actor.workspaceId, data.role as Role),
      },
    });
  });

  refresh();
  return { ok: true };
}

/**
 * Edit an account's profile: who they are, where they sit, what they are
 * expected to work.
 *
 * Role and the active flag are deliberately not here — each has its own
 * control and its own last-admin guard, and folding them into a general edit
 * form would route around both.
 */
export async function updateUserAction(input: UpdateUserInput): Promise<ActionResult> {
  await requirePermission("members.invite");

  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { id: true },
  });
  if (!user) return { ok: false, error: "That account no longer exists." };

  const clash = await prisma.user.findFirst({
    where: { email: data.email, id: { not: data.userId } },
    select: { id: true },
  });
  if (clash) return { ok: false, error: "Someone already uses that email." };

  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: data.name,
      email: data.email,
      phone: data.phone || null,
      designation: data.designation || null,
      monthlyHours: data.monthlyHours,
    },
  });

  refresh();
  revalidatePath("/team-members");
  return { ok: true };
}

/**
 * Add an account that already exists to the caller's workspace.
 *
 * The counterpart to `createUserAction`: that one makes a new account, this one
 * grants an existing account access here. Kept separate because they differ in
 * what can go wrong — this cannot fail on a duplicate email, but it can race
 * another admin adding the same person, so the membership insert is guarded by
 * a lookup and the composite primary key behind it.
 */
export async function addMemberAction(formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission("members.invite");

  const parsed = addMemberSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role") ?? "member",
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: data.userId }, select: { id: true } });
  if (!user) return { ok: false, error: "That account no longer exists." };

  const already = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId: data.userId } },
  });
  if (already) return { ok: false, error: "They are already in this workspace." };

  await prisma.workspaceMember.create({
    data: {
      workspaceId: actor.workspaceId,
      userId: data.userId,
      role: roleToDb[data.role as Role],
      customRoleId: await roleRowIdFor(actor.workspaceId, data.role as Role),
    },
  });

  const workspace = await prisma.workspace.findUnique({
    where: { id: actor.workspaceId },
    select: { name: true },
  });

  /*
   * This one is for an account that already exists, so the person may well be
   * signed in somewhere right now — unlike the create and invite paths, where
   * there is nobody to tell yet.
   *
   * Scoped to the workspace they were added to, because the bell is
   * per-workspace: `getNotifications` filters on the workspace the reader is
   * currently in. Someone sitting in a different workspace therefore sees this
   * when they switch to the new one, which is also the only place it means
   * anything — hence the link to the switcher.
   */
  await notify(prisma, {
    workspaceId: actor.workspaceId,
    userIds: [data.userId],
    actorId: actor.id,
    kind: "workspace-added",
    title: `You were added to ${workspace?.name ?? "a workspace"}`,
    body: `As ${data.role}.`,
    href: "/workspaces",
  });

  refresh();
  return { ok: true };
}

/** Enable or disable sign-in for several accounts at once. */
export async function setUsersDisabledAction(
  userIds: string[],
  disabled: boolean,
): Promise<ActionResult> {
  const actor = await requirePermission("members.invite");

  const parsed = setDisabledSchema.safeParse({ userIds, disabled });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: actor.workspaceId, userId: { in: parsed.data.userIds } },
    select: { userId: true },
  });
  const targets = members.map((m) => m.userId).filter((id) => id !== actor.id);
  if (targets.length === 0) {
    return { ok: false, error: "You cannot change your own account here." };
  }

  if (parsed.data.disabled) {
    // Never lock this workspace out of its last usable admin.
    const owners = await prisma.workspaceMember.findMany({
      where: { workspaceId: actor.workspaceId, role: "ADMIN", user: { disabledAt: null } },
      select: { userId: true },
    });
    const remaining = owners.filter((owner) => !targets.includes(owner.userId));
    if (owners.length > 0 && remaining.length === 0) {
      return { ok: false, error: "At least one admin must stay active." };
    }
  }

  await prisma.user.updateMany({
    where: { id: { in: targets } },
    data: { disabledAt: parsed.data.disabled ? new Date() : null },
  });

  refresh();
  return { ok: true };
}

/**
 * Permanently delete an account. Admins only, never the last admin of this
 * workspace, and only for someone who is actually in it.
 *
 * This still deletes the whole account, not just this workspace's membership
 * — the same account-level delete the app had before workspaces existed — so
 * it also removes the person from every other workspace they belong to. A
 * "remove from this workspace only" action would be a reasonable follow-up
 * but is a distinct feature from what's built here.
 */
export async function deleteUserAction(userId: string): Promise<ActionResult> {
  const actor = await requirePermission("members.delete");

  if (userId === actor.id) return { ok: false, error: "You cannot delete your own account." };

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId } },
  });
  if (!membership) return { ok: false, error: "That account no longer exists." };

  if (membership.role === "ADMIN") {
    const owners = await activeAdminCount(actor.workspaceId);
    if (owners <= 1) return { ok: false, error: "The workspace must keep at least one admin." };
  }

  // Task assignments and time entries cascade — deleting an account erases the
  // hours it logged, which is why the confirm dialog shows those counts.
  await prisma.user.delete({ where: { id: userId } });

  refresh();
  revalidatePath("/dashboard");
  revalidatePath("/projects");
  return { ok: true };
}

/** Change a single user's role in this workspace. Owner-only. */
export async function setUserRoleAction(userId: string, role: string): Promise<ActionResult> {
  const actor = await requirePermission("roles.manage");

  const parsed = updateRoleSchema.safeParse({ userId, role });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId: parsed.data.userId } },
  });
  if (!membership) return { ok: false, error: "That account no longer exists." };

  const guard = guardRoleChange(actor, parsed.data.userId);
  if (guard) return guard;

  if (membership.role === "ADMIN" && parsed.data.role !== "admin") {
    const owners = await activeAdminCount(actor.workspaceId);
    if (owners <= 1) return { ok: false, error: "The workspace must keep at least one admin." };
  }

  await prisma.workspaceMember.update({
    where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId: parsed.data.userId } },
    // Re-pointed as well as restamped: leaving the old link would keep them on
    // the role they were moved off.
    data: {
      role: roleToDb[parsed.data.role as Role],
      customRoleId: await roleRowIdFor(actor.workspaceId, parsed.data.role as Role),
    },
  });

  // Their role decides which pages they reach and which controls they get, so
  // this is worth telling them about — and the notification doubles as the
  // push that makes their sidebar re-resolve without a navigation.
  await notify(prisma, {
    workspaceId: actor.workspaceId,
    userIds: [parsed.data.userId],
    actorId: actor.id,
    kind: "role-changed",
    title: "Your role changed",
    body: `You are now ${parsed.data.role}.`,
    href: "/profile",
  });

  refresh();
  return { ok: true };
}


/**
 * Take somebody off this workspace, keeping a record of it.
 *
 * Not the same act as deleting an account: the `User` row is untouched, they
 * keep every other workspace they belong to, and they can be added straight
 * back. `members.invite` for that reason — it is the exact counterpart of
 * `addMemberAction` and is reversible, where `members.delete` destroys history.
 *
 * Three refusals, all re-checked here rather than trusted from the dialog:
 *
 *   **The account must be disabled first.** Removal is deliberate, and
 *   disabling is the reversible half that stops them signing in meanwhile.
 *
 *   **No assigned tasks.** Work has to be handed over by somebody who knows
 *   where it should go, not silently orphaned by this action.
 *
 *   **Never the last admin**, and never yourself — the same two guards every
 *   other membership-changing action carries.
 *
 * What it does clean up: their project memberships, and the manager link on
 * anyone reporting to them. Their time entries stay — those are the record of
 * work actually done, and deleting them would rewrite every report and any
 * invoice built from one. The counts are snapshotted into `MemberRemoval`
 * first, because afterwards there is nothing left to count.
 */
export async function removeFromWorkspaceAction(
  input: RemoveMemberInput,
): Promise<ActionResult> {
  const actor = await requirePermission("members.invite");

  const parsed = removeMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { userId, reason } = parsed.data;

  if (userId === actor.id) {
    return { ok: false, error: "You cannot remove yourself from this workspace." };
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId } },
    select: { role: true, user: { select: { name: true, email: true } } },
  });
  if (!membership) return { ok: false, error: "They are not in this workspace." };

  if (membership.role === "ADMIN") {
    const admins = await activeAdminCount(actor.workspaceId);
    if (admins <= 1) {
      return { ok: false, error: "The workspace must keep at least one admin." };
    }
  }

  // Re-read rather than trust what the dialog was showing: it may have been
  // open while somebody assigned them a task.
  const holdings = await getMemberHoldings(actor.workspaceId, userId);
  if (!holdings) return { ok: false, error: "They are not in this workspace." };
  if (holdings.blockers.length > 0) {
    return { ok: false, error: holdings.blockers[0] };
  }

  await prisma.$transaction(async (tx) => {
    // Snapshotted before anything is deleted — afterwards these are gone.
    await tx.memberRemoval.create({
      data: {
        workspaceId: actor.workspaceId,
        userId,
        userName: membership.user.name,
        userEmail: membership.user.email,
        role: membership.role,
        reason,
        projectCount: holdings.projectCount,
        hoursLogged: holdings.hoursLogged,
        removedById: actor.id,
      },
    });

    // Their project rows, which nothing else cascades.
    await tx.projectMember.deleteMany({
      where: { userId, project: { workspaceId: actor.workspaceId } },
    });

    await tx.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId } },
    });
  });

  // Everyone who was reporting to them, plus the person themselves — their
  // sidebar, their project list and their workspace switcher all just changed.
  publishToUsers([userId]);

  refresh();
  revalidatePath("/admin/users/history");
  return { ok: true };
}

/**
 * What somebody is holding in this workspace, for the removal dialog.
 *
 * A read rather than a write, but it lives here because it is only ever asked
 * by a control gated on `members.invite` and it reports things — hours,
 * assignments, who reports to whom — that nobody below that should be able to
 * enumerate about an arbitrary account.
 */
export async function memberHoldingsAction(
  userId: string,
): Promise<{ ok: boolean; holdings?: MemberHoldings; error?: string }> {
  const actor = await requirePermission("members.invite");

  const holdings = await getMemberHoldings(actor.workspaceId, userId);
  if (!holdings) return { ok: false, error: "They are not in this workspace." };

  return { ok: true, holdings };
}
