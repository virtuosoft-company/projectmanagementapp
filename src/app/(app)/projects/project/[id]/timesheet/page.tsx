import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { WeeklyTimesheet, type TimesheetRow } from "@/components/projects/weekly-timesheet";
import { Button } from "@/components/ui/button";
import { todayIso } from "@/lib/domain";
import { getProject, getProjectStats } from "@/lib/queries";
import { getSessionUser, projectScope, requireUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/projects/project/[id]/timesheet">): Promise<Metadata> {
  const { id } = await params;
  const viewer = await getSessionUser();
  const project = viewer?.workspaceId ? await getProject(viewer.workspaceId, id, await projectScope()) : null;
  return { title: `${project?.name ?? "Project"} — Timesheet` };
}

export default async function TimesheetPage({
  params,
}: PageProps<"/projects/project/[id]/timesheet">) {
  const viewer = await requireUser();
  const { id } = await params;
  const project = await getProject(viewer.workspaceId, id, await projectScope());
  // A feature switched off is genuinely gone, not just hidden from the nav.
  if (!project || !project.features.includes("timesheet")) notFound();

  const stats = await getProjectStats(viewer.workspaceId, project.id);

  const rows: TimesheetRow[] = project.members.map((person) => {
    const byDate: Record<string, number> = {};
    for (const entry of stats.entries) {
      if (entry.userId !== person.id) continue;
      byDate[entry.date] = (byDate[entry.date] ?? 0) + entry.hours;
    }
    return { memberId: person.id, name: person.name, byDate };
  });

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold leading-tight tracking-tight">Timesheet</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Weekly timesheet for {project.name}
          </p>
        </div>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4" />
          Export
        </Button>
      </div>

      <WeeklyTimesheet rows={rows} initialWeek={todayIso()} />
    </div>
  );
}
