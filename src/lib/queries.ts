import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_PROJECT_FEATURES,
  TASK_STATUSES,
  formatDay,
  minutesToHours,
  percent,
  round1,
  todayIso,
  type ActivityEntry,
  type AppNotification,
  type Attachment,
  type Branding,
  type CalendarEvent,
  type Campaign,
  type Label,
  type LandingSection,
  type Member,
  type Message,
  type Person,
  type Project,
  type ProjectFeature,
  type RunningTimer,
  type Task,
  type TaskEntry,
  type TaskStatus,
  type TimeEntry,
  type Workspace,
  type SheetDetail,
  type SheetSummary,
  type Subtask,
  type WorkspaceSummary,
} from "@/lib/domain";
import { isSameDay, isSameWeek } from "@/lib/duration";
import { buildR2Url } from "@/lib/r2";
import {
  SHEET_MAX_COLS,
  SHEET_MAX_ROWS,
  normaliseCells,
  normaliseFormats,
  normaliseWidths,
} from "@/lib/sheet-model";
import {
  campaignStatusToDomain,
  dateToIso,
  isoToDate,
  priorityToDomain,
  projectStatusToDomain,
  roleToDomain,
  sectionTypeToDomain,
  taskStatusToDomain,
} from "@/lib/mappers";

/**
 * Read side of the data layer. Every function is `cache()`d, so a page that
 * needs projects in three places issues one query per request.
 *
 * Callers must already be authenticated — pages call `requireUser()` from
 * `lib/session.ts` first — and pass that session's `workspaceId` into every
 * function here. A foreign id (a project from another workspace, say) just
 * comes back empty rather than leaking data, because every function starts
 * from a workspace-scoped base query.
 */

const personSelect = { id: true, name: true, email: true, image: true } as const;

// --- Workspaces --------------------------------------------------------------

/** The workspaces `userId` belongs to, with their role in each — for the switcher. */
export const getUserWorkspaces = cache(async (userId: string): Promise<WorkspaceSummary[]> => {
  const rows = await prisma.workspaceMember.findMany({
    where: { userId },
    orderBy: { joinedAt: "asc" },
    include: {
      workspace: {
        include: {
          _count: {
            select: {
              projects: true,
              // Disabled accounts are not people who would lose access.
              members: { where: { user: { disabledAt: null } } },
            },
          },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.workspace.id,
    name: row.workspace.name,
    slug: row.workspace.slug,
    role: roleToDomain[row.role],
    projectCount: row.workspace._count.projects,
    activeUserCount: row.workspace._count.members,
  }));
});

export const getWorkspace = cache(async (id: string): Promise<Workspace | null> => {
  const workspace = await prisma.workspace.findUnique({ where: { id } });
  if (!workspace) return null;

  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
  };
});

// --- People ------------------------------------------------------------------

/** Everyone in the workspace, for every picker and roster in the app. */
export const getMembers = cache(async (workspaceId: string): Promise<Member[]> => {
  const rows = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
    include: { user: true },
  });

  return rows.map((row) => ({
    id: row.user.id,
    name: row.user.name,
    email: row.user.email,
    image: row.user.image,
    role: roleToDomain[row.role],
    designation: row.user.designation,
    hourlyRate: row.user.hourlyRate,
    monthlyHours: row.user.monthlyHours,
    disabled: row.user.disabledAt !== null,
  }));
});

export const getMember = cache(async (workspaceId: string, id: string) => {
  const members = await getMembers(workspaceId);
  return members.find((member) => member.id === id) ?? null;
});

// --- Projects and tasks ------------------------------------------------------

/**
 * Projects in a workspace, optionally narrowed to one person's.
 *
 * Pass `memberId` for anything the signed-in user *browses* — the sidebar, All
 * Projects, tasks, the calendar — so they only see projects they were added to.
 * Omit it for workspace-level aggregates like `getMetrics`,
 * which report on the workspace rather than on the viewer, and would otherwise
 * quietly change meaning per person.
 *
 * `cache()` keys on both arguments, so the scoped and unscoped reads in one
 * request do not collide.
 */
