import {
  MyProjectsPanel,
  MyTasksPanel,
  PersonalStatTiles,
  type PersonalProjectRow,
} from "@/components/dashboard/personal-overview";
import { getMemberStats, getProjectStats, getProjects } from "@/lib/queries";
import { projectScope } from "@/lib/session";
import type { ActiveSessionUser } from "@/lib/session";

/**
 * The dashboard for somebody who does the work rather than oversees it.
 *
 * Their own projects, their own tasks, their own hours — no workspace-wide
 * figures, no charts and no export. The counterpart is `WorkspaceDashboard`,
 * and `dashboard/page.tsx` picks between them.
 *
 * It fetches its own data rather than taking it as props, which is the point
 * of the split: branching before the queries run means a common user never
 * triggers the workspace-wide reads at all, instead of fetching them and
 * throwing them away in the markup.
 *
 * Built from the same pieces as `/profile`, not a second version of them — the
 * two screens show the same thing about the same person and must not drift.
 */
export async function PersonalDashboard({ viewer }: { viewer: ActiveSessionUser }) {
  const [stats, projects] = await Promise.all([
    getMemberStats(viewer.workspaceId, viewer.id),
    getProjects(viewer.workspaceId, await projectScope()),
  ]);

  const mine = projects.filter((project) =>
    project.members.some((person) => person.id === viewer.id),
  );

  const rows: PersonalProjectRow[] = await Promise.all(
    mine.map(async (project) => ({
      project,
      stats: await getProjectStats(viewer.workspaceId, project.id),
    })),
  );

  const projectName = (id: string) => projects.find((project) => project.id === id)?.name ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold leading-tight tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome back, {viewer.name.split(" ")[0]} — here&rsquo;s where your work stands.
        </p>
      </div>

      <PersonalStatTiles
        projectCount={mine.length}
        tasksTotal={stats.tasksTotal}
        tasksDone={stats.tasksDone}
        hours={stats.hours}
      />

      {/*
        Stacked rather than tabbed: there are two sections and both are short,
        so a tab strip hid half the page behind a click for no gain.
      */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Projects</h2>
        <MyProjectsPanel rows={rows} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Tasks</h2>
        <MyTasksPanel tasks={stats.tasks} projectName={projectName} />
      </section>
    </div>
  );
}
