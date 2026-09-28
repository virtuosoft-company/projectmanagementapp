import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TaskDetail } from "@/components/projects/task-detail";
import { validateR2Config } from "@/lib/r2-server";
import {
  getLabels,
  getMembers,
  getProject,
  getRunningTimer,
  getTask,
  getTaskAttachments,
  getTaskEntries,
  getTaskSubtasks,
} from "@/lib/queries";
import { getSessionUser, hasPermission, projectScope, requireUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/projects/project/[id]/tasks/[taskId]">): Promise<Metadata> {
  const { id, taskId } = await params;
  const viewer = await getSessionUser();
  const task = viewer?.workspaceId ? await getTask(viewer.workspaceId, taskId) : null;
  void id;
  return { title: task ? `${task.title} — Task` : "Task" };
}

/**
 * One task, in full.
 *
 * An archived task still opens here — `getTask` reads past the archive filter
 * — so an old link, or the Archive list, leads somewhere rather than to a 404.
 */
export default async function TaskDetailPage({
  params,
}: PageProps<"/projects/project/[id]/tasks/[taskId]">) {
  const viewer = await requireUser();
  const { id, taskId } = await params;

  const project = await getProject(viewer.workspaceId, id, await projectScope());
  if (!project || !project.features.includes("tasks")) notFound();

  const task = await getTask(viewer.workspaceId, taskId);
  // Guard the pairing, not just the ids: a task from another project would
  // otherwise render happily under this project's breadcrumb.
  if (!task || task.projectId !== project.id) notFound();

  const [
    entries,
    attachments,
    subtasks,
    running,
    members,
    labels,
    canManage,
    canLog,
    canManageAnyTime,
  ] = await Promise.all([
    getTaskEntries(viewer.workspaceId, task.id),
    getTaskAttachments(viewer.workspaceId, task.id),
    getTaskSubtasks(viewer.workspaceId, task.id),
    getRunningTimer(viewer.workspaceId, viewer.id),
    getMembers(viewer.workspaceId),
    getLabels(viewer.workspaceId),
    hasPermission("tasks.manage"),
    hasPermission("time.log"),
    hasPermission("time.manage"),
  ]);

  return (
    <TaskDetail
      task={task}
      projectId={project.id}
      projectName={project.name}
      entries={entries}
      attachments={attachments}
      subtasks={subtasks}
      running={running}
      members={members}
      labels={labels}
      r2Problems={validateR2Config().errors}
      viewerId={viewer.id}
      canManage={canManage}
      canLog={canLog}
      canManageAnyTime={canManageAnyTime}
    />
  );
}
