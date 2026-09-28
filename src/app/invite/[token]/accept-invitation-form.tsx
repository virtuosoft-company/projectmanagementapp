"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CircleAlert, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { acceptInvitationAction } from "@/lib/invitation-actions";

/**
 * Choose a name and password, and the account exists.
 *
 * The email is shown but not editable: it comes from the invitation, and the
 * action reads it from there rather than from this form, so the field is
 * information rather than input.
 *
 * On success this does not sign them in — it points them at the sign-in page.
 * Signing in here would mean handling their password a second time for no gain,
 * and the credentials they just chose are fresh in mind.
 */
export function AcceptInvitationForm({
  token,
  email,
  workspaceName,
}: {
  token: string;
  email: string;
  workspaceName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [draft, setDraft] = useState({ name: "", password: "", confirmPassword: "" });

  const set = <K extends keyof typeof draft>(key: K, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await acceptInvitationAction({ ...draft, token });
      if (!result.ok) {
        setError(result.error ?? "Could not set up that account.");
        return;
      }

      setDone(true);
      router.prefetch("/signin");
    });
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-sm">
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          Your account is ready. Sign in with {email} and the password you just chose.
        </p>
        <Link
          href="/signin"
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Email" hint={`The address ${workspaceName} invited`}>
        <Input value={email} readOnly disabled />
      </Field>

      <Field label="Your name" required>
        <Input
          required
          autoFocus
          maxLength={50}
          value={draft.name}
          placeholder="How your name should appear"
          onChange={(changed) => set("name", changed.target.value)}
        />
      </Field>

      <Field
        label="Password"
        required
        hint="At least 8 characters, with an uppercase letter, a lowercase letter, a number and one of @$!%*?&"
      >
        <Input
          required
          type="password"
          autoComplete="new-password"
          value={draft.password}
          onChange={(changed) => set("password", changed.target.value)}
        />
      </Field>

      <Field label="Confirm password" required>
        <Input
          required
          type="password"
          autoComplete="new-password"
          value={draft.confirmPassword}
          onChange={(changed) => set("confirmPassword", changed.target.value)}
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

      <Button type="submit" className="w-full" disabled={pending || !draft.name.trim()}>
        {pending ? "Setting up…" : `Join ${workspaceName}`}
      </Button>
    </form>
  );
}
