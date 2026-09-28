"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { updateProjectAction } from "@/lib/actions";
import {
  PROJECT_STATUSES,
  type Member,
  type Project,
  type ProjectStatus,
} from "@/lib/domain";
import { roleLabel } from "@/lib/permissions";

/** Project picker plus the settings form for the selected project. */
export function ProjectSettingsForm({
  projects,
  members,
}: {
  projects: Project[];
  members: Member[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [notice, setNotice] = useState<string | null>(null);

  const project = projects.find((item) => item.id === projectId);
  if (!project) return null;

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project) return;
    const form = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await updateProjectAction({
        id: project.id,
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? ""),
        status: String(form.get("status") ?? "planning") as ProjectStatus,
        startDate: String(form.get("startDate") ?? ""),
        endDate: String(form.get("endDate") ?? ""),
      });
      setNotice(result.ok ? "Saved." : (result.error ?? "Could not save."));
      if (result.ok) {
        toast.success("Project updated");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <SelectField
        value={projectId}
        onValueChange={(value) => {
          setProjectId(value);
          setNotice(null);
        }}
        aria-label="Project"
        options={projects.map((item) => ({ value: item.id, label: item.name }))}
      />

      {notice ? (
        <p role="status" className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={save}>
            <Field label="Project Name" required>
              <Input key={`${project.id}-name`} name="name" required defaultValue={project.name} />
            </Field>
            <Field label="Description">
              <Textarea
                key={`${project.id}-desc`}
                name="description"
                defaultValue={project.description}
              />
            </Field>
            <Field label="Status">
              <SelectField
                key={`${project.id}-status`}
                name="status"
                defaultValue={project.status}
                className="capitalize"
                options={PROJECT_STATUSES.map((status) => ({ value: status, label: status }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Start Date">
                <Input
                  key={`${project.id}-start`}
                  name="startDate"
                  type="date"
                  defaultValue={project.startDate ?? ""}
                />
              </Field>
              <Field label="End Date">
                <Input
                  key={`${project.id}-end`}
                  name="endDate"
                  type="date"
                  defaultValue={project.endDate ?? ""}
                />
              </Field>
            </div>
            <Button size="sm" type="submit" disabled={pending}>
              Save Changes
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Project Members</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {project.members.map((person) => {
            const member = members.find((item) => item.id === person.id);
            return (
              <div
                key={person.id}
                className="flex items-center justify-between rounded-md px-3 py-2 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <UserAvatar
                    name={person.name}
                    className="h-8 w-8 bg-primary/10"
                    textClassName="text-xs text-primary"
                  />
                  <div>
                    <p className="text-sm font-medium">{person.name}</p>
                    <p className="text-xs text-muted-foreground">{person.email}</p>
                  </div>
                </div>
                {member ? <Badge variant="outline">{roleLabel(member.role)}</Badge> : null}
              </div>
            );
          })}
          {project.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody is on this project yet.</p>
          ) : null}
        </CardContent>
      </Card>

    </div>
  );
}
