"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useElapsed } from "@/hooks/use-elapsed";
import { formatClock } from "@/lib/duration";
import { pauseTimerAction, resumeTimerAction, stopTimerAction } from "@/lib/task-actions";
import type { RunningTimer } from "@/lib/domain";

/**
 * The running timer, in the app header.
 *
 * Rendered on every page so a timer left running is visible from wherever the
 * person wandered off to — the failure mode this prevents is a timer running
 * all night on a task nobody is looking at. Stopping is one click from here,
 * and the task title links back to where it came from.
 */
export function GlobalTimerIndicator({
  running,
  canLog,
}: {
  running: RunningTimer | null;
  /**
   * `time.log`, resolved on the server. Pause, stop and resume are all
   * `time.log` actions, so the control is hidden without it rather than
   * offering three buttons that fail on click — the same rule
   * `TimerControls` applies on the task screen.
   *
   * It only bites when the permission was taken away while a timer was
   * already running, which is exactly the case where a stale control is
   * most confusing.
   */
  canLog: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const elapsed = useElapsed(running?.startedAt ?? null, running?.pausedAt ?? null);

  if (!running || !canLog) return null;
  const paused = Boolean(running.pausedAt);

  function act(action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const result = await action();

      if (!result.ok) {
        toast.error(result.error ?? "That did not work.");
        return;
      }

      // Ok with a message: the run was under a minute and nothing was logged.
      if (result.error) toast.warning(result.error);
      else toast.success(done);

      router.refresh();
    });
  }

  return (
    <div
      className={
        paused
          ? "flex min-w-0 items-center gap-2 rounded-full border bg-warning/10 py-1 pl-3 pr-1 text-sm"
          : "flex min-w-0 items-center gap-2 rounded-full border bg-success/10 py-1 pl-3 pr-1 text-sm"
      }
    >
      {paused ? (
        <Pause className="h-3 w-3 shrink-0 text-warning" aria-hidden />
      ) : (
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
      )}

      <span className="font-mono tabular-nums" aria-hidden>
        {formatClock(elapsed)}
      </span>

      <Link
        href={`/projects/project/${running.projectId}/tasks/${running.taskId}`}
        className="hidden max-w-[16rem] truncate text-muted-foreground hover:text-foreground sm:block"
      >
        {running.taskTitle}
        {running.subtaskTitle ? ` › ${running.subtaskTitle}` : null}
      </Link>

      {paused ? (
        <Button
          variant="ghost"
          size="icon"
          disabled={pending}
          aria-label={`Resume the timer on ${running.taskTitle}`}
          onClick={() => act(resumeTimerAction, "Timer resumed.")}
        >
          <Play className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          disabled={pending}
          aria-label={`Pause the timer on ${running.taskTitle}`}
          onClick={() => act(pauseTimerAction, "Timer paused.")}
        >
          <Pause className="h-3.5 w-3.5" />
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label={`Stop the timer on ${running.taskTitle}`}
        onClick={() => act(stopTimerAction, "Timer stopped and logged.")}
      >
        <Square className="h-3.5 w-3.5" />
      </Button>

      {/* The clock itself is aria-hidden — announcing it every second would be
          unusable — so this carries the state change instead. */}
      <span role="status" aria-live="polite" className="sr-only">
        {/* State only; the outcome is carried by the toast. */}
        {`Timer ${paused ? "paused" : "running"} on ${running.taskTitle}.`}
      </span>
    </div>
  );
}
