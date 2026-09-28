import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleCheck, Clock, ListTodo } from "lucide-react";
import {
  ProjectMembersCard,
  type ProjectMemberRow,
} from "@/components/projects/project-members-card";
import { ExportReportButton } from "@/components/dashboard/export-report-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatDay, todayIso } from "@/lib/domain";
import { getMembers, getProject, getProjectStats } from "@/lib/queries";
import { getSessionUser, hasPermission, projectScope, requireUser, viewerSupervises } from "@/lib/session";
import { statusVariant, taskStatusColor } from "@/lib/status";

export async function generateMetadata({
  params,
}: PageProps<"/projects/project/[id]">): Promise<Metadata> {
  const { id } = await params;
  const viewer = await getSessionUser();
  const project = viewer?.workspaceId ? await getProject(viewer.workspaceId, id, await projectScope()) : null;
  return { title: project?.name ?? "Project" };
}

export default async function ProjectPage({ params }: PageProps<"/projects/project/[id]">) {
  const viewer = await requireUser();
  const { id } = await params;
  const project = await getProject(viewer.workspaceId, id, await projectScope());
  if (!project) notFound();

  const [stats, members, supervises] = await Promise.all([
    getProjectStats(viewer.workspaceId, project.id),
    getMembers(viewer.workspaceId),
    viewerSupervises(),
  ]);

  // Resolved server-side so the filename cannot differ by timezone.
  const today = todayIso();

  const memberIds = new Set(project.members.map((person) => person.id));
  const rows: ProjectMemberRow[] = project.members.map((person) => {
    const onProject = stats.tasks.filter((task) =>
      task.assignees.some((assignee) => assignee.id === person.id),
    );
    const member = members.find((item) => item.id === person.id);

    return {
      member: member ?? { ...person, role: "member", designation: null, hourlyRate: 0, monthlyHours: 0, disabled: false },
      tasksDone: onProject.filter((task) => task.status === "done").length,
      tasksTotal: onProject.length,
      hours: stats.entries
        .filter((entry) => entry.userId === person.id)
        .reduce((sum, entry) => sum + entry.hours, 0),
    };
  });

  /**
   * The CSV behind "Export report" — the same figures this page shows.
   *
   * It came from the project report page, which is retired: that page said
   * what the overview already says, so the figures stayed and the second page
   * went. Built only when somebody will be offered it.
   */
  const reportRows: string[][] = supervises
    ? [
        ["Project", project.name],
        ["Status", project.status],
        ["Generated", today],
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
        ["Member", "Role", "Tasks done", "Tasks", "Hours"],
        ...rows.map((row) => [
          row.member.name,
          row.member.role,
          String(row.tasksDone),
          String(row.tasksTotal),
          String(row.hours),
        ]),
        [],
        ["Task", "Status", "Priority", "Due", "Estimate (h)"],
        ...stats.tasks.map((task) => [
          task.title,
          task.status,
          task.priority,
          task.dueDate ?? "",
          String(task.estimateHours),
        ]),
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Link
          href="/projects"
          aria-label="Back to projects"
          className="inline-flex h-8 w-8 items-center justify-center -mt-0.5 rounded-md transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: project.color }} />
            <h1 className="text-xl font-bold leading-tight tracking-tight">{project.name}</h1>
            <Badge variant={statusVariant[project.status]}>{project.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
        </div>

        {/*
          Took the place of the retired report page, which existed mainly to
          carry it. Offered to whoever oversees the project — the same audience
          as the members card below.
        */}
        {supervises ? (
          <ExportReportButton
            rows={reportRows}
            name={`${project.name} report`}
            today={today}
            label="Export report"
          />
        ) : null}
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <SummaryCard
            icon={<ListTodo className="h-3.5 w-3.5" />}
            label="Tasks"
            value={stats.taskCount.toString()}
            hint={`${stats.done} done · ${stats.inProgress} in progress`}
          />
          <SummaryCard
            icon={<CircleCheck className="h-3.5 w-3.5" />}
            label="Completion"
            value={`${stats.progress}%`}
            footer={
              <Progress value={stats.progress} className="mt-1" aria-label="Project completion" />
            }
          />
          <SummaryCard
            icon={<Clock className="h-3.5 w-3.5" />}
            label="Logged hours"
            value={`${stats.hours}h`}
            hint={`of ${stats.estimateHours}h estimated`}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm">Task status breakdown</CardTitle>
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
                      <span className="text-muted-foreground">
                        {row.count} {row.count === 1 ? "task" : "tasks"}
                      </span>
                    </span>
                    <span className="font-mono text-muted-foreground">{row.percent}%</span>
                  </div>
                  <Progress value={row.percent} aria-label={`${row.label} share`} />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Start" value={project.startDate ? formatDay(project.startDate) : "—"} />
              <Row label="End" value={project.endDate ? formatDay(project.endDate) : "—"} />
              <Row label="Members" value={project.members.length.toString()} />
            </CardContent>
          </Card>
        </div>

        {/*
          Only for the people responsible for who is on a project — an admin
          or a manager. Somebody doing the work on it does not need the roster,
          and it carries each person's hours and task counts beside their name.
        */}
        {supervises ? (
          <ProjectMembersCard
            projectId={project.id}
            rows={rows}
            candidates={members.filter((member) => !memberIds.has(member.id))}
            canEdit={await hasPermission("projects.edit")}
          />
        ) : null}
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  hint,
  footer,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  footer?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <p className="font-mono text-2xl font-bold">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        {footer}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}
