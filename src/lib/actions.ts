"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { hoursToMinutes } from "@/lib/domain";
import {
  campaignStatusToDb,
  isoToDate,
  priorityToDb,
  projectStatusToDb,
  sectionTypeToDb,
  taskStatusToDb,
} from "@/lib/mappers";
import { DEFAULT_LISTS, syncTaskList } from "@/lib/boards";
import { notify } from "@/lib/notifications";
import { publishToUsers } from "@/lib/live-events";
import { requirePage, requirePermission } from "@/lib/session";
import {
  addProjectMembersSchema,
  addSectionSchema,
  type CampaignInput,
  campaignSchema,
  type CreateProjectInput,
  createProjectSchema,
  type CreateTaskInput,
  createTaskSchema,
  firstError,
  type LogTimeInput,
  logTimeSchema,
  moveTaskSchema,
  type ProjectFeaturesInput,
  projectFeaturesSchema,
  markMessagesReadSchema,
  sendMessageSchema,
  type UpdateProjectInput,
  updateProjectSchema,
  type UpdateSectionInput,
  updateSectionSchema,
} from "@/lib/validations";
import type {
  CampaignStatus,
  Priority,
  ProjectStatus,
  SectionType,
  TaskStatus,
} from "@/lib/domain";

export type ActionResult = { ok: boolean; error?: string };

/**
 * Writes for the project domain. Every action re-checks the caller's permission
 * server-side — the UI hides controls the role cannot use, but that is a
 * convenience, never the enforcement — and every action that touches an
 * existing record confirms it belongs to the caller's workspace before
 * mutating it, since a record id alone is never proof of ownership.
 */

const NOT_FOUND: ActionResult = { ok: false, error: "That record no longer exists." };

function refreshProject(projectId?: string) {
  // The sidebar lists the viewer’s projects and lives in the (app) layout, so a
  // change to who is on a project has to invalidate the layout as well as the
  // pages. Without this the list of projects down the side kept whatever it was
  // rendered with, even after the screens beside it had updated.
  revalidatePath("/", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/projects");
  revalidatePath("/projects/tasks");
  revalidatePath("/projects/calendar");
  revalidatePath("/projects/analytics");
  revalidatePath("/projects/time-tracking");
  if (projectId) revalidatePath(`/projects/project/${projectId}`, "layout");
}

// --- Projects --------------------------------------------------------------

export async function createProjectAction(input: CreateProjectInput): Promise<ActionResult> {
  const user = await requirePermission("projects.create");

  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  // The creator is always a member, whether or not they ticked themselves in
  // the picker. Project listings are scoped to the viewer's own projects, so
  // without this you could create a project and immediately not see it.
  const memberIds = [...new Set([user.id, ...data.memberIds])];

  await prisma.project.create({
    data: {
      workspaceId: user.workspaceId,
      name: data.name,
      description: data.description,
      status: projectStatusToDb[data.status as ProjectStatus],
      color: data.color,
      startDate: isoToDate(data.startDate),
      endDate: isoToDate(data.endDate),
      members: { create: memberIds.map((userId) => ({ userId })) },
      // Every project starts with a board, so its first card has somewhere
      // to go without a setup step.
      boards: {
        create: {
          name: "Main board",
          position: 0,
          lists: { create: DEFAULT_LISTS.map((list, index) => ({ ...list, position: index })) },
        },
      },
    },
  });

  refreshProject();
  return { ok: true };
}

export async function updateProjectAction(input: UpdateProjectInput): Promise<ActionResult> {
  const user = await requirePermission("projects.edit");

  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const existing = await prisma.project.findFirst({
    where: { id: data.id, workspaceId: user.workspaceId },
    select: { id: true, name: true, members: { select: { userId: true } } },
  });
  if (!existing) return NOT_FOUND;

  /*
   * The dialog posts the membership it wants, so this is a set difference
   * rather than an append: ticking adds, unticking removes.
   *
   * Everyone named is checked against this workspace first. The picker only
   * offers members of it, but the picker is the half an attacker skips, and an
   * unchecked id would put somebody from another workspace on the project.
   */
  const requested = [...new Set(data.memberIds)];
  const allowed = new Set(
    (
      await prisma.workspaceMember.findMany({
        where: { workspaceId: user.workspaceId, userId: { in: requested } },
        select: { userId: true },
      })
    ).map((member) => member.userId),
  );

  const current = new Set(existing.members.map((member) => member.userId));
  const wanted = requested.filter((userId) => allowed.has(userId));
  const added = wanted.filter((userId) => !current.has(userId));
  const removed = [...current].filter((userId) => !wanted.includes(userId));

  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: data.id },
      data: {
        name: data.name,
        description: data.description,
        status: projectStatusToDb[data.status as ProjectStatus],
        startDate: isoToDate(data.startDate),
        endDate: isoToDate(data.endDate),
      },
    });

    if (removed.length > 0) {
      await tx.projectMember.deleteMany({
        where: { projectId: data.id, userId: { in: removed } },
      });
    }

    if (added.length > 0) {
      await tx.projectMember.createMany({
        data: added.map((userId) => ({ projectId: data.id, userId })),
        skipDuplicates: true,
      });
    }
  });

  // The same message the Members card sends, so being added reads identically
  // wherever it happened from.
  await notify(prisma, {
    workspaceId: user.workspaceId,
    userIds: added,
    actorId: user.id,
    kind: "project-added",
    title: `You were added to ${existing.name}`,
    href: `/projects/project/${existing.id}`,
  });

  // Someone taken off gets no bell entry — being removed is not news worth
  // one — but their open tabs still have to stop showing the project, and only
  // a push can tell them. The nudge that `notify` would have sent is sent here
  // directly instead.
  publishToUsers(removed);

  refreshProject(data.id);
  revalidatePath("/projects/settings");
  return { ok: true };
}

