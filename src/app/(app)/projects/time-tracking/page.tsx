import type { Metadata } from "next";
import { ActiveTimer } from "@/components/projects/active-timer";
import { TimeLogs } from "@/components/projects/time-logs";
import { TimesheetChart } from "@/components/dashboard/timesheet-chart";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { WEEKDAY_LABELS, getWeekDays, todayIso } from "@/lib/domain";
import {
  getEntryDetails,
  getMemberVariance,
  getMembers,
  getProjects,
  getRunningTimer,
  getTasks,
  getTimeEntries,
  getTimeSummary,
} from "@/lib/queries";
import { hasPermission, projectScope, requirePage } from "@/lib/session";
import { cn, formatDuration } from "@/lib/utils";

export const metadata: Metadata = { title: "Time Tracking" };

export default async function TimeTrackingPage() {
  const viewer = await requirePage("time-tracking");
  // The page is assigned per role, so reaching it no longer implies the
  // permission to record hours — the timer card and the Log Time form ask.
  const canLog = await hasPermission("time.log");
  // Resolved once on the server and threaded down, so the week grid, the log
  // table and the client-side "Log Time" form all agree on which day it is
  // even when the browser sits in a different timezone.
  const today = todayIso();

  const [entries, tasks, projects, members, allEntries, running, summary] = await Promise.all([
    getEntryDetails(viewer.workspaceId),
    getTasks(viewer.workspaceId),
    getProjects(viewer.workspaceId, await projectScope()),
    getMembers(viewer.workspaceId),
    getTimeEntries(viewer.workspaceId),
    getRunningTimer(viewer.workspaceId, viewer.id),
    getTimeSummary(viewer.workspaceId, viewer.id),
  ]);

  const openTasks = tasks
    .filter((task) => task.status !== "done")
    .map((task) => ({
      id: task.id,
      title: task.title,
      projectName: projects.find((project) => project.id === task.projectId)?.name ?? "",
      estimateHours: task.estimateHours,
    }));

  const week = getWeekDays(today).map((date, index) => ({
    date: WEEKDAY_LABELS[index],
    hours: allEntries
      .filter((entry) => entry.date === date)
      .reduce((sum, entry) => sum + entry.hours, 0),
  }));

  const variances = (
    await Promise.all(
      members.map(async (member) => ({
        member,
        ...(await getMemberVariance(viewer.workspaceId, member.id)),
      })),
    )
  ).filter((row) => row.estimate > 0);

  return (
    <TimeLogs
      canLog={canLog}
      today={today}
      tasks={openTasks}
      logs={entries.map((entry) => ({
        id: entry.id,
        date: entry.date,
        memberName: entry.member.name,
        taskTitle: entry.task.title,
        projectName: entry.project.name,
        hours: entry.hours,
        variance: entry.variance,
        note: entry.note,
      }))}
    >
      <ActiveTimer
        userName={viewer.name}
        tasks={openTasks.map((task) => ({
          id: task.id,
          label: `${task.title} · ${task.projectName}`,
        }))}
        running={running}
        todayMinutes={summary.todayMinutes}
        weekMinutes={summary.weekMinutes}
        canLog={canLog}
      />

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Per-User Variance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {variances.map(({ member, logged, estimate, variance }) => (
            <div key={member.id} className="flex items-center gap-3">
              <UserAvatar
                name={member.name}
                className="h-7 w-7"
                textClassName="text-[10px]"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{member.name}</span>
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
                  aria-label={`${member.name} logged vs estimate`}
                />
              </div>
            </div>
          ))}
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
