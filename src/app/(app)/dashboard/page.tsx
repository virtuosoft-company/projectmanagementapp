import type { Metadata } from "next";
import { PersonalDashboard } from "@/components/dashboard/personal-dashboard";
import { WorkspaceDashboard } from "@/components/dashboard/workspace-dashboard";
import { requirePage, viewerSupervises } from "@/lib/session";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your workspace at a glance.",
};

/**
 * Two dashboards, one route.
 *
 * Whoever is responsible for the workspace gets the workspace: figures, charts
 * and the export. Whoever does the work in it gets their own work — their
 * projects, their tasks, their hours — and none of the reporting layer.
 *
 * Two components rather than one forked down the middle with conditionals,
 * because these are genuinely different screens rather than one screen
 * narrowed. The two halves would otherwise stop resembling each other within a
 * month while sharing a file.
 *
 * The branch is **before** the queries, not inside the markup: each component
 * fetches what it needs, so a common user never triggers the workspace-wide
 * reads at all. Gating in the JSX would have fetched every figure and then
 * declined to render it.
 */
export default async function DashboardPage() {
  const viewer = await requirePage("dashboard");

  // Admin or manager. Not `reports.view` — that includes member, which is how
  // the charts were reaching the people this split exists to take them from.
  const supervises = await viewerSupervises();

  return supervises ? (
    <WorkspaceDashboard viewer={viewer} />
  ) : (
    <PersonalDashboard viewer={viewer} />
  );
}
