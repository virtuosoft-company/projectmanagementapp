/**
 * Validation schemas
 * Zod schemas shared by forms and the server actions they submit to.
 *
 * A schema is defined once and used on both sides: the form parses to give
 * immediate feedback, the action parses again because that is the copy an
 * attacker cannot skip. `z.infer` then keeps the action's input type honest.
 */

import { z } from "zod";
import {
  CAMPAIGN_STATUSES,
  PRIORITIES,
  PROJECT_FEATURE_KEYS,
  PROJECT_STATUSES,
  SECTION_TYPES,
  TASK_STATUS_VALUES,
} from "@/lib/domain";
import { APP_PAGE_KEYS, PERMISSION_KEYS, ROLES, isFixedRole } from "@/lib/permissions";

// ============================================================================
// SHARED FIELDS
// ============================================================================

/** Digits, spaces and the usual punctuation, 7–20 characters. */
const PHONE_PATTERN = /^[+]?[\d\s().-]{7,20}$/;

/** At least one lowercase, uppercase, digit and symbol from @$!%*?& */
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/;

export const PASSWORD_MIN_LENGTH = 8;

/**
 * Trim and lowercase **before** validating, not after.
 *
 * `z.email()` is the validator, and `.trim()`/`.toLowerCase()` chained onto it
 * run on the value it already accepted — so a pasted address with a trailing
 * space was rejected outright rather than cleaned up. That reached sign-in,
 * invitations and both user forms.
 *
 * Lowercasing matters beyond tidiness: `authorize()` looks an account up by the
 * lowercased address, so a capitalised one stored here would lock the holder
 * out.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address."));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .regex(
    PASSWORD_PATTERN,
    "Password needs an uppercase letter, a lowercase letter, a number and one of @$!%*?&.",
  );

export const phoneSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || PHONE_PATTERN.test(value), "Enter a valid phone number.");

export const nameSchema = (label: string) =>
  z.string().trim().min(1, `${label} is required.`).max(50, `${label} must be 50 characters or fewer.`);

export const roleSchema = z.enum(ROLES as [string, ...string[]]);

/** ISO day (`2026-02-17`) or empty, normalised to `string | null`. */
export const isoDateSchema = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Enter a valid date.")
  .transform((value) => value || null);

/** The individual rules, for the live checklist under a password field. */
export const passwordChecks = [
  { label: "8+ characters", test: (value: string) => value.length >= PASSWORD_MIN_LENGTH },
  { label: "Uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
  { label: "Lowercase letter", test: (value: string) => /[a-z]/.test(value) },
  { label: "Number", test: (value: string) => /\d/.test(value) },
  { label: "Symbol (@$!%*?&)", test: (value: string) => /[@$!%*?&]/.test(value) },
];

// ============================================================================
// AUTH
// ============================================================================

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
});

// ============================================================================
// USERS
// ============================================================================

