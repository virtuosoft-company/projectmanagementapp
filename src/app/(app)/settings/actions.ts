"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import type { Role } from "@/lib/domain";
import { roleToDb } from "@/lib/mappers";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { roleRowIdFor } from "@/lib/resolve-role";
import { notify } from "@/lib/notifications";
import {
  firstError,
  inviteMemberSchema,
  updateRoleSchema,
  updateWorkspaceSchema,
} from "@/lib/validations";

export type ActionResult = { ok: boolean; error?: string };

function refresh() {
  revalidatePath("/settings");
  revalidatePath("/admin/users");
}

async function activeAdminCount(workspaceId: string) {
  return prisma.workspaceMember.count({
    where: { workspaceId, role: "ADMIN", user: { disabledAt: null } },
  });
}

/** Change a member's role in this workspace. Admins only, and the last admin cannot be demoted. */
export async function updateRoleAction(formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission("roles.manage");

  const parsed = updateRoleSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId: parsed.data.userId } },
  });
  if (!membership) return { ok: false, error: "That member no longer exists." };

  // Same guard as `setUserRoleAction`: changing your own role is how someone
  // locks themselves out of the screen they are standing on.
  if (parsed.data.userId === actor.id) {
    return { ok: false, error: "You cannot change your own role." };
  }

  if (membership.role === "ADMIN" && parsed.data.role !== "admin") {
    const admins = await activeAdminCount(actor.workspaceId);
    if (admins <= 1) {
      return { ok: false, error: "The workspace must keep at least one admin." };
    }
  }

  await prisma.workspaceMember.update({
    where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId: parsed.data.userId } },
    // Re-pointed as well as restamped, so the Roles screen counts them under
    // the role they now hold rather than the one they left.
    data: {
      role: roleToDb[parsed.data.role as Role],
      customRoleId: await roleRowIdFor(actor.workspaceId, parsed.data.role as Role),
    },
  });

  // The same message the Users screen sends — this is the second way to change
  // somebody’s role and it was the silent one.
  //
  // What the new role allows already applied on their next request, because
  // every gate resolves from the database. This is what reaches a tab that is
  // already open, and what makes their session re-mint so the role they see
  // matches the role they have.
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

/** Invite a member into this workspace. Owners and admins only. */
export async function inviteMemberAction(formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission("members.invite");

  const parsed = inviteMemberSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role") ?? "member",
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) return { ok: false, error: "Someone already uses that email." };

  await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash: data.password ? await bcrypt.hash(data.password, 12) : null,
        lastWorkspaceId: actor.workspaceId,
      },
    });
    await tx.workspaceMember.create({
      data: {
        workspaceId: actor.workspaceId,
        userId: created.id,
        role: roleToDb[data.role as Role],
        customRoleId: await roleRowIdFor(actor.workspaceId, data.role as Role),
      },
    });
  });

  refresh();
  return { ok: true };
}

/** Disable or re-enable sign-in for a member of this workspace. Owners and admins only. */
export async function setMemberDisabledAction(formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission("members.invite");

  const userId = String(formData.get("userId") ?? "");
  const disabled = String(formData.get("disabled") ?? "") === "true";

  if (!userId) return { ok: false, error: "Pick a member." };
  if (userId === actor.id) return { ok: false, error: "You cannot disable your own account." };

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId } },
  });
  if (!membership) return { ok: false, error: "That member no longer exists." };

  await prisma.user.update({
    where: { id: userId },
    data: { disabledAt: disabled ? new Date() : null },
  });

  refresh();
  return { ok: true };
}

/** Rename or re-describe the current workspace. Owners and admins only. */
export async function updateWorkspaceAction(formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission("workspace.settings");

  const parsed = updateWorkspaceSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  await prisma.workspace.update({
    where: { id: actor.workspaceId },
    data: { name: parsed.data.name, description: parsed.data.description },
  });

  revalidatePath("/settings");
  return { ok: true };
}
