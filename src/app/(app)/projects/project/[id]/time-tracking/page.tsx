import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActiveTimer } from "@/components/projects/active-timer";
import { TimeLogs } from "@/components/projects/time-logs";
import { TimesheetChart } from "@/components/dashboard/timesheet-chart";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { WEEKDAY_LABELS, getWeekDays, todayIso } from "@/lib/domain";
import {
  getMembers,
  getProject,
  getProjectStats,
  getRunningTimer,
  getTimeSummary,
} from "@/lib/queries";
import { getSessionUser, hasPermission, projectScope, requirePermission } from "@/lib/session";
import { cn, formatDuration } from "@/lib/utils";

export async function generateMetadata({
  params,
}: PageProps<"/projects/project/[id]/time-tracking">): Promise<Metadata> {
  const { id } = await params;
  const viewer = await getSessionUser();
  const project = viewer?.workspaceId ? await getProject(viewer.workspaceId, id, await projectScope()) : null;
  return { title: `${project?.name ?? "Project"} — Time Tracking` };
}

/**
 * Time tracking for one project.
 *
 * The same shape as the workspace-wide `/projects/time-tracking`, narrowed to a
 * single project: only this project's open tasks can be logged against, and the
 * variance rows compare hours logged *here* against estimates *here* rather
 * than reusing `getMemberVariance`, which spans every project a member is on.
 */
export default async function ProjectTimeTrackingPage({
  params,
}: PageProps<"/projects/project/[id]/time-tracking">) {
  // A project sub-page, gated on the permission itself — project pages are
  // switched on per project rather than assigned per role, so there is no
  // page key for this one.
  const viewer = await requirePermission("time.log");
  // Always true behind that gate; read rather than hardcoded so the card and
  // the gate cannot drift apart if the gate is ever relaxed.
  const canLog = await hasPermission("time.log");
  const { id } = await params;
  // Resolved once on the server and threaded down, so the week grid and the
  // client-side "Log Time" form agree on which day it is.
  const today = todayIso();

  const project = await getProject(viewer.workspaceId, id, await projectScope());
  // A feature switched off is genuinely gone, not just hidden from the nav.
  if (!project || !project.features.includes("time-tracking")) notFound();

  const [stats, members, running, summary] = await Promise.all([
    getProjectStats(viewer.workspaceId, project.id),
    getMembers(viewer.workspaceId),
    getRunningTimer(viewer.workspaceId, viewer.id),
    getTimeSummary(viewer.workspaceId, viewer.id),
  ]);

  const memberName = (userId: string) =>
    members.find((member) => member.id === userId)?.name ?? "Unknown";
  const taskFor = (taskId: string) => stats.tasks.find((task) => task.id === taskId);

  const openTasks = stats.tasks
    .filter((task) => task.status !== "done")
    .map((task) => ({
      id: task.id,
      title: task.title,
      projectName: project.name,
      estimateHours: task.estimateHours,
    }));

  const week = getWeekDays(today).map((date, index) => ({
    date: WEEKDAY_LABELS[index],
    hours: stats.entries
      .filter((entry) => entry.date === date)
      .reduce((sum, entry) => sum + entry.hours, 0),
  }));

  // Per-member figures for this project only.
  const variances = project.members
    .map((person) => {
      const logged = stats.entries
        .filter((entry) => entry.userId === person.id)
        .reduce((sum, entry) => sum + entry.hours, 0);
      const estimate = stats.tasks
        .filter((task) => task.assignees.some((assignee) => assignee.id === person.id))
        .reduce((sum, task) => sum + task.estimateHours, 0);

      return { person, logged, estimate, variance: estimate - logged };
    })
    .filter((row) => row.estimate > 0 || row.logged > 0);

  return (
    <TimeLogs
      canLog={canLog}
      today={today}
      tasks={openTasks}
      logs={stats.entries.map((entry) => {
        const task = taskFor(entry.taskId);
        return {
          id: entry.id,
          date: entry.date,
          memberName: memberName(entry.userId),
          taskTitle: task?.title ?? "Unknown task",
          projectName: project.name,
          hours: entry.hours,
          // Same basis as the workspace-wide page: this entry measured against
          // its task's estimate.
          variance: (task?.estimateHours ?? 0) - entry.hours,
          note: entry.note,
        };
      })}
    >
      <ActiveTimer
        userName={viewer.name}
        tasks={openTasks.map((task) => ({ id: task.id, label: task.title }))}
        running={running}
        todayMinutes={summary.todayMinutes}
        weekMinutes={summary.weekMinutes}
        canLog={canLog}
      />

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Per-Member Variance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {variances.map(({ person, logged, estimate, variance }) => (
            <div key={person.id} className="flex items-center gap-3">
              <UserAvatar name={person.name} className="h-7 w-7" textClassName="text-[10px]" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{person.name}</span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-muted-foreground">
                      {formatDuration(logged)} / {formatDuration(estimate)}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 font-mono font-medium",
                        variance >= 0
                          ? "bg-success/10 text-success"
                          : "bg-destructive/10 text-destructive",
                      )}
                    >
                      {variance < 0 ? "+" : ""}
                      {formatDuration(Math.abs(variance))} ({variance >= 0 ? "under" : "over"})
                    </span>
                  </span>
                </div>
                <Progress
                  value={estimate ? (logged / estimate) * 100 : 0}
                  aria-label={`${person.name} logged vs estimate`}
                />
              </div>
            </div>
          ))}
          {variances.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody has logged time or been assigned an estimate on this project yet.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Weekly Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-56">
            <TimesheetChart data={week} />
          </div>
        </CardContent>
      </Card>
    </TimeLogs>
  );
}
