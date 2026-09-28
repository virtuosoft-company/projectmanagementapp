"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleAlert, MailPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { DialogActions } from "@/components/ui/form-actions";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { inviteUserAction } from "@/lib/invitation-actions";
import { ROLES, roleLabel } from "@/lib/permissions";

/**
 * Invite somebody who has no account yet.
 *
 * Distinct from "Add member", which puts an *existing* account into this
 * workspace. Here an email goes out and the invitee chooses their own password,
 * so nothing is created until they accept.
 *
 * When SMTP is unconfigured the trigger is disabled rather than hidden: the
 * feature exists, it just needs setting up, and hiding it would look like the
 * app cannot do this at all.
 */
export function InviteUserDialog({ mailConfigured }: { mailConfigured: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [draft, setDraft] = useState({ email: "", role: "member" });

  function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await inviteUserAction(draft);
      if (!result.ok) {
        setError(result.error ?? "Could not send that invitation.");
        return;
      }

      toast.success(`Invitation sent to ${draft.email}`);
      setSentTo(draft.email);
      setDraft({ email: "", role: "member" });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!mailConfigured}
          title={
            mailConfigured
              ? undefined
              : "Set the SMTP_* environment variables to send invitations."
          }
          onClick={() => {
            setError(null);
            setSentTo(null);
            setOpen(true);
          }}
        >
          <MailPlus className="h-4 w-4" />
          Invite by email
        </Button>

        {!mailConfigured ? (
          <span className="text-xs text-muted-foreground">Email is not configured</span>
        ) : null}

        {sentTo ? (
          <span className="text-xs text-success">Invitation sent to {sentTo}</span>
        ) : null}
      </div>

      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Invite by email"
        description="They choose their own password, so nothing is created until they accept. The link lasts 7 days."
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" required>
            <Input
              required
              autoFocus
              type="email"
              value={draft.email}
              placeholder="name@company.com"
              onChange={(changed) =>
                setDraft((current) => ({ ...current, email: changed.target.value }))
              }
            />
          </Field>

          <Field
            label="Role"
            required
            hint="What they join as. Change it later on the Users screen."
          >
            <SelectField
              value={draft.role}
              onValueChange={(role) => setDraft((current) => ({ ...current, role }))}
              aria-label="Role"
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

          <DialogActions
            onCancel={() => setOpen(false)}
            submitLabel={pending ? "Sending…" : "Send invitation"}
            disabled={pending || !draft.email.trim()}
          />
        </form>
      </FormDialog>
    </>
  );
}
