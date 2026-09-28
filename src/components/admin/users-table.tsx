"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Plus,
  Pencil,
  Search,
  Trash2,
  UserCheck,
  UserMinus,
  UserX,
} from "lucide-react";
import {
  memberHoldingsAction,
  deleteUserAction,
  setUserRoleAction,
  setUsersDisabledAction,
  type ActionResult,
} from "@/app/(app)/admin/users/actions";
import { assignCustomRoleAction } from "@/app/(app)/admin/users/roles/actions";
import { RemoveMemberDialog } from "@/components/admin/remove-member-dialog";
import type { MemberHoldings } from "@/lib/admin";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { EditUserDialog } from "@/components/admin/edit-user-dialog";
import type { AdminUser, CustomRoleRow } from "@/lib/admin";
import type { Role } from "@/lib/domain";
import { FIXED_ROLES, ROLES, roleLabel } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 12;

/** Namespaces custom role ids in the role dropdown, apart from base role names. */
const CUSTOM_PREFIX = "custom:";

export function UsersTable({
  users,
  canInvite,
  canAssignRoles,
  customRoles,
  canManageRoles,
  canDelete,
  linkNames = false,
  currentUserId,
}: {
  users: AdminUser[];
  /** Owners and admins get the management controls; everyone else reads. */
  canInvite: boolean;
  /** `workspace.settings` — may assign custom roles, but not change base roles. */
  canAssignRoles: boolean;
  customRoles: CustomRoleRow[];
  canManageRoles: boolean;
  /** `members.delete` — admins only, and separate from managing roles. */
  canDelete: boolean;
  /** Link each name to that person's analytics — the roster does, the directory does not. */
  linkNames?: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [removing, setRemoving] = useState<AdminUser | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [offboarding, setOffboarding] = useState<AdminUser | null>(null);
  const [holdings, setHoldings] = useState<MemberHoldings | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== "all" && user.role !== roleFilter) return false;
      if (statusFilter === "active" && !user.active) return false;
      if (statusFilter === "inactive" && user.active) return false;
      if (!term) return true;
      return (
        user.name.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term) ||
        (user.designation ?? "").toLowerCase().includes(term)
      );
    });
  }, [users, search, roleFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const selectable = visible.filter((user) => user.id !== currentUserId).map((user) => user.id);
  const allSelected = selectable.length > 0 && selectable.every((id) => selected.includes(id));

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

  function resetTo(pageNumber: number) {
    setPage(pageNumber);
    setSelected([]);
  }

  /**
   * Base roles and custom roles in one dropdown.
   *
   * Custom values are prefixed so the two namespaces cannot collide — a role
   * named `member` is a different thing from the base `member`, and the
   * dispatch below has to tell them apart.
   *
   * Only an owner (`roles.manage`) may change the base role. An admin holds
   * `workspace.settings`, which is enough to create and assign custom roles but
   * not to re-rank someone, so they see the custom entries plus a way back to
   * whichever base role the person already has.
   */
  function roleOptions(user: AdminUser) {
    const custom = customRoles
      .filter((role) => role.isActive)
      .map((role) => ({
        value: `${CUSTOM_PREFIX}${role.id}`,
        label: role.label,
      }));

    // Only the fixed roles are offered as base roles. The others exist as
    // editable rows above — listing their enum values too would let someone
    // hold "member" after the Member role had been deleted, which would make
    // deleting a role look like it had not worked.
    const base = canManageRoles
      ? FIXED_ROLES.map((role) => ({ value: role, label: roleLabel(role) }))
      : // An admin cannot re-rank anyone, so their only base option is whatever
        // the person already holds — enough to clear a custom role, no more.
        [];

    const options = [...base, ...custom];

    // Anyone holding a plain base role that is no longer offered — seeded data,
    // or someone assigned before those roles moved into rows — still needs
    // their current value present, or the select would render blank and the
    // first change would look like it came from nowhere.
    const current = user.customRole ? `${CUSTOM_PREFIX}${user.customRole.id}` : user.role;
    if (current && !options.some((option) => option.value === current)) {
      options.unshift({
        value: current,
        label: roleLabel(user.role ?? "member"),
      });
    }

    return options;
  }

  /** Routes the choice to whichever action owns that kind of role. */

  /**
   * Open the removal dialog, then fetch what they hold.
   *
   * Opened first and filled in after, so the dialog appears immediately rather
   * than after a round trip. It renders its own "reading what they hold" state
   * until the figures land, and its submit stays disabled meanwhile.
   */
  function openRemoval(user: AdminUser) {
    setHoldings(null);
    setOffboarding(user);
    run(async () => {
      const result = await memberHoldingsAction(user.id);
      if (result.ok && result.holdings) setHoldings(result.holdings);
      return { ok: result.ok, error: result.error };
    });
  }

  function changeRole(user: AdminUser, value: string) {
    if (value.startsWith(CUSTOM_PREFIX)) {
      const roleId = value.slice(CUSTOM_PREFIX.length);
      run(() => assignCustomRoleAction(user.id, roleId));
      return;
    }

    // Moving to a base role has to clear any custom role first, or the
    // membership would keep pointing at one and resolve straight back to it.
    run(async () => {
      if (user.customRole) {
        const cleared = await assignCustomRoleAction(user.id, null);
        if (!cleared.ok) return cleared;
      }
      return canManageRoles
        ? setUserRoleAction(user.id, value as Role)
        : { ok: true as const };
    });
  }

  return (
    <div className="space-y-4">
      <Card className="shadow-none">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1 -mt-3.5">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                resetTo(1);
              }}
              placeholder="Search name, email or designation"
              aria-label="Search users"
              className="h-9 pl-8"
            />
          </div>

          <SelectField
            value={roleFilter}
            onValueChange={(value) => {
              setRoleFilter(value as "all" | Role);
              resetTo(1);
            }}
            aria-label="Filter by role"
            className="w-[150px] mt-0"
            options={[
              { value: "all", label: "All roles" },
              ...ROLES.map((role) => ({ value: role, label: roleLabel(role) })),
            ]}
          />

          <SelectField
            value={statusFilter}
            onValueChange={(value) =>
              {
                setStatusFilter(value as "all" | "active" | "inactive");
                resetTo(1);
              }
            }
            aria-label="Filter by status"
            className="w-[140px] mt-0"
            options={[
              { value: "all", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Disabled" },
            ]}
          />

          {canInvite ? (
            <Link
              href="/admin/users/new"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Add user
            </Link>
          ) : null}
        </CardContent>
      </Card>

      {notice ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {notice}
        </p>
      ) : null}

      {canInvite && selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3">
          <span className="text-sm font-medium">
            <span className="font-mono">{selected.length}</span> selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => run(() => setUsersDisabledAction(selected, false), () => setSelected([]))}
            >
              <UserCheck className="h-3.5 w-3.5" />
              Enable
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => run(() => setUsersDisabledAction(selected, true), () => setSelected([]))}
            >
              <UserX className="h-3.5 w-3.5" />
              Disable
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      <Card className="shadow-none">
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b">
                <tr className="text-left text-xs text-muted-foreground">
                  {canInvite ? (
                    <th className="w-10 px-3 py-2">
                      <Checkbox
                        checked={allSelected}
                        aria-label="Select all on this page"
                        disabled={selectable.length === 0}
                        onCheckedChange={(checked) =>
                          setSelected(checked === true ? selectable : [])
                        }
                      />
                    </th>
                  ) : null}
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  {canInvite ? (
                    <th className="px-3 py-2 font-medium">Last sign-in</th>
                  ) : null}
                  {canInvite ? (
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {visible.map((user) => (
                  <tr key={user.id} className="border-b transition-colors hover:bg-muted/50">
                    {canInvite ? (
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={selected.includes(user.id)}
                          // Bulk enable/disable only acts on members of this
                          // workspace, so an outsider cannot be selected.
                          disabled={user.id === currentUserId || !user.inWorkspace}
                          aria-label={`Select ${user.name}`}
                          onCheckedChange={() =>
                            setSelected((current) =>
                              current.includes(user.id)
                                ? current.filter((id) => id !== user.id)
                                : [...current, user.id],
                            )
                          }
                        />
                      </td>
                    ) : null}

                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <UserAvatar
                          name={user.name}
                          className="h-8 w-8 bg-primary/10"
                          textClassName="text-xs text-primary"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {linkNames && user.inWorkspace ? (
                              <Link
                                href={`/team-members/${user.id}`}
                                className="hover:underline"
                              >
                                {user.name}
                              </Link>
                            ) : (
                              user.name
                            )}
                            {user.id === currentUserId ? (
                              <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                            ) : null}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {user.email}
                          </span>
                        </span>
                      </span>
                    </td>

                    <td className="px-3 py-2">
                      {/* Someone outside this workspace has no role here, and the
                          role action would refuse them anyway — so say so rather
                          than offering a control that cannot work. */}
                      {!user.role ? (
                        <Badge variant="muted" title="This account belongs to another workspace">
                          Not a member
                        </Badge>
                      ) : canManageRoles || canAssignRoles ? (
                        <SelectField
                          aria-label={`Role for ${user.name}`}
                          value={
                            user.customRole ? `${CUSTOM_PREFIX}${user.customRole.id}` : user.role
                          }
                          // Changing your own role is refused server-side; the
                          // owner check is what stops the last one demoting
                          // themselves out of the workspace.
                          disabled={pending || user.id === currentUserId}
                          className="h-8 w-[150px]"
                          onValueChange={(value) => changeRole(user, value)}
                          options={roleOptions(user)}
                        />
                      ) : (
                        <Badge variant="outline">
                          {user.customRole?.label ?? roleLabel(user.role)}
                        </Badge>
                      )}

                      {/* A custom role reads as its base everywhere else, so
                          name the base here rather than leaving it implicit. */}
                      {user.customRole && user.role ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          inherits {roleLabel(user.role)}
                        </p>
                      ) : null}
                    </td>


                    <td className="px-3 py-2">
                      <Badge variant={user.active ? "success" : "destructive"}>
                        {user.active ? "Active" : "Disabled"}
                      </Badge>
                    </td>

                    {canInvite ? (
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-muted-foreground">
                        {user.lastLoginAt ?? "Never"}
                      </td>
                    ) : null}

                    {/*
                      Shown for `members.invite` rather than `roles.manage`, so
                      admins reach page access. Delete stays owner-only inside.
                    */}
                    {canInvite ? (
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {user.inWorkspace ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={pending}
                            onClick={() => setEditing(user)}
                            aria-label={`Edit ${user.name}`}
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {user.id !== currentUserId && user.inWorkspace ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={pending}
                            onClick={() => openRemoval(user)}
                            aria-label={`Remove ${user.name} from this workspace`}
                            title="Remove from workspace"
                          >
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {/*
                          Deleting the account is the harder, separate act —
                          it destroys their history everywhere, not just here.
                        */}
                        {canDelete && user.id !== currentUserId && user.inWorkspace ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={pending}
                            onClick={() => setRemoving(user)}
                            aria-label={`Delete ${user.name}`}
                            title="Delete account"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}

                {visible.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4 + (canInvite ? 3 : 0)}
                      className="px-3 py-8 text-center text-sm text-muted-foreground"
                    >
                      No users match those filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          Showing <span className="font-mono">{visible.length}</span> of{" "}
          <span className="font-mono">{filtered.length}</span> users
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            disabled={currentPage <= 1}
            onClick={() => resetTo(currentPage - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className={cn("min-w-[80px] text-center font-mono text-sm")}>
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            disabled={currentPage >= totalPages}
            onClick={() => resetTo(currentPage + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          run(() => deleteUserAction(removing.id), () => toast.success("Account deleted"));
        }}
        title={`Delete ${removing?.name ?? "user"}?`}
        description={
          removing
            ? `This also deletes ${removing.entryCount} time ${
                removing.entryCount === 1 ? "entry" : "entries"
              } and removes them from ${removing.taskCount} ${
                removing.taskCount === 1 ? "task" : "tasks"
              }. Disable the account instead if you need to keep their history.`
            : ""
        }
      />

      {offboarding ? (
        <RemoveMemberDialog
          key={offboarding.id}
          open
          onClose={() => {
            setOffboarding(null);
            setHoldings(null);
          }}
          userId={offboarding.id}
          holdings={holdings}
        />
      ) : null}

      {/* Keyed so reopening on a different person starts from their values. */}
      {editing ? (
        <EditUserDialog
          key={editing.id}
          user={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}

    </div>
  );
}
