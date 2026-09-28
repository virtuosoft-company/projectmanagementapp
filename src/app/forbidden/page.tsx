import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { APP_PAGES, PERMISSION_LABELS, roleLabel, type Permission } from "@/lib/permissions";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "Not allowed" };

export default async function ForbiddenPage({ searchParams }: PageProps<"/forbidden">) {
  const user = await getSessionUser();
  // Two ways to land here: `requirePermission` sends `need`, `requirePage`
  // sends `page`. They call for different advice — one is a permission the
  // role lacks, the other a page it was simply not assigned.
  const { need, page } = await searchParams;
  const permission = typeof need === "string" ? (need as Permission) : undefined;
  const label = permission ? PERMISSION_LABELS[permission] : undefined;
  const pageLabel =
    typeof page === "string"
      ? APP_PAGES.find((entry) => entry.key === page)?.label
      : undefined;

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-destructive/10 text-destructive">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight tracking-tight">
              You don&apos;t have access
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {pageLabel ? (
                <>
                  <span className="font-medium">{pageLabel}</span> is not one of the pages
                  assigned to your role.
                </>
              ) : label ? (
                <>
                  This page needs the <span className="font-medium">{label}</span> permission.
                </>
              ) : (
                "Your role doesn't allow this action."
              )}
              {user ? (
                <>
                  {" "}
                  You&apos;re signed in as {user.name}
                  {user.role ? ` (${roleLabel(user.role)})` : ""}.
                </>
              ) : null}
            </p>
          </div>
          {/*
            No “sign out and back in” any more: every gate resolves the role from
            the database on each request, so a change on the Roles screen
            applies to this person’s very next navigation.
          */}
          <p className="text-sm text-muted-foreground">
            Ask an admin to {pageLabel ? "add this page to" : "grant this permission to"} your
            role on the Roles screen. It applies straight away.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to dashboard
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
