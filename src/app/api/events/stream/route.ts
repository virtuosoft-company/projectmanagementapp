import { getSessionUser } from "@/lib/session";
import { subscribeToUser, type LiveEvent } from "@/lib/live-events";

/**
 * Server-sent events: one long-lived stream per signed-in tab.
 *
 * The browser opens this with `EventSource`, which sends cookies, so the
 * session is the authentication — there is no token in the URL to leak into
 * logs or a `Referer`. A stream only ever carries **its own** user's events:
 * the channel is keyed by the id resolved here, never by anything the client
 * asks for.
 *
 * Messages carry no application data, only "refetch". That keeps authorization
 * where it already is: the refetch is an ordinary request through the usual
 * gates, so a stale membership or a narrowed role cannot leak anything through
 * this route.
 *
 * Node runtime — it holds an open connection and subscribes to an in-process
 * emitter, neither of which survives the edge runtime.
 */
export const runtime = "nodejs";
/** A stream is never a cacheable response. */
export const dynamic = "force-dynamic";

/**
 * How often to write a comment line when nothing is happening.
 *
 * Proxies and load balancers close idle connections, commonly at 60s, and the
 * browser would then reconnect every minute. A comment is ignored by
 * `EventSource` but is enough traffic to keep the connection considered live.
 */
const HEARTBEAT_MS = 25_000;

export async function GET(request: Request) {
  const user = await getSessionUser();
  // 401 rather than a redirect: the caller is `EventSource`, which cannot
  // follow a redirect to a sign-in page and would retry the HTML forever.
  if (!user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;

      const send = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client went away between the abort signal and this write.
          open = false;
        }
      };

      // `retry` tells the browser how long to wait before reconnecting after a
      // drop. Without it EventSource uses its own default, which is aggressive.
      send("retry: 5000\n\n");
      // An immediate comment flushes headers, so the browser fires `onopen`
      // rather than sitting in `CONNECTING` until the first real event.
      send(": connected\n\n");

      const unsubscribe = subscribeToUser(userId, (event: LiveEvent) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);

      const close = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime; nothing to do.
        }
      };

      // Every teardown path runs `close`, so a navigated-away tab cannot leave
      // a listener and an interval behind — that is how this kind of endpoint
      // leaks a process to death.
      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // `no-transform` matters as much as `no-cache`: a proxy that gzips or
      // rewrites the body will buffer it, and a buffered stream never arrives.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx buffers proxied responses by default, which defeats SSE.
      "X-Accel-Buffering": "no",
    },
  });
}
