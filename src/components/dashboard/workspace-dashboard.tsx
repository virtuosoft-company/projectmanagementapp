import {
  CircleAlert,
  Clock,
  FolderKanban,
  SquareCheckBig,
  Users,
} from "lucide-react";
import { ExportReportButton } from "@/components/dashboard/export-report-button";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { OverviewTab } from "@/components/dashboard/overview-tab";
import { todayIso } from "@/lib/domain";
import { type Permission } from "@/lib/permissions";
import {
  getMemberStats,
  getMembers,
  getMetrics,
  getProjectStats,
  getProjects,
  getWorkspace,
} from "@/lib/queries";
import { type ActiveSessionUser, getViewerPermissions, projectScope } from "@/lib/session";

/**
 * The dashboard for somebody responsible for the workspace — an admin or a
 * manager. Workspace figures, the charts, and the CSV export.
 *
 * Everything here is still narrowed by the viewer: the KPI cards are filtered
 * by the permission governing what each one reports, and the figures behind
 * them come from the scoped queries. A manager sees these cards counting their
 * own projects and their own reports’ hours, not the workspace’s.
 *
 * `PersonalDashboard` is the counterpart; `dashboard/page.tsx` picks.
 */
export async function WorkspaceDashboard({ viewer }: { viewer: ActiveSessionUser }) {
  // The resolved set, not the base role's: a custom role that gives up
  // `reports.view` must lose those cards, not merely be refused on click.
  const granted = await getViewerPermissions();
  const [metrics, projects, members, workspace] = await Promise.all([
    getMetrics(viewer.workspaceId, {
      projects: await projectScope(),
    }),
    getProjects(viewer.workspaceId, await projectScope()),
    getMembers(viewer.workspaceId),
    getWorkspace(viewer.workspaceId),
  ]);

  const projectRows = await Promise.all(
    projects.map(async (project) => ({
      project,
      stats: await getProjectStats(viewer.workspaceId, project.id),
    })),
  );
  const memberRows = await Promise.all(
    members.map(async (member) => ({
      member,
      stats: await getMemberStats(viewer.workspaceId, member.id),
    })),
  );

  /**
   * The CSV behind "Export Report": the same figures the cards and tables show,
   * flattened into one sheet — summary, then a row per project, then per person.
   */
  const reportRows: string[][] = [
    ["Workspace", workspace?.name ?? ""],
    ["Generated", todayIso()],
    [],
    ["Summary"],
    ["Projects", String(metrics.totalProjects)],
    ["Active projects", String(metrics.activeProjects)],
    ["Tasks", String(metrics.tasksTotal)],
    ["Tasks done", String(metrics.tasksDone)],
    ["Completion rate", `${metrics.completionRate}%`],
    ["Hours tracked", String(metrics.hoursTracked)],
    ["Overdue tasks", String(metrics.overdueCount)],
    ["Members", String(metrics.memberCount)],
    [],
    ["Projects", "Status", "Tasks done", "Tasks", "Progress %", "Hours"],
    ...projectRows.map((row) => [
      row.project.name,
      row.project.status,
      String(row.stats.done),
      String(row.stats.taskCount),
      String(row.stats.progress),
      String(row.stats.hours),
    ]),
    [],
    ["Members", "Role", "Tasks done", "Tasks", "Hours", "Utilization %"],
    ...memberRows.map((row) => [
      row.member.name,
      row.member.role,
      String(row.stats.tasksDone),
      String(row.stats.tasksTotal),
      String(row.stats.hours),
      String(row.stats.utilization),
    ]),
  ];

  /**
   * The cards, each behind the permission that already governs the thing it
   * reports on — so the dashboard shows exactly what the viewer's role may see
   * elsewhere in the app, and adding a permission to a role adds its card
   * without a second list to keep in step.
   *
   * `null` marks a card every role sees.
   */
  const allCards: { key: string; permission: Permission | null; card: React.ReactNode }[] = [
    {
      key: "projects",
      permission: "projects.view",
      card: (
        <KpiCard
          icon={FolderKanban}
          tone="primary"
          value={metrics.activeProjects.toString()}
          label="Active Projects"
          hint={`${metrics.totalProjects} total`}
        />
      ),
    },
    {
      key: "completion",
      permission: "reports.view",
      card: (
        <KpiCard
          icon={SquareCheckBig}
          tone="success"
          value={`${metrics.completionRate}%`}
          label="Task Completion"
          hint={`${metrics.tasksDone}/${metrics.tasksTotal} done`}
        />
      ),
    },
    {
      key: "hours",
      permission: "reports.view",
      card: (
        <KpiCard
          icon={Clock}
          tone="warning"
          value={metrics.hoursTracked.toString()}
          label="Hours Tracked"
          hint={`across ${metrics.totalProjects} projects`}
        />
      ),
    },
    {
      key: "members",
      permission: null,
      card: (
        <KpiCard
          icon={Users}
          tone="muted"
          value={metrics.memberCount.toString()}
          label="Team Members"
          hint="In this workspace"
        />
      ),
    },
    {
      key: "overdue",
      // Whoever is expected to act on an overdue task, plus the roles that read
      // reports about them.
      permission: "reports.view",
      card: (
        <KpiCard
          icon={CircleAlert}
          tone="destructive"
          value={metrics.overdueCount.toString()}
          label="Overdue Tasks"
          hint="Need attention"
        />
      ),
    },
  ];

  const cards = allCards.filter(
    ({ permission }) => permission === null || granted.includes(permission),
  );

  const canReadReports = granted.includes("reports.view");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold leading-tight tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Welcome back, {viewer.name.split(" ")[0]} —{" "}
            {canReadReports
              ? "here's the full pulse of your workspace."
              : "here's where your workspace stands."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canReadReports ? (
            <ExportReportButton
              rows={reportRows}
              name={`${workspace?.name ?? "workspace"} dashboard`}
              today={todayIso()}
            />
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {cards.map(({ key, card }) => (
          <div key={key} className="contents">
            {card}
          </div>
        ))}
      </div>

      {/* The charts, overdue list and per-project progress are a report. */}
      {canReadReports ? <OverviewTab workspaceId={viewer.workspaceId} /> : null}
      {/* <TabbedPanel
        items={[
          {
            value: "overview",
            label: "Overview",
            content: <OverviewTab workspaceId={viewer.workspaceId} />,
          },
          { value: "projects", label: "Projects", content: <ProjectsTab rows={projectRows} /> },
          { value: "activity", label: "Activity", content: <ActivityTab entries={activity} /> },
        ]}
      /> */}
    </div>
  );
}
