"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogActions } from "@/components/ui/form-actions";
import { Field } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { FilePicker } from "@/components/ui/file-picker";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";
import {
  ACCEPT_ATTRIBUTE,
  ALLOWED_LABEL,
  ATTACHMENT_ACCEPT,
  ATTACHMENT_LABEL,
  MAX_SIZE,
  formatBytes,
  validateAttachmentFile,
  validateImageFile,
} from "@/lib/files";
import {
  PRIORITIES,
  TASK_STATUSES,
  type Label,
  type Member,
  type Priority,
  type Task,
  type TaskStatus,
} from "@/lib/domain";

/** What the form holds. A new card and an edited one differ only in the id. */
export type TaskFormValues = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assigneeIds: string[];
  labelIds: string[];
  estimateHours: number;
  dueDate: string;
  /** Only offered when creating; uploaded once the card exists. */
  cover: File | null;
  file: File | null;
};

export type TaskEdit = TaskFormValues & { taskId: string };

/** Adds or removes one id, so the checkbox lists stay set-like. */
function toggle(list: string[], id: string) {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

/**
 * One task's details, whether it exists yet or not.
 *
 * A board card is added with the same form it is later edited with, so the
 * fields never disagree between the two. `task` absent means a new card: the
 * form starts empty at `defaultStatus`, and offers a cover and a file, which
 * only make sense once there is something to attach them to.
 */
export function TaskEditDialog({
  open,
  onClose,
  onSubmit,
  task,
  defaultStatus = "todo",
  members,
  labels,
  pending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: TaskFormValues) => void;
  /** The task being edited, or nothing when adding one. */
  task?: Task;
  defaultStatus?: TaskStatus;
  members: Member[];
  labels: Label[];
  pending?: boolean;
  error?: string | null;
}) {
  const [draft, setDraft] = useState({
    title: task?.title ?? "",
    description: task?.description ?? "",
    status: task?.status ?? defaultStatus,
    priority: task?.priority ?? ("medium" as Priority),
    assigneeIds: task?.assignees.map((person) => person.id) ?? [],
    labelIds: task?.labels.map((label) => label.id) ?? [],
    estimateHours: task?.estimateHours ?? 1,
    dueDate: task?.dueDate ?? "",
    cover: null as File | null,
    file: null as File | null,
  });

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={task ? "Edit task" : "Add a card"}
      description={task ? "Change the details of this task." : "Create a card on this list."}
    >
      <form
        className="grid gap-4 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            title: draft.title,
            description: draft.description,
            status: draft.status,
            priority: draft.priority,
            assigneeIds: draft.assigneeIds,
            labelIds: draft.labelIds,
            estimateHours: Number(draft.estimateHours) || 0,
            dueDate: draft.dueDate,
            cover: draft.cover,
            file: draft.file,
          });
        }}
      >
        <Field label="Title" required>
          <Input
            required
            value={draft.title}
            onChange={(event) => set("title", event.target.value)}
          />
        </Field>

        <Field label="Description">
          <Textarea
            rows={4}
            value={draft.description}
            placeholder="What needs doing?"
            onChange={(event) => set("description", event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status">
            <SelectField
              value={draft.status}
              onValueChange={(value) => set("status", value as TaskStatus)}
              options={TASK_STATUSES.map(({ status, label }) => ({ value: status, label }))}
            />
          </Field>
          <Field label="Priority">
            <SelectField
              value={draft.priority}
              className="capitalize"
              onValueChange={(value) => set("priority", value as Priority)}
              options={PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Estimate (hours)">
            <Input
              type="number"
              min={0}
              step={0.5}
              value={draft.estimateHours}
              onChange={(event) => set("estimateHours", Number(event.target.value))}
            />
          </Field>
          <Field label="Due date">
            <Input
              type="date"
              value={draft.dueDate}
              onChange={(event) => set("dueDate", event.target.value)}
            />
          </Field>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium leading-none">Assigned to</legend>
          {members.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nobody in this workspace yet.</p>
          ) : (
            <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border p-2">
              {members.map((member) => (
                <label key={member.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.assigneeIds.includes(member.id)}
                    onCheckedChange={() => set("assigneeIds", toggle(draft.assigneeIds, member.id))}
                  />
                  {member.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium leading-none">Labels</legend>
          {labels.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No labels yet — create them in project settings.
            </p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border p-2">
              {labels.map((label) => (
                <label key={label.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.labelIds.includes(label.id)}
                    onCheckedChange={() => set("labelIds", toggle(draft.labelIds, label.id))}
                  />
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  {label.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        {task ? null : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cover image">
              <FilePicker
                value={draft.cover}
                onChange={(file) => set("cover", file)}
                accept={ACCEPT_ATTRIBUTE}
                validate={validateImageFile}
                disabled={pending}
                buttonLabel="Choose image"
                hint={`${ALLOWED_LABEL}, up to ${formatBytes(MAX_SIZE)}.`}
              />
            </Field>
            <Field label="File">
              <FilePicker
                value={draft.file}
                onChange={(file) => set("file", file)}
                accept={ATTACHMENT_ACCEPT}
                validate={validateAttachmentFile}
                disabled={pending}
                hint={`${ATTACHMENT_LABEL}. Up to ${formatBytes(MAX_SIZE)}.`}
              />
            </Field>
          </div>
        )}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogActions
            onCancel={onClose}
            submitLabel={
              pending ? "Saving…" : task ? "Save changes" : "Add card"
            }
            disabled={pending}
          />
        </div>
      </form>
    </FormDialog>
  );
}
