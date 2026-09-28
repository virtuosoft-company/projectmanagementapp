"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlignLeft,
  Circle,
  CircleAlert,
  FileText,
  Info,
  Paperclip,
  CircleCheck,
  CircleDot,
  CircleEllipsis,
  CornerDownRight,
  Minus,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Square,
  Trash2,
} from "lucide-react";
import { TimerDialog } from "@/components/projects/timer-controls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { DialogActions } from "@/components/ui/form-actions";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilePicker } from "@/components/ui/file-picker";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useElapsed } from "@/hooks/use-elapsed";
import { TASK_STATUSES } from "@/lib/domain";
import { formatClock, formatMinutes } from "@/lib/duration";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_LABEL,
  MAX_SIZE,
  formatBytes,
  isImageMimeType,
  isOptimizableImageSrc,
  validateAttachmentFile,
} from "@/lib/r2";
import { taskStatusColor } from "@/lib/status";
import {
  buildSubtaskTree,
  flattenTree,
  type SubtaskNode,
} from "@/lib/subtask-tree";
import {
  createSubtaskAction,
  deleteAttachmentAction,
  deleteSubtaskAction,
  pauseTimerAction,
  resumeTimerAction,
  startTimerAction,
  stopTimerAction,
  updateSubtaskAction,
  uploadTaskFileAction,
} from "@/lib/task-actions";
import type { Person, RunningTimer, Subtask, TaskStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";

type Result = { ok: boolean; error?: string };

/**
 * A task's subtasks, drawn as a mind map: the task at the root on the left,
 * subtasks branching out to the right, any of them with branches of its own.
 * Clicking a box opens its actions — status, timer, add beneath, rename, delete.
 *
 * Each node has one of the four task statuses and its own time. A branch shows
 * what it adds up to (time, estimate, how many beneath it are done) but its own
 * status is never changed by its children: the tree reports progress, people
 * set status.
 */
export function TaskSubtasks({
  taskId,
  taskTitle,
  subtasks,
  members,
  running,
  canManage,
  canLog,
}: {
  taskId: string;
  /** The task's assignees — the only people a subtask can go to. */
  members: Person[];
  /** The root of the diagram. */
  taskTitle: string;
  subtasks: Subtask[];
  /** The viewer's running timer, on this task or another. */
  running: RunningTimer | null;
  /** `tasks.manage`. Without it the tree is visible but read-only. */
  canManage: boolean;
  /** `time.log`. Without it no timer controls are shown. */
  canLog: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [removing, setRemoving] = useState<SubtaskNode | null>(null);

  const tree = useMemo(() => buildSubtaskTree(subtasks), [subtasks]);
  const done = subtasks.filter((item) => item.status === "done").length;
  const percent = subtasks.length
    ? Math.round((done / subtasks.length) * 100)
    : 0;

  function run(action: () => Promise<Result>, onDone?: () => void) {
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

  function add() {
    const trimmed = title.trim();
    if (!trimmed) return;
    run(
      () => createSubtaskAction({ taskId, title: trimmed }),
      () => {
        toast.success("Subtask added");
        setTitle("");
      },
    );
  }

  function toggleCollapsed(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const actions: NodeActions = {
    taskId,
    taskTitle,
    members,
    pending,
    canManage,
    canLog,
    running,
    collapsed,
    toggleCollapsed,
    error,
    addChild: (parentId, values, onDone) =>
      run(() => createSubtaskWithFile(taskId, parentId, values), onDone),
    update: (subtaskId, patch, onDone) =>
      run(() => updateSubtaskAction({ subtaskId, ...patch }), onDone),
    saveEdit: (node, values, onDone) => run(() => saveSubtaskEdit(node, values), onDone),
    remove: (node) => {
      // A lone subtask with nothing logged goes at once, as the checklist did.
      // One with a branch or with time asks first: more goes than the box shows.
      if (node.children.length || node.rollup.trackedMinutes) setRemoving(node);
      else run(() => deleteSubtaskAction(node.id), () => toast.success("Subtask deleted"));
    },
    startTimer: (subtaskId) =>
      run(() => startTimerAction({ taskId, subtaskId, note: "" })),
    stopTimer: () => run(stopTimerAction),
    pauseTimer: () => run(pauseTimerAction),
    resumeTimer: () => run(resumeTimerAction),
  };

  return (
    <Card className="shadow-none">
      <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle>Subtasks</CardTitle>
        {subtasks.length ? (
          <span className="text-xs text-muted-foreground">
            {done} / {subtasks.length} done
          </span>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-3">
        {subtasks.length ? (
          <Progress
            value={percent}
            aria-label={`${percent}% of subtasks done`}
            className="h-1.5"
          />
        ) : null}

        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}

        {tree.length === 0 ? (
          <p className="text-sm text-muted-foreground">No subtasks yet.</p>
        ) : (
          // Scrolls sideways rather than squeezing: a deep tree is wider than
          // the card, and a box narrower than its title helps nobody.
          <div className="overflow-x-auto pb-2">
            <div
              role="tree"
              aria-label={`Subtasks of ${taskTitle}`}
              className="flex w-max items-center py-2"
            >
              <div className="max-w-44 shrink-0 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm">
                <span className="line-clamp-2">{taskTitle}</span>
                <span className="mt-0.5 block text-[11px] font-normal opacity-80">
                  {done}/{subtasks.length} done
                </span>
              </div>
              <Branches>
                {tree.map((node) => (
                  <li key={node.id} className={branchItem}>
                    <SubtaskBranch node={node} actions={actions} />
                  </li>
                ))}
              </Branches>
            </div>
          </div>
        )}

        {canManage ? (
          <div className="flex items-center gap-2">
            <Input
              value={title}
              disabled={pending}
              placeholder="Add a subtask…"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
            <Button size="sm" disabled={pending || !title.trim()} onClick={add}>
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const node = removing;
          setRemoving(null);
          if (node) run(() => deleteSubtaskAction(node.id));
        }}
        confirmLabel="Delete"
        title={`Delete ${removing?.title ?? "subtask"}?`}
        description={removing ? describeRemoval(removing) : ""}
      />
    </Card>
  );
}

/** What deleting a node takes with it, and what it leaves. */
function describeRemoval(node: SubtaskNode) {
  const beneath = node.rollup.descendants;
  const parts = [
    beneath
      ? `This deletes it and the ${beneath} subtask${beneath === 1 ? "" : "s"} beneath it.`
      : "This deletes the subtask.",
  ];
  if (node.rollup.trackedMinutes) {
    parts.push(
      `The ${formatMinutes(node.rollup.trackedMinutes)} logged on it stays on the task, so reports do not change.`,
    );
  }
  return parts.join(" ");
}

type NodeActions = {
  taskId: string;
  taskTitle: string;
  members: Person[];
  pending: boolean;
  saveEdit: (node: SubtaskNode, values: SubtaskEdit, onDone: () => void) => void;
  error: string | null;
  canManage: boolean;
  canLog: boolean;
  running: RunningTimer | null;
  collapsed: Set<string>;
  toggleCollapsed: (id: string) => void;
  addChild: (parentId: string, values: NewSubtask, onDone: () => void) => void;
  update: (
    subtaskId: string,
    patch: { title?: string; status?: TaskStatus; estimateMinutes?: number },
    onDone?: () => void,
  ) => void;
  remove: (node: SubtaskNode) => void;
  startTimer: (subtaskId: string) => void;
  stopTimer: () => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
};

export const statusIcon: Record<TaskStatus, typeof Circle> = {
  todo: Circle,
  "in-progress": CircleDot,
  "in-review": CircleEllipsis,
  done: CircleCheck,
};

/**
 * A column of branches leaving a box: a stub out of the parent, then the
 * children stacked, each joined on by a connector.
 */
function Branches({ children }: { children: ReactNode }) {
  return (
    <>
      <span
        aria-hidden
        className="w-5 shrink-0 border-t border-muted-foreground/40"
      />
      <ul role="group" className="flex flex-col">
        {children}
      </ul>
    </>
  );
}

/**
 * One branch in a column. The lines are drawn by the item's own pseudo-elements
 * rather than measured: `before` is the horizontal stub into the child, `after`
 * is its slice of the shared vertical spine — trimmed to the lower half on the
 * first child and the upper half on the last, so the spine runs exactly from
 * the first branch to the last. An only child needs no spine at all.
 */
const branchItem = cn(
  "relative flex items-center py-1 pl-5",
  "before:absolute before:left-0 before:top-1/2 before:w-5 before:border-t before:border-muted-foreground/40",
  "after:absolute after:inset-y-0 after:left-0 after:border-l after:border-muted-foreground/40",
  "first:after:top-1/2 last:after:bottom-1/2 only:after:hidden",
);

/** One subtask's box and, unless folded, its branches to the right. */
function SubtaskBranch({
  node,
  actions,
}: {
  node: SubtaskNode;
  actions: NodeActions;
}) {
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [timingOpen, setTiming] = useState(false);

  const hasChildren = node.children.length > 0;
  const open = hasChildren && !actions.collapsed.has(node.id);
  const timing = actions.running?.subtaskId === node.id;
  const StatusIcon = statusIcon[node.status];
  const label = TASK_STATUSES.find(
    (item) => item.status === node.status,
  )?.label;

  return (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? open : undefined}
      aria-selected={false}
      className="flex items-center"
    >
      {
        <div
          className={cn(
            "relative w-52 shrink-0 rounded-md border border-l-[3px] bg-card shadow-sm",
            timing && "ring-2 ring-success/60",
          )}
          style={{ borderLeftColor: taskStatusColor[node.status] }}
        >
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={actions.pending}
                className="block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${node.title}, ${label}. Open actions`}
              >
                <span className="flex items-center gap-1.5">
                  <StatusIcon
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: taskStatusColor[node.status] }}
                  />
                  <span
                    className={cn(
                      "truncate text-xs font-medium",
                      node.status === "done" &&
                        "text-muted-foreground line-through",
                    )}
                    title={node.title}
                  >
                    {node.title}
                  </span>
                  {node.assignee ? (
                    <UserAvatar
                      name={node.assignee.name}
                      image={node.assignee.image}
                      className="ml-auto size-5 shrink-0"
                      textClassName="text-[9px]"
                    />
                  ) : null}
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">
                      {label}
                      {hasChildren
                        ? ` · ${node.rollup.descendantsDone}/${node.rollup.descendants}`
                        : ""}
                    </span>
                    {node.description ? (
                      <AlignLeft aria-label="Has a description" className="h-3 w-3 shrink-0" />
                    ) : null}
                    {node.files.length ? (
                      <span className="flex shrink-0 items-center gap-0.5" title="Files">
                        <Paperclip aria-hidden className="h-3 w-3" />
                        {node.files.length}
                      </span>
                    ) : null}
                  </span>
                  <SubtaskTime
                    node={node}
                    timing={timing}
                    running={actions.running}
                  />
                </span>
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="start" className="w-52">
              {actions.canManage ? (
                <>
                  <DropdownMenuLabel className="text-xs">
                    Status
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={node.status}
                    onValueChange={(value) =>
                      actions.update(node.id, { status: value as TaskStatus })
                    }
                  >
                    {TASK_STATUSES.map((item) => (
                      <DropdownMenuRadioItem
                        key={item.status}
                        value={item.status}
                      >
                        {item.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                </>
              ) : null}

              {node.description || node.files.length ? (
                <DropdownMenuItem onSelect={() => setViewing(true)}>
                  <Info className="h-3.5 w-3.5" />
                  Details
                </DropdownMenuItem>
              ) : null}

              {actions.canLog ? (
                <DropdownMenuItem onSelect={() => setTiming(true)}>
                  <Play className="h-3.5 w-3.5" />
                  Start timer
                </DropdownMenuItem>
              ) : null}

              {actions.canManage ? (
                <>
                  <DropdownMenuItem
                    onSelect={() => {
                      // Unfold first, so the new box shows up beside its siblings.
                      if (actions.collapsed.has(node.id))
                        actions.toggleCollapsed(node.id);
                      setAdding(true);
                    }}
                  >
                    <CornerDownRight className="h-3.5 w-3.5" />
                    Add subtask
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => actions.remove(node)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </DropdownMenuItem>
                </>
              ) : null}

              {!actions.canManage && !actions.canLog ? (
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  View only
                </DropdownMenuLabel>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* The knob on the branch point: folds the branch away, and says how
              much is folded while it is. */}
          {hasChildren ? (
            <button
              type="button"
              onClick={() => actions.toggleCollapsed(node.id)}
              aria-label={
                open ? `Collapse ${node.title}` : `Expand ${node.title}`
              }
              className="absolute -right-2.5 top-1/2 z-10 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-full border bg-background px-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
            >
              {open ? (
                <Minus className="h-3 w-3" />
              ) : (
                `+${node.rollup.descendants}`
              )}
            </button>
          ) : null}
        </div>
      }

      {open ? (
        <Branches>
          {node.children.map((child) => (
            <li key={child.id} className={branchItem}>
              <SubtaskBranch node={child} actions={actions} />
            </li>
          ))}
        </Branches>
      ) : null}

      {adding ? (
        <AddSubtaskDialog
          parentTitle={node.title}
          members={actions.members}
          pending={actions.pending}
          onClose={() => setAdding(false)}
          error={actions.error}
          onSubmit={(values) => actions.addChild(node.id, values, () => setAdding(false))}
        />
      ) : null}

      {editing ? (
        <EditSubtaskDialog
          subtask={node}
          members={actions.members}
          pending={actions.pending}
          error={actions.error}
          onClose={() => setEditing(false)}
          onSubmit={(values) => actions.saveEdit(node, values, () => setEditing(false))}
        />
      ) : null}

      {timingOpen ? (
        <TimerDialog
          open
          onClose={() => setTiming(false)}
          taskId={actions.taskId}
          taskTitle={actions.taskTitle}
          subtaskId={node.id}
          subtaskTitle={node.title}
          running={actions.running}
        />
      ) : null}

      {viewing ? (
        <SubtaskDetailsDialog
          subtask={node}
          canManage={actions.canManage}
          canLog={actions.canLog}
          running={actions.running}
          pending={actions.pending}
          onStartTimer={() => actions.startTimer(node.id)}
          onStopTimer={actions.stopTimer}
          onPauseTimer={actions.pauseTimer}
          onResumeTimer={actions.resumeTimer}
          onClose={() => setViewing(false)}
          onEdit={() => {
            setViewing(false);
            setEditing(true);
          }}
          onAddChild={() => {
            setViewing(false);
            setAdding(true);
          }}
          onDelete={() => {
            setViewing(false);
            actions.remove(node);
          }}
        />
      ) : null}
    </div>
  );
}

function AssigneeField({
  value,
  current,
  onChange,
  members,
  disabled,
}: {
  value: string;
  /** Whoever holds it now, listed even if they have since left the task. */
  current: Person | null;
  onChange: (value: string) => void;
  members: Person[];
  disabled?: boolean;
}) {
  const people =
    current && !members.some((member) => member.id === current.id)
      ? [...members, current]
      : members;

  return (
    <Field label="Assignee" required>
      <SelectField
        value={value}
        disabled={disabled || people.length === 0}
        placeholder="Who is doing this?"
        onValueChange={onChange}
        options={people.map((member) => ({ value: member.id, label: member.name }))}
      />
      {people.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nobody is on this task yet — assign someone to it first.
        </p>
      ) : null}
    </Field>
  );
}

/**
 * One subtask, read-only: what it says, what is attached, and its actions.
 * Shared by the mind map and by the rows drawn under a board card.
 */
export function SubtaskDetailsDialog({
  subtask,
  canManage,
  canLog,
  running,
  pending,
  onClose,
  onEdit,
  onDelete,
  onAddChild,
  onStartTimer,
  onStopTimer,
  onPauseTimer,
  onResumeTimer,
}: {
  subtask: Subtask;
  canManage: boolean;
  /** `time.log` — whether the timer controls are offered. */
  canLog: boolean;
  /** The viewer's running timer, anywhere. */
  running: RunningTimer | null;
  pending: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddChild: () => void;
  onStartTimer: () => void;
  onStopTimer: () => void;
  onPauseTimer: () => void;
  onResumeTimer: () => void;
}) {
  const label = TASK_STATUSES.find((item) => item.status === subtask.status)?.label;
  const timing = running?.subtaskId === subtask.id;
  const paused = Boolean(timing && running?.pausedAt);
  const elapsed = useElapsed(
    timing && running ? running.startedAt : null,
    timing ? (running?.pausedAt ?? null) : null,
  );

  return (
    <FormDialog open onClose={onClose} title={subtask.title}>
      <div className="grid gap-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className="rounded px-2 py-0.5 font-medium text-white"
              style={{ backgroundColor: taskStatusColor[subtask.status] }}
            >
              {label}
            </span>
            <span className="font-mono text-muted-foreground">
              {formatMinutes(subtask.trackedMinutes)}
              {subtask.estimateMinutes
                ? ` / ${formatMinutes(subtask.estimateMinutes)}`
                : " / no estimate"}
            </span>
          </div>

          {canManage ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Actions for ${subtask.title}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onAddChild}>
                  <CornerDownRight className="h-3.5 w-3.5" />
                  Add subtask
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <div className="flex items-center gap-2 text-sm">
          {subtask.assignee ? (
            <>
              <UserAvatar
                name={subtask.assignee.name}
                image={subtask.assignee.image}
                className="size-6"
                textClassName="text-[10px]"
              />
              <span>{subtask.assignee.name}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Not assigned</span>
          )}
        </div>

        {canLog ? (
          <div
            className={cn(
              "flex items-center justify-between gap-3 rounded-md border p-2.5",
              timing && !paused && "border-success/50 bg-success/5",
              paused && "border-warning/50 bg-warning/5",
            )}
          >
            <span className="text-sm">
              {timing ? (
                <span
                  className={cn(
                    "font-mono tabular-nums",
                    paused ? "text-warning" : "text-success",
                  )}
                >
                  {formatClock(elapsed)}
                  {paused ? <span className="ml-2 font-sans text-xs">Paused</span> : null}
                </span>
              ) : running ? (
                <span className="text-muted-foreground">
                  A timer is running on {running.taskTitle}. Starting here stops and saves it.
                </span>
              ) : (
                <span className="text-muted-foreground">No timer running.</span>
              )}
            </span>
            {timing ? (
              <div className="flex items-center gap-2">
                {paused ? (
                  <Button size="sm" variant="outline" disabled={pending} onClick={onResumeTimer}>
                    <Play className="h-3.5 w-3.5" />
                    Resume
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={pending} onClick={onPauseTimer}>
                    <Pause className="h-3.5 w-3.5" />
                    Pause
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={pending} onClick={onStopTimer}>
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </Button>
              </div>
            ) : (
              <Button size="sm" disabled={pending} onClick={onStartTimer}>
                <Play className="h-3.5 w-3.5" />
                Start timer
              </Button>
            )}
          </div>
        ) : null}

        {subtask.description ? (
          <p className="whitespace-pre-wrap text-sm">{subtask.description}</p>
        ) : (
          <p className="text-sm text-muted-foreground">No description.</p>
        )}

        {subtask.files.length ? (
          <ul className="space-y-1.5">
            {subtask.files.map((file) => (
              <li key={file.id}>
                <a
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-md border p-2 text-sm hover:bg-muted/40"
                >
                  {isImageMimeType(file.mimeType) ? (
                    <Image
                      src={file.url}
                      alt={file.filename}
                      width={64}
                      height={40}
                      className="h-10 w-16 shrink-0 rounded border object-cover"
                      unoptimized={!isOptimizableImageSrc(file.url)}
                    />
                  ) : (
                    <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{file.filename}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBytes(file.size)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </FormDialog>
  );
}

export type SubtaskEdit = {
  title: string;
  description: string;
  /** Empty means nobody. */
  assigneeId: string;
  /** Ids of existing files to delete. */
  removeFileIds: string[];
  file: File | null;
};

/** Edit a subtask's title and description, and add or remove its files. Mounted only while open. */
export function EditSubtaskDialog({
  subtask,
  members,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  subtask: Subtask;
  members: Person[];
  pending: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (values: SubtaskEdit) => void;
}) {
  const [title, setTitle] = useState(subtask.title);
  const [description, setDescription] = useState(subtask.description);
  const [assigneeId, setAssigneeId] = useState(subtask.assignee?.id ?? "");
  const currentAssignee = subtask.assignee;
  const [removing, setRemoving] = useState<Set<string>>(() => new Set());
  const [file, setFile] = useState<File | null>(null);

  function toggleRemove(id: string) {
    setRemoving((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <FormDialog open onClose={onClose} title="Edit subtask">
      <form
        className="grid gap-4 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = title.trim();
          if (!trimmed || !assigneeId) return;
          onSubmit({
            title: trimmed,
            description: description.trim(),
            assigneeId,
            removeFileIds: [...removing],
            file,
          });
        }}
      >
        <Field label="Title" required>
          <Input
            required
            autoFocus
            maxLength={200}
            value={title}
            disabled={pending}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="Description">
          <Textarea
            rows={3}
            maxLength={5000}
            value={description}
            disabled={pending}
            placeholder="What needs doing?"
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <AssigneeField
          value={assigneeId}
          current={currentAssignee}
          onChange={setAssigneeId}
          members={members}
          disabled={pending}
        />
        {subtask.files.length ? (
          <Field label="Files">
            <ul className="space-y-1.5">
              {subtask.files.map((existing) => {
                const going = removing.has(existing.id);
                return (
                  <li key={existing.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                    <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        going && "text-muted-foreground line-through",
                      )}
                      title={existing.filename}
                    >
                      {existing.filename}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={pending}
                      onClick={() => toggleRemove(existing.id)}
                    >
                      {going ? "Keep" : "Remove"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Field>
        ) : null}
        <Field label="Add a file">
          <FilePicker
            value={file}
            onChange={setFile}
            accept={ATTACHMENT_ACCEPT}
            validate={validateAttachmentFile}
            disabled={pending}
            hint={`${ATTACHMENT_LABEL}. Up to ${formatBytes(MAX_SIZE)}.`}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogActions
            onCancel={onClose}
            submitLabel={pending ? "Saving…" : "Save"}
            disabled={pending || !title.trim() || !assigneeId}
          />
        </div>
      </form>
    </FormDialog>
  );
}

/** Save an edit: the fields, then each removal, then the new file — one request each. */
export async function saveSubtaskEdit(
  subtask: Pick<Subtask, "id" | "taskId">,
  values: SubtaskEdit,
): Promise<Result> {
  const updated = await updateSubtaskAction({
    subtaskId: subtask.id,
    title: values.title,
    description: values.description,
    assigneeId: values.assigneeId,
  });
  if (!updated.ok) return updated;

  for (const id of values.removeFileIds) {
    const removed = await deleteAttachmentAction(id);
    if (!removed.ok) return { ok: false, error: `Saved, but a file was not removed: ${removed.error ?? "try again."}` };
  }

  if (values.file) {
    const form = new FormData();
    form.set("taskId", subtask.taskId);
    form.set("subtaskId", subtask.id);
    form.set("file", values.file);
    const uploaded = await uploadTaskFileAction(form);
    if (!uploaded.ok) return { ok: false, error: `Saved, but the file was not: ${uploaded.error ?? "upload failed."}` };
  }
  return { ok: true };
}

/** Name a new subtask to nest under `parentTitle`. Mounted only while open. */
export function AddSubtaskDialog({
  parentTitle,
  members,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  parentTitle: string;
  members: Person[];
  pending: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (values: NewSubtask) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const currentAssignee = null;
  const [file, setFile] = useState<File | null>(null);

  return (
    <FormDialog open onClose={onClose} title="Add subtask" description={`Under ${parentTitle}`}>
      <form
        className="grid gap-4 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = title.trim();
          if (trimmed && assigneeId) {
            onSubmit({ title: trimmed, description: description.trim(), assigneeId, file });
          }
        }}
      >
        <Field label="Title" required>
          <Input
            required
            autoFocus
            maxLength={200}
            value={title}
            disabled={pending}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="Description">
          <Textarea
            rows={3}
            maxLength={5000}
            value={description}
            disabled={pending}
            placeholder="What needs doing?"
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <AssigneeField
          value={assigneeId}
          current={currentAssignee}
          onChange={setAssigneeId}
          members={members}
          disabled={pending}
        />
        <Field label="File">
          <FilePicker
            value={file}
            onChange={setFile}
            accept={ATTACHMENT_ACCEPT}
            validate={validateAttachmentFile}
            disabled={pending}
            hint={`${ATTACHMENT_LABEL}. Up to ${formatBytes(MAX_SIZE)}.`}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogActions
            onCancel={onClose}
            submitLabel={pending ? "Saving…" : "Add subtask"}
            disabled={pending || !title.trim() || !assigneeId}
          />
        </div>
      </form>
    </FormDialog>
  );
}

export type NewSubtask = {
  title: string;
  description: string;
  /** Empty means nobody. */
  assigneeId: string;
  file: File | null;
};

/**
 * Create a subtask, then upload its file. Two requests because one file can
 * use the whole action body limit; a failed upload leaves the subtask in place
 * and says so, rather than pretending nothing was saved.
 */
export async function createSubtaskWithFile(
  taskId: string,
  parentId: string | null,
  values: NewSubtask,
): Promise<Result> {
  const created = await createSubtaskAction({
    taskId,
    parentId,
    title: values.title,
    description: values.description,
    assigneeId: values.assigneeId,
  });
  if (!created.ok || !created.id || !values.file) return created;

  const form = new FormData();
  form.set("taskId", taskId);
  form.set("subtaskId", created.id);
  form.set("file", values.file);
  const uploaded = await uploadTaskFileAction(form);
  return uploaded.ok
    ? uploaded
    : { ok: false, error: `Subtask added, but the file was not: ${uploaded.error ?? "upload failed."}` };
}

/**
 * Logged time against estimate. On a branch the figures are the whole branch's;
 * the node's own share shows on hover. A running timer shows its live clock.
 */
function SubtaskTime({
  node,
  timing,
  running,
}: {
  node: SubtaskNode;
  timing: boolean;
  running: RunningTimer | null;
}) {
  const elapsed = useElapsed(
    timing && running ? running.startedAt : null,
    timing ? (running?.pausedAt ?? null) : null,
  );
  const { trackedMinutes, estimateMinutes } = node.rollup;
  const over = estimateMinutes > 0 && trackedMinutes > estimateMinutes;

  if (timing) {
    return (
      <span
        className="shrink-0 font-mono tabular-nums text-success"
        aria-hidden
      >
        {formatClock(elapsed)}
      </span>
    );
  }

  if (!trackedMinutes && !estimateMinutes) return null;

  return (
    <span
      className="shrink-0 font-mono tabular-nums"
      title={
        node.children.length
          ? `Branch total. ${formatMinutes(node.trackedMinutes)} logged on this subtask itself.`
          : undefined
      }
    >
      <span className={over ? "text-destructive" : undefined}>
        {formatMinutes(trackedMinutes)}
      </span>
      {estimateMinutes ? ` / ${formatMinutes(estimateMinutes)}` : null}
    </span>
  );
}

/** Non-breaking spaces, so the indent survives inside a select option. */
const INDENT = String.fromCharCode(160).repeat(2);

/**
 * Every subtask as a pickable option, indented by depth — what the time-entry
 * form uses to put an entry on a subtask.
 */
export function subtaskOptions(subtasks: Subtask[]) {
  return flattenTree(buildSubtaskTree(subtasks)).map((node) => ({
    value: node.id,
    label: `${INDENT.repeat(node.depth)}${node.title}`,
  }));
}
