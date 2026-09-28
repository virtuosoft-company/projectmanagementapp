import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { AcceptInvitationForm } from "./accept-invitation-form";
import { readInvitation } from "@/lib/invitation-actions";

export const metadata: Metadata = { title: "Accept invitation" };

/**
 * Where an invitation link lands.
 *
 * Public — the person arriving has no account yet, let alone a session, so
 * `proxy.ts` exempts `/invite`. The token in the URL is the whole of their
 * authority, and `readInvitation` is what decides whether it is worth anything.
 *
 * Never cached: whether a token is still usable changes with acceptance,
 * withdrawal and the clock.
 */
export const dynamic = "force-dynamic";

export default async function AcceptInvitationPage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invitation = await readInvitation(token);

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 p-6">
          {invitation ? (
            <>
              <div>
                <h1 className="text-xl font-bold leading-tight tracking-tight">
                  Join {invitation.workspaceName}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose a password and your account is ready.
                </p>
              </div>

              <AcceptInvitationForm
                token={token}
                email={invitation.email}
                workspaceName={invitation.workspaceName}
              />
            </>
          ) : (
            <>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold leading-tight tracking-tight">
                  This invitation is not valid
                </h1>
                {/*
                  One message for every reason — expired, already used, withdrawn
                  or simply wrong. Saying which would tell an anonymous visitor
                  whether a given address had been invited.
                */}
                <p className="mt-1 text-sm text-muted-foreground">
                  It may have expired, been used already, or been withdrawn. Ask an admin to
                  send a new one.
                </p>
              </div>
              <Link
                href="/signin"
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Go to sign in
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
