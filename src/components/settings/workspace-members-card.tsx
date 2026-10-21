"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Plus } from "lucide-react";
import {
  inviteMemberAction,
  setMemberDisabledAction,
  updateRoleAction,
  type ActionResult,
} from "@/app/(app)/settings/actions";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/form-dialog";
import { DialogActions } from "@/components/ui/form-actions";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { ROLES, roleLabel } from "@/lib/permissions";
import type { WorkspaceMember } from "@/lib/users";

export function WorkspaceMembersCard({
  members,
  canInvite,
  canManageRoles,
  currentUserId,
}: {
  members: WorkspaceMember[];
  canInvite: boolean;
  canManageRoles: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function run(action: () => Promise<ActionResult>, onSuccess?: () => void) {
    startTransition(async () => {
      const result = await action();
      setNotice(result.error ?? null);
      if (result.ok) {
        onSuccess?.();
        router.refresh();
      }
    });
  }

  return (
    <Card className="shadow-none">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Members</CardTitle>
        {canInvite ? (
          <Button variant="outline" size="sm" onClick={() => setInviting(true)}>
            <Plus className="h-3.5 w-3.5" />
            Invite
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {notice ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {notice}
          </p>
        ) : null}

        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between gap-3 rounded-md px-3 py-2 transition-colors hover:bg-muted/50"
          >
            <div className="flex min-w-0 items-center gap-3">
              <UserAvatar
                name={member.name}
                className="h-8 w-8 bg-primary/10"
                textClassName="text-xs text-primary"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {member.name}
                  {member.id === currentUserId ? (
                    <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">{member.email}</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {member.disabled ? <Badge variant="destructive">Disabled</Badge> : null}

              {canManageRoles ? (
                <SelectField
                  aria-label={`Role for ${member.name}`}
                  value={member.role}
                  disabled={pending}
                  className="h-8 w-[120px]"
                  onValueChange={(value) => {
                    const form = new FormData();
                    form.set("userId", member.id);
                    form.set("role", value);
                    run(() => updateRoleAction(form));
                  }}
                  options={ROLES.map((role) => ({ value: role, label: roleLabel(role) }))}
                />
              ) : (
                <Badge variant="outline">{roleLabel(member.role)}</Badge>
              )}

              {canInvite && member.id !== currentUserId ? (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={pending}
                  onClick={() => {
                    const form = new FormData();
                    form.set("userId", member.id);
                    form.set("disabled", String(!member.disabled));
                    run(() => setMemberDisabledAction(form));
                  }}
                >
                  {member.disabled ? "Enable" : "Disable"}
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>

      <InviteDialog
        key={String(inviting)}
        open={inviting}
        pending={pending}
        onClose={() => setInviting(false)}
        onSubmit={(form) => run(() => inviteMemberAction(form), () => setInviting(false))}
      />
    </Card>
  );
}

function InviteDialog({
  open,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (form: FormData) => void;
}) {
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Invite to workspace"
      description="They sign in with this email and the temporary password you set. To let them choose their own password instead, send an invitation from Administration → Users."
    >
      <form
        className="grid gap-4 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
        }}
      >
        <Field label="Name" required>
          <Input name="name" required />
        </Field>
        <Field label="Email" required>
          <Input name="email" type="email" required placeholder="name@company.com" />
        </Field>
        <Field label="Role">
          <SelectField
              name="role"
              defaultValue="member"
              options={ROLES.map((role) => ({ value: role, label: roleLabel(role) }))}
            />
        </Field>
        <Field
          label="Temporary password"
          required
          hint="At least 8 characters, with an uppercase letter, a lowercase letter, a number and one of @$!%*?&."
        >
          <Input name="password" type="password" autoComplete="new-password" minLength={8} required />
        </Field>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogActions onCancel={onClose} submitLabel="Send invite" disabled={pending} />
        </div>
      </form>
    </FormDialog>
  );
}
