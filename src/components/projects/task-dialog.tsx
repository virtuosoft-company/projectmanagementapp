"use client";

import { useState } from "react";
import { FormDialog } from "@/components/ui/form-dialog";
import { DialogActions } from "@/components/ui/form-actions";
import { FilePicker } from "@/components/ui/file-picker";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
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
  type Member,
  type Priority,
  type Project,
  type TaskStatus,
} from "@/lib/domain";

export type TaskDraft = {
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assigneeIds: string[];
  estimateHours: number;
  dueDate: string;
  /** Uploaded after the task exists; never sent with the draft itself. */
  cover: File | null;
  file: File | null;
};

/** Create-task form. `projects` is omitted when the project is already known. */
export function TaskDialog({
  open,
  onClose,
  onSubmit,
  members,
  projects,
  projectId,
  pending,
  defaultStatus = "todo",
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: TaskDraft) => void;
  members: Member[];
  projects?: Project[];
  projectId?: string;
  pending?: boolean;
  defaultStatus?: TaskStatus;
}) {
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    cover: null as File | null,
    file: null as File | null,
    projectId: projectId ?? projects?.[0]?.id ?? "",
    assigneeId: "",
    status: defaultStatus,
    priority: "medium" as Priority,
    estimateHours: 1,
    dueDate: "",
  });

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Add Task"
      description="Create a new task for a project."
    >
      <form
        className="grid gap-4 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            title: draft.title,
            description: draft.description.trim(),
            projectId: draft.projectId,
            status: draft.status,
            priority: draft.priority,
            assigneeIds: draft.assigneeId ? [draft.assigneeId] : [],
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
            placeholder="Task title"
            onChange={(event) => set("title", event.target.value)}
          />
        </Field>

        <Field label="Description">
          <Textarea
            rows={3}
            maxLength={5000}
            value={draft.description}
            placeholder="What needs doing?"
            onChange={(event) => set("description", event.target.value)}
          />
        </Field>

        {projects ? (
          <Field label="Project">
            <SelectField
              value={draft.projectId}
              onValueChange={(value) => set("projectId", value)}
              options={projects.map((project) => ({ value: project.id, label: project.name }))}
            />
          </Field>
        ) : null}

        <Field label="Assigned To">
          <SelectField
            value={draft.assigneeId}
            onValueChange={(value) => set("assigneeId", value)}
            placeholder="Select assignee"
            options={members.map((member) => ({ value: member.id, label: member.name }))}
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
          <Field label="Due Date">
            <Input
              type="date"
              value={draft.dueDate}
              onChange={(event) => set("dueDate", event.target.value)}
            />
          </Field>
        </div>

        <Field label="Cover image">
          <FilePicker
            value={draft.cover}
            onChange={(file) => set("cover", file)}
            accept={ACCEPT_ATTRIBUTE}
            validate={validateImageFile}
            disabled={pending}
            buttonLabel="Choose image"
            hint={`${ALLOWED_LABEL}, up to ${formatBytes(MAX_SIZE)}. Shown across the top of the card.`}
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

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogActions onCancel={onClose} submitLabel="Create" disabled={pending} />
        </div>
      </form>
    </FormDialog>
  );
}
