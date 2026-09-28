import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, FolderKanban, ListTodo, Target } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserAvatar } from "@/components/ui/user-avatar";
import { TASK_STATUSES, formatDay } from "@/lib/domain";
import { roleLabel } from "@/lib/permissions";
import {
  getMember,
  getMemberStats,
  getMemberVariance,
  getProjects,
} from "@/lib/queries";
import { projectScope, requirePage, requireUser } from "@/lib/session";
import { priorityVariant, taskStatusColor } from "@/lib/status";
import { formatDuration } from "@/lib/utils";

export async function generateMetadata({
  params,
}: PageProps<"/team-members/[id]">): Promise<Metadata> {
  const { id } = await params;
  const viewer = await requireUser();
  const member = await getMember(viewer.workspaceId, id);
  return { title: member ? `${member.name} — Analytics` : "Member" };
}

/** One person's analytics: their workload, what they logged, and where it went. */
export default async function MemberAnalyticsPage({ params }: PageProps<"/team-members/[id]">) {
  /*
   * The same assignment as the roster this hangs off, not a bare `requireUser`.
   *
   * It was the latter, which meant a role without Team Members assigned could
   * not see the list but could still open any member's page straight from the
   * URL — including their rate and their hours. A detail route has to carry its
   * parent's gate, the way `/admin/users/new` carries `page: "users"`.
   */
  const viewer = await requirePage("team-members");
  const { id } = await params;

  const member = await getMember(viewer.workspaceId, id);
  if (!member) notFound();

  const [stats, variance, projects] = await Promise.all([
    getMemberStats(viewer.workspaceId, member.id),
    getMemberVariance(viewer.workspaceId, member.id),
    // Only used to put a name against a project id, but it was every project in
    // the workspace — scoped like everywhere else.
    getProjects(viewer.workspaceId, await projectScope()),
  ]);

  const open = stats.tasks.filter((task) => task.status !== "done");
  const projectName = (projectId: string) =>
    projects.find((project) => project.id === projectId)?.name ?? "";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/team-members"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to team members
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <UserAvatar name={member.name} image={member.image} className="size-12" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight tracking-tight">{member.name}</h1>
            <p className="text-sm text-muted-foreground">
              {member.designation ? `${member.designation} · ` : ""}
              {member.email}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{roleLabel(member.role)}</Badge>
            {member.disabled ? <Badge variant="destructive">Disabled</Badge> : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={Clock}
          tone="primary"
          value={formatDuration(stats.hoursExact)}
          label="Logged"
          hint={`${member.monthlyHours}h a month expected`}
        />
        <KpiCard
          icon={ListTodo}
          tone="warning"
          value={`${stats.tasksDone}/${stats.tasksTotal}`}
          label="Tasks Done"
          hint={`${open.length} still open`}
        />
        <KpiCard
          icon={FolderKanban}
          tone="accent"
          value={stats.projectCount.toString()}
          label="Projects"
          hint="They logged time on"
        />
        <KpiCard
          icon={Target}
          tone={stats.utilization > 100 ? "destructive" : "success"}
          value={`${stats.utilization}%`}
          label="Utilization"
          hint="Of their monthly hours"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-sm">Estimate vs logged</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Estimated</p>
                <p className="mt-1 font-mono text-xl font-bold">
                  {formatDuration(variance.estimate)}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Logged</p>
                <p className="mt-1 font-mono text-xl font-bold">
                  {formatDuration(variance.logged)}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Variance</p>
                <p
                  className={
                    variance.variance < 0
                      ? "mt-1 font-mono text-xl font-bold text-destructive"
                      : "mt-1 font-mono text-xl font-bold"
                  }
                >
                  {formatDuration(variance.variance)}
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Variance is estimate minus logged across every task assigned to them; negative
              means they are over the estimate.
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-sm">Task status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {TASK_STATUSES.map(({ status, label }) => {
              const count = stats.tasks.filter((task) => task.status === status).length;
              const share = stats.tasksTotal ? Math.round((count / stats.tasksTotal) * 100) : 0;
              return (
                <div key={status} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: taskStatusColor[status] }}
                      />
                      {label}
                    </span>
                    <span className="font-mono text-muted-foreground">{count}</span>
                  </div>
                  <Progress value={share} aria-label={`${label}: ${count} tasks`} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-sm">Open tasks</CardTitle>
        </CardHeader>
        <CardContent>
          {open.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing open — everything is done.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead className="text-right">Logged</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {open.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <Link
                        href={`/projects/project/${task.projectId}/tasks/${task.id}`}
                        className="font-medium hover:underline"
                      >
                        {task.title}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {projectName(task.projectId)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={priorityVariant[task.priority]} className="capitalize">
                        {task.priority}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {task.dueDate ? formatDay(task.dueDate) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatDuration(task.trackedHours)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
