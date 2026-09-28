"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleAlert, Plus } from "lucide-react";
import { addMemberAction } from "@/app/(app)/admin/users/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { DialogActions } from "@/components/ui/form-actions";
import { SelectField } from "@/components/ui/select-field";
import { ROLES, roleLabel } from "@/lib/permissions";

export type AddableUser = { id: string; name: string; email: string };

/**
 * "Add member" on the Team Members roster.
 *
 * Grants an account that already exists access to this workspace, rather than
 * creating a new one — the candidates come from `getAddableUsers`, which is
 * every account *not* already a member here. Creating a brand-new account is
 * still the Add user page, linked from the footer, because it needs a password
 * and the rest of the longer form.
 *
 * Rendered only where the caller holds `members.invite`; `addMemberAction`
 * re-checks that permission and re-validates every field server-side.
 */
export function AddMemberDialog({ users }: { users: AddableUser[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await addMemberAction(form);
      if (!result.ok) {
        setError(result.error ?? "Could not add that member.");
        return;
      }

      toast.success("Member added");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button className="shrink-0" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add member
      </Button>

      <FormDialog
        // Remounts on open, so a cancelled attempt leaves no stale values.
        key={String(open)}
        open={open}
        onClose={() => setOpen(false)}
        title="Add member"
        description="Give someone who already has an account access to this workspace."
      >
        {users.length === 0 ? (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Everyone with an account is already in this workspace. Create a new account to
              add someone else.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Link
                href="/admin/users/new?from=team-members"
                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Create account
              </Link>
            </div>
          </div>
        ) : (
          <form className="grid gap-4 py-2" onSubmit={submit}>
            <Field label="Person" required>
              <SelectField
                name="userId"
                placeholder="Select someone"
                options={users.map((user) => ({
                  value: user.id,
                  // Email disambiguates two people with the same name.
                  label: `${user.name} — ${user.email}`,
                }))}
              />
            </Field>

            <Field label="Role" hint="What they can do in this workspace.">
              <SelectField
                name="role"
                defaultValue="member"
                options={ROLES.map((role) => ({ value: role, label: roleLabel(role) }))}
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

            <p className="text-xs text-muted-foreground">
              Need a brand-new account?{" "}
              <Link
                href="/admin/users/new?from=team-members"
                className="font-medium text-foreground underline underline-offset-2"
              >
                Create one instead
              </Link>
              .
            </p>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <DialogActions
                onCancel={() => setOpen(false)}
                submitLabel={pending ? "Adding…" : "Add member"}
                disabled={pending}
              />
            </div>
          </form>
        )}
      </FormDialog>
    </>
  );
}
