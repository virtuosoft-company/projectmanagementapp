"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { DialogActions } from "@/components/ui/form-actions";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  createEventAction,
  deleteEventAction,
  updateEventAction,
} from "@/lib/event-actions";
import type { CalendarEvent, Member, Project } from "@/lib/domain";

/** Lead times offered for the reminder. `0` switches it off. */
const REMINDER_CHOICES = [
  { value: "0", label: "No reminder" },
  { value: "10", label: "10 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
];

export type EventDialogProject = Pick<Project, "id" | "name"> & {
  /** Ids of the members on this project, for narrowing the attendee list. */
  memberIds: string[];
};

/**
 * Create or edit one calendar event.
 *
 * Opened by clicking a day on the grid, which is where `date` comes from —
 * so the common case is a title and a couple of names, with the day already
 * settled.
 *
 * Picking a project narrows the attendee list to that project's members, which
 * is the same rule `resolveAttendees` enforces server-side. Anyone already
 * ticked who is not on the new project is dropped rather than silently
 * submitted and stripped on save.
 */
export function EventDialog({
  open,
  onClose,
  date,
  event,
  projects,
  members,
  canDelete,
}: {
  open: boolean;
  onClose: () => void;
  /** The day that was clicked, as an ISO day. */
  date: string;
  /** Absent when creating. */
  event?: CalendarEvent | null;
  projects: EventDialogProject[];
  members: Member[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /*
   * Seeded once per mount. The caller keys this component on the day and event
   * it is opening, so a different target arrives as a fresh mount with a fresh
   * draft — the same pattern `TaskDialog` and the sidebar's feature picker use,
   * and it keeps the reset out of an effect.
   */
  const [draft, setDraft] = useState(() => initialDraft(date, event));

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const selectedProject = projects.find((project) => project.id === draft.projectId);

  /*
   * Who may be ticked: the chosen project's members, or everyone in the
   * workspace when the event belongs to no project. Disabled accounts are left
   * out — they cannot sign in, so they would never see the notification.
   */
  const candidates = useMemo(() => {
    const active = members.filter((member) => !member.disabled);
    if (!selectedProject) return active;
    return active.filter((member) => selectedProject.memberIds.includes(member.id));
  }, [members, selectedProject]);

  function changeProject(next: string) {
    setDraft((current) => {
      const project = projects.find((item) => item.id === next);
      return {
        ...current,
        projectId: next,
        // Drop anyone the new project does not include, so what is ticked is
        // always what would actually be saved.
        attendeeIds: project
          ? current.attendeeIds.filter((id) => project.memberIds.includes(id))
          : current.attendeeIds,
      };
    });
  }

  function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = event
        ? await updateEventAction(event.id, draft)
        : await createEventAction(draft);

      if (!result.ok) {
        setError(result.error ?? "Could not save that event.");
        return;
      }

      toast.success(event ? "Event updated" : "Event created");
      onClose();
      router.refresh();
    });
  }

  function remove() {
    if (!event) return;
    setError(null);

    startTransition(async () => {
      const result = await deleteEventAction(event.id);
      if (!result.ok) {
        setError(result.error ?? "Could not delete that event.");
        return;
      }

      toast.success("Event deleted");
      onClose();
      router.refresh();
    });
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={event ? "Edit event" : "New event"}
      description={
        event
          ? "Changing the day or time re-sends the reminder."
          : "Everyone you add gets a notification now, and another before it starts."
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Title" required>
          <Input
            required
            autoFocus
            maxLength={200}
            value={draft.title}
            placeholder="e.g. Sprint review"
            onChange={(changed) => set("title", changed.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date" required>
            <Input
              required
              type="date"
              value={draft.date}
              onChange={(changed) => set("date", changed.target.value)}
            />
          </Field>
          <Field label="Start" hint="Leave blank for all day">
            <Input
              type="time"
              value={draft.startTime}
              onChange={(changed) => set("startTime", changed.target.value)}
            />
          </Field>
          <Field label="End">
            <Input
              type="time"
              value={draft.endTime}
              disabled={!draft.startTime}
              onChange={(changed) => set("endTime", changed.target.value)}
            />
          </Field>
        </div>

        <Field label="Project" hint="Optional — narrows who you can invite">
          <SelectField
            value={draft.projectId}
            onValueChange={changeProject}
            placeholder="No project"
            aria-label="Project"
            options={[
              { value: "", label: "No project" },
              ...projects.map((project) => ({ value: project.id, label: project.name })),
            ]}
          />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium leading-none">
            Attendees (<span className="font-mono">{draft.attendeeIds.length}</span>)
          </legend>

          {candidates.length === 0 ? (
            <p className="rounded-md border p-3 text-sm text-muted-foreground">
              {selectedProject
                ? `${selectedProject.name} has no members to invite yet.`
                : "There is nobody else in this workspace yet."}
            </p>
          ) : (
            <div className="grid max-h-44 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
              {candidates.map((member) => (
                <label
                  key={member.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md p-1.5 text-sm hover:bg-muted/50"
                >
                  <Checkbox
                    checked={draft.attendeeIds.includes(member.id)}
                    onCheckedChange={() =>
                      set(
                        "attendeeIds",
                        draft.attendeeIds.includes(member.id)
                          ? draft.attendeeIds.filter((id) => id !== member.id)
                          : [...draft.attendeeIds, member.id],
                      )
                    }
                  />
                  <UserAvatar name={member.name} image={member.image} className="size-5" />
                  <span className="min-w-0 flex-1 truncate">{member.name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <Field
          label="Reminder"
          hint={
            draft.startTime
              ? undefined
              : "Counted from the start of the day on an all-day event"
          }
        >
          <SelectField
            value={draft.reminderMinutes}
            onValueChange={(value) => set("reminderMinutes", value)}
            aria-label="Reminder"
            options={REMINDER_CHOICES}
          />
        </Field>

        <Field label="Notes">
          <Textarea
            rows={3}
            maxLength={5000}
            value={draft.description}
            placeholder="Anything the attendees should know."
            onChange={(changed) => set("description", changed.target.value)}
          />
        </Field>

        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}

        {event && canDelete ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 p-3">
            <p className="text-sm text-muted-foreground">
              {confirmingDelete
                ? "Everyone invited is told it was cancelled."
                : "Delete this event."}
            </p>
            <Button
              type="button"
              variant={confirmingDelete ? "destructive" : "outline"}
              size="sm"
              disabled={pending}
              onClick={() => (confirmingDelete ? remove() : setConfirmingDelete(true))}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {confirmingDelete ? "Confirm delete" : "Delete"}
            </Button>
          </div>
        ) : null}

        <DialogActions
          onCancel={onClose}
          submitLabel={pending ? "Saving…" : event ? "Save event" : "Add event"}
          disabled={pending || !draft.title.trim()}
        />
      </form>
    </FormDialog>
  );
}

/** A blank event on the clicked day, or the stored one opened for editing. */
function initialDraft(date: string, event?: CalendarEvent | null) {
  return {
    title: event?.title ?? "",
    description: event?.description ?? "",
    date: event?.date ?? date,
    startTime: event?.startTime ?? "",
    endTime: event?.endTime ?? "",
    projectId: event?.projectId ?? "",
    attendeeIds: event?.attendees.map((person) => person.id) ?? [],
    reminderMinutes: String(event?.reminderMinutes ?? 30),
  };
}
