/**
 * Domain types, constants and pure helpers shared by server and client code.
 *
 * Everything here is data-source agnostic — no Prisma, no I/O — so client
 * components can import it freely. Reads live in `lib/queries.ts`, writes in
 * `lib/actions.ts`.
 *
 * The app speaks lowercase, hyphenated statuses (`"in-progress"`) while the
 * database uses Prisma enums (`IN_PROGRESS`). The query layer translates at the
 * boundary, so nothing in the UI needs to know about the storage format.
 */

export type Role = "admin" | "manager" | "member" | "viewer" | "guest";

/**
 * How the app renders for one person, stored on their account.
 *
 * `"system"` deliberately means *no* class on `<html>` — the
 * `prefers-color-scheme` block in globals.css is what resolves it, so the
 * server never has to guess what the browser will report.
 */
export type Theme = "light" | "dark" | "system";

export const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Soft slate background, warm ivory cards." },
  { value: "dark", label: "Dark", hint: "Near-black background, dark slate cards." },
  { value: "system", label: "System", hint: "Follows your operating system setting." },
];

export type ProjectStatus = "active" | "planning" | "on-hold" | "completed";
export type TaskStatus = "todo" | "in-progress" | "in-review" | "done";
export type Priority = "low" | "medium" | "high" | "urgent";
export type CampaignStatus = "active" | "draft" | "paused" | "completed";
export type SectionType =
  | "hero"
  | "features"
  | "cta"
  | "testimonials"
  | "gallery"
  | "newsletter"
  | "faq";

/**
 * The optional sub-pages a project can switch on. Overview is not here — it is
 * the project itself and is always present.
 *
 * A key is persisted on `Project.features`, so renaming one is a migration.
 */
export type ProjectFeature =
  | "tasks"
  | "campaigns"
  | "landing-pages"
  | "time-tracking"
  | "timesheet"
  | "excel-sheet"
  | "report";

/** The minimum needed to render someone: avatar, name, link. */
export type Person = {
  id: string;
  name: string;
  email: string;
  /** Profile photo URL, or null for the initials fallback. */
  image: string | null;
};

export type Member = Person & {
  role: Role;
  designation: string | null;
  hourlyRate: number;
  monthlyHours: number;
  disabled: boolean;
};

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  description: string;
};

/**
 * One spreadsheet in a project, without its cells — enough to draw a tab.
 *
 * A project may hold several; each is named, and may be assigned to somebody.
 */
export type SheetSummary = {
  id: string;
  name: string;
  assignee: Person | null;
  updatedAt: string;
};

/** How a cell's value is shown. Stored values are never changed by it. */
export type NumberFormat = "general" | "number" | "currency" | "percent" | "date";

/** One cell's formatting. Absent keys mean the default. */
export type CellFormat = {
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  numberFormat?: NumberFormat;
  /** Decimal places for number, currency and percent. */
  decimals?: number;
};

/**
 * Formatting for a whole sheet, keyed `"row:col"` (zero-based). Only cells
 * that have been formatted appear, so a mostly plain sheet stays small.
 */
export type SheetFormats = Record<string, CellFormat>;

/** A sheet with its contents. */
export type SheetDetail = SheetSummary & {
  /**
   * Row-major `string[][]`, always exactly `rowCount` × `colCount`, exactly as
   * typed: formulas are kept as their text ("=SUM(A1:A3)"), never as results.
   */
  cells: string[][];
  rowCount: number;
  colCount: number;
  formats: SheetFormats;
  /** Pixel width per column; a missing entry means the default width. */
  colWidths: number[];
  /** Rows pinned while scrolling — 0 or 1. */
  frozenRows: number;
};

/** A workspace as it appears in the switcher — with the caller's role in it. */
export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: Role;
  /** Shown when confirming deletion, and what blocks it. */
  projectCount: number;
  /** Members whose account can still sign in — the caller included. */
  activeUserCount: number;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  color: string;
  startDate: string | null;
  endDate: string | null;
  /** Which optional sub-pages this project has switched on. */
  features: ProjectFeature[];
  members: Person[];
};

