import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SheetWorkspace } from "@/components/projects/sheet-workspace";
import { getMembers, getProject, getProjectSheet, getProjectSheets } from "@/lib/queries";
import { getSessionUser, hasPermission, projectScope, requireUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/projects/project/[id]/excel-sheet">): Promise<Metadata> {
  const { id } = await params;
  const viewer = await getSessionUser();
  const project = viewer?.workspaceId ? await getProject(viewer.workspaceId, id, await projectScope()) : null;
  return { title: `${project?.name ?? "Project"} — Excel Sheets` };
}

/**
 * The Excel sheets belonging to one project.
 *
 * Independent of everything else in the app: a sheet is not a view of tasks,
 * time or anything derived — just a named grid people type into, stored on
 * `ProjectSheet` and read back whole. Nothing here queries tasks.
 *
 * `?sheet=` picks which one is open; an id that no longer exists (or none at
 * all) falls back to the first, so a stale link opens the project rather than
 * an error.
 */
export default async function ProjectSpreadsheetPage({
  params,
  searchParams,
}: PageProps<"/projects/project/[id]/excel-sheet">) {
  const viewer = await requireUser();
  const { id } = await params;
  const { sheet: requested } = await searchParams;

  const project = await getProject(viewer.workspaceId, id, await projectScope());
  // A feature switched off is genuinely gone, not just hidden from the nav.
  if (!project || !project.features.includes("excel-sheet")) notFound();

  const [sheets, members] = await Promise.all([
    getProjectSheets(viewer.workspaceId, project.id),
    getMembers(viewer.workspaceId),
  ]);

  const wanted = typeof requested === "string" ? requested : undefined;
  const activeId = sheets.find((item) => item.id === wanted)?.id ?? sheets[0]?.id;
  const active = activeId ? await getProjectSheet(viewer.workspaceId, activeId) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold leading-tight tracking-tight">Excel Sheets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sheets with formulas and formatting for {project.name}
        </p>
      </div>

      <SheetWorkspace
        projectId={project.id}
        projectName={project.name}
        sheets={sheets}
        active={active}
        members={members}
        canEdit={await hasPermission("projects.edit")}
      />
    </div>
  );
}