export const createUserSchema = z
  .object({
    firstName: nameSchema("First name"),
    lastName: nameSchema("Last name"),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm the password."),
    phone: phoneSchema,
    role: roleSchema,
    designation: z.string().trim().max(60).default(""),
    monthlyHours: z.coerce.number().int().min(0).max(744, "That is more hours than a month has."),
    active: z.boolean(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "The two passwords do not match.",
    path: ["confirmPassword"],
  });

/**
 * Editing an existing account.
 *
 * Deliberately the same profile fields as creation, minus the password (which
 * has its own flow) and minus the role and active flag, which have their own
 * controls on the Users table and their own last-admin guards.
 */
export const updateUserSchema = z.object({
  userId: z.string().min(1),
  name: nameSchema("Name"),
  email: emailSchema,
  phone: phoneSchema,
  designation: z.string().trim().max(60).default(""),
  monthlyHours: z.coerce.number().int().min(0).max(744, "That is more hours than a month has."),
});

/** The lighter invite used from the settings screen — no password required. */
export const inviteMemberSchema = z.object({
  name: nameSchema("Name"),
  email: emailSchema,
  role: roleSchema,
  password: z
    .string()
    .refine(
      (value) => value === "" || value.length >= PASSWORD_MIN_LENGTH,
      `Temporary password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    ),
});

export const updateRoleSchema = z.object({
  userId: z.string().min(1, "Pick a member."),
  role: roleSchema,
});

export const setDisabledSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1, "Select at least one account."),
  disabled: z.boolean(),
});

/**
 * A role an owner or admin defines.
 *
 * `inheritsFrom` is required, not optional with a default: it is what every
 * role-based guard reads, and a role that silently fell back to the least
 * privileged base would look correct in the UI while refusing its holder
 * everywhere.
 */
export const customRoleSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Give the role a name.")
    .max(40)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens.")
    // Only the fixed roles are reserved. Manager, Member, Viewer and Guest are
    // themselves seeded as editable roles, so those names are legitimately in
    // use here and must stay available.
    .refine((value) => !isFixedRole(value), "That name belongs to a fixed role."),
  label: z.string().trim().min(1, "Give the role a label.").max(60),
  description: z.string().trim().max(500).default(""),
  inheritsFrom: roleSchema,
  permissions: z.array(z.enum(PERMISSION_KEYS as [string, ...string[]])),
  // Assigned outright, so no ceiling is applied here or in the action — unlike
  // `permissions`, a page may be granted to a role that holds none of the
  // permissions behind it. The page then opens read-only.
  pages: z.array(z.enum(APP_PAGE_KEYS as [string, ...string[]])).default([]),
});

/**
 * Taking somebody off a workspace.
 *
 * The reason is required and not trimmed to nothing: this record is the only
 * account of why somebody left, and "" a year later answers nothing.
 */
export const removeMemberSchema = z.object({
  userId: z.string().min(1),
  reason: z
    .string()
    .trim()
    .min(3, "Say why they are being removed.")
    .max(500, "Keep the reason under 500 characters."),
});

/** Add an account that already exists to the caller's workspace. */
export const addMemberSchema = z.object({
  userId: z.string().min(1, "Pick someone to add."),
  role: roleSchema,
});

// ============================================================================
// WORKSPACE
// ============================================================================

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Give the workspace a name.").max(80),
  description: z.string().trim().max(500).default(""),
});

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Give the workspace a name.").max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "A URL slug is required.")
    .max(60)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens."),
});

// ============================================================================
// PROJECTS
// ============================================================================

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Give the project a name.").max(120),
  description: z.string().trim().max(2000).default(""),
  status: z.enum(PROJECT_STATUSES as [string, ...string[]]),
  color: z.string().min(1),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  memberIds: z.array(z.string().min(1)).default([]),
});

export const updateProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Give the project a name.").max(120),
  description: z.string().trim().max(2000).default(""),
  status: z.enum(PROJECT_STATUSES as [string, ...string[]]),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  // The whole membership, not an addition: the edit dialog renders a checkbox
  // per member with the current ones ticked, so what comes back is the set the
  // project should end up with. It was missing here entirely — zod strips keys
  // it does not declare, so ticking somebody saved cleanly and changed nothing.
  memberIds: z.array(z.string().min(1)).default([]),
});

export const addProjectMembersSchema = z.object({
  projectId: z.string().min(1),
  userIds: z.array(z.string().min(1)).min(1, "Pick at least one person."),
});

/** An empty list is valid — a project may switch every optional page off. */
export const projectFeaturesSchema = z.object({
  projectId: z.string().min(1),
  features: z.array(z.enum(PROJECT_FEATURE_KEYS as [string, ...string[]])),
});

// ============================================================================
// TASKS
// ============================================================================

export const createTaskSchema = z.object({
  projectId: z.string().min(1, "Pick a project."),
  title: z.string().trim().min(1, "Give the task a title.").max(200),
  description: z.string().trim().max(5000).default(""),
  status: z.enum(TASK_STATUS_VALUES as [string, ...string[]]),
  priority: z.enum(PRIORITIES as [string, ...string[]]),
  assigneeIds: z.array(z.string().min(1)).default([]),
  estimateHours: z.coerce.number().min(0).max(10_000),
  dueDate: isoDateSchema,
});

export const moveTaskSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum(TASK_STATUS_VALUES as [string, ...string[]]),
});

/**
 * Editing an existing task.
 *
 * Deliberately the same field set as creation minus `projectId`: a task does
 * not move between projects here, because its time entries, attachments and
 * board position all belong to the project it was created in.
 */
export const updateTaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().trim().min(1, "Give the task a title.").max(200),
  description: z.string().trim().max(5000).default(""),
  status: z.enum(TASK_STATUS_VALUES as [string, ...string[]]),
  priority: z.enum(PRIORITIES as [string, ...string[]]),
  assigneeIds: z.array(z.string().min(1)).default([]),
  labelIds: z.array(z.string().min(1)).default([]),
  estimateHours: z.coerce.number().min(0).max(10_000),
  dueDate: isoDateSchema,
});

export const archiveTaskSchema = z.object({
  taskId: z.string().min(1),
  /** False restores it to the board. */
  archived: z.boolean(),
});

// ============================================================================
// SUBTASKS
// ============================================================================

/** An estimate on a subtask, in whole minutes: up to a working month. */
const subtaskEstimate = z.coerce
  .number()
  .int("Estimate in whole minutes.")
  .min(0, "An estimate cannot be negative.")
  .max(60 * 24 * 31, "That estimate is more than a month.");

export const createSubtaskSchema = z.object({
  taskId: z.string().min(1),
  /** The subtask to nest under; null or absent for a top-level one. */
  parentId: z.string().min(1).nullable().default(null),
  title: z.string().trim().min(1, "Give the subtask a title.").max(200),
  description: z.string().trim().max(5000).default(""),
  /**
   * Empty means nobody, which is what `resolveAssignee` in the action already
   * does with it — `if (!assigneeId) return null`.
   *
   * It was `.min(1, "Choose who this subtask is for.")`, contradicting both
   * that comment and the action: the quick-add on the task screen sends a
   * title and nothing else, so every quick-added subtask failed validation on
   * a field the form does not even offer.
   */
  assigneeId: z.string().trim().default(""),
  estimateMinutes: subtaskEstimate.default(0),
});

/** Only the fields present change — a status click does not resend the title. */
export const updateSubtaskSchema = z.object({
  subtaskId: z.string().min(1),
  title: z.string().trim().min(1, "Give the subtask a title.").max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  /** Absent leaves it alone; it can never be cleared. */
  assigneeId: z.string().trim().min(1, "Choose who this subtask is for.").optional(),
  status: z.enum(TASK_STATUS_VALUES as [string, ...string[]]).optional(),
  estimateMinutes: subtaskEstimate.optional(),
});

// ============================================================================
// LABELS
// ============================================================================

export const labelSchema = z.object({
  name: z.string().trim().min(1, "Give the label a name.").max(40),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour."),
});

export const updateLabelSchema = labelSchema.extend({ id: z.string().min(1) });

// ============================================================================
// TIME TRACKING
// ============================================================================

/** Nothing sensible is longer than a day, whether typed or timed. */
export const MAX_ENTRY_MINUTES = 24 * 60;

export const logTimeSchema = z.object({
  taskId: z.string().min(1, "Pick a task."),
  minutes: z.coerce
    .number()
    .int("Log whole minutes.")
    .min(1, "Log at least one minute.")
    .max(MAX_ENTRY_MINUTES, "That is more than a day."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  note: z.string().trim().max(500).default(""),
});

/** A blank optional field arrives as `""` from a form; treat it as absent. */
const optionalDateTime = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.iso.datetime({ offset: true }).optional(),
);

/**
 * The fields a manual time entry can be given, before the cross-field rules.
 *
 * Two ways to say the same thing: a duration on a day, or a start and an end.
 * Both are offered because both are how people actually remember work — "about
 * an hour yesterday" and "09:15 until 10:40" — and the second additionally
 * records *when*, which the first cannot.
 */
const timeEntryFields = {
  durationMinutes: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce
      .number()
      .int("Log whole minutes.")
      .min(1, "Log at least one minute.")
      .max(MAX_ENTRY_MINUTES, "That is more than a day.")
      .optional(),
  ),
  /** The day a duration-only entry belongs to; ignored when times are given. */
  date: isoDateSchema,
  startedAt: optionalDateTime,
  endedAt: optionalDateTime,
  note: z.string().trim().max(500).default(""),
  /**
   * The subtask the time belongs to. Null clears it; absent leaves an edited
   * entry's subtask as it was.
   */
  subtaskId: z.string().min(1).nullable().optional(),
};

type TimeEntryShape = {
  durationMinutes?: number;
  startedAt?: string;
  endedAt?: string;
};

/**
 * The rules that span more than one field, applied identically to creating and
 * to editing an entry.
 *
 * `superRefine` rather than chained `.refine` calls so each message lands on
 * the field that is actually wrong, and so the object stays extendable — a
 * refined Zod schema is no longer an object and cannot be given an id later.
 */
function checkTimeEntry(data: TimeEntryShape, ctx: z.RefinementCtx) {
  const hasSpan = Boolean(data.startedAt && data.endedAt);

  if (data.durationMinutes === undefined && !hasSpan) {
    ctx.addIssue({
      code: "custom",
      path: ["durationMinutes"],
      message: "Give a duration, or a start and an end time.",
    });
    return;
  }

  if (!hasSpan) return;

  const start = new Date(data.startedAt!).getTime();
  const end = new Date(data.endedAt!).getTime();

  if (end <= start) {
    ctx.addIssue({ code: "custom", path: ["endedAt"], message: "End must be after start." });
    return;
  }

  const minutes = Math.round((end - start) / 60_000);
  if (minutes > MAX_ENTRY_MINUTES) {
    ctx.addIssue({
      code: "custom",
      path: ["endedAt"],
      message: "That is more than a day — split it into separate entries.",
    });
  }

  // Time that has not happened yet cannot have been worked. Allowing it would
  // let a mistyped year put hours into a week nobody can reconcile.
  if (end > Date.now() + 60_000) {
    ctx.addIssue({ code: "custom", path: ["endedAt"], message: "That is in the future." });
  }
}

export const manualTimeEntrySchema = z
  .object({ taskId: z.string().min(1, "Pick a task."), ...timeEntryFields })
  .superRefine(checkTimeEntry);

export const updateTimeEntrySchema = z
  .object({ entryId: z.string().min(1), ...timeEntryFields })
  .superRefine(checkTimeEntry);

export const startTimerSchema = z.object({
  taskId: z.string().min(1, "Pick a task."),
  /** Time a single subtask of the task; null times the task as a whole. */
  subtaskId: z.string().min(1).nullable().default(null),
  note: z.string().trim().max(500).default(""),
});

// ============================================================================
// CAMPAIGNS
// ============================================================================

export const campaignSchema = z.object({
  name: z.string().trim().min(1, "Give the campaign a name.").max(120),
  description: z.string().trim().max(2000).default(""),
  status: z.enum(CAMPAIGN_STATUSES as [string, ...string[]]),
  progress: z.coerce.number().int().min(0).max(100),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  budget: z.coerce.number().int().min(0, "Budget cannot be negative."),
});

// ============================================================================
// LANDING SECTIONS
// ============================================================================

export const addSectionSchema = z.object({
  projectId: z.string().min(1),
  type: z.enum(SECTION_TYPES as [string, ...string[]]),
});

export const updateSectionSchema = z.object({
  id: z.string().min(1),
  heading: z.string().trim().min(1, "A section needs a heading.").max(200),
  subheading: z.string().trim().max(300).nullable(),
  items: z.array(z.string().trim().min(1)).nullable(),
  primaryCta: z.string().trim().max(60).nullable(),
  secondaryCta: z.string().trim().max(60).nullable(),
});

// ============================================================================
// MESSAGES
// ============================================================================

export const sendMessageSchema = z.object({
  recipientId: z.string().min(1, "Pick someone to message."),
  body: z.string().trim().min(1, "Write a message first.").max(4000),
});

// ============================================================================
// ERROR HELPERS
// ============================================================================

export type FieldErrors = Record<string, string>;

/** First message per field, for rendering next to inputs. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

/** A single message, for actions that report one string back to the UI. */
export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "That input is not valid.";
}

// ============================================================================
// CALENDAR EVENTS
// ============================================================================

/** Wall-clock time as `HH:MM`, or empty for an all-day event. */
const timeOfDaySchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$|^$/, "Enter a time as HH:MM.")
  .transform((value) => value || null);

export const eventSchema = z
  .object({
    title: z.string().trim().min(1, "Give the event a title.").max(200),
    description: z.string().trim().max(5000).default(""),
    // Required, unlike a task's due date: an event with no day has nowhere to
    // sit on the grid.
    date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
    projectId: z
      .string()
      .trim()
      .transform((value) => value || null),
    attendeeIds: z.array(z.string().min(1)).default([]),
    // 0 means "no reminder". The ceiling is a week, past which a reminder is
    // not a reminder.
    reminderMinutes: z.coerce.number().int().min(0).max(10_080).default(30),
  })
  .refine(
    (value) => !value.startTime || !value.endTime || value.endTime > value.startTime,
    { message: "The end time must be after the start time.", path: ["endTime"] },
  )
  .refine((value) => !value.endTime || value.startTime, {
    message: "Set a start time as well as an end time.",
    path: ["startTime"],
  });

// ============================================================================
// INVITATIONS
// ============================================================================

/** What an admin fills in to invite somebody who has no account yet. */
export const inviteSchema = z.object({
  email: emailSchema,
  role: roleSchema,
});

/**
 * What the invitee submits on the accept page.
 *
 * No email field: it comes from the invitation row, so a valid token cannot be
 * used to claim a different address. The password rules are the same
 * `passwordSchema` the admin-side create form applies — an account made this
 * way is not held to a lower standard.
 */
export const acceptInvitationSchema = z
  .object({
    token: z.string().min(1).max(512),
    name: nameSchema("Name"),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm the password."),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "The passwords do not match.",
    path: ["confirmPassword"],
  });

// ============================================================================
// PAYLOAD TYPES
// ============================================================================

/**
 * The shape each schema **accepts**, for typing both ends of an action.
 *
 * `z.input`, not `z.infer`: these describe what a caller sends, before
 * defaults are filled in and transforms applied. `z.infer` is what the action
 * receives *after* `safeParse`, and the two differ wherever a field has a
 * default or a transform — `description` is optional going in and a string
 * coming out; an empty date goes in as `""` and comes out as `null`.
 *
 * **These types do not replace validation.** A server action is a public
 * endpoint: the argument arrives over the wire and can be anything, whatever
 * the signature says. Every action still calls `safeParse` and still refuses
 * what fails. The type is a compile-time aid for this codebase's own call
 * sites, nothing more.
 *
 * Use them in two places, because they catch different mistakes:
 *
 *   **On the action's parameter** — catches a missing or wrong-typed field at
 *   the call site.
 *
 *   **On the form's draft state** — catches a field the form sends that the
 *   schema does not declare. That one matters most and is not covered by the
 *   first: a draft passed as `{ ...draft, id }` is a spread, and TypeScript
 *   does not apply excess-property checking through a spread. Typing the
 *   `useState` initialiser does apply it. The bug that prompted all of this —
 *   an edit dialog posting `memberIds` that the schema silently dropped, with
 *   no error anywhere — is exactly this case.
 */
export type SignInInput = z.input<typeof signInSchema>;
export type CreateUserInput = z.input<typeof createUserSchema>;
export type UpdateUserInput = z.input<typeof updateUserSchema>;
export type InviteMemberInput = z.input<typeof inviteMemberSchema>;
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;
export type SetDisabledInput = z.input<typeof setDisabledSchema>;
export type CustomRoleInput = z.input<typeof customRoleSchema>;
export type AddMemberInput = z.input<typeof addMemberSchema>;
export type RemoveMemberInput = z.input<typeof removeMemberSchema>;
export type UpdateWorkspaceInput = z.input<typeof updateWorkspaceSchema>;
export type CreateWorkspaceInput = z.input<typeof createWorkspaceSchema>;
export type CreateProjectInput = z.input<typeof createProjectSchema>;
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;
export type AddProjectMembersInput = z.input<typeof addProjectMembersSchema>;
export type ProjectFeaturesInput = z.input<typeof projectFeaturesSchema>;
export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type MoveTaskInput = z.input<typeof moveTaskSchema>;
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;
export type ArchiveTaskInput = z.input<typeof archiveTaskSchema>;
export type CreateSubtaskInput = z.input<typeof createSubtaskSchema>;
export type UpdateSubtaskInput = z.input<typeof updateSubtaskSchema>;
export type LabelInput = z.input<typeof labelSchema>;
export type UpdateLabelInput = z.input<typeof updateLabelSchema>;
export type LogTimeInput = z.input<typeof logTimeSchema>;
export type ManualTimeEntryInput = z.input<typeof manualTimeEntrySchema>;
export type UpdateTimeEntryInput = z.input<typeof updateTimeEntrySchema>;
export type StartTimerInput = z.input<typeof startTimerSchema>;
export type CampaignInput = z.input<typeof campaignSchema>;
export type AddSectionInput = z.input<typeof addSectionSchema>;
export type UpdateSectionInput = z.input<typeof updateSectionSchema>;
export type SendMessageInput = z.input<typeof sendMessageSchema>;
export type EventInput = z.input<typeof eventSchema>;
export type InviteInput = z.input<typeof inviteSchema>;
export type AcceptInvitationInput = z.input<typeof acceptInvitationSchema>;