/**
 * Delete a project and everything inside it.
 *
 * Cascades to its boards, tasks, subtasks, time entries, sheets and campaigns,
 * so the caller is told the counts before confirming — the figures come back
 * with the refusal-free path rather than being guessed in the dialog.
 */
export async function deleteProjectAction(projectId: string): Promise<ActionResult> {
  const user = await requirePermission("projects.delete");

  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: user.workspaceId },
    // Members are read *before* the delete cascades them away — afterwards
    // there is no longer anybody to tell.
    select: { id: true, name: true, members: { select: { userId: true } } },
  });
  if (!project) return NOT_FOUND;

  const affected = project.members.map((member) => member.userId);

  await prisma.project.delete({ where: { id: project.id } });

  // No bell entry: a deleted project is not something anyone can act on, and
  // the admin doing it usually says so themselves. But an open Projects page
  // or sidebar still lists it, so those tabs are told to refetch.
  publishToUsers(affected);

  revalidatePath("/projects", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/projects/settings");
  return { ok: true };
}

export async function addProjectMembersAction(
  projectId: string,
  userIds: string[],
): Promise<ActionResult> {
  const user = await requirePermission("projects.edit");

  const parsed = addProjectMembersSchema.safeParse({ projectId, userIds });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, workspaceId: user.workspaceId },
    select: { id: true, name: true, members: { select: { userId: true } } },
  });
  if (!project) return NOT_FOUND;

  // Who is genuinely new. `skipDuplicates` silently absorbs the rest, so
  // without this an admin re-saving the member list would notify everybody on
  // the project all over again.
  const already = new Set(project.members.map((member) => member.userId));
  const added = [...new Set(parsed.data.userIds)].filter((userId) => !already.has(userId));

  await prisma.projectMember.createMany({
    data: added.map((userId) => ({ projectId: parsed.data.projectId, userId })),
    skipDuplicates: true,
  });

  // Being put on a project changes what someone sees on their own Projects
  // page and in their sidebar, and they have no other way to learn it happened
  // — the same reason assigning a task notifies.
  await notify(prisma, {
    workspaceId: user.workspaceId,
    userIds: added,
    actorId: user.id,
    kind: "project-added",
    title: `You were added to ${project.name}`,
    href: `/projects/project/${project.id}`,
  });

  refreshProject(projectId);
  return { ok: true };
}

/** Switch a project's optional sub-pages on or off. */
/**
 * Switch a project's optional pages on or off. Owners and admins only.
 *
 * `workspace.settings` rather than `projects.edit`: which pages a project has
 * is a shape-of-the-workspace decision, not day-to-day project work. Under
 * `projects.edit` a member could remove Reports or Billing-adjacent pages from
 * a project for everyone on it, which is not theirs to decide.
 */