export const getProjects = cache(
  async (workspaceId: string, memberId?: string): Promise<Project[]> => {
  const projects = await prisma.project.findMany({
    where: {
      workspaceId,
      ...(memberId ? { members: { some: { userId: memberId } } } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: { members: { include: { user: { select: personSelect } } } },
  });

  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description,
    status: projectStatusToDomain[project.status],
    color: project.color,
    startDate: dateToIso(project.startDate),
    endDate: dateToIso(project.endDate),
    // Null means the project predates the column, so it keeps the pages it
    // already showed rather than losing them all at once.
    features: Array.isArray(project.features)
      ? (project.features as ProjectFeature[])
      : DEFAULT_PROJECT_FEATURES,
    members: project.members.map((link) => link.user as Person),
  }));
});

/**
 * One project, **as the viewer is allowed to see it**.
 *
 * `memberId` is `projectScope()`: undefined for an admin, who is responsible
 * for the whole workspace, and the viewer's own id for everybody else.
 *
 * Omitting it is what the bug was. This resolved through the unscoped
 * `getProjects`, so the project *list* was narrowed to what you had been added
 * to while the project *page* was not — anybody in the workspace could open any
 * project by id and read its tasks, members and hours. Returning null for a
 * non-member turns that into the `notFound()` these pages already handle.
 */
export const getProject = cache(
  async (workspaceId: string, id: string, memberId?: string) => {
    const projects = await getProjects(workspaceId, memberId);
    return projects.find((project) => project.id === id) ?? null;
  },
);

/**
 * Every task in the workspace, archived ones included.
 *
 * Almost nothing wants this — see `getTasks`, which is the one to reach for.
 * It exists so a task that has been archived can still be *opened*: a link to
 * its detail page, and its time entries, must keep working after it leaves the
 * board.
 */
const getAllTasks = cache(async (workspaceId: string): Promise<Task[]> => {
  const [tasks, tracked, subtaskCounts] = await Promise.all([
    prisma.task.findMany({
      where: { project: { workspaceId } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: {
        assignees: { include: { user: { select: personSelect } } },
        labels: { include: { label: true } },
        _count: { select: { attachments: true } },
      },
    }),
    // One grouped query rather than loading every entry through each task:
    // the totals are wanted on the board, where a per-task include would mean
    // fetching every minute ever logged just to render a badge.
    prisma.timeEntry.groupBy({
      by: ["taskId"],
      where: { task: { project: { workspaceId } } },
      _sum: { minutes: true },
    }),
    // Same reasoning for subtasks: a count per task, not every checklist item,
    // is all the board needs.
    prisma.subtask.groupBy({
      by: ["taskId", "status"],
      where: { task: { project: { workspaceId } } },
      _count: { _all: true },
    }),
  ]);

  const minutesByTask = new Map(tracked.map((row) => [row.taskId, row._sum.minutes ?? 0]));

  const subtaskStatsByTask = new Map<string, { total: number; done: number }>();
  for (const row of subtaskCounts) {
    const current = subtaskStatsByTask.get(row.taskId) ?? { total: 0, done: 0 };
    current.total += row._count._all;
    if (row.status === "DONE") current.done += row._count._all;
    subtaskStatsByTask.set(row.taskId, current);
  }

  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    projectId: task.projectId,
    status: taskStatusToDomain[task.status],
    priority: priorityToDomain[task.priority],
    assignees: task.assignees.map((link) => link.user as Person),
    labels: task.labels.map((link) => ({
      id: link.label.id,
      name: link.label.name,
      color: link.label.color,
    })),
    estimateHours: minutesToHours(task.estimateMinutes),
    dueDate: dateToIso(task.dueDate),
    subtasksTotal: subtaskStatsByTask.get(task.id)?.total ?? 0,
    subtasksDone: subtaskStatsByTask.get(task.id)?.done ?? 0,
    trackedHours: minutesToHours(minutesByTask.get(task.id) ?? 0),
    attachmentCount: task._count.attachments,
    coverUrl: task.coverKey ? buildR2Url(task.coverKey) : null,
    archived: task.archivedAt !== null,
    listId: task.listId,
    position: task.position,
  }));
});

