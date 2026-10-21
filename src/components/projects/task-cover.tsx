"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { CircleAlert, ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ACCEPT_ATTRIBUTE,
  ALLOWED_LABEL,
  MAX_SIZE,
  formatBytes,
  isOptimizableImageSrc,
  validateImageFile,
} from "@/lib/files";
import { removeTaskCoverAction, setTaskCoverAction } from "@/lib/task-actions";

/**
 * A task's cover image on its page. Choosing a file uploads it straight away:
 * there is no form around it to submit.
 */
export function TaskCover({
  taskId,
  coverUrl,
  canManage,
}: {
  taskId: string;
  coverUrl: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!coverUrl && !canManage) return null;

  function upload(file: File | undefined) {
    if (!file) return;
    const verdict = validateImageFile(file);
    if (!verdict.isValid) {
      setError(verdict.error ?? "That image cannot be used.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("taskId", taskId);
      form.set("file", file);
      const result = await setTaskCoverAction(form);
      if (!result.ok) {
        setError(result.error ?? "Could not save the cover.");
        return;
      }
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await removeTaskCoverAction(taskId);
      if (!result.ok) {
        setError(result.error ?? "Could not remove the cover.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {canManage ? (
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            upload(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      ) : null}

      {coverUrl ? (
        <div className="group relative h-40 overflow-hidden rounded-lg border bg-muted sm:h-52">
          <Image
            src={coverUrl}
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 64rem, 100vw"
            className="object-cover"
            unoptimized={!isOptimizableImageSrc(coverUrl)}
          />
          {canManage ? (
            <div className="absolute right-2 top-2 flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => inputRef.current?.click()}
              >
                <ImagePlus className="h-3.5 w-3.5" />
                {pending ? "Saving…" : "Change cover"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                aria-label="Remove cover"
                onClick={remove}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          title={`${ALLOWED_LABEL}, up to ${formatBytes(MAX_SIZE)}`}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus className="h-3.5 w-3.5" />
          {pending ? "Saving…" : "Add cover"}
        </Button>
      )}

      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
          <CircleAlert className="h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