export async function updateProjectFeaturesAction(input: ProjectFeaturesInput): Promise<ActionResult> {
  const user = await requirePermission("workspace.settings");

  const parsed = projectFeaturesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const existing = await prisma.project.findFirst({
    where: { id: data.projectId, workspaceId: user.workspaceId },
    select: { id: true, members: { select: { userId: true } } },
  });
  if (!existing) return NOT_FOUND;

  await prisma.project.update({
    where: { id: data.projectId },
    data: { features: data.features },
  });

  // These are the project's rows in everyone's sidebar. Switching one off
  // leaves a link that now 404s, and switching one on hides a page they are
  // entitled to until they happen to navigate.
  publishToUsers(existing.members.map((member) => member.userId));

  refreshProject(data.projectId);
  return { ok: true };
}

// --- Tasks -----------------------------------------------------------------

/** Returns the new task's id, so a cover and a file can be uploaded to it next. */
export async function createTaskAction(input: CreateTaskInput): Promise<ActionResult & { id?: string }> {
  const user = await requirePermission("tasks.manage");

  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const project = await prisma.project.findFirst({
    where: { id: data.projectId, workspaceId: user.workspaceId },
    select: { id: true },
  });
  if (!project) return NOT_FOUND;

  const last = await prisma.task.findFirst({
    where: { projectId: data.projectId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const created = await prisma.task.create({
    data: {
      projectId: data.projectId,
      title: data.title,
      description: data.description,
      status: taskStatusToDb[data.status as TaskStatus],
      priority: priorityToDb[data.priority as Priority],
      estimateMinutes: hoursToMinutes(data.estimateHours),
      dueDate: isoToDate(data.dueDate),
      position: (last?.position ?? -1) + 1,
      assignees: { create: data.assigneeIds.map((userId) => ({ userId })) },
    },
    select: { id: true },
  });

  // Onto the first board, in a list that counts as the chosen status.
  await syncTaskList(prisma, created.id);

  // Assigning somebody at creation is the same event as assigning them later,
  // and `updateTaskAction` has always notified. Only this path was silent, so
  // a task created straight onto a person reached them without a word.
  await notify(prisma, {
    workspaceId: user.workspaceId,
    userIds: data.assigneeIds,
    actorId: user.id,
    kind: "task-assigned",
    title: `You were assigned "${data.title}"`,
    href: `/projects/project/${data.projectId}/tasks/${created.id}`,
  });

  refreshProject(data.projectId);
  return { ok: true, id: created.id };
}

export async function moveTaskAction(taskId: string, status: TaskStatus): Promise<ActionResult> {
  const user = await requirePermission("tasks.manage");

  const parsed = moveTaskSchema.safeParse({ taskId, status });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const task = await prisma.task.findFirst({
    where: { id: parsed.data.taskId, project: { workspaceId: user.workspaceId } },
    select: { projectId: true },
  });
  if (!task) return NOT_FOUND;

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: parsed.data.taskId },
      data: { status: taskStatusToDb[parsed.data.status as TaskStatus] },
    });
    // A new status means a new list — onto one that counts as it, on the
    // same board — so the board never shows a card in the wrong column.
    await syncTaskList(tx, parsed.data.taskId);
  });

  refreshProject(task.projectId);
  return { ok: true };
}

export async function deleteTaskAction(taskId: string): Promise<ActionResult> {
  const user = await requirePermission("tasks.manage");

  const task = await prisma.task.findFirst({
    where: { id: taskId, project: { workspaceId: user.workspaceId } },
    select: { projectId: true },
  });
  if (!task) return NOT_FOUND;

  await prisma.task.delete({ where: { id: taskId } });

  refreshProject(task.projectId);
  return { ok: true };
}

// --- Time entries ----------------------------------------------------------

export async function logTimeAction(input: LogTimeInput): Promise<ActionResult> {
  const user = await requirePermission("time.log");

  const parsed = logTimeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const task = await prisma.task.findFirst({
    where: { id: data.taskId, project: { workspaceId: user.workspaceId } },
    select: { projectId: true },
  });
  if (!task) return { ok: false, error: "That task no longer exists." };

  await prisma.timeEntry.create({
    data: {
      taskId: data.taskId,
      userId: user.id,
      date: isoToDate(data.date) ?? new Date(),
      minutes: data.minutes,
      note: data.note,
    },
  });

  refreshProject(task.projectId);
  return { ok: true };
}

