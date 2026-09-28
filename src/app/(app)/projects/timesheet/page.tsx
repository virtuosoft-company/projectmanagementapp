import type { Metadata } from "next";
import {
  TimesheetView,
  type TimesheetEntry,
} from "@/components/projects/timesheet-view";
import { todayIso } from "@/lib/domain";
import { getEntryDetails, getProjects } from "@/lib/queries";
import { projectScope, requirePage } from "@/lib/session";

export const metadata: Metadata = { title: "Timesheet" };

/**
 * The weekly grid across every project the viewer is on, filterable to one.
 *
 * Entries are limited to the viewer's own projects for the same reason the
 * project lists are — someone should not see hours logged on work they were
 * never added to. `projectScope()` widens that to the whole workspace for
 * owners and admins, so the filter offers them everything they are responsible
 * for.
 *
 * The rows are aggregated in the client component rather than here: the filter
 * is a view of data already sent, so changing project should not cost a round
 * trip.
 */
export default async function WorkspaceTimesheetPage() {
  const viewer = await requirePage("timesheet");

  const [projects, details] = await Promise.all([
    getProjects(viewer.workspaceId, await projectScope()),
    getEntryDetails(viewer.workspaceId),
  ]);

  const visibleProjectIds = new Set(projects.map((project) => project.id));

  // Flattened to the few fields the grid needs, so the payload carries hours
  // rather than whole task, member and project objects.
  const entries: TimesheetEntry[] = details
    .filter((entry) => visibleProjectIds.has(entry.project.id))
    .map((entry) => ({
      projectId: entry.project.id,
      memberId: entry.member.id,
      memberName: entry.member.name,
      date: entry.date,
      hours: entry.hours,
    }));

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold leading-tight tracking-tight">Timesheet</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hours logged across the {projects.length}{" "}
          {projects.length === 1 ? "project" : "projects"} you can see
        </p>
      </div>

      {projects.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          You are not on any projects yet, so there is nothing to show.
        </p>
      ) : (
        <TimesheetView
          entries={entries}
          projects={projects.map(({ id, name }) => ({ id, name }))}
          initialWeek={todayIso()}
        />
      )}
    </div>
  );
}
