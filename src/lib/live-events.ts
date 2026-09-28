import "server-only";

import { EventEmitter } from "node:events";
import type { LiveEvent } from "@/lib/domain";

/**
 * A tiny publish/subscribe bus for pushing "something changed for you" to a
 * signed-in browser, over the SSE stream in `app/api/events/stream`.
 *
 * **In-process, and deliberately so.** It carries no data — only the fact that
 * a given user should re-fetch — so the worst a lost message can do is leave a
 * page as stale as it was before any of this existed. Every screen still works
 * from its own server render; this only removes the wait.
 *
 * **It does not span processes.** With more than one Node instance behind a
 * load balancer, a publish only reaches the browsers connected to *that*
 * instance. Making it cross-instance means putting a real broker underneath
 * `publish` — Redis pub/sub, a Postgres LISTEN/NOTIFY, whatever the deployment
 * already runs — and nothing else here would change. Noted rather than guessed
 * at, because this app currently runs as a single process.
 */

export type { LiveEvent };

type Listener = (event: LiveEvent) => void;

/**
 * One emitter per process, cached on `globalThis`.
 *
 * Same reasoning as `lib/prisma.ts`: dev hot-reload re-evaluates the module,
 * and a fresh emitter each time would orphan every open stream's listener —
 * the connection would stay up and silently stop receiving anything.
 */
const globalForLive = globalThis as unknown as { liveBus?: EventEmitter };

function bus(): EventEmitter {
  if (!globalForLive.liveBus) {
    const emitter = new EventEmitter();
    // One listener per open tab per user. The default ceiling of 10 is a
    // leak-detection heuristic meant for a handful of listeners on one object;
    // here a busy workspace legitimately has far more, and hitting it would
    // print a warning on every connection.
    emitter.setMaxListeners(0);
    globalForLive.liveBus = emitter;
  }
  return globalForLive.liveBus;
}

/** Channel name for one user. Scoped per user, so nothing fans out workspace-wide. */
const channel = (userId: string) => `user:${userId}`;

/**
 * Dev-only tracing, and worth keeping: this subsystem fails silently by
 * construction. A publish with no listener and a publish in the wrong process
 * look identical from the browser — nothing happens. The pid and the listener
 * count are exactly what tells those two apart.
 */
function trace(what: string, detail: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") return;
  console.log(`[live] ${what}`, { pid: process.pid, ...detail });
}

/**
 * Tell these users to refetch.
 *
 * Best-effort, like `notify`: a failure here must never fail the action that
 * succeeded. The caller has already written the change; this is only the nudge.
 */
export function publishToUsers(
  userIds: readonly string[],
  options: { session?: boolean } = {},
): void {
  const recipients = [...new Set(userIds)].filter(Boolean);
  if (recipients.length === 0) return;

  const event: LiveEvent = { kind: "refresh", session: options.session, at: Date.now() };

  try {
    for (const userId of recipients) {
      const name = channel(userId);
      trace("publish", { userId, listeners: bus().listenerCount(name) });
      bus().emit(name, event);
    }
  } catch {
    // Deliberately swallowed — see above.
  }
}

/** Listen for one user's events. Returns the unsubscribe, for stream teardown. */
export function subscribeToUser(userId: string, listener: Listener): () => void {
  const name = channel(userId);
  bus().on(name, listener);
  trace("subscribe", { userId, listeners: bus().listenerCount(name) });

  return () => {
    bus().off(name, listener);
    trace("unsubscribe", { userId, listeners: bus().listenerCount(name) });
  };
}