// --- Campaigns -------------------------------------------------------------

export async function createCampaignAction(
  projectId: string,
  input: CampaignInput,
): Promise<ActionResult> {
  const user = await requirePermission("projects.edit");

  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: user.workspaceId },
    select: { id: true },
  });
  if (!project) return NOT_FOUND;

  await prisma.campaign.create({
    data: {
      projectId,
      name: data.name,
      description: data.description,
      status: campaignStatusToDb[data.status as CampaignStatus],
      progress: data.progress,
      startDate: isoToDate(data.startDate),
      endDate: isoToDate(data.endDate),
      budget: data.budget,
    },
  });

  revalidatePath(`/projects/project/${projectId}/campaigns`);
  return { ok: true };
}

export async function updateCampaignAction(id: string, input: CampaignInput): Promise<ActionResult> {
  const user = await requirePermission("projects.edit");

  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const existing = await prisma.campaign.findFirst({
    where: { id, project: { workspaceId: user.workspaceId } },
    select: { projectId: true },
  });
  if (!existing) return NOT_FOUND;

  const campaign = await prisma.campaign.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description,
      status: campaignStatusToDb[data.status as CampaignStatus],
      progress: data.progress,
      startDate: isoToDate(data.startDate),
      endDate: isoToDate(data.endDate),
      budget: data.budget,
    },
    select: { projectId: true },
  });

  revalidatePath(`/projects/project/${campaign.projectId}/campaigns`);
  return { ok: true };
}

export async function deleteCampaignAction(id: string): Promise<ActionResult> {
  const user = await requirePermission("projects.delete");

  const existing = await prisma.campaign.findFirst({
    where: { id, project: { workspaceId: user.workspaceId } },
    select: { projectId: true },
  });
  if (!existing) return NOT_FOUND;

  const campaign = await prisma.campaign.delete({ where: { id }, select: { projectId: true } });
  revalidatePath(`/projects/project/${campaign.projectId}/campaigns`);
  return { ok: true };
}

// --- Landing sections ------------------------------------------------------

