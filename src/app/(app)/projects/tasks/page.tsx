import type { Metadata } from "next";
import { TasksView } from "@/components/projects/tasks-view";
import {
  getArchivedTasks,
  getLabelUsage,
  getLabels,
  getMembers,
  getProjects,
  getTasks,
} from "@/lib/queries";
import { hasPermission, projectScope, requirePage } from "@/lib/session";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage() {
  const viewer = await requirePage("tasks");
  const [tasks, archived, projects, members, labels, labelUsage] = await Promise.all([
    getTasks(viewer.workspaceId),
    getArchivedTasks(viewer.workspaceId),
    getProjects(viewer.workspaceId, await projectScope()),
    getMembers(viewer.workspaceId),
    getLabels(viewer.workspaceId),
    getLabelUsage(viewer.workspaceId),
  ]);

  // Archived tasks are sent too so "Show archived" is a filter rather than a
  // second page; they are hidden until asked for.
  const rows = [...tasks, ...archived].map((task) => ({
    ...task,
    projectName: projects.find((project) => project.id === task.projectId)?.name ?? "",
  }));

  return (
    <TasksView
      tasks={rows}
      projects={projects}
      members={members}
      labels={labels}
      labelUsage={Object.fromEntries(labelUsage)}
      canManage={await hasPermission("tasks.manage")}
    />
  );
}
