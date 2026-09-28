import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { publishToUsers } from "@/lib/live-events";

/**
 * Publish one event to whoever calls this, to prove the push path end to end.
 *
 * The live stream fails silently by construction: a dropped connection, a
 * buffering proxy, and an action that published to nobody all look the same
 * from a page that simply does not update. This isolates the middle of that —
 * open it in a signed-in tab and every other signed-in tab of the same account
 * should log `[live] event received; refreshing` within a second.
 *
 * A pass means the bus and the stream are fine and the answer lies in the
 * *caller*: usually that the action published to an empty recipient list, or
 * only to the person who performed it (`notify` skips the actor by design).
 *
 * **Development only.** It lets any signed-in person cause a refetch for
 * themselves, which is harmless but is a debugging affordance, not a feature,
 * and it should not exist in a deployed app.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  const user = await getSessionUser();
  if (!user?.id) {
    return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  }

  // Only ever to the caller. This cannot be pointed at anybody else.
  publishToUsers([user.id]);

  return NextResponse.json({
    ok: true,
    publishedTo: user.email,
    hint: "Your other signed-in tabs should log '[live] event received' now. Check the dev server output for the matching '[live] publish' line and its listener count.",
  });
}