/** One bell entry: something that happened, addressed to one person. */
export type AppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** Where clicking it goes, or "" when it leads nowhere. */
  href: string;
  /** Who caused it, when the app itself did not. */
  actor: Person | null;
  createdAt: string;
  read: boolean;
};

/**
 * A dated entry on the shared calendar.
 *
 * `date` is an ISO day, the same shape as `Task.dueDate`, so the calendar grid
 * can match both against a cell without parsing either.
 */
export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  date: string;
  /** "HH:MM", or null on an all-day event. */
  startTime: string | null;
  endTime: string | null;
  /** Minutes before the start that the reminder goes out. */
  reminderMinutes: number;
  projectId: string | null;
  projectName: string | null;
  attendees: Person[];
  createdById: string | null;
};

/**
 * What the live stream pushes to a signed-in tab.
 *
 * Carries no application data — it is a nudge to refetch, not a diff — so a
 * stale membership or a narrowed role cannot leak through the stream. Lives
 * here rather than beside the publisher because the client component that
 * reads it cannot import a `server-only` module.
 */
export type LiveEvent = {
  kind: "refresh";
  /**
   * Whether the viewer’s **session** moved, not just the data on screen.
   *
   * Re-minting the JWT costs a round trip and a membership read, and the role
   * is the only thing the token carries that anyone else can change — so only
   * a role change asks for it.
   */
  session?: boolean;
  /** Server time, so a client can ignore anything older than its last refresh. */
  at: number;
};

/** A tag that can be put on tasks. Scoped to one workspace. */
export type Label = {
  id: string;
  name: string;
  color: string;
};

export type Task = {
  id: string;
  title: string;
  description: string;
  projectId: string;
  status: TaskStatus;
  priority: Priority;
  assignees: Person[];
  labels: Label[];
  estimateHours: number;
  dueDate: string | null;
  subtasksTotal: number;
  subtasksDone: number;
  /** Hours logged against this task by everyone, from its time entries. */
  trackedHours: number;
  attachmentCount: number;
  /** Image across the top of the card and the task page; null for none. */
  coverUrl: string | null;
  /** Archived tasks keep their history but leave the board. */
  archived: boolean;
  /** The board list the card sits in; null until it is first placed. */
  listId: string | null;
  /** Order within that list, top to bottom. */
  position: number;
};

/**
 * A column on a board. Named freely, but it *counts as* one task status —
 * which is what keeps progress and every report correct however the lists are
 * arranged. A card on a list always has that list's status.
 */
export type BoardList = {
  id: string;
  name: string;
  status: TaskStatus;
  position: number;
};

/** A Trello-style board. A project may have several. */
export type Board = {
  id: string;
  name: string;
  position: number;
  lists: BoardList[];
};

export type TimeEntry = {
  id: string;
  date: string;
  userId: string;
  taskId: string;
  hours: number;
  note: string;
  /**
   * The wall-clock span, when it is known. A timer records both; a manual
   * entry given only as a duration has neither. `hours` is authoritative
   * either way — these are for display and for editing the original times.
   */
  startedAt: string | null;
  endedAt: string | null;
  /** The subtask the time was spent on, if any. It counts toward the task either way. */
  subtaskId: string | null;
};

/** A time entry with the person who logged it, as the task detail lists them. */
export type TaskEntry = TimeEntry & { user: Person };

/**
 * The timer a person currently has running. At most one exists per user.
 *
 * Carries `startedAt` rather than an elapsed count: the client derives the
 * number it shows, so a refresh resumes at the right place instead of at zero.
 */
export type RunningTimer = {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  startedAt: string;
  /** Set while paused; the clock shows the time up to this moment. */
  pausedAt: string | null;
  note: string;
  /** Set when the timer runs on one subtask of the task rather than the task as a whole. */
  subtaskId: string | null;
  subtaskTitle: string | null;
};

/**
 * An image attached to a task. The bytes live in Cloudflare R2, not here.
 *
 * `url` is derived from `objectKey` in the query layer rather than stored, so
 * the bucket's public domain lives in one place. `size` and the dimensions
 * describe the object *as stored*, after sharp has resized and re-encoded it.
 */
