"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CircleAlert, Eye, EyeOff, Key, Shield, User, X } from "lucide-react";
import { createUserAction } from "@/app/(app)/admin/users/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { DESIGNATIONS, type Role } from "@/lib/domain";
import { ROLES, roleLabel } from "@/lib/permissions";
import { createUserSchema, fieldErrors, passwordChecks } from "@/lib/validations";
import { cn } from "@/lib/utils";

type Draft = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  phone: string;
  role: Role;
  designation: string;
  monthlyHours: number;
  active: boolean;
};

const EMPTY: Draft = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  confirmPassword: "",
  phone: "",
  role: "member",
  designation: "",
  monthlyHours: 160,
  active: true,
};

export function CreateUserForm({
  roleHints,
}: {
  roleHints: Record<Role, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  function validate(): boolean {
    // Same schema the server action parses, so the two can never disagree.
    const result = createUserSchema.safeParse(draft);
    setErrors(result.success ? {} : (fieldErrors(result.error) as typeof errors));
    return result.success;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;

    startTransition(async () => {
      const result = await createUserAction(draft);
      if (result.ok) {
        // Raised before navigating: the toast outlives the route change, so it
        // is the confirmation that the account exists on the screen they land on.
        toast.success("Account created");
        router.push("/admin/users");
        router.refresh();
      } else {
        setFormError(result.error ?? "Could not create the account.");
      }
    });
  }

  return (
    <form className="space-y-6" onSubmit={submit} noValidate>
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Personal information
          </CardTitle>
          <CardDescription>How this person appears across the workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" required>
              <Input
                value={draft.firstName}
                onChange={(event) => set("firstName", event.target.value)}
                aria-invalid={Boolean(errors.firstName)}
                placeholder="Jordan"
              />
              <FieldError message={errors.firstName} />
            </Field>
            <Field label="Last name" required>
              <Input
                value={draft.lastName}
                onChange={(event) => set("lastName", event.target.value)}
                aria-invalid={Boolean(errors.lastName)}
                placeholder="Lee"
              />
              <FieldError message={errors.lastName} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" required>
              <Input
                type="email"
                value={draft.email}
                onChange={(event) => set("email", event.target.value)}
                aria-invalid={Boolean(errors.email)}
                placeholder="name@company.com"
              />
              <FieldError message={errors.email} />
            </Field>
            <Field label="Phone">
              <Input
                type="tel"
                value={draft.phone}
                onChange={(event) => set("phone", event.target.value)}
                aria-invalid={Boolean(errors.phone)}
                placeholder="+92 300 1234567"
              />
              <FieldError message={errors.phone} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            Password
          </CardTitle>
          <CardDescription>They can change it after the first sign-in.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Password" required>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={draft.password}
                  onChange={(event) => set("password", event.target.value)}
                  aria-invalid={Boolean(errors.password)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <FieldError message={errors.password} />
            </Field>

            <Field label="Confirm password" required>
              <div className="relative">
                <Input
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  value={draft.confirmPassword}
                  onChange={(event) => set("confirmPassword", event.target.value)}
                  aria-invalid={Boolean(errors.confirmPassword)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((value) => !value)}
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <FieldError message={errors.confirmPassword} />
            </Field>
          </div>

          <ul className="grid gap-1 sm:grid-cols-2">
            {passwordChecks.map((check) => {
              const met = check.test(draft.password);
              return (
                <li
                  key={check.label}
                  className={cn(
                    "flex items-center gap-1.5 text-xs",
                    met ? "text-success" : "text-muted-foreground",
                  )}
                >
                  {met ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  {check.label}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Role &amp; access
          </CardTitle>
          <CardDescription>{roleHints[draft.role]}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role">
              <SelectField
                value={draft.role}
                onValueChange={(value) => set("role", value as Role)}
                options={ROLES.map((role) => ({ value: role, label: roleLabel(role) }))}
              />
            </Field>
            <Field label="Designation">
              <SelectField
                value={draft.designation}
                onValueChange={(value) => set("designation", value)}
                placeholder="Select designation"
                options={DESIGNATIONS.map((designation) => ({
                  value: designation,
                  label: designation,
                }))}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Monthly hours">
              <Input
                type="number"
                min={0}
                value={draft.monthlyHours}
                onChange={(event) => set("monthlyHours", Number(event.target.value))}
              />
            </Field>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={draft.active}
              onCheckedChange={(checked) => set("active", checked === true)}
            />
            Active — they can sign in straight away
          </label>
        </CardContent>
      </Card>

      {formError ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {formError}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Link
          href="/admin/users"
          className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Cancel
        </Link>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create user"}
        </Button>
      </div>
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <span role="alert" className="block text-xs text-destructive">
      {message}
    </span>
  );
}
