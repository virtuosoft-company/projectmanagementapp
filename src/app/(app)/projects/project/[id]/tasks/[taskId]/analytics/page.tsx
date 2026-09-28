import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Clock, ListTree, Target, Users } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { TimesheetChart } from "@/components/dashboard/timesheet-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserAvatar } from "@/components/ui/user-avatar";
import { TASK_STATUSES, todayIso } from "@/lib/domain";
import { formatMinutes } from "@/lib/duration";
import { getProject, getTask, getTaskEntries, getTaskSubtasks } from "@/lib/queries";
import { getSessionUser, projectScope, requireUser } from "@/lib/session";
import { taskStatusColor } from "@/lib/status";
import { MAX_CHART_DAYS, WHOLE_TASK_LABEL, computeTaskAnalytics } from "@/lib/task-analytics";
import { cn } from "@/lib/utils";

export async function generateMetadata({
  params,
}: PageProps<"/projects/project/[id]/tasks/[taskId]/analytics">): Promise<Metadata> {
  const { taskId } = await params;
  const viewer = await getSessionUser();
  const task = viewer?.workspaceId ? await getTask(viewer.workspaceId, taskId) : null;
  return { title: task ? `${task.title} — Analytics` : "Task analytics" };
}

/**
 * One task's analytics: where its time went — by branch of the subtask tree,
 * by person, by day — and how far through its subtasks it is.
 *
 * Readable by anyone who can open the task; it shows nothing the task page
 * does not already, only added up.
 */
