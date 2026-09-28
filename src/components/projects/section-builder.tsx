"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DialogActions } from "@/components/ui/form-actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import {
  addSectionAction,
  deleteSectionAction,
  moveSectionAction,
  updateSectionAction,
} from "@/lib/actions";
import type { LandingSection, SectionType } from "@/lib/domain";
import { cn } from "@/lib/utils";

const SECTION_TYPES: { type: SectionType; label: string; description: string }[] = [
  { type: "hero", label: "Hero", description: "Large header with headline and CTA" },
  { type: "features", label: "Features", description: "Highlight key features in a grid" },
  { type: "cta", label: "Call to Action", description: "Drive user action with a bold CTA" },
  { type: "testimonials", label: "Testimonials", description: "Social proof from customers" },
  { type: "gallery", label: "Image Gallery", description: "Showcase images in a grid" },
  { type: "newsletter", label: "Newsletter", description: "Email signup section" },
  { type: "faq", label: "FAQ", description: "Frequently asked questions" },
];

const label = (type: SectionType) =>
  SECTION_TYPES.find((item) => item.type === type)?.label ?? type;

type SectionDefaults = {
  heading: string;
  subheading?: string;
  items?: string[];
  primaryCta?: string;
  secondaryCta?: string;
};

const DEFAULTS: Record<SectionType, SectionDefaults> = {
  hero: {
    heading: "Build Something Amazing",
    subheading: "The fastest way to launch your product",
    primaryCta: "Get Started",
  },
  features: { heading: "Why Choose Us", items: ["Feature 1", "Feature 2", "Feature 3"] },
  cta: {
    heading: "Ready to Start?",
    subheading: "Join thousands of happy users",
    primaryCta: "Sign Up",
    secondaryCta: "Learn More",
  },
  testimonials: {
    heading: "Loved by teams",
    items: ["“It just works.” — Customer", "“Saved us weeks.” — Customer"],
  },
  gallery: { heading: "Gallery", items: ["Image 1", "Image 2", "Image 3"] },
  newsletter: {
    heading: "Stay in the loop",
    subheading: "Product news, once a month.",
    primaryCta: "Subscribe",
  },
  faq: { heading: "Questions", items: ["How does billing work?", "Can I cancel anytime?"] },
};

export function SectionBuilder({
  projectId,
  projectName,
  sections,
  canEdit,
}: {
  projectId: string;
  projectName: string;
  sections: LandingSection[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LandingSection | null>(null);
  const [removing, setRemoving] = useState<LandingSection | null>(null);

  /** `done` is the toast raised on success; omitted for reordering. */
  function run(
    action: () => Promise<{ ok: boolean }>,
    onSuccess?: () => void,
    done?: string,
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        if (done) toast.success(done);
        onSuccess?.();
        router.refresh();
      }
    });
  }

  function move(section: LandingSection, delta: -1 | 1) {
    run(() => moveSectionAction(section.id, delta));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold leading-tight tracking-tight">Landing Page Builder</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add, arrange, and customize sections to build {projectName}&apos;s landing page
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Eye className="h-4 w-4" />
            Preview
          </Button>
          {canEdit ? (
            <Button size="sm" onClick={() => setAdding(true)} disabled={pending}>
              <Plus className="h-4 w-4" />
              Add Section
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        {sections.map((section, index) => (
          <Card key={section.id}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center gap-1 pt-1">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === 0 || pending || !canEdit}
                    onClick={() => move(section, -1)}
                    aria-label={`Move ${label(section.type)} up`}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === sections.length - 1 || pending || !canEdit}
                    onClick={() => move(section, 1)}
                    aria-label={`Move ${label(section.type)} down`}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-2">
                    <Badge variant="secondary">{label(section.type)}</Badge>
                    <span className="truncate text-sm font-medium">{section.heading}</span>
                  </div>
                  <div className="overflow-hidden rounded-md border bg-background">
                    <SectionPreview section={section} />
                  </div>
                </div>

                <div className={cn("flex flex-col gap-1", !canEdit && "hidden")}>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditing(section)}
                    aria-label={`Edit ${label(section.type)}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setRemoving(section)}
                    aria-label={`Delete ${label(section.type)}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {sections.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No sections yet. Add one to start building the page.
            </CardContent>
          </Card>
        ) : null}
      </div>

      <AddSectionDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={(type) => {
          const preset = DEFAULTS[type];
          run(
            () =>
              addSectionAction(projectId, type, {
                heading: preset.heading,
                subheading: preset.subheading,
                items: preset.items ? [...preset.items] : undefined,
                primaryCta: preset.primaryCta,
                secondaryCta: preset.secondaryCta,
              }),
            () => setAdding(false),
            "Section added",
          );
        }}
      />

      <EditSectionDialog
        key={editing?.id ?? "edit"}
        section={editing}
        onClose={() => setEditing(null)}
        onSave={(updated) => {
          run(
            () =>
              updateSectionAction({
                id: updated.id,
                heading: updated.heading,
                subheading: updated.subheading,
                items: updated.items,
                primaryCta: updated.primaryCta,
                secondaryCta: updated.secondaryCta,
              }),
            () => setEditing(null),
            "Section updated",
          );
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          run(() => deleteSectionAction(removing.id), undefined, "Section deleted");
        }}
        title={`Delete the ${removing ? label(removing.type) : ""} section?`}
        description="It will be removed from the landing page layout."
      />
    </div>
  );
}

function AddSectionDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (type: SectionType) => void;
}) {
  const [selected, setSelected] = useState<SectionType>("hero");

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Add Section"
      description="Pick a section type to append to the page."
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onAdd(selected)}>
            Add Section
          </Button>
        </>
      }
    >
      <div className="grid gap-2">
        {SECTION_TYPES.map((item) => (
          <button
            key={item.type}
            type="button"
            onClick={() => setSelected(item.type)}
            aria-pressed={selected === item.type}
            className={cn(
              "rounded-md border p-3 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected === item.type
                ? "border-primary bg-primary/5"
                : "hover:border-primary/40 hover:bg-muted/50",
            )}
          >
            <p className="text-sm font-medium">{item.label}</p>
            <p className="text-xs text-muted-foreground">{item.description}</p>
          </button>
        ))}
      </div>
    </FormDialog>
  );
}

