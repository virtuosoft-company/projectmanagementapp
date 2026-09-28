import type { NextConfig } from "next";
import { R2_PREFIX } from "./src/lib/r2";


function r2RemotePatterns(): NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> {
  const origin = process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.trim();
  if (!origin) return [];

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    // A malformed value should not take the whole build down. Images stay
    // unoptimised, and the misconfiguration is already reported where it
    // matters — the upload controls, which check the same variable.
    console.warn(
      `next.config.ts: NEXT_PUBLIC_R2_PUBLIC_URL is not a valid URL (${origin}); ` +
        "remote images will not be optimised.",
    );
    return [];
  }

  const basePath = url.pathname.replace(/\/+$/, "");

  return [
    {
      protocol: url.protocol.replace(":", "") as "http" | "https",
      hostname: url.hostname,
      port: url.port,
      // Narrowed to this app's own prefix rather than the whole host: a bucket
      // may be shared, and a bare `/**` would turn the optimiser into an open
      // proxy for every object in it.
      pathname: `${basePath}/${R2_PREFIX}/**`,
      // No image URL this app builds carries a query string, so allowing one
      // would only widen what the optimiser accepts.
      search: "",
    },
  ];
}

/**
 * The largest request a server action accepts. Next's default is 1MB.
 *
 * Two things here need more: an image upload (up to 10MB, sent one file per
 * request, plus multipart overhead), and saving or importing an Excel sheet,
 * whose cells travel as JSON. Before this was set, any image over 1MB failed
 * at the HTTP layer before the action ever ran.
 */
// const ACTION_BODY_LIMIT = "11mb";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: r2RemotePatterns(),
  },

  // experimental: {
  //   serverActions: {
  //     bodySizeLimit: ACTION_BODY_LIMIT,
  //   },
  // },

  async redirects() {
    return [
      // Both people screens moved under /admin; keep old links working.
      { source: "/team", destination: "/admin/users", permanent: true },
      { source: "/teams", destination: "/admin/teams", permanent: true },
      // Spreadsheets became Excel sheets; old links and bookmarks still land.
      {
        source: "/projects/project/:id/spreadsheet",
        destination: "/projects/project/:id/excel-sheet",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
