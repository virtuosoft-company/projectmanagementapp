import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectTasksTab } from "@/components/projects/project-tasks-tab";
import { ensureProjectBoards, getBoards } from "@/lib/boards";
import { todayIso } from "@/lib/domain";
import {
  getLabels,
  getMembers,
  getProject,
  getProjectSubtasks,
  getRunningTimer,
  getTasks,
} from "@/lib/queries";
import { getSessionUser, hasPermission, projectScope, requireUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/projects/project/[id]/tasks">): Promise<Metadata> {
  const { id } = await params;
  const viewer = await getSessionUser();
  const project = viewer?.workspaceId ? await getProject(viewer.workspaceId, id, await projectScope()) : null;
  return { title: `${project?.name ?? "Project"} — Boards` };
}

/**
 * A project's Trello-style boards.
 *
 * `?board=` picks which one is open; an id that no longer exists (or none at
 * all) falls back to the first, so a stale link opens the project rather than
 * an error.
 */
export default async function ProjectTasksPage({
  params,
  searchParams,
}: PageProps<"/projects/project/[id]/tasks">) {
  const viewer = await requireUser();
  const { id } = await params;
  const { board: requested } = await searchParams;

  const project = await getProject(viewer.workspaceId, id, await projectScope());
  // A feature switched off is genuinely gone, not just hidden from the nav.
  if (!project || !project.features.includes("tasks")) notFound();

  // Before any read: a project without a board gets one, and a task created
  // elsewhere gets put on a list. Idempotent, and a no-op almost always.
  await ensureProjectBoards(project.id);

  const [boards, tasks, members, labels, subtasks, running, canLog] = await Promise.all([
    getBoards(viewer.workspaceId, project.id),
    getTasks(viewer.workspaceId),
    getMembers(viewer.workspaceId),
    getLabels(viewer.workspaceId),
    getProjectSubtasks(viewer.workspaceId, project.id),
    getRunningTimer(viewer.workspaceId, viewer.id),
    hasPermission("time.log"),
  ]);

  const wanted = typeof requested === "string" ? requested : undefined;
  const active = boards.find((board) => board.id === wanted) ?? boards[0];

  return (
    <ProjectTasksTab
      projectId={project.id}
      boards={boards}
      activeBoardId={active?.id ?? ""}
      tasks={tasks.filter((task) => task.projectId === project.id)}
      members={members}
      labels={labels}
      today={todayIso()}
      canManage={await hasPermission("tasks.manage")}
      canLog={canLog}
      subtasks={subtasks}
      running={running}
    />
  );
}
