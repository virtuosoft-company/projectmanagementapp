/**
 * Attendance: reading a verdict off a recorded day.
 *
 * Pure throughout — no database, no `server-only` — so the rules that decide
 * whether somebody was late can be exercised without either. Everything that
 * reads or writes rows lives elsewhere; this module only interprets them.
 *
 * The central decision: **nothing here is stored.** `Attendance` records what
 * happened (a check-in time, a check-out time, where the row came from) and
 * `WorkSchedule` records what was expected. Late, absent, short-day and on-time
 * are read off the pair, every time they are needed.
 *
 * Storing the verdict instead would mean an office moving its start time from
 * 10:00 to 09:30 either rewrites six months of history or leaves two
 * contradictory meanings of "LATE" in the same table. Dating the schedule and
 * deriving the verdict keeps yesterday's mornings judged by yesterday's rules.
 */

/** ISO weekday, Monday 1 through Sunday 7 — the shape `WorkSchedule` stores. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * What a day turned out to be.
 *
 * `absent` is the one that has to be inferred rather than observed: there is no
 * row for a day nobody attended, so it is the absence of a record on a day that
 * expected one. That makes it the only verdict that can be wrong because
 * something else is missing — an unimported device log reads exactly like a
 * day off work.
 */
export type AttendanceVerdict =
  | "on-time"
  | "late"
  | "remote"
  | "absent"
  | "not-working"
  | "holiday"
  /**
   * A working day that has not finished yet — today, or anything after it.
   *
   * Distinct from `absent`, which is a judgement about a day that is over.
   * Without this, opening a month showed every remaining working day in it as
   * an absence: a calendar accusing somebody of missing nine days they have
   * not yet had the chance to attend.
   */
  | "upcoming";

/** The schedule fields the verdict depends on, as plain data. */
export interface SchedulePolicy {
  /** Local wall-clock "HH:MM". */
  startsAt: string;
  /** Local wall-clock "HH:MM". */
  endsAt: string;
  /** Minutes after `startsAt` that still count as on time. */
  graceMinutes: number;
  workingDays: Weekday[];
}

/** The recorded half, as plain data. */
export interface AttendanceDay {
  /** Local wall-clock "HH:MM", or null when nobody checked in. */
  checkIn: string | null;
  /** Local wall-clock "HH:MM", or null while they are still in. */
  checkOut: string | null;
  source: "DEVICE" | "REMOTE" | "CORRECTION";
}

/**
 * Minutes since midnight for "HH:MM", or null when it is not that.
 *
 * Returns null rather than NaN or a throw: these strings come from a schedule
 * row and, for imported days, from whatever the device wrote. A malformed one
 * must not take a page down, and null flows into `verdictFor` as "unknown",
 * which is honest.
 */
