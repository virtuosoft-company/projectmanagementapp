"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pause, Play, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { useElapsed } from "@/hooks/use-elapsed";
import { formatClock, formatMinutes } from "@/lib/duration";
import {
  discardTimerAction,
  pauseTimerAction,
  resumeTimerAction,
  startTimerAction,
  stopTimerAction,
} from "@/lib/task-actions";
import type { RunningTimer } from "@/lib/domain";

/**
 * The timer card on the time-tracking screen.
 *
 * The running timer lives in the database, not in this component: the elapsed
 * figure is derived from `startedAt`, so a refresh, a navigation or a second
 * tab all show the same number, and closing the browser mid-run no longer
 * throws the time away. It used to count seconds locally, which meant exactly
 * those three things lost work.
 *
 * Stopping writes a real `TimeEntry` — the same row the manual "Log Time"
 * dialog produces — so tracked and typed time are indistinguishable afterwards.
 */
export function ActiveTimer({
  userName,
  tasks,
  running,
  todayMinutes,
  weekMinutes,
  canLog,
}: {
  userName: string;
  tasks: { id: string; label: string }[];
  /** The viewer's running timer, if they have one. */
  running: RunningTimer | null;
  /** This person's own logged time, for the summary line. */
  todayMinutes: number;
  weekMinutes: number;
  /**
   * `time.log`. The card is nothing but timer controls, so without it there is
   * nothing here to show read-only.
   *
   * It used to rely on the page gate, which asked for `time.log` directly.
   * Time Tracking is now a page an admin assigns per role, so reaching the
   * screen no longer implies the permission and the card has to ask.
   */
  canLog: boolean;
}) {
  const router = useRouter();
  const [taskId, setTaskId] = useState("");
  const [pending, startSaving] = useTransition();

  const elapsed = useElapsed(running?.startedAt ?? null, running?.pausedAt ?? null);
  const paused = Boolean(running?.pausedAt);

  if (!canLog) return null;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    startSaving(async () => {
      const result = await action();

      if (!result.ok) {
        toast.error(result.error ?? "That did not work.");
        return;
      }

      // Ok *with* a message means the run was too short to log. Reporting that
      // as a success would claim time was recorded when it was discarded.
      if (result.error) toast.warning(result.error);
      else toast.success(done);

      router.refresh();
    });
  }

  return (
    <Card className="border-2 border-primary/20 shadow-none">
      <CardContent className="space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold">Active Timer</h2>
          <p className="text-xs text-muted-foreground">Tracking as {userName}</p>
        </div>

        {running ? (
          <p className="text-center text-sm">
            <Link
              href={`/projects/project/${running.projectId}/tasks/${running.taskId}`}
              className="font-medium hover:underline"
            >
              {running.taskTitle}
            </Link>
            <span className="block text-xs text-muted-foreground">
              {running.subtaskTitle ? `${running.subtaskTitle} · ` : null}
              {running.projectName}
            </span>
          </p>
        ) : (
          <SelectField
            value={taskId}
            onValueChange={setTaskId}
            placeholder="Select a task to track…"
            aria-label="Task to track"
            options={tasks.map((task) => ({ value: task.id, label: task.label }))}
          />
        )}

        <p className="text-center font-mono text-4xl font-bold tracking-wider" aria-hidden>
          {formatClock(running ? elapsed : 0)}
        </p>

        <div className="flex items-center justify-center gap-2">
          {running ? (
            <>
              {paused ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(resumeTimerAction, "Resumed.")}
                >
                  <Play className="h-4 w-4" />
                  Resume
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(pauseTimerAction, "Paused.")}
                >
                  <Pause className="h-4 w-4" />
                  Pause
                </Button>
              )}
              <Button
                size="sm"
                disabled={pending}
                onClick={() => run(stopTimerAction, "Stopped and logged.")}
              >
                <Square className="h-4 w-4" />
                {pending ? "Saving…" : "Stop & log"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => run(discardTimerAction, "Discarded — nothing logged.")}
              >
                <Trash2 className="h-4 w-4" />
                Discard
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={!taskId || pending}
              onClick={() => run(() => startTimerAction({ taskId, note: "" }), "Timer started.")}
            >
              <Play className="h-4 w-4" />
              {pending ? "Starting…" : "Start"}
            </Button>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          You have logged <span className="font-mono">{formatMinutes(todayMinutes)}</span> today
          and <span className="font-mono">{formatMinutes(weekMinutes)}</span> this week.
        </p>

        {/* The clock is aria-hidden — a per-second announcement is unusable —
            so state changes are announced here instead. */}
        <p role="status" aria-live="polite" className="text-center text-xs text-muted-foreground">
          {/*
            State only. What just happened is carried by the toast, which sonner
            renders in its own live region — so the outcome is still announced.
          */}
          {running ? `${paused ? "Paused on" : "Timing"} ${running.taskTitle}.` : ""}
        </p>
      </CardContent>
    </Card>
  );
}
