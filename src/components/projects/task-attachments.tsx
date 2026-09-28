"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleAlert, FileText, ImagePlus, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Attachment } from "@/lib/domain";
import {
  ACCEPT_ATTRIBUTE,
  ALLOWED_LABEL,
  MAX_SIZE,
  formatBytes,
  isImageMimeType,
  isOptimizableImageSrc,
  validateImageForSlot,
} from "@/lib/r2";
import {
  deleteAttachmentAction,
  uploadTaskImagesAction,
  type UploadOutcome,
} from "@/lib/task-actions";
import { cn } from "@/lib/utils";

/** A file chosen but not yet saved. Local only until the upload succeeds. */
type Pending = {
  key: string;
  file: File;
  previewUrl: string;
  /** Set when the last save attempt rejected this particular file. */
  error?: string;
  /** Non-blocking advice — wrong shape for the slot, say. */
  warnings: string[];
};

/**
 * Images attached to a task, stored in Cloudflare R2.
 *
 * Choosing a file only previews it. Nothing leaves the browser until **Save**,
 * which posts the selection to a server action that resizes and re-encodes each
 * image before storing it — so a nine-megabyte phone photo lands as a few
 * hundred kilobytes.
 *
 * A failed file stays in the list with its reason attached, so saving again
 * retries just that one rather than making the person re-pick everything.
 */
