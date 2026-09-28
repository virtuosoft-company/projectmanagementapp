import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, ListTodo, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ExportReportButton } from "@/components/dashboard/export-report-button";
import { formatDay, todayIso } from "@/lib/domain";
import { getMembers, getProject, getProjectStats } from "@/lib/queries";
import { getSessionUser, projectScope, requirePermission } from "@/lib/session";
import { statusVariant, taskStatusColor } from "@/lib/status";
import { cn, formatDuration } from "@/lib/utils";

export async function generateMetadata({
  params,
}: PageProps<"/projects/project/[id]/report">): Promise<Metadata> {
  const { id } = await params;
  const viewer = await getSessionUser();
  const project = viewer?.workspaceId ? await getProject(viewer.workspaceId, id, await projectScope()) : null;
  return { title: `${project?.name ?? "Project"} — Report` };
}

export default async function ReportPage({
  params,
}: PageProps<"/projects/project/[id]/report">) {
  const viewer = await requirePermission("reports.view");

  const { id } = await params;
  const project = await getProject(viewer.workspaceId, id, await projectScope());
  // A feature switched off is genuinely gone, not just hidden from the nav.
  if (!project || !project.features.includes("report")) notFound();

  const [stats, members] = await Promise.all([
    getProjectStats(viewer.workspaceId, project.id),
    getMembers(viewer.workspaceId),
  ]);
  const projectEntries = stats.entries;

  const performance = project.members.map((person) => {
    const member = members.find((item) => item.id === person.id);
    const entries = projectEntries.filter((entry) => entry.userId === person.id);
    return {
      member: { name: person.name, role: member?.role ?? "member" },
      taskCount: stats.tasks.filter((task) =>
        task.assignees.some((assignee) => assignee.id === person.id),
      ).length,
      hours: entries.reduce((sum, entry) => sum + entry.hours, 0),
    };
  });

  const loggedByTask = (taskId: string) =>
    projectEntries
      .filter((entry) => entry.taskId === taskId)
      .reduce((sum, entry) => sum + entry.hours, 0);

  /** The CSV behind "Export to CSV": the same figures this page shows. */
  const reportRows: string[][] = [
    ["Project", project.name],
    ["Status", project.status],
    ["Generated", todayIso()],
    [],
    ["Summary"],
    ["Tasks", String(stats.taskCount)],
    ["Tasks done", String(stats.done)],
    ["Progress %", String(stats.progress)],
    ["Hours logged", String(stats.hours)],
    ["Hours estimated", String(stats.estimateHours)],
    ["Members", String(project.members.length)],
    [],
    ["Status", "Tasks", "Share %"],
    ...stats.byStatus.map((row) => [row.label, String(row.count), String(row.percent)]),
    [],
    ["Member", "Role", "Tasks", "Hours"],
    ...performance.map((row) => [
      row.member.name,
      row.member.role,
      String(row.taskCount),
      String(row.hours),
    ]),
    [],
    ["Task", "Status", "Priority", "Due", "Estimate (h)", "Logged (h)"],
    ...stats.tasks.map((task) => [
      task.title,
      task.status,
      task.priority,
      task.dueDate ?? "",
      String(task.estimateHours),
      String(loggedByTask(task.id)),
    ]),
  ];

  return (
    <div className="max-w-full space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href={`/projects/project/${project.id}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to project
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: project.color }}
            />
            <h1 className="text-2xl font-bold leading-tight tracking-tight">{project.name} — Report</h1>
            <Badge variant={statusVariant[project.status]}>{project.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
        </div>
        <ExportReportButton
          rows={reportRows}
          name={`${project.name} report`}
          today={todayIso()}
          label="Export to CSV"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Card className="shadow-none">
          <CardContent className="p-4">
            <Label icon={<ListTodo className="h-4 w-4" />}>Tasks</Label>
            <p className="mt-1 font-mono text-2xl font-bold">
              {stats.done}/{stats.taskCount}
            </p>
            <Progress value={stats.progress} className="mt-2" aria-label="Task completion" />
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-mono">{stats.progress}%</span> complete
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="p-4">
            <Label icon={<Clock className="h-4 w-4" />}>Hours Logged</Label>
            <p className="mt-1 font-mono text-2xl font-bold">{stats.hours}h</p>
            <p className="mt-1 text-xs text-muted-foreground">
              of {stats.estimateHours}h estimated
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="p-4">
            <Label icon={<Users className="h-4 w-4" />}>Members</Label>
            <p className="mt-1 font-mono text-2xl font-bold">{project.members.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">on this project</p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Status Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {stats.byStatus.map((row) => (
            <div key={row.status} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: taskStatusColor[row.status] }}
                  />
                  {row.label}
                </span>
                <span className="font-mono text-muted-foreground">
                  {row.count} ({row.percent}%)
                </span>
              </div>
              <Progress value={row.percent} aria-label={`${row.label} share`} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Member Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <Table
            head={["Name", "Role", "Tasks", "Hours"]}
            rows={performance.map((row) => [
              row.member.name,
              <span key="role" className="capitalize">
                {row.member.role}
              </span>,
              row.taskCount.toString(),
              formatDuration(row.hours),
            ])}
          />
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Tasks ({stats.taskCount})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table
            head={["Title", "Status", "Priority", "Due", "Est.", "Logged"]}
            rows={stats.tasks.map((task) => [
              task.title,
              <span key="status" className="capitalize">
                {task.status.replace("-", " ")}
              </span>,
              <span key="priority" className="capitalize">
                {task.priority}
              </span>,
              task.dueDate ? formatDay(task.dueDate) : "—",
              formatDuration(task.estimateHours),
              formatDuration(loggedByTask(task.id)),
            ])}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Label({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      {icon}
      <p className="text-xs font-medium uppercase tracking-wide">{children}</p>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full caption-bottom text-sm">
        <thead className="[&_tr]:border-b">
          <tr className="text-left text-xs text-muted-foreground">
            {head.map((cell, index) => (
              <th
                key={cell}
                className={cn("px-3 py-2 font-medium", index > 1 && "text-right")}
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_tr:last-child]:border-0">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b transition-colors hover:bg-muted/50">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={cn(
                    "whitespace-nowrap px-3 py-2",
                    cellIndex > 1 && "text-right font-mono",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