/**
 * The live tasks in the workspace.
 *
 * Archived tasks are filtered out here, once, rather than at each of the many
 * call sites: they should not appear on boards, and should not count towards
 * progress, totals or overdue warnings. `getArchivedTasks` is the way to see
 * them.
 */
export const getTasks = cache(async (workspaceId: string): Promise<Task[]> => {
  const tasks = await getAllTasks(workspaceId);
  return tasks.filter((task) => !task.archived);
});

export const getArchivedTasks = cache(async (workspaceId: string): Promise<Task[]> => {
  const tasks = await getAllTasks(workspaceId);
  return tasks.filter((task) => task.archived);
});

/** One task by id, archived or not. */
export const getTask = cache(async (workspaceId: string, id: string) => {
  const tasks = await getAllTasks(workspaceId);
  return tasks.find((task) => task.id === id) ?? null;
});

export const getTimeEntries = cache(async (workspaceId: string): Promise<TimeEntry[]> => {
  const entries = await prisma.timeEntry.findMany({
    where: { task: { project: { workspaceId } } },
    orderBy: { date: "asc" },
  });

  return entries.map((entry) => ({
    id: entry.id,
    date: dateToIso(entry.date)!,
    userId: entry.userId,
    taskId: entry.taskId,
    hours: minutesToHours(entry.minutes),
    note: entry.note,
    startedAt: entry.startedAt?.toISOString() ?? null,
    endedAt: entry.endedAt?.toISOString() ?? null,
    subtaskId: entry.subtaskId,
  }));
});

/** The labels defined in this workspace, for the picker and the filter bar. */
export const getLabels = cache(async (workspaceId: string): Promise<Label[]> => {
  const labels = await prisma.label.findMany({
    where: { workspaceId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true },
  });
  return labels;
});

/** How many tasks carry each label — what makes deleting one safe to confirm. */
export const getLabelUsage = cache(async (workspaceId: string) => {
  const rows = await prisma.taskLabel.groupBy({
    by: ["labelId"],
    where: { label: { workspaceId } },
    _count: { taskId: true },
  });
  return new Map(rows.map((row) => [row.labelId, row._count.taskId]));
});