export function TaskAttachments({
  taskId,
  attachments,
  problems,
  canManage,
}: {
  taskId: string;
  attachments: Attachment[];
  /**
   * What is wrong with the R2 configuration, empty when it is fine.
   *
   * A list rather than a boolean so the card can say *which* variable is
   * missing or malformed. "Not configured" is unhelpful when the variables are
   * all set and one of them is simply the wrong value.
   */
  problems: string[];
  /** `tasks.manage`. Without it attachments are visible but read-only. */
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [queue, setQueue] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Object URLs are a manual allocation; without this every preview leaks for
  // as long as the page lives. Deliberately on unmount only — revoking on each
  // change would blank the previews still on screen.
  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    return () => queueRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  }, []);

  async function accept(files: FileList | File[] | null) {
    if (!files || !canManage) return;
    setError(null);
    setNotice(null);

    const additions: Pending[] = [];
    for (const file of Array.from(files)) {
      // Checked here for immediate feedback; the action checks again, because
      // it is reachable without going through this component.
      const verdict = await validateImageForSlot(file, "task-attachment");
      if (!verdict.isValid) {
        setError(verdict.errors[0]);
        continue;
      }
      additions.push({
        key: `${file.name}-${file.size}-${Date.now()}-${additions.length}`,
        file,
        previewUrl: URL.createObjectURL(file),
        warnings: verdict.warnings,
      });
    }

    if (additions.length) setQueue((current) => [...current, ...additions]);
  }

  function drop(key: string) {
    setQueue((current) => {
      const going = current.find((item) => item.key === key);
      if (going) URL.revokeObjectURL(going.previewUrl);
      return current.filter((item) => item.key !== key);
    });
  }

  function save() {
    if (!queue.length) return;
    setError(null);
    setNotice(null);

    startTransition(async () => {
      // One request per file, not one for the batch. A server action's body is
      // capped (`serverActions.bodySizeLimit` in next.config.ts), and five
      // 10MB photos in a single request would be rejected at the HTTP layer —
      // before the action could even say which ones were too big.
      const results: UploadOutcome[] = [];
      let fatal: string | null = null;
      for (const item of queue) {
        const form = new FormData();
        form.set("taskId", taskId);
        form.append("files", item.file);
        try {
          const response = await uploadTaskImagesAction(form);
          if (response.results.length) results.push(...response.results);
          else fatal = response.error ?? "Could not upload that image.";
        } catch {
          // The request itself failed — too large for the limit, or offline.
          results.push({ filename: item.file.name, ok: false, error: "The upload failed." });
        }
        if (fatal) break;
      }
      const result = { results, error: fatal ?? undefined };

      if (!result.results.length) {
        setError(result.error ?? "Could not upload those images.");
        return;
      }

      // Keep only what failed, with the reason on the card that failed — the
      // successful ones are now real attachments and are re-rendered from the
      // server data.
      const failedByName = new Map(
        result.results.filter((row) => !row.ok).map((row) => [row.filename, row.error]),
      );

      setQueue((current) => {
        const keep: Pending[] = [];
        for (const item of current) {
          if (failedByName.has(item.file.name)) {
            keep.push({ ...item, error: failedByName.get(item.file.name) });
          } else {
            URL.revokeObjectURL(item.previewUrl);
          }
        }
        return keep;
      });

      const saved = result.results.filter((row) => row.ok).length;
      if (saved) setNotice(`Saved ${saved} image${saved === 1 ? "" : "s"}.`);
      if (failedByName.size) {
        const n = failedByName.size;
        setError(`${n} image${n === 1 ? "" : "s"} could not be saved.`);
      }
      if (saved) router.refresh();
    });
  }

  const disabled = !canManage || problems.length > 0;

  return (
    <Card className="shadow-none">
      <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle>Images</CardTitle>
        <div className="flex items-center gap-2">
          {!disabled ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
              Add images
            </Button>
          ) : null}
          {queue.length ? (
            <Button size="sm" disabled={pending} onClick={save}>
              <Upload className="h-4 w-4" />
              {pending
                ? "Saving…"
                : `Save ${queue.length} image${queue.length === 1 ? "" : "s"}`}
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {problems.length ? (
          <div className="space-y-1 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            <p>Image uploads are not working on this server:</p>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}

        {!disabled ? (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT_ATTRIBUTE}
              className="sr-only"
              onChange={(event) => {
                void accept(event.target.files);
                // Reset, so choosing the same file twice in a row still fires.
                event.target.value = "";
              }}
            />

            <div
              // A drop zone is a region, not a control: the button above is the
              // keyboard route to the same thing, so this is not focusable.
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void accept(event.dataTransfer.files);
              }}
              onPaste={(event) => void accept(event.clipboardData.files)}
              className={cn(
                "rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground transition-colors",
                dragging && "border-primary/50 bg-primary/5 text-foreground",
              )}
            >
              Drop images here, or paste from the clipboard.
              <span className="mt-1 block text-xs">
                {ALLOWED_LABEL}, up to {formatBytes(MAX_SIZE)}. Nothing is uploaded until you
                save.
              </span>
            </div>
          </>
        ) : null}

        {attachments.length === 0 && queue.length === 0 ? (
          <p className="text-sm text-muted-foreground">No images yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {attachments.map((attachment) => (
              <li key={attachment.id} className="group relative">
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="relative block aspect-square overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {/* Uploads are stored at up to 2000px but drawn here at a
                      couple of hundred; `sizes` is what stops the browser
                      fetching the full-size object for a thumbnail. The link
                      still opens the original. */}
                  {isImageMimeType(attachment.mimeType) ? (
                    <Image
                      src={attachment.url}
                      alt={attachment.filename}
                      fill
                      sizes="(min-width: 1024px) 20vw, (min-width: 640px) 30vw, 45vw"
                      className="object-cover"
                      // A bucket that is configured but not yet whitelisted in
                      // next.config.ts would otherwise throw at render time.
                      unoptimized={!isOptimizableImageSrc(attachment.url)}
                    />
                  ) : (
                    <span className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
                      <FileText aria-hidden className="h-8 w-8" />
                      <span className="text-[10px] font-medium uppercase">
                        {attachment.filename.split(".").pop()}
                      </span>
                    </span>
                  )}
                </a>

                <p className="mt-1 truncate text-xs text-muted-foreground" title={attachment.filename}>
                  {attachment.filename}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {formatBytes(attachment.size)}
                  {attachment.width && attachment.height
                    ? ` · ${attachment.width}×${attachment.height}`
                    : ""}
                </p>

                {canManage ? (
                  <Button
                    variant="secondary"
                    size="icon"
                    disabled={pending}
                    aria-label={`Delete ${attachment.filename}`}
                    onClick={() => setRemoving(attachment)}
                    className="absolute right-1 top-1 h-7 w-7 opacity-0 shadow transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </li>
            ))}

            {queue.map((item) => (
              <li key={item.key} className="relative">
                <div
                  className={cn(
                    "overflow-hidden rounded-md border-2 border-dashed",
                    item.error ? "border-destructive/50" : "border-primary/40",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.previewUrl}
                    alt=""
                    className="aspect-square w-full bg-muted object-cover opacity-80"
                  />
                </div>

                <Button
                  variant="secondary"
                  size="icon"
                  disabled={pending}
                  aria-label={`Remove ${item.file.name} from the selection`}
                  onClick={() => drop(item.key)}
                  className="absolute right-1 top-1 h-7 w-7 shadow"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>

                <p className="mt-1 truncate text-xs text-muted-foreground" title={item.file.name}>
                  {item.file.name}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {item.error ? (
                    <span className="text-destructive">{item.error}</span>
                  ) : item.warnings.length ? (
                    <span className="text-warning">{item.warnings[0]}</span>
                  ) : (
                    `${formatBytes(item.file.size)} · not saved yet`
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}

        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {notice ??
            (queue.length
              ? `${queue.length} image${queue.length === 1 ? "" : "s"} ready to save.`
              : "")}
        </p>
      </CardContent>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const attachment = removing;
          if (!attachment) return;
          setRemoving(null);
          setError(null);
          startTransition(async () => {
            const result = await deleteAttachmentAction(attachment.id);
            if (!result.ok) {
              setError(result.error ?? "Could not delete that image.");
              return;
            }

            toast.success("Image deleted");
            router.refresh();
          });
        }}
        title={`Delete ${removing?.filename ?? "image"}?`}
        description="The image is removed from this task and from storage. This cannot be undone."
      />
    </Card>
  );
}
