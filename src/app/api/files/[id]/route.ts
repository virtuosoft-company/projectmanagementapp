import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { isInlineMimeType } from "@/lib/files";

/**
 * Serves a stored file's bytes.
 *
 * Replaces the R2 public bucket URL. Three things this route does that serving
 * from a separate origin did for free:
 *
 * 1. **It requires a session**, unless the row is marked `public`. The bytes
 *    are workspace material; a bare cuid is not an access grant. Branding is
 *    the only exception — the favicon, the two logos and the sign-in screen
 *    render before anyone has signed in, so gating those would stop the login
 *    page drawing itself.
 * 2. **It refuses to render most things inline.** Serving from this app's own
 *    origin means an uploaded `.html` or `.svg` displayed inline would execute
 *    with access to the session cookie. Only the types in `INLINE_MIME_TYPES`
 *    open in the tab; everything else downloads. SVG is deliberately absent —
 *    it is an image to a person and a script host to a browser.
 * 3. **It sends the stored type, never a caller-supplied one.** The type was
 *    decided at upload, by sharp for images and by extension for documents.
 *
 * What it does not do is stream. `findUnique` reads the whole LONGBLOB into
 * memory, so there is no range support and therefore no seeking in a large
 * video. That is the cost of database storage, and it is why the upload path
 * caps dimensions rather than accepting arbitrary files.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const file = await prisma.file.findUnique({
    where: { id },
    select: { name: true, mimeType: true, size: true, data: true, public: true },
  });

  // Same answer for "no such file" and "not yours": a 403 on a real id would
  // confirm the id exists, which is the one thing a guessed cuid should not
  // learn.
  if (!file) return new Response("Not found", { status: 404 });

  if (!file.public) {
    const viewer = await getSessionUser();
    if (!viewer) return new Response("Not found", { status: 404 });
  }

  const inline = isInlineMimeType(file.mimeType);
  // `filename*=UTF-8''…` rather than `filename="…"`: a name with a quote or a
  // non-ASCII character breaks the quoted form, and a quote in it could end
  // the header value early.
  const disposition = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`;

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.size),
      "Content-Disposition": disposition,
      // Immutable because a File row is never rewritten — replacing an image
      // creates a new row and repoints the column, so a given id always
      // serves the same bytes. `private` on anything session-gated so a shared
      // cache never holds one person's file.
      "Cache-Control": file.public
        ? "public, max-age=31536000, immutable"
        : "private, max-age=31536000, immutable",
      // Stops a browser second-guessing the type and rendering a download as
      // something executable.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