/** One person's time entries against one task, newest first, with who logged them. */
export const getTaskEntries = cache(
  async (workspaceId: string, taskId: string): Promise<TaskEntry[]> => {
    const entries = await prisma.timeEntry.findMany({
      where: { taskId, task: { project: { workspaceId } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { user: { select: personSelect } },
    });

    return entries.map((entry) => ({
      id: entry.id,
      date: dateToIso(entry.date)!,
      userId: entry.userId,
      taskId: entry.taskId,
      hours: minutesToHours(entry.minutes),
      note: entry.note,
      startedAt: entry.startedAt?.toISOString() ?? null,
      endedAt: entry.endedAt?.toISOString() ?? null,
      subtaskId: entry.subtaskId,
      user: entry.user as Person,
    }));
  },
);

/** The images attached to a task, oldest first. */
export const getTaskAttachments = cache(
  async (workspaceId: string, taskId: string): Promise<Attachment[]> => {
    const rows = await prisma.taskAttachment.findMany({
      where: { taskId, task: { project: { workspaceId } } },
      orderBy: { createdAt: "asc" },
      include: { uploadedBy: { select: personSelect } },
    });

    return rows.map((row) => ({
      id: row.id,
      taskId: row.taskId,
      subtaskId: row.subtaskId,
      objectKey: row.objectKey,
      // Resolved here rather than in the component, so the bucket's public
      // domain is read in one place instead of everywhere an image is drawn.
      url: buildR2Url(row.objectKey),
      filename: row.filename,
      mimeType: row.mimeType,
      size: row.size,
      width: row.width,
      height: row.height,
      uploadedBy: (row.uploadedBy as Person | null) ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  },
);

/** Subtasks of one task, or of every task in a project, in the order arranged. */
async function loadSubtasks(
  workspaceId: string,
  scope: { taskId: string } | { projectId: string },
): Promise<Subtask[]> {
  const taskWhere = {
    ...("taskId" in scope ? { id: scope.taskId } : { projectId: scope.projectId }),
    project: { workspaceId },
  };
  const [rows, tracked] = await Promise.all([
    prisma.subtask.findMany({
      where: { task: taskWhere },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: {
        assignee: { select: personSelect },
        attachments: {
          orderBy: { createdAt: "asc" },
          select: { id: true, filename: true, objectKey: true, mimeType: true, size: true },
        },
      },
    }),
    // Summed per subtask in the database rather than by loading every entry.
    prisma.timeEntry.groupBy({
      by: ["subtaskId"],
      where: { subtaskId: { not: null }, task: taskWhere },
      _sum: { minutes: true },
    }),
  ]);

  const minutesBySubtask = new Map(tracked.map((row) => [row.subtaskId, row._sum.minutes ?? 0]));

  return rows.map((row) => ({
    id: row.id,
    taskId: row.taskId,
    parentId: row.parentId,
    title: row.title,
    description: row.description,
    assignee: (row.assignee as Person | null) ?? null,
    status: taskStatusToDomain[row.status],
    estimateMinutes: row.estimateMinutes,
    position: row.position,
    trackedMinutes: minutesBySubtask.get(row.id) ?? 0,
    files: row.attachments.map((file) => ({
      id: file.id,
      filename: file.filename,
      url: buildR2Url(file.objectKey),
      mimeType: file.mimeType,
      size: file.size,
    })),
  }));
}

/** A task's checklist, in the order it was arranged. */
export const getTaskSubtasks = cache(
  (workspaceId: string, taskId: string): Promise<Subtask[]> =>
    loadSubtasks(workspaceId, { taskId }),
);

/** Every subtask in a project, for the board's subtasks dialog. */
export const getProjectSubtasks = cache(
  (workspaceId: string, projectId: string): Promise<Subtask[]> =>
    loadSubtasks(workspaceId, { projectId }),
);

/**
 * The viewer's notifications in this workspace, newest first.
 *
 * Capped rather than paged: the bell is a glance, not an inbox, and a count of
 * everything unread is carried separately so the badge stays honest past the
 * cap.
 */
export const getNotifications = cache(
  async (
    workspaceId: string,
    userId: string,
  ): Promise<{ items: AppNotification[]; unread: number }> => {
    const [rows, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { workspaceId, userId },
        orderBy: { createdAt: "desc" },
        take: 15,
        include: { actor: { select: personSelect } },
      }),
      prisma.notification.count({ where: { workspaceId, userId, readAt: null } }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        href: row.href,
        actor: (row.actor as Person | null) ?? null,
        createdAt: row.createdAt.toISOString(),
        read: row.readAt !== null,
      })),
      unread,
    };
  },
);

/**
 * The deployment's branding, as URLs ready to render.
 *
 * Not workspace-scoped and not behind auth: the favicon and the sign-in screen
 * both need it before anyone has a session, let alone a workspace.
 */
export const getBranding = cache(async (): Promise<Branding> => {
  const settings = await prisma.appSetting.findUnique({ where: { id: "app" } });
  const url = (key: string | null | undefined) => (key ? buildR2Url(key) : null);

  return {
    logoLight: url(settings?.logoLightKey),
    logoDark: url(settings?.logoDarkKey),
    favicon: url(settings?.faviconKey),
  };
});

/**
 * The timer this person currently has running, if any.
 *
 * Read from the database on every request rather than kept in the client, so
 * the answer is the same after a refresh, in a second tab, or on another
 * machine — and so "one timer per user" is a fact rather than a hope.
 */
export const getRunningTimer = cache(
  async (workspaceId: string, userId: string): Promise<RunningTimer | null> => {
    const timer = await prisma.taskTimer.findUnique({
      where: { userId },
      include: {
        task: { include: { project: { select: { id: true, name: true, workspaceId: true } } } },
        subtask: { select: { title: true } },
      },
    });

    // A timer started in another workspace is none of this one's business —
    // showing it would leak a task title across the tenancy boundary.
    if (!timer || timer.task.project.workspaceId !== workspaceId) return null;

    return {
      taskId: timer.taskId,
      taskTitle: timer.task.title,
      projectId: timer.task.project.id,
      projectName: timer.task.project.name,
      startedAt: timer.startedAt.toISOString(),
      pausedAt: timer.pausedAt?.toISOString() ?? null,
      note: timer.note,
      subtaskId: timer.subtaskId,
      subtaskTitle: timer.subtask?.title ?? null,
    };
  },
);

/**
 * One person's logged hours for today and for the current week.
 *
 * "Today" is the server's calendar day — the same one `TimeEntry.date` is
 * written with — so a timer stopped a minute ago shows up here.
 */
export const getTimeSummary = cache(async (workspaceId: string, userId: string) => {
  const now = new Date();
  const entries = await prisma.timeEntry.findMany({
    where: { userId, task: { project: { workspaceId } } },
    select: { minutes: true, date: true },
  });

  const totals = entries.reduce(
    (sums, entry) => {
      // `date` is a date-only column; compared as a calendar day, not as an
      // instant, so the answer does not shift with the server's timezone.
      const day = dateToIso(entry.date)!;
      if (isSameDay(day, now)) sums.today += entry.minutes;
      if (isSameWeek(day, now)) sums.week += entry.minutes;
      return sums;
    },
    { today: 0, week: 0 },
  );

  return { todayMinutes: totals.today, weekMinutes: totals.week };
});

// --- Derived views ------------------------------------------------------------

export type EntryDetail = TimeEntry & {
  member: Member;
  task: Task;
  project: Project;
  /** Estimate minus logged hours; negative means over estimate. */
  variance: number;
};

/** Time entries joined with their member, task and project, oldest first. */
export const getEntryDetails = cache(async (workspaceId: string): Promise<EntryDetail[]> => {
  const [entries, tasks, projects, members] = await Promise.all([
    getTimeEntries(workspaceId),
    getTasks(workspaceId),
    getProjects(workspaceId),
    getMembers(workspaceId),
  ]);

  return entries.flatMap((entry) => {
    const task = tasks.find((item) => item.id === entry.taskId);
    const member = members.find((item) => item.id === entry.userId);
    const project = task ? projects.find((item) => item.id === task.projectId) : undefined;
    if (!task || !member || !project) return [];

    return [
      {
        ...entry,
        member,
        task,
        project,
        variance: task.estimateHours - entry.hours,
      },
    ];
  });
});

export const getProjectStats = cache(async (workspaceId: string, projectId: string) => {
  const [allTasks, entries] = await Promise.all([
    getTasks(workspaceId),
    getTimeEntries(workspaceId),
  ]);

  const tasks = allTasks.filter((task) => task.projectId === projectId);
  const taskIds = new Set(tasks.map((task) => task.id));
  const projectEntries = entries.filter((entry) => taskIds.has(entry.taskId));
  const done = tasks.filter((task) => task.status === "done").length;
  const hours = projectEntries.reduce((sum, entry) => sum + entry.hours, 0);

  return {
    tasks,
    taskCount: tasks.length,
    done,
    inProgress: tasks.filter((task) => task.status === "in-progress").length,
    byStatus: TASK_STATUSES.map(({ status, label }) => {
      const count = tasks.filter((task) => task.status === status).length;
      return { status, label, count, percent: percent(count, tasks.length) };
    }),
    progress: percent(done, tasks.length),
    hours: round1(hours),
    estimateHours: round1(tasks.reduce((sum, task) => sum + task.estimateHours, 0)),
    entries: projectEntries,
  };
});

export const getMemberStats = cache(async (workspaceId: string, memberId: string) => {
  const [allTasks, entries, member] = await Promise.all([
    getTasks(workspaceId),
    // Not scoped: this is already asked for one person by id, and the caller
    // only ever has ids it was allowed to see.
    getTimeEntries(workspaceId),
    getMember(workspaceId, memberId),
  ]);

  const mine = entries.filter((entry) => entry.userId === memberId);
  const assigned = allTasks.filter((task) =>
    task.assignees.some((person) => person.id === memberId),
  );
  const hours = mine.reduce((sum, entry) => sum + entry.hours, 0);

  return {
    hours: round1(hours),
    hoursExact: hours,
    tasks: assigned,
    tasksTotal: assigned.length,
    tasksDone: assigned.filter((task) => task.status === "done").length,
    projectCount: new Set(
      mine.flatMap((entry) => {
        const task = allTasks.find((item) => item.id === entry.taskId);
        return task ? [task.projectId] : [];
      }),
    ).size,
    utilization: member?.monthlyHours ? percent(hours, member.monthlyHours) : 0,
  };
});

/** Hours logged vs estimated across every task assigned to a member. */
export const getMemberVariance = cache(async (workspaceId: string, memberId: string) => {
  const [tasks, entries] = await Promise.all([getTasks(workspaceId), getTimeEntries(workspaceId)]);

  const estimate = tasks
    .filter((task) => task.assignees.some((person) => person.id === memberId))
    .reduce((sum, task) => sum + task.estimateHours, 0);
  const logged = entries
    .filter((entry) => entry.userId === memberId)
    .reduce((sum, entry) => sum + entry.hours, 0);

  return { logged, estimate, variance: estimate - logged };
});

/** Hours logged per day, oldest first. */
export const getHoursByDay = cache(async (workspaceId: string) => {
  const entries = await getTimeEntries(workspaceId);
  const byDate = new Map<string, number>();

  for (const entry of entries) {
    byDate.set(entry.date, (byDate.get(entry.date) ?? 0) + entry.hours);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, hours]) => ({ date, label: formatDay(date), hours: round1(hours) }));
});

