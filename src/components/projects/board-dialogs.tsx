"use client";

import { useState } from "react";
import { DialogActions } from "@/components/ui/form-actions";
import { Field } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { AvatarStack } from "@/components/avatar-stack";
import { TaskSubtasks } from "@/components/projects/task-subtasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isOptimizableImageSrc } from "@/lib/files";
import { priorityVariant } from "@/lib/status";
import {
  TASK_STATUSES,
  formatDay,
  type BoardList,
  type RunningTimer,
  type Subtask,
  type Task,
} from "@/lib/domain";

/** A card's subtasks — the same mind map as on the task page. */
export function SubtasksDialog({
  open,
  task,
  subtasks,
  running,
  canManage,
  canLog,
  canUseTimer,
  onClose,
  onEdit,
  onDelete,
}: {
  open: boolean;
  task: Task;
  subtasks: Subtask[];
  running: RunningTimer | null;
  canManage: boolean;
  canLog: boolean;
  /** `time.log` *and* not the admin account — may run the clock. */
  canUseTimer: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const status = TASK_STATUSES.find((item) => item.status === task.status)?.label;

  return (
    <FormDialog open={open} onClose={onClose} title={task.title} className="sm:max-w-4xl">
      <div className="space-y-4">
        {task.coverUrl ? (
          <div className="relative h-32 overflow-hidden rounded-md border bg-muted sm:h-40">
            <Image
              src={task.coverUrl}
              alt=""
              fill
              sizes="(min-width: 640px) 56rem, 100vw"
              className="object-cover"
              unoptimized={!isOptimizableImageSrc(task.coverUrl)}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={priorityVariant[task.priority]} className="capitalize">
              {task.priority}
            </Badge>
            <Badge variant="outline">{status}</Badge>
            {task.dueDate ? (
              <Badge variant="outline" className="font-mono">
                Due {formatDay(task.dueDate)}
              </Badge>
            ) : null}
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

          <div className="flex items-center gap-2">
            {task.assignees.length ? <AvatarStack people={task.assignees} max={4} /> : null}
            <Button variant="outline" size="sm" asChild>
              <Link href={`/projects/project/${task.projectId}/tasks/${task.id}`}>
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </Link>
            </Button>
            {canManage ? (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={`Actions for ${task.title}`}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem onSelect={onEdit}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>

        {task.description ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</p>
        ) : null}

        <TaskSubtasks
          taskId={task.id}
          taskTitle={task.title}
          subtasks={subtasks}
          members={task.assignees}
          running={running}
          canManage={canManage}
          canLog={canLog}
          canUseTimer={canUseTimer}
        />
      </div>
    </FormDialog>
  );
}

/** Name a new board, or rename one. */
export function BoardNameDialog({
  open,
  title,
  initial,
  submitLabel,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initial: string;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);

  return (
    <FormDialog open={open} onClose={onClose} title={title}>
      <form
        className="grid gap-4 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(name);
        }}
      >
        <Field label="Name" required>
          <Input
            required
            autoFocus
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogActions onCancel={onClose} submitLabel={submitLabel} disabled={pending} />
        </div>
      </form>
    </FormDialog>
  );
}


/**
 * Move a card without dragging it.
 *
 * Drag and drop does not fire on touch screens and cannot be driven from the
 * keyboard; this is the same move, reachable by both.
 */
export function MoveCardDialog({
  open,
  title,
  lists,
  countIn,
  initialListId,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  lists: BoardList[];
  /** Cards already in a list, excluding the one being moved. */
  countIn: (listId: string) => number;
  initialListId: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (listId: string, index: number) => void;
}) {
  const [listId, setListId] = useState(initialListId);
  const [position, setPosition] = useState("end");
  const slots = countIn(listId);

  return (
    <FormDialog open={open} onClose={onClose} title={`Move ${title}`}>
      <form
        className="grid gap-4 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(listId, position === "end" ? slots : Number(position));
        }}
      >
        <Field label="List">
          <SelectField
            value={listId}
            onValueChange={(value) => {
              setListId(value);
              setPosition("end");
            }}
            options={lists.map((list) => ({ value: list.id, label: list.name }))}
          />
        </Field>
        <Field label="Position">
          <SelectField
            value={position}
            onValueChange={setPosition}
            options={[
              ...Array.from({ length: slots }, (_, index) => ({
                value: String(index),
                label: index === 0 ? "Top" : `${index + 1}`,
              })),
              { value: "end", label: "Bottom" },
            ]}
          />
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogActions onCancel={onClose} submitLabel="Move" disabled={pending} />
        </div>
      </form>
    </FormDialog>
  );
}
