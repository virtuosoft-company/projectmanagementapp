"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { Plus, Tag } from "lucide-react";
import { AvatarStack } from "@/components/avatar-stack";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LabelsManager } from "@/components/projects/labels-manager";
import { TaskDialog } from "@/components/projects/task-dialog";
import {
  EMPTY_FILTER,
  TaskFilters,
  filterTasks,
  type TaskFilter,
} from "@/components/projects/task-filters";
import { createTaskAction } from "@/lib/actions";
import { setTaskCoverAction, uploadTaskFileAction } from "@/lib/task-actions";
import {
  TASK_STATUSES,
  formatDay,
  type Label,
  type Member,
  type Project,
  type Task,
} from "@/lib/domain";
import { priorityVariant } from "@/lib/status";
import { cn, formatDuration } from "@/lib/utils";

type TaskRow = Task & { projectName: string };

export function TasksView({
  tasks,
  projects,
  members,
  labels,
  labelUsage,
  canManage,
}: {
  /** Live and archived; the filter decides which are shown. */
  tasks: TaskRow[];
  projects: Project[];
  members: Member[];
  labels: Label[];
  /** Tasks per label, for the delete confirmation in the labels dialog. */
  labelUsage: Record<string, number>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<"board" | "list">("board");
  const [creating, setCreating] = useState(false);
  const [managingLabels, setManagingLabels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_FILTER);

  const visible = filterTasks(tasks, filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold leading-tight tracking-tight">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">All tasks across your projects</p>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="tablist"
            aria-label="Task view"
            className="inline-flex h-9 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground"
          >
            {(["board", "list"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={view === value}
                onClick={() => setView(value)}
                className={cn(
                  "inline-flex items-center justify-center rounded-sm px-3 py-1 text-sm font-medium capitalize transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  view === value && "bg-background text-foreground shadow-sm",
                )}
              >
                {value}
              </button>
            ))}
          </div>
          {canManage ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setManagingLabels(true)}
                disabled={pending}
              >
                <Tag className="h-4 w-4" />
                Labels
              </Button>
              <Button size="sm" onClick={() => setCreating(true)} disabled={pending}>
                <Plus className="h-4 w-4" />
                Add Task
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <TaskFilters
        filter={filter}
        onChange={setFilter}
        members={members}
        labels={labels}
        resultCount={visible.length}
        totalCount={tasks.length}
      />

      {view === "board" ? <Board tasks={visible} /> : <List tasks={visible} />}

      <TaskDialog
        key={String(creating)}
        open={creating}
        onClose={() => setCreating(false)}
        members={members}
        projects={projects}
        pending={pending}
        onSubmit={(draft) => {
          startTransition(async () => {
            const { cover, file, ...fields } = draft;
            const result = await createTaskAction(fields);
            if (!result.ok || !result.id) {
              setError(result.error ?? null);
              return;
            }

            // One upload per request: each file may use the whole body limit.
            const problems: string[] = [];
            for (const [upload, chosen] of [
              [setTaskCoverAction, cover],
              [uploadTaskFileAction, file],
            ] as const) {
              if (!chosen) continue;
              const form = new FormData();
              form.set("taskId", result.id);
              form.set("file", chosen);
              const uploaded = await upload(form);
              if (!uploaded.ok) problems.push(`${chosen.name}: ${uploaded.error ?? "upload failed."}`);
            }

            // The task exists either way; a failed upload is reported beside
            // it rather than instead of it.
            if (problems.length) {
              setError(`Task created, but ${problems.join(" ")}`);
              toast.warning("Task created, with problems");
            } else {
              setError(null);
              toast.success("Task created");
            }
            setCreating(false);
            router.refresh();
          });
        }}
      />

      <LabelsManager
        open={managingLabels}
        onClose={() => setManagingLabels(false)}
        labels={labels}
        usage={labelUsage}
      />
    </div>
  );
}

function Board({ tasks }: { tasks: TaskRow[] }) {
  return (
    <div className="grid min-h-[60vh] grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {TASK_STATUSES.map(({ status, label }) => {
        const column = tasks.filter((task) => task.status === status);
        return (
          <div key={status} className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-medium text-muted-foreground">
                {label}
                <span className="ml-1 text-xs">{column.length}</span>
              </h2>
            </div>
            <div className="min-h-[100px] space-y-2 rounded-lg p-1">
              {column.map((task) => (
                <Card
                  key={task.id}
                  className="shadow-none transition-colors hover:border-primary/30"
                >
                  <CardContent className="space-y-2 p-3">
                    <p className="text-sm font-medium">
                      <Link
                        href={`/projects/project/${task.projectId}/tasks/${task.id}`}
                        className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {task.title}
                      </Link>
                      {task.archived ? (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          archived
                        </Badge>
                      ) : null}
                    </p>
                    <Link
                      href={`/projects/project/${task.projectId}`}
                      className="block text-xs text-muted-foreground hover:underline"
                    >
                      {task.projectName}
                    </Link>
                    {task.labels.length ? (
                      <div className="flex flex-wrap gap-1">
                        {task.labels.map((label) => (
                          <Badge
                            key={label.id}
                            variant="outline"
                            className="px-1.5 text-[10px]"
                            style={{ borderColor: label.color }}
                          >
                            {label.name}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={priorityVariant[task.priority]} className="capitalize">
                        {task.priority}
                      </Badge>
                      <AvatarStack people={task.assignees} max={3} />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{task.dueDate ? `Due ${formatDay(task.dueDate)}` : "No due date"}</span>
                      <span className="font-mono">{formatDuration(task.trackedHours)}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function List({ tasks }: { tasks: TaskRow[] }) {
  const statusLabel = Object.fromEntries(
    TASK_STATUSES.map(({ status, label }) => [status, label]),
  );

  return (
    <Card className="shadow-none">
      <CardContent className="p-0">
        <div className="w-full overflow-x-auto">
          <table className="w-full caption-bottom text-sm">
            <thead className="[&_tr]:border-b">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Task</th>
                <th className="px-4 py-2 font-medium">Project</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Priority</th>
                <th className="px-4 py-2 font-medium">Assignee</th>
                <th className="px-4 py-2 font-medium">Due Date</th>
                <th className="px-4 py-2 text-right font-medium">Tracked</th>
              </tr>
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {tasks.map((task) => (
                <tr key={task.id} className="border-b transition-colors hover:bg-muted/50">
                  <td className="px-4 py-2">
                    <Link
                      href={`/projects/project/${task.projectId}/tasks/${task.id}`}
                      className="hover:underline"
                    >
                      {task.title}
                    </Link>
                    {task.archived ? (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        archived
                      </Badge>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                    <Link href={`/projects/project/${task.projectId}`} className="hover:underline">
                      {task.projectName}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">{statusLabel[task.status]}</td>
                  <td className="px-4 py-2 capitalize">{task.priority}</td>
                  <td className="px-4 py-2">
                    <AvatarStack people={task.assignees} max={3} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono">
                    {task.dueDate ? formatDay(task.dueDate) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-mono">
                    {formatDuration(task.trackedHours)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
