"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EventDialog,
  type EventDialogProject,
} from "@/components/projects/event-dialog";
import { getMonthGrid } from "@/lib/domain";
import type { CalendarEvent, Member, Task } from "@/lib/domain";
import { taskStatusColor } from "@/lib/status";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The month grid: task deadlines and calendar events on the same squares.
 *
 * A client component because the day dialog is opened here.
 *
 * The month lives in the URL rather than in local state: the page fetches
 * exactly the month it is asked for, so paging has to reach the server or the
 * grid would draw an empty month whose events were simply never loaded.
 * `?month=` is the same pattern the project tasks screen uses for `?board=`.
 */
export function CalendarView({
  month,
  today,
  tasks,
  events,
  projects,
  members,
  projectNames,
  canManageEvents,
}: {
  /** The month being shown, as an ISO day on its 1st — what the page fetched for. */
  month: string;
  /** The server's idea of today, so the highlight does not depend on the browser. */
  today: string;
  tasks: Task[];
  events: CalendarEvent[];
  projects: EventDialogProject[];
  members: Member[];
  /** Project id to name, for the deadline tooltips. */
  projectNames: Record<string, string>;
  canManageEvents: boolean;
}) {
  const router = useRouter();
  const [paging, startPaging] = useTransition();
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);

  const { cells, label } = getMonthGrid(month);

  /** Step a whole month, landing on the 1st so a short month cannot overshoot. */
  function stepMonth(delta: -1 | 1) {
    const [year, monthNumber] = month.split("-").map(Number);
    const moved = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
    goTo(moved.toISOString().slice(0, 7));
  }

  function goTo(yearMonth: string) {
    // A transition rather than a bare push, so the grid keeps showing the old
    // month while the new one loads instead of flashing empty.
    startPaging(() => router.push(`/projects/calendar?month=${yearMonth}`, { scroll: false }));
  }

  function openDate(date: string) {
    if (!canManageEvents) return;
    setEditing(null);
    setOpenDay(date);
  }

  function openEvent(calendarEvent: CalendarEvent) {
    if (!canManageEvents) return;
    setEditing(calendarEvent);
    setOpenDay(calendarEvent.date);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold leading-tight tracking-tight">Calendar</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {label} — task deadlines and events
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Previous month"
              disabled={paging}
              onClick={() => stepMonth(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={paging}
              onClick={() => goTo(today.slice(0, 7))}
            >
              Today
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Next month"
              disabled={paging}
              onClick={() => stepMonth(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {canManageEvents ? (
            <Button type="button" size="sm" onClick={() => openDate(today)}>
              <CalendarPlus className="h-4 w-4" />
              New event
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-border">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="bg-muted p-2 text-center text-xs font-medium text-muted-foreground"
          >
            {day}
          </div>
        ))}

        {cells.map((date, index) => {
          const due = date ? tasks.filter((task) => task.dueDate === date) : [];
          const onDay = date ? events.filter((item) => item.date === date) : [];

          return (
            <div
              key={date ?? `empty-${index}`}
              className={cn(
                "min-h-[104px] bg-card p-2",
                date === today && "bg-primary/5 ring-1 ring-inset ring-primary/30",
              )}
            >
              {date ? (
                <>
                  {/*
                    The day number is the click target rather than the whole
                    cell: the cell also holds task links and event buttons, and
                    a wrapping button would swallow their clicks.
                  */}
                  {canManageEvents ? (
                    <button
                      type="button"
                      onClick={() => openDate(date)}
                      aria-label={`Add an event on ${date}`}
                      className="rounded px-1 font-mono text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {Number(date.slice(8))}
                    </button>
                  ) : (
                    <span className="px-1 font-mono text-xs font-medium text-muted-foreground">
                      {Number(date.slice(8))}
                    </span>
                  )}

                  <div className="mt-1 space-y-0.5">
                    {onDay.map((item) => {
                      const time = item.startTime ? `${item.startTime} · ` : "";
                      const summary = `${time}${item.title}${
                        item.attendees.length > 0 ? ` · ${item.attendees.length} invited` : ""
                      }`;

                      return canManageEvents ? (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => openEvent(item)}
                          title={summary}
                          className="flex w-full items-center gap-1 rounded bg-primary/10 px-1 py-0.5 text-left text-[11px] text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          <span className="truncate">
                            {item.startTime ? (
                              <span className="font-mono">{item.startTime} </span>
                            ) : null}
                            {item.title}
                          </span>
                        </button>
                      ) : (
                        <span
                          key={item.id}
                          title={summary}
                          className="flex items-center gap-1 rounded bg-primary/10 px-1 py-0.5 text-[11px] text-primary"
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          <span className="truncate">
                            {item.startTime ? (
                              <span className="font-mono">{item.startTime} </span>
                            ) : null}
                            {item.title}
                          </span>
                        </span>
                      );
                    })}

                    {due.map((task) => (
                      <Link
                        key={task.id}
                        href={`/projects/project/${task.projectId}`}
                        title={`${task.title} · ${projectNames[task.projectId] ?? ""}`}
                        className="flex items-center gap-1 rounded bg-muted/60 px-1 py-0.5 text-[11px] hover:underline"
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: taskStatusColor[task.status] }}
                        />
                        <span className="truncate">{task.title}</span>
                      </Link>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      {canManageEvents ? (
        <EventDialog
          // Remounts when the dialog is pointed at a different day or event, which
          // is what reseeds its draft — see the note on `draft` there.
          key={`${openDay ?? "closed"}:${editing?.id ?? "new"}`}
          open={openDay !== null}
          onClose={() => {
            setOpenDay(null);
            setEditing(null);
          }}
          date={openDay ?? today}
          event={editing}
          projects={projects}
          members={members}
          canDelete={canManageEvents}
        />
      ) : null}
    </div>
  );
}
