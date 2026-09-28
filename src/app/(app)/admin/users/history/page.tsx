import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, UserMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getRemovalHistory } from "@/lib/admin";
import { roleLabel } from "@/lib/permissions";
import { requirePage } from "@/lib/session";

export const metadata: Metadata = { title: "Removal history" };

/**
 * Everyone taken off this workspace, and why.
 *
 * Part of Users rather than a page of its own, so it is reached on that page's
 * assignment — the same way `/admin/users/new` carries `page: "users"`. Adding
 * a key to `APP_PAGES` would have meant no existing role held it until an
 * admin re-ticked every one.
 *
 * Reads only the `MemberRemoval` snapshots. The membership and project rows it
 * describes are gone, which is exactly why the counts were recorded at the
 * time rather than derived now.
 */
export default async function RemovalHistoryPage() {
  const viewer = await requirePage("users");
  const removals = await getRemovalHistory(viewer.workspaceId);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to users
        </Link>
        <h1 className="mt-1 text-2xl font-bold leading-tight tracking-tight">Removal history</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone taken off this workspace, what they were holding, and why
        </p>
      </div>

      {removals.length === 0 ? (
        <Card className="shadow-none">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <UserMinus className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nobody has been removed from this workspace.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Role held</th>
                <th className="px-3 py-2 font-medium">Projects</th>
                <th className="px-3 py-2 font-medium">Hours</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Removed</th>
              </tr>
            </thead>
            <tbody>
              {removals.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2">
                    <span className="block font-medium">{row.name}</span>
                    <span className="block text-xs text-muted-foreground">{row.email}</span>
                    {/*
                      The account was deleted after the removal, so there is
                      nobody left to add back — worth saying, since every other
                      row here can be.
                    */}
                    {row.accountExists ? null : (
                      <Badge variant="muted" className="mt-1">
                        Account deleted
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">{roleLabel(row.role)}</Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    {row.projectCount}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    {row.hoursLogged}
                  </td>
                  <td className="max-w-[22rem] px-3 py-2 text-muted-foreground">{row.reason}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    <span className="block">{row.removedAt}</span>
                    {row.removedByName ? (
                      <span className="block text-xs">by {row.removedByName}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
