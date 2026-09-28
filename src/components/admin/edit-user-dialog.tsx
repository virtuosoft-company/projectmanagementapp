"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleAlert } from "lucide-react";
import { updateUserAction } from "@/app/(app)/admin/users/actions";
import { DialogActions } from "@/components/ui/form-actions";
import { Field } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import type { AdminUser } from "@/lib/admin";

/**
 * Edit one account's profile from the Users table.
 *
 * Role and active status are not here: each has its own control in the row,
 * with its own last-admin guard, and a general edit form would route around
 * them. The password is its own flow too.
 */
export function EditUserDialog({
  user,
  onClose,
}: {
  user: AdminUser;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: user.name,
    email: user.email,
    phone: user.phone ?? "",
    designation: user.designation ?? "",
    monthlyHours: user.monthlyHours,
  });

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await updateUserAction({
        userId: user.id,
        name: draft.name,
        email: draft.email,
        phone: draft.phone,
        designation: draft.designation,
        monthlyHours: draft.monthlyHours,
      });

      if (!result.ok) {
        setError(result.error ?? "Could not save those changes.");
        return;
      }

      toast.success("Account updated");
      onClose();
      router.refresh();
    });
  }

  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Edit ${user.name}`}
      description="Their profile. Role and access are set from the row itself."
    >
      <form className="grid gap-4 py-2" onSubmit={submit}>
        <Field label="Name" required>
          <Input
            required
            autoFocus
            maxLength={50}
            value={draft.name}
            disabled={pending}
            onChange={(event) => set("name", event.target.value)}
          />
        </Field>

        <Field label="Email" required>
          <Input
            required
            type="email"
            value={draft.email}
            disabled={pending}
            onChange={(event) => set("email", event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone">
            <Input
              value={draft.phone}
              disabled={pending}
              placeholder="+92 300 1234567"
              onChange={(event) => set("phone", event.target.value)}
            />
          </Field>
          <Field label="Designation">
            <Input
              maxLength={60}
              value={draft.designation}
              disabled={pending}
              placeholder="Software Engineer"
              onChange={(event) => set("designation", event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Monthly hours" hint="What utilization is measured against.">
            <Input
              type="number"
              min={0}
              max={744}
              value={draft.monthlyHours}
              disabled={pending}
              onChange={(event) => set("monthlyHours", Number(event.target.value))}
            />
          </Field>
        </div>

        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogActions
            onCancel={onClose}
            submitLabel={pending ? "Saving…" : "Save changes"}
            disabled={pending}
          />
        </div>
      </form>
    </FormDialog>
  );
}
