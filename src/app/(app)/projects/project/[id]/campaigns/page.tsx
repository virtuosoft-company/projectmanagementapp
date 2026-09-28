import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CampaignsGrid } from "@/components/projects/campaigns-grid";
import { getCampaigns, getProject } from "@/lib/queries";
import { getSessionUser, hasPermission, projectScope, requireUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/projects/project/[id]/campaigns">): Promise<Metadata> {
  const { id } = await params;
  const viewer = await getSessionUser();
  const project = viewer?.workspaceId ? await getProject(viewer.workspaceId, id, await projectScope()) : null;
  return { title: `${project?.name ?? "Project"} — Campaigns` };
}

export default async function CampaignsPage({
  params,
}: PageProps<"/projects/project/[id]/campaigns">) {
  const viewer = await requireUser();
  const { id } = await params;
  const project = await getProject(viewer.workspaceId, id, await projectScope());
  // A feature switched off is genuinely gone, not just hidden from the nav.
  if (!project || !project.features.includes("campaigns")) notFound();

  const campaigns = await getCampaigns(viewer.workspaceId, project.id);

  return (
    <CampaignsGrid
      project={project}
      campaigns={campaigns}
      canEdit={await hasPermission("projects.edit")}
      canDelete={await hasPermission("projects.delete")}
    />
  );
}
