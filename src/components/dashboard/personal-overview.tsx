import Link from "next/link";
import { Clock, FolderKanban, SquareCheckBig } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { statusVariant } from "@/lib/status";
import type { Project, Task } from "@/lib/domain";

/**
 * One person's own work: what they are on, what is assigned, what they logged.
 *
 * Lifted out of `/profile`, which had all of it inline, so the common-user
 * dashboard can show the same thing rather than a second version of it. Three
 * separate pieces rather than one block because the two screens compose them
 * differently — the profile puts the two panels in a tab strip beside its
 * details form, the dashboard does not have a details form to sit beside.
 *
 * Presentational only: every figure is handed in, already scoped by the caller.
 */

export type PersonalProjectRow = {
  project: Project;
  stats: { progress: number; done: number; taskCount: number; hours: number };
};

/** Projects, tasks, completed and hours — the four numbers about you. */
export function PersonalStatTiles({
  projectCount,
  tasksTotal,
  tasksDone,
  hours,
}: {
  projectCount: number;
  tasksTotal: number;
  tasksDone: number;
  hours: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile
        icon={<FolderKanban className="h-4 w-4 text-primary" />}
        value={projectCount}
        label="Projects"
      />
      <Tile
        icon={<SquareCheckBig className="h-4 w-4 text-primary" />}
        value={tasksTotal}
        label="Tasks"
      />
      <Tile
        icon={<SquareCheckBig className="h-4 w-4 text-primary" />}
        value={tasksDone}
        label="Completed"
      />
      <Tile icon={<Clock className="h-4 w-4 text-primary" />} value={hours} label="Hours Logged" />
    </div>
  );
}

/** The projects this person is on, with each one's progress. */
export function MyProjectsPanel({ rows }: { rows: PersonalProjectRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Not on any project yet.</p>;
  }

  return (
    <div className="space-y-2">
      {rows.map(({ project, stats }) => (
        <Card key={project.id} className="shadow-none">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <Link
                href={`/projects/project/${project.id}`}
                className="truncate font-medium hover:underline"
              >
                {project.name}
              </Link>
              <Badge variant={statusVariant[project.status]}>{project.status}</Badge>
            </div>
            <div className="flex items-center gap-3">
              <Progress value={stats.progress} aria-label={`${project.name} progress`} />
              <span className="w-10 text-right font-mono text-xs text-muted-foreground">
                {stats.progress}%
              </span>
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              {stats.done}/{stats.taskCount} tasks · {stats.hours}h
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** The tasks assigned to this person, with the project each belongs to. */
export function MyTasksPanel({
  tasks,
  projectName,
}: {
  tasks: Task[];
  /** Resolves a project id to its name; the caller already has the list. */
  projectName: (projectId: string) => string;
}) {
  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No tasks assigned.</p>;
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <Card key={task.id} className="shadow-none">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{task.title}</p>
              <p className="text-xs text-muted-foreground">{projectName(task.projectId)}</p>
            </div>
            <Badge variant="secondary">{task.status}</Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Tile({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
          {icon}
        </div>
        <div>
          <p className="font-mono text-xl font-bold leading-none">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
