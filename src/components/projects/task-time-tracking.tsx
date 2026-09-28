"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleAlert, Pencil, Plus, Trash2 } from "lucide-react";
import { subtaskOptions } from "@/components/projects/task-subtasks";
import { TimerControls } from "@/components/projects/timer-controls";
import {
  TimeEntryForm,
  type TimeEntryDraft,
} from "@/components/projects/time-entry-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UserAvatar } from "@/components/ui/user-avatar";
import { formatDay } from "@/lib/domain";
import { formatMinutes, formatStamp, formatTime } from "@/lib/duration";
import {
  addTimeEntryAction,
  deleteTimeEntryAction,
  updateTimeEntryAction,
} from "@/lib/task-actions";
import { subtaskPath } from "@/lib/subtask-tree";
import type { RunningTimer, Subtask, TaskEntry } from "@/lib/domain";

/**
 * The time-tracking section of a task: the timer, the total, and every entry.
 *
 * Deleting is optimistic — the row leaves immediately and the total drops with
 * it — because the alternative is a list that sits unchanged for a round trip
 * after a click that looks instantaneous. A rejected delete puts the row back
 * when the refreshed server data arrives, and the error says why.
 */
export function TaskTimeTracking({
  taskId,
  taskTitle,
  entries,
  subtasks,
  running,
  viewerId,
  canLog,
  canManageAny,
}: {
  taskId: string;
  taskTitle: string;
  entries: TaskEntry[];
  /** The task's subtasks, so an entry can name — and be put on — one. */
  subtasks: Subtask[];
  /** The viewer's running timer, on this task or another. */
  running: RunningTimer | null;
  viewerId: string;
  /** `time.log` — may track and add their own time. */
  canLog: boolean;
  /** `time.manage` — may edit and delete other people's entries too. */
  canManageAny: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TaskEntry | null>(null);
  const [removing, setRemoving] = useState<TaskEntry | null>(null);

  const [visible, removeOptimistically] = useOptimistic(entries, (current, id: string) =>
    current.filter((entry) => entry.id !== id),
  );

  const totalMinutes = visible.reduce((sum, entry) => sum + Math.round(entry.hours * 60), 0);
  const options = useMemo(() => subtaskOptions(subtasks), [subtasks]);
  const mayChange = (entry: TaskEntry) => canManageAny || entry.userId === viewerId;

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

  function submit(draft: TimeEntryDraft) {
    if (editing) {
      run(() => updateTimeEntryAction({ ...draft, entryId: editing.id }), () => setEditing(null));
    } else {
      run(() => addTimeEntryAction({ ...draft, taskId }), () => setAdding(false));
    }
  }

  return (
    <Card className="shadow-none">
      <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="flex items-center gap-2">
          Time
          <Badge variant="secondary" className="font-mono">
            {formatMinutes(totalMinutes)}
          </Badge>
        </CardTitle>
        {canLog ? (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} disabled={pending}>
            <Plus className="h-4 w-4" />
            Add time
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        <TimerControls
          taskId={taskId}
          taskTitle={taskTitle}
          running={running}
          canLog={canLog}
          className="rounded-md border bg-muted/30 p-3"
        />

        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}

        {visible.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No time logged yet.
          </p>
        ) : (
          <ul className="divide-y">
            {visible.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <UserAvatar
                  name={entry.user.name}
                  className="h-7 w-7 bg-primary/10"
                  textClassName="text-[10px] text-primary"
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    <span className="font-medium">{entry.user.name.split(" ")[0]}</span>
                    {entry.note ? (
                      <span className="text-muted-foreground"> — {entry.note}</span>
                    ) : null}
                  </p>
                  {entry.subtaskId && subtasks.some((item) => item.id === entry.subtaskId) ? (
                    <p className="truncate text-xs text-muted-foreground">
                      on {subtaskPath(subtasks, entry.subtaskId)}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {/* A timed entry can say when; a duration-only one can only
                        say which day, so it does not pretend otherwise. */}
                    {entry.startedAt && entry.endedAt
                      ? `${formatStamp(entry.startedAt)} – ${formatTime(entry.endedAt)}`
                      : formatDay(entry.date)}
                  </p>
                </div>

                <span className="font-mono text-sm tabular-nums">
                  {formatMinutes(Math.round(entry.hours * 60))}
                </span>

                {mayChange(entry) ? (
                  <span className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      aria-label={`Edit ${entry.user.name}'s entry`}
                      onClick={() => setEditing(entry)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      aria-label={`Delete ${entry.user.name}'s entry`}
                      onClick={() => setRemoving(entry)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {adding || editing ? (
        <TimeEntryForm
          // Remounts between add and edit so the fields reset to the right
          // starting values rather than keeping the previous entry's.
          key={editing?.id ?? "new"}
          open
          entry={editing ?? undefined}
          pending={pending}
          error={error}
          subtasks={options}
          onClose={() => {
            setAdding(false);
            setEditing(null);
            setError(null);
          }}
          onSubmit={submit}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const entry = removing;
          if (!entry) return;
          setRemoving(null);
          setError(null);
          startTransition(async () => {
            removeOptimistically(entry.id);
            const result = await deleteTimeEntryAction(entry.id);
            if (!result.ok) {
              setError(result.error ?? "Could not delete that entry.");
              return;
            }

            toast.success("Time entry deleted");
            router.refresh();
          });
        }}
        title="Delete this time entry?"
        description={
          removing
            ? `${formatMinutes(Math.round(removing.hours * 60))} logged by ${removing.user.name} will be removed from every total and report. This cannot be undone.`
            : ""
        }
      />
    </Card>
  );
}
