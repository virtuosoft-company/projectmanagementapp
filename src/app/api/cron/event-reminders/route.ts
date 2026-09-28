import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notifications";

/**
 * Send the reminder for every event whose lead time has arrived.
 *
 * **This app has no scheduler.** There is no cron, queue or background worker
 * here, so nothing calls this on its own — it has to be triggered from
 * outside, on whatever interval you want reminders checked at (every five
 * minutes is a reasonable starting point):
 *
 *   curl -X POST http://localhost:3000/api/cron/event-reminders \
 *        -H "Authorization: Bearer $CRON_SECRET"
 *
 * Until something calls it, write-time notifications still work and reminders
 * simply never fire. That is a deliberately visible failure mode rather than a
 * silent one: `GET` reports how many reminders are currently overdue.
 *
 * Runs on the Node runtime because it talks to Prisma.
 */
export const runtime = "nodejs";
/** Never cached: the answer depends entirely on the clock. */
export const dynamic = "force-dynamic";

/** How many events one run will process, so a backlog cannot stall a request. */
const BATCH = 200;

/**
 * Shared-secret check.
 *
 * The endpoint writes notifications for other people, so it is not public. It
 * refuses outright when `CRON_SECRET` is unset rather than defaulting to open
 * — an unconfigured deployment should send nothing, not accept anything.
 */
function authorise(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set; the reminder endpoint is disabled." },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const offered = header.startsWith("Bearer ") ? header.slice(7) : "";

  // Length-independent comparison is not worth reaching for here: the secret is
  // compared whole and the endpoint is not a timing oracle for anything else.
  if (offered !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  return null;
}

/**
 * Events whose reminder is due: not yet sent, and starting within their own
 * lead time.
 *
 * The lead time varies per row, so the comparison cannot be a plain `WHERE
 * startsAt <= ?`. The index narrows to unsent reminders in the near future and
 * the exact test is applied in memory, over a bounded batch.
 */
async function dueEvents(now: Date) {
  // A week is the schema's maximum `reminderMinutes`, so nothing further out
  // than that can be due yet.
  const horizon = new Date(now.getTime() + 10_080 * 60_000);

  const candidates = await prisma.event.findMany({
    where: { reminderSentAt: null, reminderMinutes: { gt: 0 }, startsAt: { lte: horizon } },
    orderBy: { startsAt: "asc" },
    take: BATCH,
    include: { attendees: { select: { userId: true } } },
  });

  return candidates.filter(
    (event) => event.startsAt.getTime() - event.reminderMinutes * 60_000 <= now.getTime(),
  );
}

export async function POST(request: Request) {
  const refusal = authorise(request);
  if (refusal) return refusal;

  const now = new Date();
  const due = await dueEvents(now);

  let notified = 0;

  for (const event of due) {
    const minutes = Math.max(0, Math.round((event.startsAt.getTime() - now.getTime()) / 60_000));

    await notify(prisma, {
      workspaceId: event.workspaceId,
      userIds: event.attendees.map((attendee) => attendee.userId),
      // The app itself is sending this, not a person — so no actor, and
      // `notify` skips nobody.
      actorId: null,
      kind: "event-reminder",
      title: `"${event.title}" starts soon`,
      body:
        minutes <= 0
          ? "Starting now."
          : `Starting in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      href: "/projects/calendar",
    });

    // Stamped whether or not anybody was notified — an event with no attendees
    // is still handled, and leaving it unstamped would re-examine it forever.
    //
    // After `notify`, not before: `notify` swallows its own failures, so the
    // order only matters for a crash between the two, and a reminder sent
    // twice is a smaller problem than one never sent at all.
    await prisma.event.update({
      where: { id: event.id },
      data: { reminderSentAt: now },
    });

    notified += 1;
  }

  return NextResponse.json({ ok: true, processed: notified, checkedAt: now.toISOString() });
}

/** How many reminders are overdue — for checking the trigger is actually wired up. */
export async function GET(request: Request) {
  const refusal = authorise(request);
  if (refusal) return refusal;

  const now = new Date();
  const due = await dueEvents(now);

  return NextResponse.json({
    ok: true,
    pending: due.length,
    oldest: due[0]?.startsAt.toISOString() ?? null,
    checkedAt: now.toISOString(),
  });
}
