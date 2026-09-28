import {
  HoursAreaChart,
  ProjectEffortChart,
  TaskDistributionChart,
} from "@/components/dashboard/charts";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getHoursByDay,
  getMetrics,
  getProjectStats,
  getProjects,
  getTaskDistribution,
} from "@/lib/queries";

export async function OverviewTab({ workspaceId }: { workspaceId: string }) {
  const [metrics, hoursByDay, distribution, projects] = await Promise.all([
    getMetrics(workspaceId),
    getHoursByDay(workspaceId),
    getTaskDistribution(workspaceId),
    getProjects(workspaceId),
  ]);

  const effort = await Promise.all(
    projects.map(async (project) => {
      const stats = await getProjectStats(workspaceId, project.id);
      return { name: project.name, hours: stats.hours };
    }),
  );

  const hours = hoursByDay.map((point) => ({ date: point.label, hours: point.hours }));

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="shadow-none lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Hours Logged Over Time</CardTitle>
                <CardDescription>Daily activity across all projects</CardDescription>
              </div>
              <Badge variant="secondary">{metrics.hoursTracked} h total</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[240px]">
              <HoursAreaChart data={hours} />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Task Distribution</CardTitle>
            <CardDescription>By status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[240px]">
              <TaskDistributionChart data={distribution} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Hours &amp; Cost by Project</CardTitle>
          <CardDescription>Effort distribution across active work</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[260px]">
            <ProjectEffortChart data={effort} />
          </div>
        </CardContent>
      </Card>

      {/* <Card className="border-destructive/30 bg-destructive/5 shadow-none">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4 text-destructive" />
            <CardTitle>Overdue Tasks</CardTitle>
            <Badge variant="destructive">{overdue.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {overdue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is overdue. Nice.</p>
          ) : (
            overdue.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between rounded-md border bg-background p-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/projects/project/${task.projectId}`}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {task.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {projectName(task.projectId)} · Due {formatDay(task.dueDate!)}
                  </p>
                </div>
                <Badge variant={priorityVariant[task.priority]}>{task.priority}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card> */}
    </div>
  );
}