export const getTaskDistribution = cache(async (workspaceId: string) => {
  const tasks = await getTasks(workspaceId);
  return TASK_STATUSES.map(({ status, label }) => ({
    status: status as TaskStatus,
    label,
    count: tasks.filter((task) => task.status === status).length,
  }));
});

export const getOverdueTasks = cache(async (workspaceId: string) => {
  const tasks = await getTasks(workspaceId);
  return tasks.filter(
    (task) => task.dueDate && task.dueDate < todayIso() && task.status !== "done",
  );
});

/**
 * The headline figures, counted over **what the viewer may see**.
 *
 * Two scopes, because two different questions decide the answer:
 *
 *   `projects` is `projectScope()` — which projects you were added to. It
 *   narrows the project counts, and through them the task counts and hours,
 *   since a task belongs to a project.
 *
 * It was absent, so these read the whole workspace while the grid beside them
 * was already narrowed: somebody on one of five projects saw "Total Projects:
 * 5" above a grid showing one. A figure on a scoped screen has to be counted
 * over the same rows the screen is showing, or it is not a total of anything
 * the viewer can point at.
 */
export const getMetrics = cache(
  async (workspaceId: string, scope: { projects?: string } = {}) => {
  const [projects, allTasks, allEntries, members] = await Promise.all([
    getProjects(workspaceId, scope.projects),
    getTasks(workspaceId),
    getTimeEntries(workspaceId),
    getMembers(workspaceId),
  ]);

  // Tasks and hours follow the projects: `getTasks` is workspace-wide and
  // `cache()`d, so narrowing here reuses that one query rather than issuing a
  // second, differently-filtered one.
  const visibleProjects = new Set(projects.map((project) => project.id));
  const tasks = allTasks.filter((task) => visibleProjects.has(task.projectId));

  const visibleTasks = new Set(tasks.map((task) => task.id));
  const entries = allEntries.filter((entry) => visibleTasks.has(entry.taskId));

  const totalHours = entries.reduce((sum, entry) => sum + entry.hours, 0);
  const done = tasks.filter((task) => task.status === "done").length;
  const overdue = tasks.filter(
    (task) => task.dueDate && task.dueDate < todayIso() && task.status !== "done",
  ).length;

  return {
    activeProjects: projects.filter((project) => project.status === "active").length,
    planningProjects: projects.filter((project) => project.status === "planning").length,
    completedProjects: projects.filter((project) => project.status === "completed").length,
    totalProjects: projects.length,
    tasksTotal: tasks.length,
    tasksDone: done,
    completionRate: percent(done, tasks.length),
    hoursTracked: round1(totalHours),
    totalHoursExact: totalHours,
    memberCount: members.length,
    overdueCount: overdue,
  };
  },
);