function EditSectionDialog({
  section,
  onClose,
  onSave,
}: {
  section: LandingSection | null;
  onClose: () => void;
  onSave: (section: LandingSection) => void;
}) {
  const [draft, setDraft] = useState(section);

  if (!section || !draft) {
    return (
      <FormDialog open={false} onClose={onClose} title="Edit section" />
    );
  }

  const set = <K extends keyof LandingSection>(key: K, value: LandingSection[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Edit ${label(section.type)}`}
      description="Update the copy shown in this section."
    >
      <form
        className="grid gap-4 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <Field label="Heading" required>
          <Input
            required
            value={draft.heading}
            onChange={(event) => set("heading", event.target.value)}
          />
        </Field>
        <Field label="Subheading">
          <Input
            value={draft.subheading ?? ""}
            onChange={(event) => set("subheading", event.target.value)}
          />
        </Field>
        {draft.items ? (
          <Field label="Items" hint="One per line">
            <Textarea
              value={draft.items.join("\n")}
              onChange={(event) =>
                set("items", event.target.value.split("\n").filter((line) => line.trim()))
              }
            />
          </Field>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Primary button">
            <Input
              value={draft.primaryCta ?? ""}
              onChange={(event) => set("primaryCta", event.target.value)}
            />
          </Field>
          <Field label="Secondary button">
            <Input
              value={draft.secondaryCta ?? ""}
              onChange={(event) => set("secondaryCta", event.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogActions onCancel={onClose} submitLabel="Save" />
        </div>
      </form>
    </FormDialog>
  );
}

function SectionPreview({ section }: { section: LandingSection }) {
  if (section.items?.length) {
    return (
      <div className="space-y-3 p-6 text-center">
        <p className="text-lg font-semibold">{section.heading}</p>
        {section.subheading ? (
          <p className="text-sm text-muted-foreground">{section.subheading}</p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-3">
          {section.items.map((item) => (
            <div key={item} className="rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">
              {item}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-8 text-center">
      <p className={section.type === "hero" ? "text-2xl font-bold" : "text-lg font-semibold"}>
        {section.heading}
      </p>
      {section.subheading ? (
        <p className="text-sm text-muted-foreground">{section.subheading}</p>
      ) : null}
      <div className="flex items-center justify-center gap-2 pt-1">
        {section.primaryCta ? <Button size="sm">{section.primaryCta}</Button> : null}
        {section.secondaryCta ? (
          <Button size="sm" variant="outline">
            {section.secondaryCta}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
