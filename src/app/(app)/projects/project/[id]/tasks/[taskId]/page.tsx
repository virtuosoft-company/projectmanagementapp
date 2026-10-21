import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TaskDetail } from "@/components/projects/task-detail";
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
import {
  getSessionUser,
  hasPermission,
  projectScope,
  requireUser,
  timeEntryScope,
  viewerIsAdmin,
} from "@/lib/session";

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
    getTaskEntries(viewer.workspaceId, task.id, await timeEntryScope()),
    getTaskAttachments(viewer.workspaceId, task.id),
    getTaskSubtasks(viewer.workspaceId, task.id),
    getRunningTimer(viewer.workspaceId, viewer.id),
    getMembers(viewer.workspaceId),
    getLabels(viewer.workspaceId),
    hasPermission("tasks.manage"),
    hasPermission("time.log"),
    hasPermission("time.manage"),
  ]);

  // The admin records time by hand, never by the clock. The account exists to
  // administer the workspace rather than to do the work in it, so a running
  // timer against it would be a figure nobody meant to produce — the manual
  // form stays, so corrections are still possible. `startTimerAction` refuses
  // the same account, because hiding a control is presentation, not a rule.
  const canUseTimer = canLog && !(await viewerIsAdmin());

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
      viewerId={viewer.id}
      canManage={canManage}
      canLog={canLog}
      canUseTimer={canUseTimer}
      canManageAnyTime={canManageAnyTime}
    />
  );
}
