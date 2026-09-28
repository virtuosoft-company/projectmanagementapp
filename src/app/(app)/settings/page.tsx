import type { Metadata } from "next";
import { Check, X } from "lucide-react";
import { DangerZone } from "@/components/settings/danger-zone";
import { WorkspaceMembersCard } from "@/components/settings/workspace-members-card";
import { ImageUpload } from "@/components/ui/image-upload";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Field } from "@/components/ui/field";
import { getBranding, getMember, getWorkspace } from "@/lib/queries";
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  ROLES,
  can,
  roleLabel,
} from "@/lib/permissions";
import { hasPermission, requirePage } from "@/lib/session";
import { listMembers } from "@/lib/users";
import { updateWorkspaceAction } from "./actions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const currentUser = await requirePage("settings");
  const [members, workspace, branding, profile] = await Promise.all([
    listMembers(),
    getWorkspace(currentUser.workspaceId),
    getBranding(),
    getMember(currentUser.workspaceId, currentUser.id),
  ]);

  // Gates both the workspace form and branding: branding is the whole
  // deployment’s identity, so it sits with the same people who may change
  // workspace settings.
  const canManageWorkspace = await hasPermission("workspace.settings");

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold leading-tight tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your workspace and profile</p>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
        </CardHeader>
        <CardContent>
          {/*
            Reaching this screen and being able to change it are separate
            questions now that pages are assigned per role: a role can be given
            Settings without `workspace.settings`. The fields stay visible so
            the page is worth opening, but they are disabled and the submit is
            withheld — `updateWorkspaceAction` would refuse anyway.
          */}
          <form
            action={async (formData: FormData) => {
              "use server";
              await updateWorkspaceAction(formData);
            }}
            className="space-y-4"
          >
            <div className="grid gap-4">
              <Field label="Workspace Name">
                <Input name="name" defaultValue={workspace?.name} disabled={!canManageWorkspace} />
              </Field>
              <Field label="Description">
                <Textarea
                  name="description"
                  defaultValue={workspace?.description}
                  disabled={!canManageWorkspace}
                />
              </Field>
            </div>
            {canManageWorkspace ? (
              <Button type="submit" size="sm">
                Save Workspace
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {canManageWorkspace ? (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Branding</CardTitle>
            <CardDescription>
              Used on the sign-in screen, in the sidebar and in the browser tab. These belong to
              the whole app rather than to one workspace — the sign-in screen is rendered before
              anyone has chosen one.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ImageUpload
              kind="logo-light"
              shape="wide"
              label="Logo"
              currentUrl={branding.logoLight}
            />
            <Separator />
            <ImageUpload
              kind="logo-dark"
              shape="wide"
              label="Logo (dark mode)"
              currentUrl={branding.logoDark}
            />
            <Separator />
            <ImageUpload kind="favicon" label="Favicon" currentUrl={branding.favicon} />
          </CardContent>
        </Card>
      ) : null}

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ImageUpload
            kind="avatar"
            shape="round"
            label="Profile photo"
            currentUrl={profile?.image ?? null}
          />
          <Separator />
          <div className="grid gap-4">
            <Field label="Display name">
              <Input defaultValue={currentUser.name} />
            </Field>
            <Field label="Email" hint="Email cannot be changed">
              <Input defaultValue={currentUser.email} disabled />
            </Field>
          </div>
          <Button size="sm">Save Changes</Button>
        </CardContent>
      </Card>

      <WorkspaceMembersCard
        members={members}
        canInvite={await hasPermission("members.invite")}
        canManageRoles={await hasPermission("roles.manage")}
        currentUserId={currentUser.id}
      />

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Permissions</CardTitle>
          <CardDescription>Role-based access control for this workspace</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b">
                <tr className="text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Permission</th>
                  {ROLES.map((role) => (
                    <th key={role} className="px-3 py-2 text-center font-medium">
                      {roleLabel(role)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {PERMISSION_KEYS.map((permission) => (
                  <tr key={permission} className="border-b">
                    <td className="whitespace-nowrap px-3 py-2">
                      {PERMISSION_LABELS[permission]}
                    </td>
                    {ROLES.map((role) => (
                      <td key={role} className="px-3 py-2">
                        <span className="flex justify-center">
                          {can(role, permission) ? (
                            <Check
                              className="h-4 w-4 text-success"
                              aria-label={`${roleLabel(role)} allowed`}
                            />
                          ) : (
                            <X
                              className="h-4 w-4 text-muted-foreground/50"
                              aria-label={`${roleLabel(role)} denied`}
                            />
                          )}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <DangerZone />
    </div>
  );
}
