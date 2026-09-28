import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic auth gate. Renamed from `middleware.ts` in Next 16.
 *
 * This only checks whether a session cookie is present — it never decodes or
 * trusts it. Real verification happens in `lib/session.ts`, which every
 * protected page and action calls. Keeping it cookie-shallow means no database
 * or crypto work runs on the edge for each request.
 */
/**
 * `/invite` is public because the person arriving has no account yet — the
 * token in the URL is their only credential, and it is checked by the page, not
 * here. Redirecting them to /signin would leave an invitee with no way in.
 */
const PUBLIC_PATHS = ["/signin", "/forbidden", "/invite"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  // Auth.js names the cookie `__Secure-authjs.session-token` over HTTPS.
  const hasSession =
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token");

  if (!hasSession) {
    const signIn = new URL("/signin", request.url);
    if (pathname !== "/") signIn.searchParams.set("from", `${pathname}${search}`);
    return NextResponse.redirect(signIn);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals, the auth endpoints, and static files.
  //
  // `api/cron` is exempt because it is called from outside the browser and has
  // no session cookie to present — it authenticates with the `CRON_SECRET`
  // bearer token instead, checked inside the route itself. Left in, this gate
  // would redirect every call to /signin and the sweep would never run.
  //
  // `api/events` is exempt for the mirror-image reason: it is opened by
  // `EventSource`, which cannot follow a redirect to an HTML sign-in page and
  // would retry it forever. It checks the session itself and answers 401, which
  // is what a non-navigating client can actually act on.
  matcher: [
    "/((?!api/auth|api/cron|api/events|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)",
  ],
};
