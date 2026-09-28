"use server";

/**
 * Calendar events.
 *
 * Gated on `events.manage` rather than `tasks.manage`: creating an event puts a
 * notification in somebody else's bell and a commitment in their day, which is
 * a different act from moving a card on a board.
 *
 * Notifications go out twice. Once here, the moment someone is added to an
 * event, and once from the reminder sweep shortly before it starts — see
 * `app/api/cron/event-reminders`.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isoToDate } from "@/lib/mappers";
import { notify } from "@/lib/notifications";
import { requirePermission } from "@/lib/session";
import {
  type EventInput,
  eventSchema,
  firstError,
} from "@/lib/validations";

export type ActionResult = { ok: boolean; error?: string; id?: string };

const NOT_FOUND: ActionResult = { ok: false, error: "That event no longer exists." };

function refresh() {
  revalidatePath("/projects/calendar");
  // The bell lives in the (app) layout, so a new notification has to invalidate
  // the layout rather than only the page that caused it.
  revalidatePath("/", "layout");
}

/**
 * The absolute instant an event begins.
 *
 * The day is a `@db.Date` — the same calendar square for everyone — but a
 * reminder has to be compared against `now()`, which needs a real point in
 * time. An all-day event resolves to midnight, so its reminder counts back
 * from the start of the day.
 *
 * Built from the server's own clock, so an event created at 09:00 is due at
 * 09:00 as the server reckons it. A workspace spread across timezones would
 * need a stored zone; that is a bigger change than this screen calls for, and
 * is noted here rather than guessed at.
 */
function resolveStartsAt(dateIso: string, startTime: string | null): Date {
  const [year, month, day] = dateIso.split("-").map(Number);
  const [hour, minute] = startTime ? startTime.split(":").map(Number) : [0, 0];
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

/** Human date for a notification body, e.g. `17 Feb 2026 at 14:30`. */
function describeWhen(dateIso: string, startTime: string | null): string {
  const shown = new Date(`${dateIso}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return startTime ? `${shown} at ${startTime}` : `${shown}, all day`;
}

/**
 * Attendees the caller may actually add.
 *
 * Everyone named has to be a member of this workspace — the picker only offers
 * members, but the picker is the half an attacker skips. When the event is
 * pinned to a project, membership of that project is required too, which is
 * the same rule the dropdown applies on screen.
 */
async function resolveAttendees(
  workspaceId: string,
  projectId: string | null,
  requested: string[],
): Promise<string[]> {
  const unique = [...new Set(requested)].filter(Boolean);
  if (unique.length === 0) return [];

  const rows = await prisma.workspaceMember.findMany({
    where: {
      workspaceId,
      userId: { in: unique },
      ...(projectId ? { user: { projects: { some: { projectId } } } } : {}),
    },
    select: { userId: true },
  });

  return rows.map((row) => row.userId);
}

/** Confirm a project belongs to this workspace before an event points at it. */
async function resolveProjectId(
  workspaceId: string,
  projectId: string | null,
): Promise<string | null | false> {
  if (!projectId) return null;
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true },
  });
  return project ? project.id : false;
}

export async function createEventAction(input: EventInput): Promise<ActionResult> {
  const user = await requirePermission("events.manage");

  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const projectId = await resolveProjectId(user.workspaceId, data.projectId);
  if (projectId === false) return { ok: false, error: "That project is not in this workspace." };

  const attendeeIds = await resolveAttendees(user.workspaceId, projectId, data.attendeeIds);

  const created = await prisma.event.create({
    data: {
      workspaceId: user.workspaceId,
      projectId,
      title: data.title,
      description: data.description,
      date: isoToDate(data.date)!,
      startTime: data.startTime,
      endTime: data.endTime,
      startsAt: resolveStartsAt(data.date, data.startTime),
      reminderMinutes: data.reminderMinutes,
      createdById: user.id,
      attendees: { create: attendeeIds.map((userId) => ({ userId })) },
    },
    select: { id: true },
  });

  await notify(prisma, {
    workspaceId: user.workspaceId,
    userIds: attendeeIds,
    actorId: user.id,
    kind: "event-invited",
    title: `You were added to "${data.title}"`,
    body: describeWhen(data.date, data.startTime),
    href: "/projects/calendar",
  });

  refresh();
  return { ok: true, id: created.id };
}

export async function updateEventAction(
  eventId: string,
  input: EventInput,
): Promise<ActionResult> {
  const user = await requirePermission("events.manage");

  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const existing = await prisma.event.findFirst({
    where: { id: eventId, workspaceId: user.workspaceId },
    include: { attendees: { select: { userId: true } } },
  });
  if (!existing) return NOT_FOUND;

  const projectId = await resolveProjectId(user.workspaceId, data.projectId);
  if (projectId === false) return { ok: false, error: "That project is not in this workspace." };

  const attendeeIds = await resolveAttendees(user.workspaceId, projectId, data.attendeeIds);
  const startsAt = resolveStartsAt(data.date, data.startTime);

  // Whether the *when* changed. A reminder already sent is only worth sending
  // again if the time it referred to has moved.
  const rescheduled =
    existing.startsAt.getTime() !== startsAt.getTime() ||
    existing.reminderMinutes !== data.reminderMinutes;

  await prisma.$transaction(async (tx) => {
    await tx.eventAttendee.deleteMany({ where: { eventId } });
    await tx.event.update({
      where: { id: eventId },
      data: {
        projectId,
        title: data.title,
        description: data.description,
        date: isoToDate(data.date)!,
        startTime: data.startTime,
        endTime: data.endTime,
        startsAt,
        reminderMinutes: data.reminderMinutes,
        // Re-arm the reminder when the event moved, so people are told about
        // the new time rather than silently missing it.
        reminderSentAt: rescheduled ? null : existing.reminderSentAt,
        attendees: { create: attendeeIds.map((userId) => ({ userId })) },
      },
    });
  });

  const had = new Set(existing.attendees.map((row) => row.userId));

  // Someone newly added always hears about it. Everyone else only when the
  // event actually moved — a typo fix in the title is not worth a bell.
  await notify(prisma, {
    workspaceId: user.workspaceId,
    userIds: attendeeIds.filter((id) => !had.has(id)),
    actorId: user.id,
    kind: "event-invited",
    title: `You were added to "${data.title}"`,
    body: describeWhen(data.date, data.startTime),
    href: "/projects/calendar",
  });

  if (rescheduled) {
    await notify(prisma, {
      workspaceId: user.workspaceId,
      userIds: attendeeIds.filter((id) => had.has(id)),
      actorId: user.id,
      kind: "event-updated",
      title: `"${data.title}" moved`,
      body: `Now ${describeWhen(data.date, data.startTime)}.`,
      href: "/projects/calendar",
    });
  }

  refresh();
  return { ok: true, id: eventId };
}

export async function deleteEventAction(eventId: string): Promise<ActionResult> {
  const user = await requirePermission("events.manage");

  const existing = await prisma.event.findFirst({
    where: { id: eventId, workspaceId: user.workspaceId },
    include: { attendees: { select: { userId: true } } },
  });
  if (!existing) return NOT_FOUND;

  await prisma.event.delete({ where: { id: eventId } });

  // Told before the row is gone would risk announcing a delete that then
  // failed; told after means the notification can only follow a real one.
  await notify(prisma, {
    workspaceId: user.workspaceId,
    userIds: existing.attendees.map((row) => row.userId),
    actorId: user.id,
    kind: "event-cancelled",
    title: `"${existing.title}" was cancelled`,
    href: "/projects/calendar",
  });

  refresh();
  return { ok: true };
}
