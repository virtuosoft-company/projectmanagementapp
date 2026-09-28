"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { LiveEvent } from "@/lib/domain";

/**
 * Keeps this tab in step with changes made by other people.
 *
 * Opens the SSE stream in `api/events/stream` and calls `router.refresh()` when
 * something arrives — so being added to a project, assigned a task or sent a
 * notification shows up without the person navigating or reloading.
 *
 * Two things happen per event, and both are needed:
 *
 *   `router.refresh()` re-runs the current route **and its layouts** on the
 *   server. That covers everything resolved from the database per request —
 *   permissions, assigned pages, project lists, the notification bell. Client
 *   state is kept, so a half-typed form or an open dialog survives it.
 *
 *   `update({})` re-mints the session JWT. The token carries a copy of the
 *   base role, and `router.refresh()` does **not** touch it — so after an
 *   admin changed somebody's role their pages and sidebar updated while the
 *   role itself stayed as it was at sign-in. The `jwt` callback already had
 *   the branch for this, commented "plain refresh (e.g. after a role change)";
 *   nothing had ever called it.
 *
 * Renders nothing. Mounted once in the app shell, where it lives for as long as
 * the person is signed in.
 */
export function LiveUpdates() {
  const router = useRouter();

  const { update } = useSession();
  const [, startRefreshing] = useTransition();

  /*
   * Neither `router` nor `update` is documented as stable across renders, and a
   * refresh causes a render. Depending on either in the stream effect would
   * tear down and reopen the connection on every event — a reconnect loop that
   * gets worse the busier the workspace is. Holding the work in a ref keeps
   * that effect's dependency list genuinely empty; the ref is written in an
   * effect rather than during render, which is the only time a ref may be
   * touched.
   */
  const refresh = useRef<(withSession: boolean) => void | Promise<void>>(() => {});

  useEffect(() => {
    refresh.current = async (withSession: boolean) => {
      /*
       * Only when the event says the session moved — a role change. Everything
       * else is data on the page, which `router.refresh()` alone re-reads.
       *
       * `{}` rather than no argument, and the empty object is the whole point.
       *
       * next-auth's `update(data)` only sends a POST when `data` is defined
       * (see `fetchData` in next-auth/lib/client.js). With no argument it
       * issues a plain GET of the session, which re-reads the *existing* token
       * and never runs the `jwt` callback with `trigger: "update"` — so the
       * role stayed exactly as stale as before. Any defined value posts, and
       * an empty one carries no instruction beyond "re-read", which lands in
       * the callback's plain-refresh branch.
       *
       * The token first, then the render: `update` writes the new session
       * cookie, so refreshing afterwards means the server components re-read
       * with the fresh role rather than one request behind it.
       *
       * A failed update must not cost the refresh — next-auth returns a falsy
       * value while the session is still loading, and refusing to re-render
       * because of that would make a role change look like nothing happened.
       */
      if (withSession) {
        try {
          await update({});
        } catch {
          // Ignored on purpose — see above.
        }
      }

      /*
       * Inside a transition, exactly as the workspace switcher does it.
       *
       * `router.refresh()` re-renders the whole tree from the root layout, and
       * outside a transition React blanks the current UI while it waits for the
       * new payload. Since this fires on somebody *else's* action, that showed
       * up as the page apparently reloading itself out of nowhere. Inside one,
       * the current page stays on screen until the new data is ready, so a
       * role change reads as an update rather than a reload.
       */
      startRefreshing(() => {
        router.refresh();
      });
    };
  }, [router, update, startRefreshing]);

  useEffect(() => {
    // Server-rendered or an environment without EventSource: the app works
    // exactly as it did before, one navigation behind.
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;

    const source = new EventSource("/api/events/stream");

    /*
     * Dev-only, and worth the lines: this stream fails silently by nature. A
     * closed connection, a proxy that buffers, or a push that never reaches
     * this process all look identical from the outside — the page simply does
     * not update. These three logs say which it was.
     */
    const debug = (...args: unknown[]) => {
      if (process.env.NODE_ENV === "development") console.debug("[live]", ...args);
    };

    source.onopen = () => debug("stream open");

    /*
     * Several changes often land together — adding three people to a project is
     * three publishes. Coalescing them into one refresh avoids three server
     * round-trips for one visible outcome.
     */
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Sticky across a coalesced batch: if any event in it moved the session,
    // the one refresh that follows has to re-mint the token.
    let withSession = false;

    const scheduleRefresh = (message: MessageEvent<string>) => {
      let session = false;
      try {
        session = Boolean((JSON.parse(message.data) as LiveEvent).session);
      } catch {
        // An unparseable payload still means "something changed" — refresh
        // anyway rather than ignoring it.
      }

      withSession = withSession || session;
      debug("event received; refreshing", { session: withSession });

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const needsSession = withSession;
        withSession = false;
        void refresh.current(needsSession);
      }, 250);
    };

    source.onmessage = scheduleRefresh;

    /*
     * No handler beyond logging: `EventSource` reconnects on its own, using the
     * `retry` interval the route sends. Closing it here would turn a dropped
     * connection — a laptop lid, a proxy timeout — into a permanently dead
     * stream for the rest of the session.
     */
    source.onerror = () => debug("stream interrupted; the browser will reconnect");

    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, []);

  return null;
}