export type Attachment = {
  id: string;
  taskId: string;
  /** Set when the file was added to a subtask rather than the task itself. */
  subtaskId: string | null;
  objectKey: string;
  url: string;
  filename: string;
  mimeType: string;
  /** Bytes. */
  size: number;
  width: number | null;
  height: number | null;
  uploadedBy: Person | null;
  createdAt: string;
};

/**
 * A node in a task's subtask tree. Stored flat; `lib/subtask-tree.ts` builds
 * the branches. Its status is independent of the task's — a parent shows its
 * children's progress but is never moved by it.
 */
export type Subtask = {
  id: string;
  taskId: string;
  /** Null for a top-level subtask. */
  parentId: string | null;
  title: string;
  description: string;
  /** Who is doing it, or null. */
  assignee: Person | null;
  status: TaskStatus;
  estimateMinutes: number;
  position: number;
  /** Minutes logged directly on this subtask — not its children. */
  trackedMinutes: number;
  files: SubtaskFile[];
};

/** A file on a subtask — just what the subtask's details dialog lists. */
export type SubtaskFile = {
  id: string;
  filename: string;
  url: string;
  mimeType: string;
  size: number;
};

/**
 * The deployment's branding, as URLs ready to render. Null means no image has
 * been uploaded and the built-in wordmark should be used instead.
 */
export type Branding = {
  logoLight: string | null;
  logoDark: string | null;
  favicon: string | null;
};

export type Campaign = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  status: CampaignStatus;
  progress: number;
  startDate: string | null;
  endDate: string | null;
  budget: number;
};

export type LandingSection = {
  id: string;
  projectId: string;
  type: SectionType;
  heading: string;
  subheading: string | null;
  items: string[] | null;
  primaryCta: string | null;
  secondaryCta: string | null;
  position: number;
};

export type ActivityEntry = {
  id: string;
  actor: Person;
  action: string;
  target: string;
  at: string;
};

export type Message = {
  id: string;
  /** The other participant in the thread, whichever way it was sent. */
  memberId: string;
  from: "me" | "them";
  text: string;
  date: string;
  time: string;
  /**
   * Whether the recipient has read it. Always true for a message you sent —
   * only the recipient's own reading is tracked — so the thread view uses this
   * to decide whether opening it has anything left to mark.
   */
  read: boolean;
};

/** Product branding shown before sign-in, when there's no session/workspace yet. */
export const APP_NAME = "Acme Corp";

export const TASK_STATUSES: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in-progress", label: "In Progress" },
  { status: "in-review", label: "In Review" },
  { status: "done", label: "Done" },
];

export const PROJECT_STATUSES: ProjectStatus[] = [
  "planning",
  "active",
  "on-hold",
  "completed",
];

export const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];

/** Status values alone, for schema enums. */
export const TASK_STATUS_VALUES: TaskStatus[] = TASK_STATUSES.map((item) => item.status);

export const SECTION_TYPES: SectionType[] = [
  "hero",
  "features",
  "cta",
  "testimonials",
  "gallery",
  "newsletter",
  "faq",
];

export const CAMPAIGN_STATUSES: CampaignStatus[] = ["draft", "active", "paused", "completed"];

/**
 * The optional sub-pages offered when configuring a project, in the order the
 * picker lists them — which is also the order they appear under the project in
 * the sidebar.
 */
export const PROJECT_FEATURES: { key: ProjectFeature; label: string; hint: string }[] = [
  { key: "tasks", label: "Tasks", hint: "Kanban board for this project's work." },
  {
    key: "time-tracking",
    label: "Time Tracking",
    hint: "Log time against this project's tasks, with variance per member.",
  },
  { key: "campaigns", label: "Campaigns", hint: "Marketing campaigns and their budgets." },
  {
    key: "excel-sheet",
    label: "Excel Sheets",
    hint: "Spreadsheets with formulas and formatting — import and export .xlsx.",
  },
  // Retired: the project overview already shows the same figures — status
  // breakdown, member performance and the task list — so a second page saying
  // them again was a page to keep in step for nothing. The export it carried
  // now sits on the overview instead.
  //
  // Still typed, and the route still exists, but it is never offered here and
  // so never appears in the nav. Its page guards on the feature being present,
  // and the migration that retired it removed it from every project, so the
  // route 404s rather than lingering half-alive.
  // { key: "report", label: "Reports", hint: "Cost, hours and status summary." },
];

