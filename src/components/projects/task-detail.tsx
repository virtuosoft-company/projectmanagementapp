"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { ArchiveRestore, ArchiveX, ChartNoAxesColumn, ChevronLeft, CircleAlert, Pencil } from "lucide-react";
import { AvatarStack } from "@/components/avatar-stack";
import { TaskAttachments } from "@/components/projects/task-attachments";
import { TaskCover } from "@/components/projects/task-cover";
import {
  TaskEditDialog,
  type TaskFormValues,
} from "@/components/projects/task-edit-dialog";
import { TaskSubtasks } from "@/components/projects/task-subtasks";
import { TaskTimeTracking } from "@/components/projects/task-time-tracking";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SelectField } from "@/components/ui/select-field";
import { TASK_STATUSES, formatDay } from "@/lib/domain";
import { formatMinutes } from "@/lib/duration";
import { moveTaskAction } from "@/lib/actions";
import { archiveTaskAction, updateTaskAction } from "@/lib/task-actions";
import { priorityVariant } from "@/lib/status";
import type {
  Attachment,
  Label,
  Member,
  RunningTimer,
  Subtask,
  Task,
  TaskEntry,
  TaskStatus,
} from "@/lib/domain";

/**
 * Everything about one task on one page: its fields, its time, its images.
 *
 * This is where the docs' flows converge — start/stop a timer, add or correct
 * time, attach an image, edit the task — so it is a page rather than a drawer:
 * each of those is a several-step job, and all of them benefit from being
 * linkable.
 */
export function TaskDetail({
  task,
  projectId,
  projectName,
  entries,
  attachments,
  subtasks,
  running,
  members,
  labels,
  r2Problems,
  viewerId,
  canManage,
  canLog,
  canManageAnyTime,
}: {
  task: Task;
  projectId: string;
  projectName: string;
  entries: TaskEntry[];
  attachments: Attachment[];
  subtasks: Subtask[];
  running: RunningTimer | null;
  members: Member[];
  labels: Label[];
  /** What is wrong with the R2 setup, so the Images card can explain itself. */
  r2Problems: string[];
  viewerId: string;
  /** `tasks.manage`. */
  canManage: boolean;
  /** `time.log`. */
  canLog: boolean;
  /** `time.manage`. */
  canManageAnyTime: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const trackedMinutes = Math.round(task.trackedHours * 60);
  const estimateMinutes = Math.round(task.estimateHours * 60);
  const overEstimate = estimateMinutes > 0 && trackedMinutes > estimateMinutes;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  function save(values: TaskFormValues) {
    run(() => updateTaskAction({ ...values, taskId: task.id }), () => {
      toast.success("Task updated");
      setEditing(false);
    });
  }

  return (
    <div className="max-w-5xl space-y-6">
      <TaskCover taskId={task.id} coverUrl={task.coverUrl} canManage={canManage} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/projects/project/${projectId}/tasks`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            {projectName}
          </Link>

          <h1 className="mt-1 text-2xl font-bold leading-tight tracking-tight">{task.title}</h1>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={priorityVariant[task.priority]} className="capitalize">
              {task.priority}
            </Badge>
            {task.archived ? <Badge variant="outline">Archived</Badge> : null}
            {task.labels.map((label) => (
              <Badge
                key={label.id}
                variant="outline"
                className="gap-1.5"
                style={{ borderColor: label.color }}
              >
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                {label.name}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/projects/project/${projectId}/tasks/${task.id}/analytics`}>
              <ChartNoAxesColumn className="h-3.5 w-3.5" />
              Analytics
            </Link>
          </Button>
        {canManage ? (
          <>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                task.archived
                  ? run(() => archiveTaskAction({ taskId: task.id, archived: false }), () =>
                      toast.success("Task restored"),
                    )
                  : setArchiving(true)
              }
            >
              {task.archived ? (
                <>
                  <ArchiveRestore className="h-3.5 w-3.5" />
                  Restore
                </>
              ) : (
                <>
                  <ArchiveX className="h-3.5 w-3.5" />
                  Archive
                </>
              )}
            </Button>
          </>
        ) : null}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <Card className="shadow-none">
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Status</p>
            {canManage ? (
              <SelectField
                value={task.status}
                disabled={pending}
                aria-label="Status"
                className="h-8 text-xs"
                onValueChange={(value) => run(() => moveTaskAction(task.id, value as TaskStatus))}
                options={TASK_STATUSES.map((item) => ({ value: item.status, label: item.label }))}
              />
            ) : (
              <p className="text-sm font-medium">
                {TASK_STATUSES.find((item) => item.status === task.status)?.label}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Assigned to</p>
            {task.assignees.length ? (
              <AvatarStack people={task.assignees} max={4} />
            ) : (
              <p className="text-sm text-muted-foreground">Nobody</p>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Due</p>
            <p className="font-mono text-sm">
              {task.dueDate ? formatDay(task.dueDate) : <span className="text-muted-foreground">—</span>}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Tracked vs estimate</p>
            <p className="font-mono text-sm">
              <span className={overEstimate ? "text-destructive" : undefined}>
                {formatMinutes(trackedMinutes)}
              </span>
              <span className="text-muted-foreground">
                {estimateMinutes ? ` / ${formatMinutes(estimateMinutes)}` : " / no estimate"}
              </span>
            </p>
          </div>
        </CardContent>
      </Card>

      {task.description ? (
        <Card className="shadow-none">
          <CardContent className="p-4">
            <p className="whitespace-pre-wrap text-sm">{task.description}</p>
          </CardContent>
        </Card>
      ) : null}

      <TaskSubtasks
        taskId={task.id}
        taskTitle={task.title}
        subtasks={subtasks}
        members={task.assignees}
        running={running}
        canManage={canManage}
        canLog={canLog}
      />

      <TaskTimeTracking
        taskId={task.id}
        taskTitle={task.title}
        entries={entries}
        subtasks={subtasks}
        running={running}
        viewerId={viewerId}
        canLog={canLog}
        canManageAny={canManageAnyTime}
      />

      <TaskAttachments
        taskId={task.id}
        attachments={attachments}
        problems={r2Problems}
        canManage={canManage}
      />

      {editing ? (
        <TaskEditDialog
          open
          task={task}
          members={members}
          labels={labels}
          pending={pending}
          error={error}
          onClose={() => {
            setEditing(false);
            setError(null);
          }}
          onSubmit={save}
        />
      ) : null}

      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        onConfirm={() => {
          setArchiving(false);
          run(() => archiveTaskAction({ taskId: task.id, archived: true }), () =>
            toast.success("Task archived"),
          );
        }}
        confirmLabel="Archive"
        title={`Archive ${task.title}?`}
        description={
          trackedMinutes
            ? `It leaves the board but keeps its ${formatMinutes(trackedMinutes)} of logged time, so reports stay accurate. You can restore it later.`
            : "It leaves the board and can be restored later. Nothing is deleted."
        }
      />
    </div>
  );
}