export type Metrics = Awaited<ReturnType<typeof getMetrics>>;

// --- Project children ----------------------------------------------------------

export const getCampaigns = cache(
  async (workspaceId: string, projectId: string): Promise<Campaign[]> => {
    const campaigns = await prisma.campaign.findMany({
      where: { projectId, project: { workspaceId } },
      orderBy: { createdAt: "asc" },
    });

    return campaigns.map((campaign) => ({
      id: campaign.id,
      projectId: campaign.projectId,
      name: campaign.name,
      description: campaign.description,
      status: campaignStatusToDomain[campaign.status],
      progress: campaign.progress,
      startDate: dateToIso(campaign.startDate),
      endDate: dateToIso(campaign.endDate),
      budget: campaign.budget,
    }));
  },
);

export const getLandingSections = cache(
  async (workspaceId: string, projectId: string): Promise<LandingSection[]> => {
    const sections = await prisma.landingSection.findMany({
      where: { projectId, project: { workspaceId } },
      orderBy: { position: "asc" },
    });

    return sections.map((section) => ({
      id: section.id,
      projectId: section.projectId,
      type: sectionTypeToDomain[section.type],
      heading: section.heading,
      subheading: section.subheading,
      items: Array.isArray(section.items) ? (section.items as string[]) : null,
      primaryCta: section.primaryCta,
      secondaryCta: section.secondaryCta,
      position: section.position,
    }));
  },
);

