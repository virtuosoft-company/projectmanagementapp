import type { NextConfig } from "next";

/**
 * The largest request a server action accepts. Next's default is 1MB.
 *
 * Two things here need more: an image upload (up to 4MB, sent one file per
 * request, plus multipart overhead), and saving or importing an Excel sheet,
 * whose cells travel as JSON. Before this was set, any image over 1MB failed
 * at the HTTP layer before the action ever ran.
 *
 * Still 11mb rather than ~5mb: the Excel path sends whole sheets as JSON, and
 * that is what sets the floor here, not the image cap.
 */
const ACTION_BODY_LIMIT = "11mb";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: ACTION_BODY_LIMIT,
    },
  },

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
