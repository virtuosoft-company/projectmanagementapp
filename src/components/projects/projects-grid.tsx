"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import {
  CalendarDays,
  Circle,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SquareCheckBig,
  Trash2,
} from "lucide-react";
import { AvatarStack } from "@/components/avatar-stack";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/form-dialog";
import { DialogActions } from "@/components/ui/form-actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import {
  createProjectAction,
  deleteProjectAction,
  updateProjectAction,
} from "@/lib/actions";
import {
  COLOR_SWATCHES,
  PROJECT_STATUSES,
  formatDay,
  type Member,
  type Project,
  type ProjectStatus,
} from "@/lib/domain";
import {
  createProjectSchema,
  fieldErrors,
  type FieldErrors,
} from "@/lib/validations";
import { statusVariant } from "@/lib/status";
import { cn } from "@/lib/utils";

export type ProjectCard = Project & { done: number; taskCount: number };

export function ProjectsGrid({
  projects,
  members,
  canCreate,
  canEdit,
  canDelete,
  stats,
  showingAll,
}: {
  projects: ProjectCard[];
  members: Member[];
  canCreate: boolean;
  /** `projects.edit` — the ⋯ menu's Edit. */
  canEdit: boolean;
  /** `projects.delete` — its Delete. */
  canDelete: boolean;
  /** Summary cards rendered between the header and the project grid. */
  stats: React.ReactNode;
  /**
   * Whether `projects` is the whole workspace or only the viewer's own.
   *
   * Resolved from `projectScope()` on the server, because the narrowing happens
   * in the query and nothing in the props reveals it: a manager with no
   * projects and a workspace with no projects arrive here identically. The
   * heading used to claim "All projects in your workspace" either way, which
   * read as the page being broken rather than as a rule being applied.
   */
  showingAll: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProjectCard | null>(null);
  const [removing, setRemoving] = useState<ProjectCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects.filter((project) => {
      if (status !== "all" && project.status !== status) return false;
      if (!term) return true;
      return (
        project.name.toLowerCase().includes(term) ||
        project.description.toLowerCase().includes(term)
      );
    });
  }, [projects, search, status]);

  /** `done` is the toast raised on success; omitted where none is wanted. */
  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    onDone: () => void,
    done?: string,
  ) {
    startTransition(async () => {
      const result = await action();
      setError(result.error ?? null);
      if (result.ok) {
        if (done) toast.success(done);
        onDone();
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold leading-tight tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            {showingAll ? "All projects in your workspace" : "Projects you are a member of"}
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreating(true)} disabled={pending}>
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {stats}

      {projects.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1 ">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 text-muted-foreground"
            />
            <Input
              value={search}
              aria-label="Search projects"
              placeholder="Search projects…"
              className="h-9 pl-8"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <SelectField
            value={status}
            aria-label="Filter by status"
            className="h-9 w-40"
            onValueChange={setStatus}
            options={[
              { value: "all", label: "Any status" },
              ...PROJECT_STATUSES.map((value) => ({
                value,
                label: value.replace("-", " "),
              })),
            ]}
          />

          {/* <span className="text-xs text-muted-foreground">
            {visible.length === projects.length
              ? `${projects.length} project${projects.length === 1 ? "" : "s"}`
              : `${visible.length} of ${projects.length}`}
          </span> */}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visible.map((project) => (
          <Card key={project.id} className="transition-shadow hover:shadow-md">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Circle
                    className="h-3 w-3 shrink-0"
                    style={{ color: project.color, fill: project.color }}
                  />
                  <Link
                    href={`/projects/project/${project.id}`}
                    className="truncate font-semibold hover:underline"
                  >
                    {project.name}
                  </Link>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge variant={statusVariant[project.status]}>{project.status}</Badge>
                  {canEdit || canDelete ? (
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={pending}
                          aria-label={`Actions for ${project.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        {canEdit ? (
                          <DropdownMenuItem onSelect={() => setEditing(project)}>
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </DropdownMenuItem>
                        ) : null}
                        {canDelete ? (
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setRemoving(project)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </div>

              <p className="line-clamp-2 text-sm text-muted-foreground">
                {project.description || "No description."}
              </p>

              <Progress
                value={project.taskCount ? Math.round((project.done / project.taskCount) * 100) : 0}
                aria-label={`${project.name} task progress`}
                className="h-1.5"
              />

              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <SquareCheckBig className="h-3.5 w-3.5" />
                  <span className="font-mono">
                    {project.done}/{project.taskCount}
                  </span>{" "}
                  tasks
                </span>
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span className="font-mono">
                    {project.endDate ? formatDay(project.endDate) : "—"}
                  </span>
                </span>
              </div>

              <AvatarStack people={project.members} />
            </CardContent>
          </Card>
        ))}
      </div>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <FolderPlus aria-hidden className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No projects yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            A project holds the boards, tasks and time behind a piece of work.
          </p>
          {canCreate ? (
            <Button className="mt-4" onClick={() => setCreating(true)} disabled={pending}>
              <Plus className="h-4 w-4" />
              New Project
            </Button>
          ) : null}
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No project matches those filters.
        </p>
      ) : null}

      <ProjectDialog
        key={String(creating)}
        open={creating}
        pending={pending}
        onClose={() => setCreating(false)}
        members={members}
        onSubmit={(draft) =>
          run(() => createProjectAction(draft), () => setCreating(false), "Project created")
        }
      />

      {editing ? (
        <ProjectDialog
          key={editing.id}
          open
          project={editing}
          pending={pending}
          onClose={() => setEditing(null)}
          members={members}
          onSubmit={(draft) =>
            run(
              () => updateProjectAction({ ...draft, id: editing.id }),
              () => setEditing(null),
              "Project updated",
            )
          }
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const project = removing;
          if (!project) return;
          setRemoving(null);
          run(() => deleteProjectAction(project.id), () => undefined, "Project deleted");
        }}
        confirmLabel="Delete"
        title={`Delete ${removing?.name ?? "project"}?`}
        description={
          removing?.taskCount
            ? `Its ${removing.taskCount} tasks go with it, along with their subtasks, files and logged time. This cannot be undone.`
            : "Its boards, sheets and campaigns go with it. This cannot be undone."
        }
      />
    </div>
  );
}

type ProjectDraft = {
  name: string;
  description: string;
  status: ProjectStatus;
  color: string;
  startDate: string;
  endDate: string;
  memberIds: string[];
};

function ProjectDialog({
  open,
  project,
  pending,
  onClose,
  onSubmit,
  members,
}: {
  open: boolean;
  /** The project being edited, or nothing when creating one. */
  project?: ProjectCard;
  pending: boolean;
  onClose: () => void;
  onSubmit: (draft: ProjectDraft) => void;
  members: Member[];
}) {
  const [draft, setDraft] = useState({
    name: project?.name ?? "",
    description: project?.description ?? "",
    status: project?.status ?? ("planning" as ProjectStatus),
    color: project?.color ?? COLOR_SWATCHES[0],
    startDate: project?.startDate ?? "",
    endDate: project?.endDate ?? "",
    memberIds: project?.members.map((person) => person.id) ?? ([] as string[]),
  });

  /**
   * Per-field messages from the same schema the action parses with, so what the
   * field says is what the server would have said.
   *
   * The name input used to carry the native `required` attribute, which meant
   * the browser blocked submit with its own tooltip before any of this ran —
   * no `aria-invalid`, nothing in the DOM, and nothing a test could assert.
   */
  const [errors, setErrors] = useState<FieldErrors>({});

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((current) => {
      // Clears as soon as they start fixing it, rather than sitting there stale.
      setErrors((shown) => {
        if (!shown[key as string]) return shown;
        const next = { ...shown };
        delete next[key as string];
        return next;
      });
      return { ...current, [key]: value };
    });

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={project ? "Edit project" : "Create Project"}
      description={
        project
          ? "Change this project's details and who is on it. Its colour is set on the project itself."
          : "Add a new project to your workspace."
      }
      className="max-w-xl"
    >
      <form
        className="grid gap-4 py-2"
        onSubmit={(event) => {
          event.preventDefault();

          // The action parses again on arrival — this is not a substitute for
          // that, only the half that can tell the person which field is wrong.
          const parsed = createProjectSchema.safeParse(draft);
          if (!parsed.success) {
            setErrors(fieldErrors(parsed.error));
            return;
          }

          setErrors({});
          onSubmit(draft);
        }}
      >
        <Field label="Name" required error={errors.name}>
          <Input
            value={draft.name}
            aria-invalid={errors.name ? true : undefined}
            placeholder="e.g. Marketing Site"
            onChange={(event) => set("name", event.target.value)}
          />
        </Field>

        <Field label="Description">
          <Textarea
            value={draft.description}
            placeholder="What is this project about?"
            onChange={(event) => set("description", event.target.value)}
          />
        </Field>

        <Field label="Status">
          <SelectField
            value={draft.status}
            className="capitalize"
            onValueChange={(value) => set("status", value as ProjectStatus)}
            options={PROJECT_STATUSES.map((status) => ({ value: status, label: status }))}
          />
        </Field>

        <fieldset>
          <legend className="mb-4 text-sm font-medium leading-none">Color</legend>
          <div className="flex items-center gap-2">
            {COLOR_SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => set("color", color)}
                aria-label={`Use color ${color}`}
                aria-pressed={draft.color === color}
                className={cn(
                  "h-7 w-7 rounded-full border-2 transition-transform",
                  draft.color === color
                    ? "scale-110 border-foreground"
                    : "border-transparent hover:scale-105",
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start Date">
            <Input
              type="date"
              value={draft.startDate}
              onChange={(event) => set("startDate", event.target.value)}
            />
          </Field>
          <Field label="End Date">
            <Input
              type="date"
              value={draft.endDate}
              onChange={(event) => set("endDate", event.target.value)}
            />
          </Field>
        </div>

        <fieldset>
          <div className="mb-4 flex items-center justify-between gap-2">
            <legend className="text-sm font-medium leading-none">
              Members ({draft.memberIds.length} selected)
            </legend>
          </div>

          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
            {members.length === 0 ? (
              <p className="p-1.5 text-sm text-muted-foreground">
                Nobody is in this workspace yet.
              </p>
            ) : (
              members.map((member) => (
                <label
                  key={member.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md p-1.5 text-sm hover:bg-muted/50"
                >
                  <Checkbox
                    checked={draft.memberIds.includes(member.id)}
                    onCheckedChange={() =>
                      set(
                        "memberIds",
                        draft.memberIds.includes(member.id)
                          ? draft.memberIds.filter((id) => id !== member.id)
                          : [...draft.memberIds, member.id],
                      )
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">{member.name}</span>
                </label>
              ))
            )}
          </div>
        </fieldset>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogActions
            onCancel={onClose}
            submitLabel={project ? "Save changes" : "Create Project"}
            disabled={pending}
          />
        </div>
      </form>
    </FormDialog>
  );
}
