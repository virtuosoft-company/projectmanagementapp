import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getMonthGrid, WEEKDAYS_SUNDAY_FIRST } from "@/lib/domain";
import {
  minutesOfDay,
  verdictFor,
  verdictLabel,
  workedMinutes,
  type AttendanceDay,
  type AttendanceVerdict,
  type SchedulePolicy,
  type Weekday,
} from "@/lib/attendance";
import { formatMinutes } from "@/lib/duration";
import type { AttendanceRecord } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * A month of one person's attendance.
 *
 * Server-rendered: stepping months is a link, not state, so the whole screen
 * stays a server component and a shared URL opens the month it names.
 *
 * The day cell is the design decision here. The system this replaces painted
 * each day a full-width colour bar captioned "LATE - IN: 10:07 / OUT: 19:3" —
 * colour carried the verdict and the text ran out of room, so the times, which
 * are the actual information, were the part that got cut. Here the times are
 * plain text and the bar underneath them is a scale drawing of the day: the
 * track spans the scheduled hours, the fill is time actually present, and a
 * hairline marks the hour work was due to start. A 10:01 arrival and an 11:03
 * arrival are both "late" but they do not look alike, which is the difference
 * a month view exists to show.
 */

/** Where a wall-clock time sits across the scheduled day, as a percentage. */
function positionIn(window: { start: number; end: number }, time: number): number {
  const span = window.end - window.start;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(100, ((time - window.start) / span) * 100));
}

function DayTrack({
  day,
  policy,
  verdict,
}: {
  day: AttendanceDay;
  policy: SchedulePolicy;
  verdict: AttendanceVerdict;
}) {
  const start = minutesOfDay(policy.startsAt);
  const end = minutesOfDay(policy.endsAt);
  const checkIn = minutesOfDay(day.checkIn);
  if (start === null || end === null || checkIn === null) return null;

  // An open day is drawn to the scheduled end rather than to "now": the server
  // renders this, and a clock that only advances when somebody reloads is a
  // worse lie than a span that plainly shows the expected finish.
  const checkOut = minutesOfDay(day.checkOut) ?? end;
  const window = { start: Math.min(start, checkIn), end: Math.max(end, checkOut) };

  const left = positionIn(window, checkIn);
  const right = positionIn(window, checkOut);
  const dueAt = positionIn(window, start);

  return (
    <div className="relative mt-1.5 h-1 w-full rounded-full bg-muted" aria-hidden>
      <div
        className={cn(
          "absolute inset-y-0 rounded-full",
          verdict === "late" && "bg-warning",
          verdict === "on-time" && "bg-success",
          verdict === "remote" && "bg-muted-foreground/50",
        )}
        style={{ left: `${left}%`, width: `${Math.max(right - left, 2)}%` }}
      />
      {/* The hour work was due to start. Lateness is the gap to the left of it. */}
      <div
        className="absolute inset-y-[-2px] w-px bg-foreground/40"
        style={{ left: `${dueAt}%` }}
      />
    </div>
  );
}

function DayCell({
  iso,
  record,
  policy,
  today,
}: {
  iso: string;
  record: AttendanceRecord | undefined;
  policy: SchedulePolicy | null;
  today: string;
}) {
  const isToday = iso === today;
  const weekday = ((new Date(`${iso}T00:00:00.000Z`).getUTCDay() + 6) % 7 + 1) as Weekday;
  const dayNumber = Number(iso.slice(8, 10));

  // No schedule covers this date — somebody hired later, or an unassigned
  // person. The day is drawn blank rather than guessed at: calling it an
  // absence would accuse somebody of missing a day they were never rostered.
  if (!policy) {
    return (
      <div className="min-h-20 bg-card p-2">
        <span className="text-xs text-muted-foreground/60">{dayNumber}</span>
      </div>
    );
  }

  const day: AttendanceDay | null = record
    ? { checkIn: record.checkIn, checkOut: record.checkOut, source: record.source }
    : null;
  // Lexicographic on ISO dates is chronological, and today is not past: a
  // morning somebody has not checked in to yet is still theirs to attend.
  const verdict = verdictFor({ day, policy, weekday, isPast: iso < today });
  const worked = day ? workedMinutes(day) : null;

  const label = verdictLabel(verdict);
  const times = day?.checkIn ? `${day.checkIn} – ${day.checkOut ?? "now"}` : null;

  return (
    <div
      className={cn(
        "min-h-20 bg-card p-2",
        verdict === "not-working" && "bg-muted/40",
        isToday && "ring-1 ring-inset ring-primary",
      )}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span
          className={cn(
            "text-xs",
            isToday ? "font-semibold text-primary" : "text-muted-foreground",
          )}
        >
          {dayNumber}
        </span>
        {/*
          The verdict is written out only when it is an exception. A present
          day is self-evident from its times, and labelling every one of them
          "Present" turns twenty ordinary mornings into twenty announcements.
          The full verdict stays available to a screen reader below.
        */}
        {verdict === "late" || verdict === "absent" || verdict === "remote" ? (
          <span
            className={cn(
              "text-[11px] font-medium",
              verdict === "late" && "text-warning",
              verdict === "absent" && "text-destructive",
              verdict === "remote" && "text-muted-foreground",
            )}
          >
            {label}
          </span>
        ) : null}
      </div>

      {times ? (
        <p className="mt-1 font-mono text-[11px] tabular-nums text-foreground">{times}</p>
      ) : null}

      {day ? <DayTrack day={day} policy={policy} verdict={verdict} /> : null}

      {worked !== null ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{formatMinutes(worked)}</p>
      ) : null}

      <span className="sr-only">
        {label}
        {times ? `, ${times}` : ""}
      </span>
    </div>
  );
}

export function AttendanceCalendar({
  month,
  records,
  policyFor,
  today,
  subjectName,
}: {
  /** First of the month, `YYYY-MM-01`. */
  month: string;
  records: AttendanceRecord[];
  /** The schedule in force on a given day, or null when none covers it. */
  policyFor: (iso: string) => SchedulePolicy | null;
  today: string;
  /** Whose month this is, when it is not the viewer's own. */
  subjectName?: string;
}) {
  const { cells, label } = getMonthGrid(month);
  const byDate = new Map(records.map((record) => [record.date, record]));

  const [year, monthNumber] = month.split("-").map(Number);
  const step = (delta: -1 | 1) => {
    const next = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
    return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
  };

  return (
    <Card className="shadow-none">
      <CardContent className="p-4">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold leading-tight">{label}</h2>
            {subjectName ? (
              <p className="text-sm text-muted-foreground">{subjectName}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <Link
              href={`/attendance?month=${step(-1)}`}
              aria-label="Previous month"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <Link
              href={`/attendance?month=${step(1)}`}
              aria-label="Next month"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-border">
          {WEEKDAYS_SUNDAY_FIRST.map((weekday) => (
            <div
              key={weekday}
              className="bg-muted p-2 text-center text-xs font-medium text-muted-foreground"
            >
              {weekday}
            </div>
          ))}

          {cells.map((iso, index) =>
            iso ? (
              <DayCell
                key={iso}
                iso={iso}
                record={byDate.get(iso)}
                policy={policyFor(iso)}
                today={today}
              />
            ) : (
              <div key={`blank-${index}`} className="min-h-20 bg-muted/30" />
            ),
          )}
        </div>
      </CardContent>
    </Card>
  );
}
