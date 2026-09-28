"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/domain";
import { roleToDb, roleToDomain } from "@/lib/mappers";
import { permissionsFor, sanitisePages, type Permission } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { notify } from "@/lib/notifications";
import {
  type CustomRoleInput,
  customRoleSchema,
  firstError,
} from "@/lib/validations";

export type ActionResult = { ok: boolean; error?: string; roleId?: string };

function refresh() {
  revalidatePath("/admin/users/roles");
  revalidatePath("/admin/users");
  revalidatePath("/team-members");
  revalidatePath("/settings");
  // A role's page list is what the sidebar is built from, and the sidebar
  // lives in the (app) layout — so editing a role has to invalidate the layout
  // itself, not just the screens above, or holders keep the old nav until
  // their next full load.
  revalidatePath("/", "layout");
}

/**
 * Permissions a custom role may never hold, whatever its base role allows.
 *
 * `roles.manage` is the escalation route: a holder could edit their own role,
 * grant themselves everything, and the narrowing that makes custom roles safe
 * would no longer bound them. Managing roles stays with the base owner role.
 */
const FORBIDDEN_IN_CUSTOM_ROLES: Permission[] = ["roles.manage"];

/**
 * Validates a submitted role and returns the permissions it may actually hold.
 *
 * Two ceilings apply, in this order: the base role it inherits from, then the
 * forbidden list above. Both are applied server-side rather than trusted from
 * the form, because the form is the half an attacker skips.
 */
/*
 * Pages have no equivalent of this: `sanitisePages` only drops keys that name
 * no real page. There is deliberately no permission ceiling on them — an admin
 * may hand a role any page, including one whose permission it does not hold,
 * and the page opens read-only because every control inside is still gated on
 * `permissions` and every action re-checks.
 */
function sanitisePermissions(inheritsFrom: Role, requested: string[]) {
  const ceiling = permissionsFor(inheritsFrom).filter(
    (permission) => !FORBIDDEN_IN_CUSTOM_ROLES.includes(permission),
  );
  const granted = ceiling.filter((permission) => requested.includes(permission));

  const refused = requested.filter(
    (permission) => FORBIDDEN_IN_CUSTOM_ROLES.includes(permission as Permission),
  );

  return { granted, refused };
}

/** Create a role in the caller's workspace. Owners and admins only. */
export async function createCustomRoleAction(input: CustomRoleInput): Promise<ActionResult> {
  const actor = await requirePermission("workspace.settings");

  const parsed = customRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const clash = await prisma.customRole.findUnique({
    where: { workspaceId_name: { workspaceId: actor.workspaceId, name: data.name } },
  });
  if (clash) return { ok: false, error: "A role with that name already exists here." };

  const { granted, refused } = sanitisePermissions(data.inheritsFrom as Role, data.permissions);
  if (refused.length > 0) {
    return { ok: false, error: "Managing roles cannot be granted to a custom role." };
  }

  const created = await prisma.customRole.create({
    data: {
      workspaceId: actor.workspaceId,
      name: data.name,
      label: data.label,
      description: data.description,
      permissions: granted,
      pages: sanitisePages(data.pages),
      inheritsFrom: roleToDb[data.inheritsFrom as Role],
      isActive: true,
      isSystem: false,
      createdById: actor.id,
      updatedById: actor.id,
    },
  });

  refresh();
  return { ok: true, roleId: created.id };
}

/** Edit a role. Owners and admins only; system roles are read-only. */
export async function updateCustomRoleAction(
  roleId: string,
  input: CustomRoleInput,
): Promise<ActionResult> {
  const actor = await requirePermission("workspace.settings");

  const parsed = customRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const existing = await prisma.customRole.findFirst({
    where: { id: roleId, workspaceId: actor.workspaceId },
  });
  if (!existing) return { ok: false, error: "That role no longer exists." };
  if (existing.isSystem) return { ok: false, error: "System roles cannot be edited." };

  if (data.name !== existing.name) {
    const clash = await prisma.customRole.findUnique({
      where: { workspaceId_name: { workspaceId: actor.workspaceId, name: data.name } },
    });
    if (clash) return { ok: false, error: "A role with that name already exists here." };
  }

  const { granted, refused } = sanitisePermissions(data.inheritsFrom as Role, data.permissions);
  if (refused.length > 0) {
    return { ok: false, error: "Managing roles cannot be granted to a custom role." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.customRole.update({
      where: { id: roleId },
      data: {
        name: data.name,
        label: data.label,
        description: data.description,
        permissions: granted,
        pages: sanitisePages(data.pages),
        inheritsFrom: roleToDb[data.inheritsFrom as Role],
        updatedById: actor.id,
      },
    });

    // Members carry the base role alongside the custom one so role filters work
    // without a join — so changing what a role inherits has to restamp them.
    await tx.workspaceMember.updateMany({
      where: { workspaceId: actor.workspaceId, customRoleId: roleId },
      data: { role: roleToDb[data.inheritsFrom as Role] },
    });
  });

  // Retuning a role changes what its holders may reach, so their sidebars and
  // page gates have to re-resolve — and they are told, because a change to what
  // you may do is not something to discover by noticing a missing menu item.
  //
  // `notify` publishes to the live stream itself, so this both rings the bell
  // and refetches; no separate push is needed on this path.
  const holders = await prisma.workspaceMember.findMany({
    where: { workspaceId: actor.workspaceId, customRoleId: roleId },
    select: { userId: true },
  });

  await notify(prisma, {
    workspaceId: actor.workspaceId,
    userIds: holders.map((holder) => holder.userId),
    actorId: actor.id,
    kind: "role-changed",
    title: `Your role "${data.label}" was updated`,
    body: "What you can see and do may have changed.",
    href: "/profile",
  });

  refresh();
  return { ok: true, roleId };
}