/** Feature keys alone, for schema enums. */
export const PROJECT_FEATURE_KEYS: ProjectFeature[] = PROJECT_FEATURES.map((item) => item.key);

/**
 * What a project shows when `features` has never been set. Matches the pages
 * projects displayed before they became optional, so the column arriving does
 * not silently hide anything.
 */
export const DEFAULT_PROJECT_FEATURES: ProjectFeature[] = ["tasks", "campaigns"];

export const DESIGNATIONS = [
  "Software Engineer",
  "Senior Software Engineer",
  "Engineering Manager",
  "Product Designer",
  "Product Manager",
  "QA Engineer",
  "DevOps Engineer",
  "Marketing Specialist",
  "Content Writer",
];

/** Swatches offered when creating a project. */
export const COLOR_SWATCHES = [
  "hsl(var(--primary))",
  "#21c45d",
  "#f59f0a",
  "#ef4343",
  "#a73cdd",
  "#1ac3e6",
];

/** Swatches offered when creating a label. */
export const LABEL_COLORS = [
  "#64748B",
  "#1E3A5F",
  "#21C45D",
  "#F59F0A",
  "#EF4343",
  "#A73CDD",
  "#1AC3E6",
];


// --- Date helpers ----------------------------------------------------------
// All UTC-based so a server in one timezone and a browser in another agree.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const FULL_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Formats `2026-02-17` as `Feb 17` without depending on the runtime locale. */
export function formatDay(iso: string) {
  const [, month, day] = iso.split("-");
  return `${MONTHS[Number(month) - 1]} ${Number(day)}`;
}

/** Parses `2026-02-17` as a UTC date, avoiding local-timezone drift. */
export function parseDay(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function toIso(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Today, as `yyyy-MM-dd` in the running process's own timezone.
 *
 * This is the app's single notion of a day, and it is the *server's* day on
 * purpose: `TimeEntry.date` is a date-only column written from the server's
 * local calendar, so overdue checks, week grids and day comparisons all have to
 * read it the same way to agree with what was stored.
 *
 * Client components should therefore be handed the server's value as a prop
 * rather than calling this themselves — otherwise a browser in a different
 * timezone can disagree with the markup it is hydrating.
 *
 * This replaced a `TODAY` constant frozen at a demo date. Time tracking records
 * real timestamps, and a fixed "today" filed live work into a week nobody was
 * looking at.
 */
export function todayIso() {
  const now = new Date();
  // Build the local calendar day as a UTC instant, so `toIso` — which formats
  // in UTC — prints the local date rather than shifting it.
  return toIso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

/** The seven ISO dates of the Monday-start week containing `iso`. */
export function getWeekDays(iso: string) {
  const date = parseDay(iso);
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(date.getTime() - weekday * DAY_MS);
  return Array.from({ length: 7 }, (_, index) => toIso(new Date(monday.getTime() + index * DAY_MS)));
}

export function shiftWeek(iso: string, weeks: number) {
  return toIso(new Date(parseDay(iso).getTime() + weeks * 7 * DAY_MS));
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Calendar grid (Sunday-start) for the month containing `iso`. */
export function getMonthGrid(iso: string) {
  const date = parseDay(iso);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const leading = first.getUTCDay();

  const cells: (string | null)[] = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(toIso(new Date(Date.UTC(year, month, day))));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  return { cells, label: `${FULL_MONTHS[month]} ${year}` };
}

// --- Small numeric helpers -------------------------------------------------

export function round1(value: number) {
  return Math.round(value * 10) / 10;
}

export function percent(part: number, whole: number) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

export const minutesToHours = (minutes: number) => minutes / 60;
export const hoursToMinutes = (hours: number) => Math.round(hours * 60);
