import type { Metadata } from "next";
import { AttendanceCalendar } from "@/components/attendance/attendance-calendar";
import { scheduleOn, type SchedulePolicy } from "@/lib/attendance";
import { todayIso } from "@/lib/domain";
import { getAttendanceMonth, getWorkSchedules } from "@/lib/queries";
import { attendanceScope, requirePage } from "@/lib/session";

export const metadata: Metadata = { title: "Attendance" };

/** The first and last day of the month containing `iso`. */
function monthBounds(iso: string) {
  const [year, month] = iso.split("-").map(Number);
  return {
    from: new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

/**
 * Normalises `?month=YYYY-MM` to the 1st of that month.
 *
 * Anything unparseable falls back to this month rather than erroring — the
 * same treatment the projects calendar gives a mistyped URL.
 */
function resolveMonth(requested: string | string[] | undefined, today: string): string {
  const value = typeof requested === "string" ? requested : "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return `${today.slice(0, 7)}-01`;
  return `${value}-01`;
}

/**
 * One person's attendance, a month at a time.
 *
 * Shows the viewer their own days. Whoever holds `attendance.manage` sees
 * everyone's, which this page does not yet let them pick between — that is the
 * employee picker, and it is the next piece rather than a hidden feature.
 */
export default async function AttendancePage({ searchParams }: PageProps<"/attendance">) {
  const viewer = await requirePage("attendance");
  const { month: requested } = await searchParams;

  const today = todayIso();
  const month = resolveMonth(requested, today);
  const { from, to } = monthBounds(month);

  const [records, schedules] = await Promise.all([
    // Scoped in the query. Without `attendance.manage` this is the viewer's own
    // days and nobody else's ever reaches the browser.
    getAttendanceMonth(viewer.workspaceId, from, to, await attendanceScope()),
    getWorkSchedules(viewer.workspaceId, viewer.id),
  ]);

  /**
   * The schedule that applied on a given day, as plain policy.
   *
   * Resolved per day rather than once for the month: a month containing a
   * reassignment is judged by both schedules, each on its own side of the
   * change. Returns null when none covers the date, and the cell draws blank
   * rather than inventing an absence.
   */
  const policyFor = (iso: string): SchedulePolicy | null => {
    const schedule = scheduleOn(schedules, new Date(`${iso}T00:00:00.000Z`));
    if (!schedule) return null;
    return {
      startsAt: schedule.startsAt,
      endsAt: schedule.endsAt,
      graceMinutes: schedule.graceMinutes,
      workingDays: schedule.workingDays,
    };
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-bold leading-tight tracking-tight">Attendance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your days this month, as recorded.
        </p>
      </div>

      {schedules.length === 0 ? (
        // An empty screen is an invitation to act — but not for the person
        // reading it, who cannot assign themselves hours. So it says who can.
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No working hours have been assigned to you yet, so there is nothing to measure
          attendance against. Ask an administrator to set your schedule.
        </p>
      ) : null}

      <AttendanceCalendar
        month={month}
        records={records}
        policyFor={policyFor}
        today={today}
      />
    </div>
  );
}
