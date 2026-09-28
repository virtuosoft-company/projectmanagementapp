import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SectionBuilder } from "@/components/projects/section-builder";
import { getLandingSections, getProject } from "@/lib/queries";
import { getSessionUser, hasPermission, projectScope, requireUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/projects/project/[id]/landing-pages">): Promise<Metadata> {
  const { id } = await params;
  const viewer = await getSessionUser();
  const project = viewer?.workspaceId ? await getProject(viewer.workspaceId, id, await projectScope()) : null;
  return { title: `${project?.name ?? "Project"} — Landing Pages` };
}

export default async function LandingPagesPage({
  params,
}: PageProps<"/projects/project/[id]/landing-pages">) {
  const viewer = await requireUser();
  const { id } = await params;
  const project = await getProject(viewer.workspaceId, id, await projectScope());
  // A feature switched off is genuinely gone, not just hidden from the nav.
  if (!project || !project.features.includes("landing-pages")) notFound();

  const sections = await getLandingSections(viewer.workspaceId, project.id);

  return (
    <SectionBuilder
      projectId={project.id}
      projectName={project.name}
      sections={sections}
      canEdit={await hasPermission("projects.edit")}
    />
  );
}