export async function addSectionAction(
  projectId: string,
  type: SectionType,
  defaults: { heading: string; subheading?: string; items?: string[]; primaryCta?: string; secondaryCta?: string },
): Promise<ActionResult> {
  const user = await requirePermission("projects.edit");

  const parsed = addSectionSchema.safeParse({ projectId, type });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: user.workspaceId },
    select: { id: true },
  });
  if (!project) return NOT_FOUND;

  const last = await prisma.landingSection.findFirst({
    where: { projectId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  await prisma.landingSection.create({
    data: {
      projectId,
      type: sectionTypeToDb[type],
      heading: defaults.heading,
      subheading: defaults.subheading ?? null,
      items: defaults.items ?? undefined,
      primaryCta: defaults.primaryCta ?? null,
      secondaryCta: defaults.secondaryCta ?? null,
      position: (last?.position ?? -1) + 1,
    },
  });

  revalidatePath(`/projects/project/${projectId}/landing-pages`);
  return { ok: true };
}

export async function updateSectionAction(input: UpdateSectionInput): Promise<ActionResult> {
  const user = await requirePermission("projects.edit");

  const parsed = updateSectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const existing = await prisma.landingSection.findFirst({
    where: { id: data.id, project: { workspaceId: user.workspaceId } },
    select: { projectId: true },
  });
  if (!existing) return NOT_FOUND;

  const section = await prisma.landingSection.update({
    where: { id: data.id },
    data: {
      heading: data.heading,
      subheading: data.subheading,
      items: data.items ?? undefined,
      primaryCta: data.primaryCta,
      secondaryCta: data.secondaryCta,
    },
    select: { projectId: true },
  });

  revalidatePath(`/projects/project/${section.projectId}/landing-pages`);
  return { ok: true };
}

export async function deleteSectionAction(id: string): Promise<ActionResult> {
  const user = await requirePermission("projects.edit");

  const existing = await prisma.landingSection.findFirst({
    where: { id, project: { workspaceId: user.workspaceId } },
    select: { projectId: true },
  });
  if (!existing) return NOT_FOUND;

  const section = await prisma.landingSection.delete({
    where: { id },
    select: { projectId: true },
  });

  revalidatePath(`/projects/project/${section.projectId}/landing-pages`);
  return { ok: true };
}

/** Swap a section with its neighbour. */
export async function moveSectionAction(id: string, delta: -1 | 1): Promise<ActionResult> {
  const user = await requirePermission("projects.edit");

  const section = await prisma.landingSection.findFirst({
    where: { id, project: { workspaceId: user.workspaceId } },
  });
  if (!section) return { ok: false, error: "That section no longer exists." };

  const neighbour = await prisma.landingSection.findFirst({
    where: {
      projectId: section.projectId,
      position: delta === -1 ? { lt: section.position } : { gt: section.position },
    },
    orderBy: { position: delta === -1 ? "desc" : "asc" },
  });
  if (!neighbour) return { ok: true };

  await prisma.$transaction([
    prisma.landingSection.update({
      where: { id: section.id },
      data: { position: neighbour.position },
    }),
    prisma.landingSection.update({
      where: { id: neighbour.id },
      data: { position: section.position },
    }),
  ]);

  revalidatePath(`/projects/project/${section.projectId}/landing-pages`);
  return { ok: true };
}

// --- Messages --------------------------------------------------------------

export async function sendMessageAction(
  recipientId: string,
  body: string,
): Promise<ActionResult> {
  // The same gate the page uses. It asked for `projects.view` before, which no
  // part of Messages is derived from: the nav entry carries `permission: null`,
  // so assignment is the only authority over this screen. The mismatch cut both
  // ways — somebody assigned the page but without `projects.view` could read
  // every thread and have each send refused, and somebody holding
  // `projects.view` without the page could still send by calling this directly,
  // which a server action always allows.
  const user = await requirePage("messages");

  const parsed = sendMessageSchema.safeParse({ recipientId, body });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const recipient = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId: user.workspaceId, userId: parsed.data.recipientId },
    },
    select: { userId: true },
  });
  if (!recipient) return { ok: false, error: "That person isn't in this workspace." };

  await prisma.message.create({
    data: {
      workspaceId: user.workspaceId,
      senderId: user.id,
      recipientId: parsed.data.recipientId,
      body: parsed.data.body,
    },
  });

  // Just this page. The badge lives in the app layout, but nothing reaches the
  // new count through the cache anyway: both sides arrive via `router.refresh()`,
  // which re-runs the tree from the root layout and refetches regardless. The
  // root-layout form invalidated every route under `(app)` on every send, for
  // no gain the refresh was not already delivering.
  revalidatePath("/messages");

  // Push to the recipient, so the message lands without them navigating. Their
  // `LiveUpdates` turns this into a `router.refresh()`, which re-runs the route
  // and its layouts — the open thread and the unread badge in one pass.
  //
  // Only the recipient: the sender's own client already refreshes when the
  // action returns, and publishing to them would just queue a second one.
  publishToUsers([parsed.data.recipientId]);

  return { ok: true };
}

/**
 * Mark one thread's incoming messages read — what clicking into the reply box
 * does. The badge counts unread rows, so this is what makes it go down.
 *
 * Scoped three ways on purpose: `recipientId` is always the caller, so this can
 * only ever mark your own mail read, never someone else's; `senderId` limits it
 * to the thread actually opened rather than the whole inbox; and `readAt: null`
 * means an already-read message keeps its original timestamp instead of being
 * bumped every time the box is focused.
 */
export async function markMessagesReadAction(contactId: string): Promise<ActionResult> {
  const user = await requirePage("messages");

  const parsed = markMessagesReadSchema.safeParse({ contactId });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  await prisma.message.updateMany({
    where: {
      workspaceId: user.workspaceId,
      recipientId: user.id,
      senderId: parsed.data.contactId,
      readAt: null,
    },
    data: { readAt: new Date() },
  });

  // Same reasoning as `sendMessageAction`: the caller refreshes when this
  // returns, and that re-runs the layout the badge is rendered by.
  revalidatePath("/messages");
  return { ok: true };
}
