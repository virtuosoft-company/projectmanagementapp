"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { Building2, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DialogActions } from "@/components/ui/form-actions";
import { Field } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { updateWorkspaceAction } from "@/app/(app)/settings/actions";
import type { WorkspaceSummary } from "@/lib/domain";
import { roleLabel } from "@/lib/permissions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createWorkspaceAction, deleteWorkspaceAction } from "@/lib/workspace-actions";
import { cn } from "@/lib/utils";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The workspaces the signed-in user belongs to.
 *
 * Scope note: this is not a cross-tenant list. Roles live on `WorkspaceMember`,
 * so "every workspace in the system" is not a thing any role can currently see.
 *
 * Rename only targets the *current* workspace — `updateWorkspaceAction` writes
 * to the caller's `workspaceId` rather than taking one, which is what stops an
 * admin renaming a workspace they merely belong to. Switching first is
 * therefore a real step, not a UI quirk.
 */
export function WorkspacesView({
  workspaces,
  currentWorkspaceId,
  currentDescription,
  canCreate,
  canRename,
}: {
  workspaces: WorkspaceSummary[];
  currentWorkspaceId: string;
  currentDescription: string;
  /** `workspace.create`, resolved server-side from the viewer’s actual role. */
  canCreate: boolean;
  /** `workspace.settings` — renaming the current workspace. */
  canRename: boolean;
}) {
  const router = useRouter();
  const { update } = useSession();
  const [switching, setSwitching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState<WorkspaceSummary | null>(null);
  const [draft, setDraft] = useState({ name: "", slug: "" });
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** The workspace this session is in — named in the rename dialog. */
  const current = workspaces.find((workspace) => workspace.id === currentWorkspaceId);

  /**
   * What still stands in the way of deleting this workspace, or null when
   * nothing does.
   *
   * The same rule the action enforces, phrased for the confirm dialog. The
   * button stays enabled either way — you find out *why* by clicking, with the
   * exact numbers, rather than meeting a dead control and having to guess.
   *
   * The caller is excluded from the user count: they are the one asking, so
   * "1 other active user" is the honest phrasing rather than counting yourself
   * as an obstacle.
   */
  function blockersFor(workspace: WorkspaceSummary): string | null {
    const others = workspace.activeUserCount - 1;
    const parts = [
      workspace.projectCount > 0
        ? `${workspace.projectCount} ${workspace.projectCount === 1 ? "project" : "projects"}`
        : null,
      others > 0 ? `${others} other active ${others === 1 ? "user" : "users"}` : null,
    ].filter(Boolean);

    if (parts.length === 0) return null;
    return parts.join(" and ");
  }

  function remove(workspace: WorkspaceSummary) {
    startTransition(async () => {
      const result = await deleteWorkspaceAction(workspace.id);
      if (!result.ok) {
        setError(result.error ?? "Could not delete that workspace.");
        setRemoving(null);
        return;
      }

      toast.success(`${workspace.name} deleted`);
      setRemoving(null);

      // Deleting the one you were in leaves the session pointing at a workspace
      // that no longer exists, so move it before anything tries to read from it.
      if (workspace.id === currentWorkspaceId) {
        if (result.nextWorkspaceId) await update({ workspaceId: result.nextWorkspaceId });
        else router.push("/onboarding");
      }

      router.refresh();
    });
  }

  // Cleared in a `finally` so one failed switch cannot leave every "Switch to"
  // button disabled for the rest of the session.
  async function switchTo(workspaceId: string) {
    if (workspaceId === currentWorkspaceId || switching) return;

    setSwitching(true);
    setError(null);
    try {
      // A falsy result means next-auth declined the update — it returns early
      // while the session is still loading. Refreshing anyway would redraw the
      // same workspace and look like the switch simply did nothing.
      const next = await update({ workspaceId });
      if (!next) {
        setError("Could not switch workspace. Try again in a moment.");
        return;
      }
      router.refresh();
    } finally {
      setSwitching(false);
    }
  }

  function submitCreate() {
    startTransition(async () => {
      const result = await createWorkspaceAction(draft);
      if (!result.ok || !result.workspaceId) {
        setError(result.error ?? "Could not create that workspace.");
        return;
      }
      toast.success("Workspace created");
      setCreating(false);
      setDraft({ name: "", slug: "" });
      setSlugTouched(false);
      setError(null);

      // The workspace exists either way; only moving into it can fail here.
      const next = await update({ workspaceId: result.workspaceId });
      if (!next) {
        setError("Workspace created, but switching into it failed. Pick it from the list.");
      }
      router.refresh();
    });
  }

  function submitRename(formData: FormData) {
    startTransition(async () => {
      const result = await updateWorkspaceAction(formData);
      if (!result.ok) {
        setError(result.error ?? "Could not save those changes.");
        return;
      }
      setRenaming(false);
      setError(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold leading-tight tracking-tight">Workspaces</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The workspaces you belong to, and the role you hold in each.
          </p>
        </div>
        {/* Resolved server-side; `createWorkspaceAction` enforces it again. */}
        {canCreate ? (
          <Button
            size="sm"
            onClick={() => {
              setError(null);
              setCreating(true);
            }}
          >
            <Plus className="h-4 w-4" />
            New workspace
          </Button>
        ) : null}
      </div>

      {error && !creating && !renaming ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="space-y-2">
        {workspaces.map((workspace) => {
          const isCurrent = workspace.id === currentWorkspaceId;
          return (
            <Card
              key={workspace.id}
              className={cn("shadow-none", isCurrent && "border-primary/30 bg-primary/5")}
            >
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-semibold text-primary">
                  {workspace.name[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate font-medium">
                    {workspace.name}
                    {isCurrent ? (
                      <Badge variant="secondary" className="gap-1">
                        <Check className="h-3 w-3" />
                        Current
                      </Badge>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">/{workspace.slug}</span> ·{" "}
                    {roleLabel(workspace.role)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {isCurrent ? (
                    canRename ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setError(null);
                          setRenaming(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                    ) : null
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={switching || pending}
                      onClick={() => void switchTo(workspace.id)}
                    >
                      <Building2 className="h-3.5 w-3.5" />
                      Switch to
                    </Button>
                  )}

                  {/*
                    Only an admin of *this* workspace. Never disabled — clicking
                    is how you learn what is blocking it, with exact numbers, in
                    the dialog. Styled to match Edit and Switch to: same variant
                    and size, so the row reads as one set of actions.
                  */}
                  {workspace.role === "admin" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending || switching}
                      onClick={() => {
                        setError(null);
                        setRemoving(workspace);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {workspaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">You are not in any workspace yet.</p>
        ) : null}
      </div>

      <FormDialog
        open={creating}
        onClose={() => setCreating(false)}
        title="New workspace"
        description="You'll be its admin, and you'll be switched into it once it's created."
      >
        <form
          className="grid gap-4 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitCreate();
          }}
        >
          <Field label="Workspace Name" error={error ?? undefined}>
            <Input
              required
              autoFocus
              value={draft.name}
              placeholder="e.g. Northwind Traders"
              onChange={(event) => {
                const name = event.target.value;
                setDraft((cur) => ({
                  ...cur,
                  name,
                  slug: slugTouched ? cur.slug : slugify(name),
                }));
              }}
            />
          </Field>
          <Field label="URL Slug" hint="Lowercase letters, numbers and hyphens">
            <Input
              required
              value={draft.slug}
              placeholder="northwind-traders"
              onChange={(event) => {
                setSlugTouched(true);
                setDraft((cur) => ({ ...cur, slug: event.target.value }));
              }}
            />
          </Field>
          <DialogActions
            onCancel={() => setCreating(false)}
            submitLabel="Create workspace"
            disabled={pending || switching}
          />
        </form>
      </FormDialog>

      <FormDialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title={`Edit ${current?.name ?? "workspace"}`}
        description="Renaming affects everyone in this workspace."
      >
        <form action={submitRename} className="grid gap-4 py-2">
          <Field label="Workspace Name" error={error ?? undefined}>
            <Input name="name" required defaultValue={current?.name} />
          </Field>
          <Field label="Description">
            <Textarea name="description" defaultValue={currentDescription} />
          </Field>
          <DialogActions
            onCancel={() => setRenaming(false)}
            submitLabel="Save changes"
            disabled={pending}
          />
        </form>
      </FormDialog>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove(removing);
        }}
        blocked={removing ? blockersFor(removing) !== null : false}
        title={
          removing && blockersFor(removing)
            ? `${removing.name} cannot be deleted yet`
            : `Delete ${removing?.name ?? "workspace"}?`
        }
        description={
          !removing
            ? ""
            : blockersFor(removing)
              ? `It still has ${blockersFor(removing)}. Delete the projects and remove the ` +
                `other members first — deleting a workspace would take their work with it.`
              : `This removes the workspace and your membership of it.${
                  removing.id === currentWorkspaceId
                    ? " You are in this workspace, so you will be moved out of it."
                    : ""
                } It has no projects and nobody else active in it, so nothing else is lost. This cannot be undone.`
        }
      />
    </div>
  );
}