export function minutesOfDay(time: string | null | undefined): number | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** "HH:MM" for minutes since midnight. The inverse of `minutesOfDay`. */
export function timeOfDay(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** Whether `weekday` is one this schedule expects to be worked. */
export function isWorkingDay(policy: SchedulePolicy, weekday: Weekday): boolean {
  return policy.workingDays.includes(weekday);
}

/**
 * What a single day amounts to.
 *
 * Order matters and is not arbitrary:
 *
 * 1. **A holiday beats everything**, including a day somebody worked. Coming in
 *    on a public holiday is not what made the day a holiday.
 * 2. **A record beats the calendar.** Somebody who checked in on a Saturday was
 *    at work; calling that "not-working" because the schedule says so would
 *    discard a fact in favour of an expectation.
 * 3. **Remote is its own answer**, never late. The hours on an approved
 *    work-from-home day are the hours the request asked for, not hours anybody
 *    measured, so holding them to a start time would be judging a number that
 *    was typed into a form.
 * 4. Only then does the clock decide, and only when there is a start time to
 *    compare against.
 */
export function verdictFor(args: {
  day: AttendanceDay | null;
  policy: SchedulePolicy;
  weekday: Weekday;
  isHoliday?: boolean;
  /**
   * Whether the day is over. Today is **not** past: somebody who has not
   * checked in by mid-morning has not missed the day yet.
   *
   * Defaults to true because every day with a record is necessarily one that
   * happened; a caller drawing a calendar has to say otherwise for the days
   * ahead of it.
   */
  isPast?: boolean;
}): AttendanceVerdict {
  const { day, policy, weekday, isHoliday = false, isPast = true } = args;

  if (isHoliday) return "holiday";
  if (!day) {
    if (!isWorkingDay(policy, weekday)) return "not-working";
    // A day that has not finished cannot have been missed.
    return isPast ? "absent" : "upcoming";
  }
  if (day.source === "REMOTE") return "remote";

  const checkIn = minutesOfDay(day.checkIn);
  const start = minutesOfDay(policy.startsAt);
  // No check-in, or a schedule with no readable start: there is a row, so the
  // person was not absent, but nothing here can call them late either.
  if (checkIn === null || start === null) return "on-time";

  return checkIn > start + policy.graceMinutes ? "late" : "on-time";
}

/**
 * Minutes between check-in and check-out, or null when the day is still open.
 *
 * A check-out before the check-in is treated as crossing midnight rather than
 * as bad data: a night shift that starts at 22:00 and ends at 06:00 is eight
 * hours, not minus sixteen. The alternative — refusing it — would make a whole
 * shift pattern unrecordable to avoid a case that cannot otherwise occur.
 */
export function workedMinutes(day: AttendanceDay): number | null {
  const start = minutesOfDay(day.checkIn);
  const end = minutesOfDay(day.checkOut);
  if (start === null || end === null) return null;
  return end >= start ? end - start : 24 * 60 - start + end;
}

/**
 * The schedule in force on `date`, from a person's schedules.
 *
 * The latest one that had started by then and had not already ended. Schedules
 * are dated rather than overwritten, so assigning somebody new hours tomorrow
 * leaves every morning they already worked judged by the hours that applied
 * then. Returns null when none covers the date — a person hired last month has
 * no schedule for last year, and no verdict should be invented for it.
 */
export function scheduleOn<T extends { effectiveFrom: Date; effectiveTo: Date | null }>(
  schedules: T[],
  date: Date,
): T | null {
  const applicable = schedules.filter(
    (schedule) =>
      schedule.effectiveFrom.getTime() <= date.getTime() &&
      (schedule.effectiveTo === null || schedule.effectiveTo.getTime() >= date.getTime()),
  );
  if (applicable.length === 0) return null;

  return applicable.reduce((latest, candidate) =>
    candidate.effectiveFrom.getTime() > latest.effectiveFrom.getTime() ? candidate : latest,
  );
}

/** Colour token per verdict, so the calendar and the tiles cannot disagree. */
export function verdictTone(verdict: AttendanceVerdict): "success" | "warning" | "muted" | "destructive" {
  switch (verdict) {
    case "on-time":
      return "success";
    case "late":
      return "warning";
    case "remote":
      return "muted";
    case "absent":
      return "destructive";
    // A day nobody was meant to work, and a public holiday, are both "nothing
    // to see" rather than something good or bad.
    default:
      return "muted";
  }
}

/**
 * Label per verdict.
 *
 * Every verdict gets one, including the quiet ones. The calendar prints this
 * visibly only for exceptions, but it reads it out to a screen reader on every
 * day — so "not-working" returning an empty string left a Saturday announced
 * as "Nothing scheduled", which is what an unrostered day says, not a weekend.
 */
export function verdictLabel(verdict: AttendanceVerdict): string {
  switch (verdict) {
    case "on-time":
      return "Present";
    case "late":
      return "Late";
    case "remote":
      return "WFH";
    case "absent":
      return "Absent";
    case "holiday":
      return "Holiday";
    case "not-working":
      return "Not a working day";
    case "upcoming":
      return "Upcoming";
    default:
      return "";
  }
}
