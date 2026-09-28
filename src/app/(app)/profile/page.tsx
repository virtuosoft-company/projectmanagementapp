import type { Metadata } from "next";
import { ImageUpload } from "@/components/ui/image-upload";
import { PersonalInfoForm } from "@/components/profile/personal-info-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { roleLabel } from "@/lib/permissions";
import { getMember } from "@/lib/queries";
import { hasPermission, requirePage } from "@/lib/session";

export const metadata: Metadata = { title: "My Profile" };

/**
 * Who you are, and the details you can change about yourself.
 *
 * Deliberately only that. The four stat tiles, your projects and your assigned
 * tasks used to sit here too; they now live on the dashboard, which is the
 * screen for what you are working on. Keeping them in both places meant two
 * screens answering the same question and drifting apart — the shared
 * components in `components/dashboard/personal-overview` were extracted for
 * exactly that reason and are now used from one place.
 *
 * One consequence worth the note: this page no longer reads projects, project
 * stats or member stats at all, so it costs a single query.
 */
export default async function ProfilePage() {
  const viewer = await requirePage("profile");
  const profile = await getMember(viewer.workspaceId, viewer.id);

  // The session's copy is whatever the JWT was minted with; the row is current.
  const name = profile?.name ?? viewer.name;
  const email = profile?.email ?? viewer.email;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold leading-tight tracking-tight">My Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          View and manage your personal information
        </p>
      </div>

      <Card className="shadow-none">
        <CardContent className="py-4 px-6">
          <div className="flex flex-col justify-between items-start gap-5 sm:flex-row">
            <ImageUpload
              kind="avatar"
              shape="round"
              label="Profile photo"
              currentUrl={profile?.image ?? null}
              className="w-full sm:max-w-md flex-1"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold">{name}</h2>
                <Badge variant="outline">{roleLabel(viewer.role)}</Badge>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">{email}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Details</h2>
        <PersonalInfoForm
          name={name}
          email={email}
          monthlyHours={profile?.monthlyHours ?? 0}
          manages={await hasPermission("members.invite")}
        />
      </section>
    </div>
  );
}
