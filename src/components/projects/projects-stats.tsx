import { Activity, CircleCheck, Clock, FolderKanban } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";

/**
 * The figures above the project grid — shown to whoever oversees the work, not
 * to whoever does it.
 *
 * Its own component rather than a block inlined in the page, so the page reads
 * as the decision ("show the figures or don't") rather than as thirty lines of
 * markup wrapped in a conditional.
 *
 * The numbers are already scoped by the caller: a manager's totals count their
 * own projects and their reports' hours, not the workspace's.
 */
export function ProjectsStats({
  metrics,
}: {
  metrics: {
    totalProjects: number;
    planningProjects: number;
    activeProjects: number;
    completedProjects: number;
    completionRate: number;
    tasksDone: number;
    tasksTotal: number;
  };
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard
        icon={FolderKanban}
        tone="primary"
        value={metrics.totalProjects.toString()}
        label="Total Projects"
        hint={`${metrics.planningProjects} planning`}
      />
      <KpiCard
        icon={Activity}
        tone="success"
        value={metrics.activeProjects.toString()}
        label="Active"
        hint="In progress"
      />
      <KpiCard
        icon={CircleCheck}
        tone="warning"
        value={`${metrics.completionRate}%`}
        label="Task Completion"
        hint={`${metrics.tasksDone}/${metrics.tasksTotal} tasks`}
      />
      <KpiCard
        icon={Clock}
        tone="accent"
        value={metrics.completedProjects.toString()}
        label="Completed"
        hint="Wrapped up"
      />
    </div>
  );
}
