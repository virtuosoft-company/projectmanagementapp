"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { updateProfileAction } from "@/app/(app)/profile/actions";

/**
 * The Details tab of your own profile.
 *
 * `manages` mirrors the `members.invite` check in the action: an admin edits
 * every field here, everyone else edits their display name and reads the rest.
 * Disabled inputs are submitted as nothing by the browser, so the action's own
 * permission check and this flag cannot disagree about what was sent.
 */
export function PersonalInfoForm({
  name,
  email,
  monthlyHours,
  manages,
}: {
  name: string;
  email: string;
  monthlyHours: number;
  manages: boolean;
}) {
  const router = useRouter();
  const { update } = useSession();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await updateProfileAction(form);
      setNotice(result.ok ? "Saved." : (result.error ?? "Could not save."));
      if (result.ok) {
        // The name and email the shell renders come from the JWT, not the
        // database, so the token has to be refreshed or the header keeps the
        // old ones until the next sign-in.
        await update();
        router.refresh();
      }
    });
  }

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Personal Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="space-y-4" onSubmit={save}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display Name" required>
              <Input name="name" required maxLength={80} defaultValue={name} />
            </Field>
            <Field
              label="Email"
              required={manages}
              hint={manages ? "Sign in with this address" : "Email cannot be changed"}
            >
              <Input
                name="email"
                type="email"
                required={manages}
                defaultValue={email}
                disabled={!manages}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Monthly Hours"
              required={manages}
              hint={manages ? "Expected hours a month" : "Set by an admin"}
            >
              <Input
                name="monthlyHours"
                type="number"
                min={0}
                max={744}
                required={manages}
                defaultValue={monthlyHours}
                disabled={!manages}
              />
            </Field>
          </div>
          {notice ? (
            <p role="status" className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              {notice}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
