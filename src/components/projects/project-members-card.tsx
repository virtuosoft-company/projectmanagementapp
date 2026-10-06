"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChartNoAxesColumn, Plus } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/form-dialog";
import { DialogActions } from "@/components/ui/form-actions";
import { addProjectMembersAction } from "@/lib/actions";
import type { Member } from "@/lib/domain";

export type ProjectMemberRow = {
  member: Member;
  tasksDone: number;
  tasksTotal: number;
  hours: number;
  /**
   * Capacity, in hours. `committedHours` is the estimate on everything they
   * still owe **across the workspace**, not just this project — the other
   * figures in this row are project-scoped, and this one deliberately is not,
   * because somebody at their limit is usually at it because of other work.
   *
   * `capacityHours` is their `monthlyHours`. Zero means it was never set, and
   * the bar is withheld rather than dividing by it.
   */
  committedHours: number;
  capacityHours: number;
};

/** Over, nearly full, or fine. One function so the bar and the label agree. */
function loadTone(ratio: number): { bar: string; text: string } {
  if (ratio > 1) return { bar: "bg-destructive", text: "text-destructive" };
  if (ratio >= 0.9) return { bar: "bg-warning", text: "text-warning" };
  return { bar: "bg-success", text: "text-success" };
}

export function ProjectMembersCard({
  projectId,
  rows,
  candidates,
  canEdit,
}: {
  projectId: string;
  rows: ProjectMemberRow[];
  /** Every workspace member; those already on the project are filtered out. */
  candidates: Member[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<ProjectMemberRow | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const available = candidates.filter(
    (member) => !rows.some((row) => row.member.id === member.id),
  );

  // One flat list, by name. The grouping that used to sit here was per team.
  const ordered = useMemo(
    () => [...rows].sort((a, b) => a.member.name.localeCompare(b.member.name)),
    [rows],
  );

  function add() {
    startTransition(async () => {
      const result = await addProjectMembersAction(projectId, selected);
      if (result.ok) {
        setSelected([]);
        setAdding(false);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <div className="flex! flex-row items-center justify-between px-6">
        <CardTitle className="text-sm">Members</CardTitle>
        <div>
          {canEdit ? (
            <Button variant="ghost" size="xs" onClick={() => setAdding(true)} disabled={pending}>
              <Plus className="h-3.5 w-3.5" />
              Add member
            </Button>
          ) : null}
        </div>
      </div>
      <CardContent className="space-y-1">
        {ordered.map(({ member, tasksDone, tasksTotal, hours, committedHours, capacityHours }) => (
          <div
            key={member.id}
            className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted/50"
          >
            <UserAvatar
              name={member.name}
              className="h-9 w-9 bg-primary/10"
              textClassName="text-xs text-primary"
            />
            <div className="min-w-0 flex-1">
              <button
                type="button"
                className="block max-w-full truncate rounded text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Analytics for ${member.name}`}
                onClick={() =>
                  setViewing({
                    member,
                    tasksDone,
                    tasksTotal,
                    hours,
                    committedHours,
                    capacityHours,
                  })
                }
              >
                {member.name}
              </button>
              <p className="truncate text-xs text-muted-foreground">
                <span className="capitalize">{member.role}</span> · {member.email}
              </p>

              {capacityHours > 0 ? (
                <div className="mt-1.5 flex items-center gap-2">
                  <div
                    className="h-1 w-full max-w-24 overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={`${Math.round(
                      (committedHours / capacityHours) * 100,
                    )}% of capacity committed`}
                  >
                    <div
                      className={`h-full rounded-full ${loadTone(committedHours / capacityHours).bar}`}
                      // Capped so an over-committed bar fills the track rather
                      // than overflowing it; the number beside it carries the
                      // overflow.
                      style={{
                        width: `${Math.min(100, Math.round((committedHours / capacityHours) * 100))}%`,
                      }}
                    />
                  </div>
                  <span
                    className={`shrink-0 font-mono text-[10px] ${loadTone(committedHours / capacityHours).text}`}
                  >
                    {Math.round(committedHours)}/{capacityHours}h
                  </span>
                </div>
              ) : null}
            </div>
            <div className="shrink-0 text-right text-xs">
              <p className="font-mono font-medium">
                {tasksDone}/{tasksTotal} tasks
              </p>
              <p className="font-mono text-muted-foreground">{hours.toFixed(1)}h logged</p>
            </div>
          </div>
        ))}

        {rows.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">Nobody is on this project yet.</p>
        ) : null}
      </CardContent>

      {viewing ? (
        <FormDialog
          open
          onClose={() => setViewing(null)}
          title={viewing.member.name}
          description={`${viewing.member.designation ?? viewing.member.role} · ${viewing.member.email}`}
        >
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Tasks done</p>
                <p className="mt-1 font-mono text-xl font-bold">
                  {viewing.tasksDone}/{viewing.tasksTotal}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Progress</p>
                <p className="mt-1 font-mono text-xl font-bold">
                  {viewing.tasksTotal
                    ? Math.round((viewing.tasksDone / viewing.tasksTotal) * 100)
                    : 0}
                  %
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Logged</p>
                <p className="mt-1 font-mono text-xl font-bold">{viewing.hours.toFixed(1)}h</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">Their work on this project.</p>

            {viewing.capacityHours > 0 ? (
              <div className="rounded-md border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs text-muted-foreground">Committed across all projects</p>
                  <p
                    className={`font-mono text-sm font-medium ${
                      loadTone(viewing.committedHours / viewing.capacityHours).text
                    }`}
                  >
                    {Math.round(viewing.committedHours)} / {viewing.capacityHours}h
                  </p>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${
                      loadTone(viewing.committedHours / viewing.capacityHours).bar
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round((viewing.committedHours / viewing.capacityHours) * 100),
                      )}%`,
                    }}
                  />
                </div>
                {/* Said plainly, because the three tiles above are this project
                    only and this figure is not. */}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Estimated hours on unfinished tasks assigned to them anywhere in the workspace,
                  against their {viewing.capacityHours}h month.
                </p>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/team-members/${viewing.member.id}`}>
                  <ChartNoAxesColumn className="h-3.5 w-3.5" />
                  Full analytics
                </Link>
              </Button>
            </div>
          </div>
        </FormDialog>
      ) : null}

      <FormDialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add member"
        description="Pick workspace members to add to this project."
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <div className="max-h-60 space-y-1 overflow-y-auto rounded-md border p-2">
            {available.map((member) => (
              <label
                key={member.id}
                className="flex cursor-pointer items-center gap-3 rounded-md p-1.5 hover:bg-muted/50"
              >
                <Checkbox
                  checked={selected.includes(member.id)}
                  onCheckedChange={() =>
                    setSelected((current) =>
                      current.includes(member.id)
                        ? current.filter((id) => id !== member.id)
                        : [...current, member.id],
                    )
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{member.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {member.email}
                  </span>
                </span>
              </label>
            ))}
            {available.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">
                Everyone in the workspace is already on this project.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogActions
              onCancel={() => setAdding(false)}
              submitLabel="Add"
              disabled={selected.length === 0 || pending}
            />
          </div>
        </form>
      </FormDialog>
    </Card>
  );
}
