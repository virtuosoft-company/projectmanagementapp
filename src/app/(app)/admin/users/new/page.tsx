import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreateUserForm } from "@/components/admin/create-user-form";
import type { Role } from "@/lib/domain";
import { PERMISSION_LABELS, ROLES, permissionsFor } from "@/lib/permissions";
import { hasPermission, requirePage } from "@/lib/session";

export const metadata: Metadata = { title: "Add user" };

export default async function NewUserPage({
  searchParams,
}: PageProps<"/admin/users/new">) {
  // Part of Users, so it is reached on that page's assignment rather than one
  // of its own — the sidebar entry comes and goes with Users too.
  await requirePage("users");

  // Unlike the other screens, this one is nothing but the action: there is no
  // read-only version of a create form. Without the permission the form is
  // withheld and the page says so, rather than collecting a submission that
  // `createUserAction` would refuse.
  const canCreate = await hasPermission("members.invite");

  // Reached from two places — Administration → Users, and the "Add member"
  // button on the Team Members roster. Send people back where they started
  // rather than always to the directory.
  const { from } = await searchParams;
  const cameFromRoster = from === "team-members";
  const backHref = cameFromRoster ? "/team-members" : "/admin/users";
  const backLabel = cameFromRoster ? "Back to team members" : "Back to users";

  // Summarise each role from the permission matrix, so the hint under the role
  // picker can never drift from what the role actually grants.
  const roleHints = Object.fromEntries(
    ROLES.map((role) => {
      const permissions = permissionsFor(role);
      return [
        role,
        permissions.length === 0
          ? "No permissions."
          : `Grants ${permissions.length} permissions, including ${permissions
              .slice(0, 3)
              .map((permission) => PERMISSION_LABELS[permission].toLowerCase())
              .join(", ")}.`,
      ];
    }),
  ) as Record<Role, string>;

  return (
    <div className="max-w-full space-y-6">
      <div>
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel}
        </Link>
        <h1 className="mt-1 text-2xl font-bold leading-tight tracking-tight">Add user</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create an account and set what it can reach.
        </p>
      </div>

      {canCreate ? (
        <CreateUserForm roleHints={roleHints} />
      ) : (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          Your role can open this page but cannot create accounts. Ask an admin for the
          Invite members permission.
        </p>
      )}
    </div>
  );
}
