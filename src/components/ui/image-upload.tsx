"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { CircleAlert, ImagePlus, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  removeBrandingAction,
  removeProfileImageAction,
  updateBrandingAction,
  updateProfileImageAction,
} from "@/lib/asset-actions";
import {
  ACCEPT_ATTRIBUTE,
  ALLOWED_LABEL,
  IMAGE_VALIDATION,
  MAX_SIZE,
  formatBytes,
  isOptimizableImageSrc,
  validateImageForSlot,
  type ImageKind,
} from "@/lib/files";
import { cn } from "@/lib/utils";

/**
 * Pick an image, see it, then save it.
 *
 * Nothing is uploaded on selection: the preview is a local object URL and the
 * file only crosses the wire when Save is pressed. That makes choosing the
 * wrong file free to undo, and it means a form that is abandoned leaves no
 * orphaned object in the bucket.
 *
 * One component covers the profile photo and all three branding slots, because
 * the interaction is identical — only the shape of the preview, the action it
 * posts to, and the advice under it differ.
 */
export function ImageUpload({
  kind,
  currentUrl,
  label,
  shape = "square",
  disabled = false,
  className,
}: {
  kind: ImageKind;
  /** What is stored today, or null. */
  currentUrl: string | null;
  label: string;
  /** Round for a profile photo; the rest are rectangles. */
  shape?: "square" | "round" | "wide";
  disabled?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The object URL is a manual allocation; release the previous one whenever a
  // new file replaces it, and the last one when this unmounts.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const advice = IMAGE_VALIDATION[kind];

  function clear() {
    setFile(null);
    setPreviewUrl(null);
    setWarnings([]);
  }

  async function choose(chosen: File | null | undefined) {
    if (!chosen) return;
    setError(null);
    setNotice(null);

    const verdict = await validateImageForSlot(chosen, kind);
    if (!verdict.isValid) {
      setError(verdict.errors[0]);
      return;
    }

    setFile(chosen);
    setPreviewUrl(URL.createObjectURL(chosen));
    setWarnings(verdict.warnings);
  }

  function save() {
    if (!file) return;
    setError(null);

    startTransition(async () => {
      const form = new FormData();
      form.set("file", file);
      // The branding action serves three slots, so it is told which one.
      if (kind !== "avatar") form.set("kind", kind);

      const result =
        kind === "avatar"
          ? await updateProfileImageAction(form)
          : await updateBrandingAction(form);

      if (!result.ok) {
        setError(result.error ?? "Could not save that image.");
        return;
      }

      clear();
      setNotice(`${label} updated.`);
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result =
        kind === "avatar" ? await removeProfileImageAction() : await removeBrandingAction(kind);

      if (!result.ok) {
        setError(result.error ?? "Could not remove that image.");
        return;
      }

      clear();
      setNotice(`${label} removed.`);
      router.refresh();
    });
  }

  const shown = previewUrl ?? currentUrl;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "relative flex shrink-0 items-center justify-center overflow-hidden border bg-muted",
            shape === "round" && "h-20 w-20 rounded-full",
            shape === "square" && "h-20 w-20 rounded-md",
            shape === "wide" && "h-20 w-40 rounded-md",
            // A pending file is visibly not yet saved.
            previewUrl && "border-2 border-dashed border-primary/50",
          )}
        >
          {shown ? (
            <Image
              src={shown}
              alt={label}
              fill
              sizes="160px"
              className={shape === "wide" ? "object-contain" : "object-cover"}
              // A local preview is a `blob:` URL, which the optimiser cannot
              // fetch — and a stored image is only optimisable once the bucket
              // host is whitelisted in next.config.ts. `isOptimizableImageSrc`
              // answers both, so neither case throws at render time.
              unoptimized={!isOptimizableImageSrc(shown)}
            />
          ) : (
            <ImagePlus aria-hidden className="h-6 w-6 text-muted-foreground" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">
            {advice.note} {ALLOWED_LABEL}, up to {formatBytes(MAX_SIZE)}. Recommended{" "}
            {advice.recommended.width}×{advice.recommended.height}.
          </p>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            className="sr-only"
            onChange={(event) => {
              void choose(event.target.files?.[0]);
              // Reset, so re-picking the same file still fires.
              event.target.value = "";
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            {file ? (
              <>
                <Button size="sm" disabled={pending || disabled} onClick={save}>
                  <Upload className="h-4 w-4" />
                  {pending ? "Saving…" : "Save"}
                </Button>
                <Button variant="ghost" size="sm" disabled={pending} onClick={clear}>
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending || disabled}
                  onClick={() => inputRef.current?.click()}
                >
                  <ImagePlus className="h-4 w-4" />
                  {currentUrl ? "Replace" : "Choose image"}
                </Button>
                {currentUrl ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending || disabled}
                    onClick={remove}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      {warnings.map((warning) => (
        <p key={warning} className="text-xs text-warning">
          {warning}
        </p>
      ))}

      {error ? (
        <p role="alert" className="flex items-start gap-2 text-xs text-destructive">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {notice ?? (file ? `${file.name} — not saved yet.` : "")}
      </p>
    </div>
  );
}