/**
 * Delete a role. Owners and admins only.
 *
 * Holders are not deleted with it: the foreign key is `SetNull`, so they fall
 * back to the base role the membership already carries. That is a demotion in
 * effect, which is why the dialog says how many people it affects.
 */
export async function deleteCustomRoleAction(roleId: string): Promise<ActionResult> {
  const actor = await requirePermission("workspace.settings");

  const existing = await prisma.customRole.findFirst({
    where: { id: roleId, workspaceId: actor.workspaceId },
    include: { _count: { select: { members: true } } },
  });
  if (!existing) return { ok: false, error: "That role no longer exists." };
  if (existing.isSystem) return { ok: false, error: "System roles cannot be deleted." };

  // Captured before the delete: the foreign key is SetNull, so afterwards
  // there is nothing linking these people to the role that just vanished.
  const holders = await prisma.workspaceMember.findMany({
    where: { workspaceId: actor.workspaceId, customRoleId: roleId },
    select: { userId: true },
  });

  await prisma.customRole.delete({ where: { id: roleId } });

  // They fall back to their base role, which is a demotion in effect — worth
  // telling them about, not just silently re-resolving their sidebar.
  await notify(prisma, {
    workspaceId: actor.workspaceId,
    userIds: holders.map((holder) => holder.userId),
    actorId: actor.id,
    kind: "role-changed",
    title: `The role "${existing.label}" was deleted`,
    body: "You have been returned to your base role.",
    href: "/profile",
  });

  refresh();
  return { ok: true };
}

/** Give a member a custom role, or return them to a plain base role. */
export async function assignCustomRoleAction(
  userId: string,
  roleId: string | null,
): Promise<ActionResult> {
  const actor = await requirePermission("workspace.settings");

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId } },
  });
  if (!membership) return { ok: false, error: "They are not in this workspace." };
  if (userId === actor.id) return { ok: false, error: "You cannot change your own role." };

  if (roleId === null) {
    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId } },
      data: { customRoleId: null },
    });

    await notify(prisma, {
      workspaceId: actor.workspaceId,
      userIds: [userId],
      actorId: actor.id,
      kind: "role-changed",
      title: "Your role changed",
      body: `You are now ${roleToDomain[membership.role]}.`,
      href: "/profile",
    });

    refresh();
    return { ok: true };
  }

  const role = await prisma.customRole.findFirst({
    where: { id: roleId, workspaceId: actor.workspaceId, isActive: true },
  });
  if (!role) return { ok: false, error: "That role is not available in this workspace." };

  await prisma.workspaceMember.update({
    where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId } },
    // Base role restamped to match, for the same reason as in the update above.
    data: { customRoleId: role.id, role: role.inheritsFrom },
  });

  /*
   * This is the path the Users screen actually takes.
   *
   * Every non-admin role exists as a `CustomRole` row, so picking Manager,
   * Member, Viewer or Guest from that dropdown lands here rather than in
   * `setUserRoleAction` — which is reachable only for a base role, in practice
   * just Admin. Wiring the notification there and not here meant role changes
   * refreshed the person's session and told them nothing.
   *
   * `notify` publishes to the live stream itself, so this rings the bell and
   * re-resolves their tabs in one go.
   */
  await notify(prisma, {
    workspaceId: actor.workspaceId,
    userIds: [userId],
    actorId: actor.id,
    kind: "role-changed",
    title: "Your role changed",
    body: `You are now ${role.label}.`,
    href: "/profile",
  });

  refresh();
  return { ok: true };
}
