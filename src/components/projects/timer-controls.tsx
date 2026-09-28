"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pause, Play, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { useElapsed } from "@/hooks/use-elapsed";
import { formatClock } from "@/lib/duration";
import {
  discardTimerAction,
  pauseTimerAction,
  resumeTimerAction,
  startTimerAction,
  stopTimerAction,
} from "@/lib/task-actions";
import type { RunningTimer } from "@/lib/domain";
import { cn } from "@/lib/utils";

/**
 * Start / stop the timer for one task.
 *
 * `running` is the viewer's timer wherever it happens to be, not just this
 * task's, so the control can say what starting here would interrupt. Only one
 * timer exists per person — starting a second stops and saves the first — and
 * showing that before the click is the difference between the rule feeling
 * deliberate and feeling like lost work.
 *
 * The elapsed figure is derived from `startedAt`, so a refresh mid-run resumes
 * at the right number instead of starting over.
 */
export function TimerControls({
  taskId,
  taskTitle,
  subtaskId = null,
  subtaskTitle = null,
  running,
  canLog,
  className,
}: {
  taskId: string;
  taskTitle: string;
  /** Time one subtask of the task instead of the task as a whole. */
  subtaskId?: string | null;
  subtaskTitle?: string | null;
  /** The viewer's running timer, on this task or another. */
  running: RunningTimer | null;
  /** `time.log`. Without it the controls are not rendered at all. */
  canLog: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // For a subtask, only a timer on that subtask is "this one"; for the task,
  // any timer running on it is.
  const isThisTask =
    running !== null &&
    (subtaskId ? running.subtaskId === subtaskId : running.taskId === taskId);
  const target = subtaskTitle ?? taskTitle;
  const elapsed = useElapsed(isThisTask ? running.startedAt : null, running?.pausedAt ?? null);
  const paused = Boolean(isThisTask && running?.pausedAt);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done?: string) {
    startTransition(async () => {
      const result = await action();

      if (!result.ok) {
        toast.error(result.error ?? "That did not work.");
        return;
      }

      // `stopTimerAction` reports a discarded sub-minute run as ok-with-a-note.
      if (result.error) toast.warning(result.error);
      else if (done) toast.success(done);

      router.refresh();
    });
  }

  if (!canLog) return null;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-3">
        {isThisTask ? (
          <>
            <span
              className="font-mono text-2xl font-bold tabular-nums"
              // Announced as it changes would be unbearable once a second; the
              // start/stop messages below carry the state change instead.
              aria-hidden
            >
              {formatClock(elapsed)}
            </span>
            <span
              className={cn(
                "flex items-center gap-1.5 text-xs",
                paused ? "text-warning" : "text-success",
              )}
            >
              {paused ? (
                <Pause className="h-3 w-3" aria-hidden />
              ) : (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                </span>
              )}
              {paused ? "Paused" : "Running"}
              {running.subtaskTitle ? (
                <span className="text-muted-foreground">on {running.subtaskTitle}</span>
              ) : null}
            </span>

            {paused ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(resumeTimerAction, "Timer resumed.")}
              >
                <Play className="h-4 w-4" />
                Resume
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(pauseTimerAction, "Timer paused.")}
              >
                <Pause className="h-4 w-4" />
                Pause
              </Button>
            )}
            <Button size="sm" disabled={pending} onClick={() => run(stopTimerAction, "Timer stopped and logged.")}>
              <Square className="h-4 w-4" />
              {pending ? "Stopping…" : "Stop"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => run(discardTimerAction, "Timer discarded — nothing logged.")}
            >
              <Trash2 className="h-4 w-4" />
              Discard
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(
                () => startTimerAction({ taskId, subtaskId, note: "" }),
                running ? `Stopped ${running.subtaskTitle ?? running.taskTitle} and started ${target}.` : "Timer started.",
              )
            }
          >
            <Play className="h-4 w-4" />
            {pending ? "Starting…" : "Start timer"}
          </Button>
        )}
      </div>

      {running && !isThisTask ? (
        <p className="text-xs text-muted-foreground">
          Timing <span className="font-medium">{running.subtaskTitle ?? running.taskTitle}</span> —
          starting here stops that one and saves it.
        </p>
      ) : null}

      {/* The live region is what a screen reader gets instead of the ticking
          clock: one announcement per state change, not one per second. */}
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {/* State only; the outcome is carried by the toast. */}
        {isThisTask ? (paused ? "Timer paused." : "Timer running.") : ""}
      </p>
    </div>
  );
}

/**
 * The timer for one task or subtask, in a dialog — what "Start timer" opens
 * from a board card or a subtask. Starting is still a deliberate click inside
 * it, so the dialog can first say what a timer running elsewhere would lose.
 */
export function TimerDialog({
  open,
  onClose,
  taskId,
  taskTitle,
  subtaskId = null,
  subtaskTitle = null,
  running,
}: {
  open: boolean;
  onClose: () => void;
  taskId: string;
  taskTitle: string;
  subtaskId?: string | null;
  subtaskTitle?: string | null;
  running: RunningTimer | null;
}) {
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={subtaskTitle ?? taskTitle}
      description={subtaskTitle ? `Subtask of ${taskTitle}` : "Track time on this task."}
    >
      <TimerControls
        className="py-2"
        taskId={taskId}
        taskTitle={taskTitle}
        subtaskId={subtaskId}
        subtaskTitle={subtaskTitle}
        running={running}
        canLog
      />
    </FormDialog>
  );
}