// --- Activity and messages ------------------------------------------------------

export const getActivity = cache(
  async (workspaceId: string, limit = 5): Promise<ActivityEntry[]> => {
    const rows = await prisma.activityEntry.findMany({
      where: { workspaceId },
      orderBy: { at: "desc" },
      take: limit,
      include: { user: { select: personSelect } },
    });

    return rows.map((row) => ({
      id: row.id,
      actor: row.user as Person,
      action: row.action,
      target: row.target,
      at: formatTimestamp(row.at),
    }));
  },
);

/** Every message involving `userId` within this workspace, flattened into per-contact threads. */
export const getMessages = cache(
  async (workspaceId: string, userId: string): Promise<Message[]> => {
    const rows = await prisma.message.findMany({
      where: { workspaceId, OR: [{ senderId: userId }, { recipientId: userId }] },
      orderBy: { sentAt: "asc" },
    });

    return rows.map((row) => ({
      id: row.id,
      memberId: row.senderId === userId ? row.recipientId : row.senderId,
      from: row.senderId === userId ? "me" : "them",
      text: row.body,
      date: formatDay(row.sentAt.toISOString().slice(0, 10)),
      time: formatClock(row.sentAt),
    }));
  },
);

const HOUR_FORMAT = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: "UTC",
});

/** `02:30 PM` — fixed to UTC so server and client agree. */
function formatClock(value: Date) {
  return HOUR_FORMAT.format(value);
}

