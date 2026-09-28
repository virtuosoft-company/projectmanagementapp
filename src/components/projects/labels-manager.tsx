"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleAlert, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { LABEL_COLORS, type Label } from "@/lib/domain";
import { createLabelAction, deleteLabelAction, updateLabelAction } from "@/lib/task-actions";
import { cn } from "@/lib/utils";

/**
 * Create, rename, recolour and delete the workspace's labels.
 *
 * Lives in a dialog on the tasks screen rather than under workspace settings:
 * labels are managed by whoever manages tasks (`tasks.manage`), which is a
 * wider group than the owners and admins who reach settings, and they are
 * created in the middle of organising a board rather than as an admin chore.
 */
export function LabelsManager({
  open,
  onClose,
  labels,
  usage,
}: {
  open: boolean;
  onClose: () => void;
  labels: Label[];
  /** How many tasks carry each label, so deletion can say what it affects. */
  usage: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Label | null>(null);
  const [removing, setRemoving] = useState<Label | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[0]);

  function reset() {
    setEditing(null);
    setName("");
    setColor(LABEL_COLORS[0]);
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  return (
    <>
      <FormDialog
        open={open}
        onClose={() => {
          reset();
          setError(null);
          onClose();
        }}
        title="Labels"
        description="Tags you can put on any task in this workspace."
      >
        <div className="space-y-4 py-2">
          <form
            className="space-y-3 rounded-md border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              const wasEditing = Boolean(editing);
              run(
                () =>
                  editing
                    ? updateLabelAction({ id: editing.id, name, color })
                    : createLabelAction({ name, color }),
                () => {
                  toast.success(wasEditing ? "Label updated" : "Label created");
                  reset();
                },
              );
            }}
          >
            <Field label={editing ? `Rename ${editing.name}` : "New label"} required>
              <Input
                required
                value={name}
                maxLength={40}
                placeholder="e.g. bug, design, blocked"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            <fieldset>
              <legend className="mb-1.5 text-sm font-medium leading-none">Colour</legend>
              <div className="flex flex-wrap gap-2">
                {LABEL_COLORS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`Use ${swatch}`}
                    aria-pressed={color === swatch}
                    onClick={() => setColor(swatch)}
                    style={{ backgroundColor: swatch }}
                    className={cn(
                      "h-6 w-6 rounded-full ring-offset-2 ring-offset-background transition-shadow",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      color === swatch && "ring-2 ring-foreground",
                    )}
                  />
                ))}
              </div>
            </fieldset>

            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending || !name.trim()}>
                {editing ? null : <Plus className="h-4 w-4" />}
                {pending ? "Saving…" : editing ? "Save" : "Add label"}
              </Button>
              {editing ? (
                <Button type="button" variant="ghost" size="sm" onClick={reset}>
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>

          {error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          ) : null}

          {labels.length === 0 ? (
            <p className="text-sm text-muted-foreground">No labels yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {labels.map((label) => (
                <li key={label.id} className="flex items-center gap-2 px-3 py-2">
                  <span
                    aria-hidden
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{label.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {usage[label.id] ?? 0} task{(usage[label.id] ?? 0) === 1 ? "" : "s"}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={pending}
                    aria-label={`Edit ${label.name}`}
                    onClick={() => {
                      setEditing(label);
                      setName(label.name);
                      setColor(label.color);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={pending}
                    aria-label={`Delete ${label.name}`}
                    onClick={() => setRemoving(label)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </FormDialog>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const label = removing;
          if (!label) return;
          setRemoving(null);
          run(() => deleteLabelAction(label.id), () => toast.success("Label deleted"));
        }}
        title={`Delete ${removing?.name ?? "label"}?`}
        description={
          removing
            ? `It is removed from ${usage[removing.id] ?? 0} task${(usage[removing.id] ?? 0) === 1 ? "" : "s"}. The tasks themselves are not affected.`
            : ""
        }
      />
    </>
  );
}
