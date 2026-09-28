"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleAlert, MailX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { revokeInvitationAction } from "@/lib/invitation-actions";
import { roleLabel } from "@/lib/permissions";
import type { Role } from "@/lib/domain";

export type PendingInvitation = {
  id: string;
  email: string;
  role: Role;
  /** ISO instant, formatted here so the server and client agree on the text. */
  expiresAt: string;
  invitedByName: string | null;
};

/**
 * Invitations that have been sent and not yet accepted.
 *
 * Rendered only when there are some — an empty card on the Users screen would
 * be noise on the many days when nobody is mid-invitation.
 */
export function PendingInvitations({
  invitations,
  canRevoke,
}: {
  invitations: PendingInvitation[];
  canRevoke: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  if (invitations.length === 0) return null;

  function revoke(id: string) {
    setError(null);
    setWorking(id);

    startTransition(async () => {
      const result = await revokeInvitationAction(id);
      setWorking(null);
      if (!result.ok) {
        setError(result.error ?? "Could not withdraw that invitation.");
        return;
      }

      toast.success("Invitation withdrawn");
      router.refresh();
    });
  }

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-sm">
          Pending invitations (<span className="font-mono">{invitations.length}</span>)
        </CardTitle>
        <CardDescription>
          Sent but not yet accepted. Withdrawing one stops its link working.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-2">
        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}

        <ul className="divide-y rounded-md border">
          {invitations.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">{invitation.email}</span>
              <Badge variant="outline">{roleLabel(invitation.role)}</Badge>
              <span className="text-xs text-muted-foreground">
                expires {invitation.expiresAt}
                {invitation.invitedByName ? ` · by ${invitation.invitedByName}` : ""}
              </span>
              {canRevoke ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={pending}
                  onClick={() => revoke(invitation.id)}
                >
                  <MailX className="h-3.5 w-3.5" />
                  {working === invitation.id ? "Withdrawing…" : "Withdraw"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
