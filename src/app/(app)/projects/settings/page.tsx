import type { Metadata } from "next";
import { ProjectSettingsForm } from "@/components/projects/project-settings-form";
import { getMembers, getProjects } from "@/lib/queries";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Project Settings" };

export default async function ProjectSettingsPage() {
  // Part of Settings, so unassigning that page closes this too.
  await requirePermission("workspace.settings");
  const viewer = await requirePermission("workspace.settings");
  const [projects, members] = await Promise.all([
    getProjects(viewer.workspaceId),
    getMembers(viewer.workspaceId),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold leading-tight tracking-tight">Project Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Configure individual project details</p>
      </div>
      <ProjectSettingsForm projects={projects} members={members} />
    </div>
  );
}
