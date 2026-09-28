import type { Metadata } from "next";
import { CalendarView } from "@/components/projects/calendar-view";
import { todayIso } from "@/lib/domain";
import { getEvents, getMembers, getProjects, getTasks } from "@/lib/queries";
import { hasPermission, projectScope, requirePage } from "@/lib/session";

export const metadata: Metadata = { title: "Calendar" };

/**
 * The first and last day of the month containing `iso`.
 *
 * The grid draws leading and trailing blanks rather than a neighbouring
 * month's days, so a month is exactly what needs fetching.
 */
function monthBounds(iso: string) {
  const [year, month] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/**
 * Normalises `?month=YYYY-MM` to the 1st of that month.
 *
 * Anything unparseable falls back to today rather than erroring: a mistyped
 * URL should land somewhere sensible, and the value reaches `getMonthGrid`
 * and a date range where a malformed one would produce `Invalid Date`.
 */
function resolveMonth(requested: string | string[] | undefined, today: string): string {
  const value = typeof requested === "string" ? requested : "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return `${today.slice(0, 7)}-01`;
  return `${value}-01`;
}

export default async function CalendarPage({ searchParams }: PageProps<"/projects/calendar">) {
  const viewer = await requirePage("calendar");
  const { month: requested } = await searchParams;

  const today = todayIso();
  const month = resolveMonth(requested, today);
  const { from, to } = monthBounds(month);

  const [tasks, projects, members, events, canManageEvents] = await Promise.all([
    getTasks(viewer.workspaceId),
    getProjects(viewer.workspaceId, await projectScope()),
    getMembers(viewer.workspaceId),
    getEvents(viewer.workspaceId, from, to),
    hasPermission("events.manage"),
  ]);

  return (
    <CalendarView
      month={month}
      today={today}
      tasks={tasks}
      events={events}
      // The dialog narrows its attendee list to the chosen project's members,
      // so each project carries its own roster rather than the dialog going
      // back to the server on every change of the dropdown.
      projects={projects.map((project) => ({
        id: project.id,
        name: project.name,
        memberIds: project.members.map((member) => member.id),
      }))}
      members={members}
      projectNames={Object.fromEntries(
        projects.map((project) => [project.id, project.name]),
      )}
      canManageEvents={canManageEvents}
    />
  );
}
