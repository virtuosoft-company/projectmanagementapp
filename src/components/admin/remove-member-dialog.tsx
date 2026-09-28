"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { Field } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { DialogActions } from "@/components/ui/form-actions";
import { Textarea } from "@/components/ui/textarea";
import { removeFromWorkspaceAction } from "@/app/(app)/admin/users/actions";
import type { MemberHoldings } from "@/lib/admin";

/**
 * Take somebody off this workspace, having first said what that disconnects.
 *
 * The figures are read on the server before this opens, so the admin is shown
 * what the person is holding rather than finding out afterwards. Every rule
 * here is enforced again inside the action — this is the explanation, not the
 * enforcement.
 */
export function RemoveMemberDialog({
  open,
  onClose,
  userId,
  holdings,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  /** Null while the figures are still being fetched. */
  holdings: MemberHoldings | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const blocked = !holdings || holdings.blockers.length > 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await removeFromWorkspaceAction({ userId, reason });
      if (!result.ok) {
        setError(result.error ?? "Could not remove them.");
        return;
      }

      toast.success(`${holdings?.name ?? "They"} removed from this workspace`);
      onClose();
      router.refresh();
    });
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={holdings ? `Remove ${holdings.name}?` : "Remove from workspace"}
      description="They keep their account and any other workspace they belong to, and can be added back. The removal is recorded on the history screen."
    >
      <form onSubmit={submit} className="space-y-4">
        {holdings ? (
          <dl className="grid grid-cols-3 gap-2 rounded-md border p-3 text-sm">
            <Holding label="Projects" value={holdings.projectCount} />
            <Holding label="Tasks" value={holdings.taskCount} />
            <Holding label="Hours logged" value={holdings.hoursLogged} />
          </dl>
        ) : (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">
            Reading what they hold…
          </p>
        )}


        {holdings && holdings.blockers.length > 0 ? (
          <div
            role="alert"
            className="space-y-1 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm"
          >
            <p className="flex items-center gap-2 font-medium">
              <TriangleAlert className="h-4 w-4 shrink-0 text-warning" />
              Not yet
            </p>
            {holdings.blockers.map((blocker) => (
              <p key={blocker} className="text-muted-foreground">
                {blocker}
              </p>
            ))}
          </div>
        ) : null}

        <Field label="Reason" required hint="Kept on the history screen.">
          <Textarea
            required
            rows={3}
            maxLength={500}
            value={reason}
            disabled={blocked}
            placeholder="e.g. Left the company on 30 September."
            onChange={(changed) => setReason(changed.target.value)}
          />
        </Field>

        {/*
          Their hours are deliberately kept: they are the record of work that
          was actually done, and removing them would change every report and
          any invoice built from one.
        */}
        <p className="text-xs text-muted-foreground">
          Their logged time stays with the workspace. Project memberships are removed.
        </p>

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
          onCancel={onClose}
          submitLabel={pending ? "Removing…" : "Remove from workspace"}
          disabled={pending || blocked || reason.trim().length < 3}
        />
      </form>
    </FormDialog>
  );
}

function Holding({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-lg font-bold leading-tight">{value}</dd>
    </div>
  );
}
