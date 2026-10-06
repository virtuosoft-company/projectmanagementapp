import type { Metadata } from "next";
import { ProjectsGrid, type ProjectCard } from "@/components/projects/projects-grid";
import { ProjectsStats } from "@/components/projects/projects-stats";
import { getMembers, getMetrics, getProjectStats, getProjects } from "@/lib/queries";
import { hasPermission, projectScope, requirePage, viewerSupervises } from "@/lib/session";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const viewer = await requirePage("projects");

  // Admin or manager. The grid itself is the same screen for everybody — the
  // figures above it are not, and they are what a common user does not get.
  const supervises = await viewerSupervises();

  // Resolved once and reused below. It was read twice, which left room for the
  // grid and the figures above it to disagree about what the viewer can see —
  // and the heading needs the same answer to describe it honestly.
  const scope = await projectScope();

  const [projects, members] = await Promise.all([
    getProjects(viewer.workspaceId, scope),
    getMembers(viewer.workspaceId),
  ]);

  // Only when they will be shown. `getMetrics` reads projects, tasks, entries
  // and members to compute figures nobody is going to see otherwise.
  const metrics = supervises ? await getMetrics(viewer.workspaceId, { projects: scope }) : null;

  const cards: ProjectCard[] = await Promise.all(
    projects.map(async (project) => {
      const stats = await getProjectStats(viewer.workspaceId, project.id);
      return { ...project, done: stats.done, taskCount: stats.taskCount };
    }),
  );

  return (
    <ProjectsGrid
      projects={cards}
      members={members}
      canCreate={await hasPermission("projects.create")}
      canEdit={await hasPermission("projects.edit")}
      canDelete={await hasPermission("projects.delete")}
      stats={metrics ? <ProjectsStats metrics={metrics} /> : null}
      // `undefined` scope means no narrowing — every project in the workspace.
      showingAll={scope === undefined}
    />
  );
}
