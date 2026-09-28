import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check, Lock, Users, X } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminUsers, getCustomRoles } from "@/lib/admin";
import { CreateRoleButton, RoleRowActions } from "@/components/admin/role-dialog";
import type { Role } from "@/lib/domain";
import {
  APP_PAGES,
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  FIXED_ROLES,
  can,
  pagesForRole,
  permissionsFor,
  roleLabel,
} from "@/lib/permissions";
import { hasPermission, requirePage } from "@/lib/session";

export const metadata: Metadata = { title: "Roles" };

/** Plain-English summary and swatch per built-in role. */
const ROLE_META: Record<Role, { description: string; color: string }> = {
  admin: {
    description: "Full control, including role management and deleting accounts.",
    color: "hsl(var(--primary))",
  },
  manager: {
    description: "Leads projects and people without workspace-level settings.",
    color: "#f59f0a",
  },
  member: {
    description: "Does the work: projects, tasks and time tracking.",
    color: "#21c45d",
  },
  viewer: {
    description: "Read-only access, including reports.",
    color: "#1ac3e6",
  },
  guest: {
    description: "Sees projects only — typically an external client.",
    color: "hsl(var(--muted-foreground))",
  },
};

export default async function RolesPage() {
  const viewer = await requirePage("roles");
  const [users, custom] = await Promise.all([
    getAdminUsers(viewer.workspaceId),
    getCustomRoles(viewer.workspaceId),
  ]);

  // Creating and editing roles is `workspace.settings` — the same permission
  // the actions enforce, so the buttons never appear to someone they'd refuse.
  const canManage = await hasPermission("workspace.settings");

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
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="mt-1 text-2xl font-bold leading-tight tracking-tight">Roles</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              What each role can do, and who holds it
            </p>
          </div>
          {canManage ? <CreateRoleButton /> : null}
        </div>
      </div>

      {custom.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Editable roles</h2>
            <p className="text-xs text-muted-foreground">
              Every role except Owner — edit or delete any of them
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {custom.map((role) => (
              <Card key={role.id} className="shadow-none">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle>{role.label}</CardTitle>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge variant="secondary" className="gap-1">
                        <Users className="h-3 w-3" />
                        {role.memberCount}
                      </Badge>
                      <Badge variant="outline">
                        <span className="font-mono">{role.permissions.length}</span> perms
                      </Badge>
                    </div>
                  </div>
                  <CardDescription>
                    {role.description || "No description."}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Inherits from{" "}
                    <span className="font-medium text-foreground">
                      {roleLabel(role.inheritsFrom)}
                    </span>{" "}
                    · key <span className="font-mono">{role.name}</span>
                    {role.isActive ? null : " · inactive"}
                  </p>

                  <div className="flex flex-wrap gap-1">
                    {role.permissions.map((permission) => (
                      <Badge key={permission} variant="secondary" className="font-normal">
                        {PERMISSION_LABELS[permission]}
                      </Badge>
                    ))}
                    {role.permissions.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        No permissions — holders can sign in but do nothing.
                      </span>
                    ) : null}
                  </div>

                  <div>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Pages (<span className="font-mono">{role.pages.length}</span>/
                      <span className="font-mono">{APP_PAGES.length}</span>)
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {APP_PAGES.filter((page) => role.pages.includes(page.key)).map((page) => (
                        <Badge key={page.key} variant="outline" className="font-normal">
                          {page.label}
                        </Badge>
                      ))}
                      {role.pages.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          No pages — holders can sign in but reach nothing.
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {canManage ? (
                    <div className="flex justify-end border-t pt-2">
                      <RoleRowActions role={role} />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Fixed role</h2>
        <p className="text-xs text-muted-foreground">
          Cannot be edited or deleted — the guarantee that a workspace stays administrable
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {FIXED_ROLES.map((role) => {
          // Someone on a custom role carries its base role too, and is already
          // counted on that role's own card — so only people holding the base
          // role directly belong here.
          const holders = users.filter(
            (user) => user.role === role && !user.customRole,
          );
          const permissions = permissionsFor(role);
          const pages = pagesForRole(role);
          const meta = ROLE_META[role];

          return (
            <Card key={role} className="shadow-none">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: meta.color }}
                    />
                    <CardTitle>{roleLabel(role)}</CardTitle>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant="secondary" className="gap-1">
                      <Users className="h-3 w-3" />
                      {holders.length}
                    </Badge>
                    <Badge variant="muted" className="gap-1">
                      <Lock className="h-3 w-3" />
                      System
                    </Badge>
                  </div>
                </div>
                <CardDescription>{meta.description}</CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Permissions (<span className="font-mono">{permissions.length}</span>/
                    <span className="font-mono">{PERMISSION_KEYS.length}</span>)
                  </p>
                  <ul className="grid gap-1">
                    {PERMISSION_KEYS.map((permission) => {
                      const granted = can(role, permission);
                      return (
                        <li
                          key={permission}
                          className={
                            granted
                              ? "flex items-center gap-1.5 text-xs"
                              : "flex items-center gap-1.5 text-xs text-muted-foreground/60"
                          }
                        >
                          {granted ? (
                            <Check className="h-3 w-3 text-success" />
                          ) : (
                            <X className="h-3 w-3" />
                          )}
                          {PERMISSION_LABELS[permission]}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Pages (<span className="font-mono">{pages.length}</span>/
                    <span className="font-mono">{APP_PAGES.length}</span>)
                  </p>
                  {/*
                    Admin is the fixed role, so its pages are the whole
                    catalogue and are not editable — that is what keeps a
                    workspace administrable no matter how the other roles are
                    retuned. Every other role's list is assigned on its own card
                    above.
                  */}
                  <div className="flex flex-wrap gap-1">
                    {APP_PAGES.filter((page) => pages.includes(page.key)).map((page) => (
                      <Badge key={page.key} variant="secondary" className="font-normal">
                        {page.label}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Members
                  </p>
                  {holders.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nobody holds this role.</p>
                  ) : (
                    <ul className="space-y-1">
                      {/* Everyone holding the role reaches exactly its pages —
                          there is no per-member narrowing to report. */}
                      {holders.map((user) => (
                        <li key={user.id} className="flex items-center gap-2">
                          <UserAvatar
                            name={user.name}
                            className="h-6 w-6 bg-primary/10"
                            textClassName="text-[10px] text-primary"
                          />
                          <span className="min-w-0 flex-1 truncate text-xs">{user.name}</span>
                          {!user.active ? <Badge variant="destructive">Disabled</Badge> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Which roles are fixed, and why</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <span className="font-medium">Owner</span> is the only fixed role. It holds role
            management and account deletion, and a workspace always keeps at least one
            owner — so whatever is edited or deleted elsewhere, somebody can always put it
            back. Every other role, <span className="font-medium">Admin</span> included, is
            editable and deletable.
          </p>
          <p>
            Deleting a role does not delete the people holding it. They fall back to the
            base role their membership already carries, which may grant them{" "}
            <span className="font-medium">more</span> than the deleted role did — a role can
            only ever narrow its base.
          </p>
          <p>
            The six values in the database enum still exist, but as{" "}
            <span className="font-medium">permission ceilings</span> rather than roles you
            hold: each editable role names one under &ldquo;inherits from&rdquo;, and can
            never grant more than that ceiling allows.
          </p>
          <p>
            There are two ways to change what one person reaches, and they work in
            different directions. Changing their <span className="font-medium">role</span> on
            the{" "}
            <Link href="/admin/users" className="underline hover:text-foreground">
              users page
            </Link>{" "}
            sets the ceiling above — the most they could ever see. Assigning{" "}
            <span className="font-medium">pages</span> to them, from the same page, narrows
            them below it.
          </p>
          <p>
            Page assignment can only take away. Nobody can be given a page their role does not
            already grant, because the permission behind it is what every server action checks
            — a page handed out past the role would load a screen whose every control refuses
            them. Widening access is a role change.
          </p>
          <p>
            The two also differ in when they apply. Page assignment is read from the database
            on each request, so it takes effect immediately. A role lives in the sign-in token,
            so it applies on their next sign-in.
          </p>
        </CardContent>
      </Card> */}
    </div>
  );
}