export default async function TaskAnalyticsPage({
  params,
}: PageProps<"/projects/project/[id]/tasks/[taskId]/analytics">) {
  const viewer = await requireUser();
  const { id, taskId } = await params;

  const project = await getProject(viewer.workspaceId, id, await projectScope());
  if (!project || !project.features.includes("tasks")) notFound();

  const task = await getTask(viewer.workspaceId, taskId);
  if (!task || task.projectId !== project.id) notFound();

  const [entries, subtasks] = await Promise.all([
    getTaskEntries(viewer.workspaceId, task.id),
    getTaskSubtasks(viewer.workspaceId, task.id),
  ]);

  const data = computeTaskAnalytics({ subtasks, entries, today: todayIso() });
  const estimateMinutes = Math.round(task.estimateHours * 60);
  const overEstimate = estimateMinutes > 0 && data.totalMinutes > estimateMinutes;
  const taskHref = `/projects/project/${project.id}/tasks/${task.id}`;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link
          href={taskHref}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {task.title}
        </Link>
        <h1 className="mt-1 text-2xl font-bold leading-tight tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">{project.name}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Clock}
          tone={overEstimate ? "destructive" : "primary"}
          value={formatMinutes(data.totalMinutes)}
          label="Logged"
          hint={estimateMinutes ? `of ${formatMinutes(estimateMinutes)} estimated` : "No estimate on the task"}
        />
        <KpiCard
          icon={Target}
          tone="success"
          value={`${data.percentDone}%`}
          label="Subtasks done"
          hint={data.subtaskCount ? `${data.doneCount} of ${data.subtaskCount}` : "No subtasks yet"}
        />
        <KpiCard
          icon={ListTree}
          tone="accent"
          value={formatMinutes(data.onSubtasksMinutes)}
          label="On subtasks"
          hint={`${formatMinutes(data.onTaskMinutes)} on the task itself`}
        />
        <KpiCard
          icon={Users}
          tone="muted"
          value={String(data.people.length)}
          label={data.people.length === 1 ? "Contributor" : "Contributors"}
          hint={`${entries.length} time entr${entries.length === 1 ? "y" : "ies"}`}
        />
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.subtaskCount ? (
            <>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                {TASK_STATUSES.map(({ status, label }) =>
                  data.statusCounts[status] ? (
                    <div
                      key={status}
                      title={`${label}: ${data.statusCounts[status]}`}
                      style={{
                        width: `${(data.statusCounts[status] / data.subtaskCount) * 100}%`,
                        backgroundColor: taskStatusColor[status],
                      }}
                    />
                  ) : null,
                )}
              </div>
              <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                {TASK_STATUSES.map(({ status, label }) => (
                  <li key={status} className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: taskStatusColor[status] }}
                    />
                    {label}
                    <span className="font-mono text-muted-foreground">{data.statusCounts[status]}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              This task has no subtasks. Add some on the{" "}
              <Link href={taskHref} className="underline underline-offset-2">
                task page
              </Link>{" "}
              to see progress here.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Time by subtask</CardTitle>
        </CardHeader>
        <CardContent>
          {data.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Subtask</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 text-right font-medium">Own</th>
                    <th className="py-2 pr-4 text-right font-medium">Branch</th>
                    <th className="py-2 text-right font-medium">Estimate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((node) => {
                    const over =
                      node.rollup.estimateMinutes > 0 &&
                      node.rollup.trackedMinutes > node.rollup.estimateMinutes;
                    return (
                      <tr key={node.id} className="border-b last:border-0">
                        <td className="py-2 pr-4">
                          <span
                            className={cn("block truncate", node.depth === 0 && "font-medium")}
                            style={{ paddingLeft: `${node.depth * 1.25}rem` }}
                          >
                            {node.depth ? <span className="text-muted-foreground">└ </span> : null}
                            {node.title}
                          </span>
                        </td>
                        <td className="whitespace-nowrap py-2 pr-4">
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <span
                              aria-hidden
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: taskStatusColor[node.status] }}
                            />
                            {TASK_STATUSES.find((item) => item.status === node.status)?.label}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right font-mono tabular-nums text-muted-foreground">
                          {node.trackedMinutes ? formatMinutes(node.trackedMinutes) : "—"}
                        </td>
                        <td
                          className={cn(
                            "py-2 pr-4 text-right font-mono tabular-nums",
                            over && "text-destructive",
                          )}
                        >
                          {node.rollup.trackedMinutes ? formatMinutes(node.rollup.trackedMinutes) : "—"}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">
                          {node.rollup.estimateMinutes ? formatMinutes(node.rollup.estimateMinutes) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {data.onTaskMinutes ? (
                    <tr>
                      <td className="py-2 pr-4 italic text-muted-foreground" colSpan={3}>
                        {WHOLE_TASK_LABEL}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">
                        {formatMinutes(data.onTaskMinutes)}
                      </td>
                      <td />
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No subtasks to break the time down by.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Time by person</CardTitle>
          </CardHeader>
          <CardContent>
            {data.people.length ? (
              <ul className="space-y-4">
                {data.people.map((item) => (
                  <li key={item.person.id} className="space-y-1.5">
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        name={item.person.name}
                        className="h-7 w-7 bg-primary/10"
                        textClassName="text-[10px] text-primary"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {item.person.name}
                      </span>
                      <span className="font-mono text-sm tabular-nums">{formatMinutes(item.minutes)}</span>
                      <span className="w-10 text-right text-xs text-muted-foreground">{item.share}%</span>
                    </div>
                    <div className="ml-10 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${item.share}%` }} />
                    </div>
                    <p className="ml-10 truncate text-xs text-muted-foreground">
                      {item.branches
                        .slice(0, 3)
                        .map((branch) => `${branch.title} ${formatMinutes(branch.minutes)}`)
                        .join(" · ")}
                      {item.branches.length > 3 ? ` · +${item.branches.length - 3} more` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No time logged yet.</p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Time over days</CardTitle>
          </CardHeader>
          <CardContent>
            {data.days.length ? (
              <>
                <div className="h-56">
                  <TimesheetChart data={data.days.map((day) => ({ date: day.label, hours: day.hours }))} />
                </div>
                {data.daysTruncated ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    The last {MAX_CHART_DAYS} days; earlier time still counts in every total above.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No time logged yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