/** `Feb 17, 02:30 PM`. */
function formatTimestamp(value: Date) {
  return `${formatDay(value.toISOString().slice(0, 10))}, ${formatClock(value)}`;
}

// --- Project sheets -----------------------------------------------------------

/** Every sheet in a project, without their cells — enough to draw the tabs. */
export const getProjectSheets = cache(
  async (workspaceId: string, projectId: string): Promise<SheetSummary[]> => {
    const sheets = await prisma.projectSheet.findMany({
      // Scoped through the project, so a foreign id returns nothing.
      where: { projectId, project: { workspaceId } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        updatedAt: true,
        assignee: { select: personSelect },
      },
    });

    return sheets.map((sheet) => ({
      id: sheet.id,
      name: sheet.name,
      assignee: (sheet.assignee as Person | null) ?? null,
      updatedAt: sheet.updatedAt.toISOString(),
    }));
  },
);

/** One sheet with its cells. */
export const getProjectSheet = cache(
  async (workspaceId: string, sheetId: string): Promise<SheetDetail | null> => {
    const sheet = await prisma.projectSheet.findFirst({
      where: { id: sheetId, project: { workspaceId } },
      include: { assignee: { select: personSelect } },
    });
    if (!sheet) return null;

    const rowCount = Math.min(Math.max(sheet.rowCount, 1), SHEET_MAX_ROWS);
    const colCount = Math.min(Math.max(sheet.colCount, 1), SHEET_MAX_COLS);

    return {
      id: sheet.id,
      name: sheet.name,
      assignee: (sheet.assignee as Person | null) ?? null,
      updatedAt: sheet.updatedAt.toISOString(),
      // Every part is normalised on the way out rather than trusted: the
      // stored JSON may predate a limit, or have been written by an import.
      cells: normaliseCells(sheet.cells, rowCount, colCount),
      rowCount,
      colCount,
      formats: normaliseFormats(sheet.formats, rowCount, colCount),
      colWidths: normaliseWidths(sheet.colWidths, colCount),
      frozenRows: sheet.frozenRows > 0 ? 1 : 0,
    };
  },
);

/**
 * Calendar events for one month, oldest first.
 *
 * Scoped by the `[workspaceId, date]` index rather than read whole and
 * filtered: a workspace accumulates events indefinitely, and the grid only
 * ever draws one month.
 *
 * Not scoped to the viewer's projects, unlike `getProjects`. An event is a
 * commitment on the shared calendar — hiding one because its project is not
 * yours would leave a gap in a day everybody else can see, and the attendee
 * list is what decides who is actually expected.
 */
export const getEvents = cache(
  async (workspaceId: string, fromIso: string, toIso: string): Promise<CalendarEvent[]> => {
    const rows = await prisma.event.findMany({
      where: {
        workspaceId,
        date: { gte: isoToDate(fromIso)!, lte: isoToDate(toIso)! },
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      include: {
        project: { select: { id: true, name: true } },
        attendees: { include: { user: { select: personSelect } } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      date: dateToIso(row.date)!,
      startTime: row.startTime,
      endTime: row.endTime,
      reminderMinutes: row.reminderMinutes,
      projectId: row.project?.id ?? null,
      projectName: row.project?.name ?? null,
      attendees: row.attendees.map((attendee) => attendee.user as Person),
      createdById: row.createdById,
    }));
  },
);
