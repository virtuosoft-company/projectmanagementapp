"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DialogActions } from "@/components/ui/form-actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { Progress } from "@/components/ui/progress";
import { ProjectHeader } from "@/components/projects/project-header";
import {
  createCampaignAction,
  deleteCampaignAction,
  updateCampaignAction,
} from "@/lib/actions";
import {
  CAMPAIGN_STATUSES,
  formatDay,
  type Campaign,
  type CampaignStatus,
  type Project,
} from "@/lib/domain";
import type { CampaignInput } from "@/lib/validations";
import { formatPkr } from "@/lib/utils";

const campaignVariant: Record<CampaignStatus, BadgeVariant> = {
  active: "success",
  draft: "muted",
  paused: "warning",
  completed: "secondary",
};

/**
 * Typed from the schema, not from `Campaign`.
 *
 * The domain model allows `startDate: string | null`, but the schema takes a
 * string and turns an empty one into null — so a draft shaped like the model
 * claims a null the action would reject. Deriving the draft from the schema
 * keeps the form and what it posts to in step by construction, and means a
 * field added to one without the other stops compiling.
 */
type Draft = Omit<CampaignInput, "progress" | "budget"> & {
  /*
   * Narrowed back to numbers. `z.coerce.number()` accepts anything coercible,
   * so its *input* type is `unknown` — correct for a schema, useless for a
   * form field. Everything else still comes from the schema, which is what
   * keeps the field names in step.
   */
  progress: number;
  budget: number;
};

export function CampaignsGrid({
  project,
  campaigns,
  canEdit,
  canDelete,
}: {
  project: Project;
  campaigns: Campaign[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const projectId = project.id;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [removing, setRemoving] = useState<Campaign | null>(null);

  return (
    <div className="space-y-6">
      <ProjectHeader
        project={project}
        title="Campaigns"
        description="Manage marketing campaigns for this project"
        action={
          canEdit ? (
            <Button onClick={() => setCreating(true)} disabled={pending}>
              <Plus className="h-4 w-4" />
              New Campaign
            </Button>
          ) : undefined
        }
      />

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No campaigns for this project yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign) => (
            <Card key={campaign.id} className="transition-shadow hover:shadow-md">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="truncate font-semibold">{campaign.name}</h2>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant={campaignVariant[campaign.status]} className="capitalize">
                      {campaign.status}
                    </Badge>
                    {canEdit ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditing(campaign)}
                        aria-label={`Edit ${campaign.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setRemoving(campaign)}
                        aria-label={`Delete ${campaign.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>

                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {campaign.description}
                </p>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-mono font-medium">{campaign.progress}%</span>
                  </div>
                  <Progress value={campaign.progress} aria-label={`${campaign.name} progress`} />
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" />
                    <span className="font-mono">
                      {campaign.startDate ? formatDay(campaign.startDate) : "—"} –{" "}
                      {campaign.endDate ? formatDay(campaign.endDate) : "—"}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Wallet className="h-3.5 w-3.5" />
                    <span className="font-mono">{formatPkr(campaign.budget)}</span>
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CampaignDialog
        open={creating}
        onClose={() => setCreating(false)}
        title="New Campaign"
        submitLabel="Create"
        onSubmit={(draft) => {
          startTransition(async () => {
            const result = await createCampaignAction(projectId, draft);
            if (result.ok) {
              toast.success("Campaign created");
              setCreating(false);
              router.refresh();
            }
          });
        }}
      />

      <CampaignDialog
        key={editing?.id ?? "edit"}
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit Campaign"
        submitLabel="Save"
        campaign={editing ?? undefined}
        onSubmit={(draft) => {
          if (!editing) return;
          startTransition(async () => {
            const result = await updateCampaignAction(editing.id, draft);
            if (result.ok) {
              toast.success("Campaign updated");
              setEditing(null);
              router.refresh();
            }
          });
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          startTransition(async () => {
            // The result was discarded here, so a refused delete refreshed the
            // page and looked exactly like a successful one. A toast cannot be
            // raised honestly without reading it.
            const result = await deleteCampaignAction(removing.id);
            if (!result.ok) {
              toast.error(result.error ?? "Could not delete that campaign.");
              return;
            }
            toast.success("Campaign deleted");
            router.refresh();
          });
        }}
        title={`Delete ${removing?.name ?? "campaign"}?`}
        description="This removes the campaign and its budget from the project."
      />
    </div>
  );
}

function CampaignDialog({
  open,
  onClose,
  onSubmit,
  title,
  submitLabel,
  campaign,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: Draft) => void;
  title: string;
  submitLabel: string;
  campaign?: Campaign;
}) {
  const [draft, setDraft] = useState<Draft>({
    name: campaign?.name ?? "",
    description: campaign?.description ?? "",
    status: campaign?.status ?? "draft",
    progress: campaign?.progress ?? 0,
    startDate: campaign?.startDate ?? "",
    endDate: campaign?.endDate ?? "",
    budget: campaign?.budget ?? 0,
  });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <FormDialog open={open} onClose={onClose} title={title}>
      <form
        className="grid gap-4 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(draft);
        }}
      >
        <Field label="Name" required>
          <Input
            required
            value={draft.name}
            placeholder="e.g. Q2 Launch"
            onChange={(event) => set("name", event.target.value)}
          />
        </Field>
        <Field label="Description">
          <Textarea
            value={draft.description}
            placeholder="Campaign details..."
            onChange={(event) => set("description", event.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status">
            <SelectField
              value={draft.status}
              className="capitalize"
              onValueChange={(value) => set("status", value as CampaignStatus)}
              options={CAMPAIGN_STATUSES.map((status) => ({ value: status, label: status }))}
            />
          </Field>
          <Field label="Budget (PKR)">
            <Input
              type="number"
              min={0}
              value={draft.budget}
              onChange={(event) => set("budget", Number(event.target.value))}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start Date">
            <Input
              type="date"
              value={draft.startDate ?? ""}
              onChange={(event) => set("startDate", event.target.value)}
            />
          </Field>
          <Field label="End Date">
            <Input
              type="date"
              value={draft.endDate ?? ""}
              onChange={(event) => set("endDate", event.target.value)}
            />
          </Field>
        </div>
        <Field label={`Progress (${draft.progress}%)`}>
          <input
            type="range"
            min={0}
            max={100}
            value={draft.progress}
            onChange={(event) => set("progress", Number(event.target.value))}
            className="w-full accent-[hsl(var(--primary))]"
          />
        </Field>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogActions onCancel={onClose} submitLabel={submitLabel} />
        </div>
      </form>
    </FormDialog>
  );
}
