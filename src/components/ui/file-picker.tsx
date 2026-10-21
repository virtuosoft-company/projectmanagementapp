"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, isImageMimeType } from "@/lib/files";

/**
 * Choose one file for a form, without uploading it. The form uploads it on
 * submit, once there is something to attach it to.
 *
 * `validate` runs on selection so a wrong type or an oversized file is caught
 * before the form is sent; the server action checks again regardless.
 */
export function FilePicker({
  value,
  onChange,
  accept,
  hint,
  validate,
  disabled = false,
  buttonLabel = "Choose file",
}: {
  value: File | null;
  onChange: (file: File | null) => void;
  accept: string;
  hint?: string;
  validate: (file: File) => { isValid: boolean; error?: string };
  disabled?: boolean;
  buttonLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [error, setError] = useState<string | null>(null);
  // Any image is previewed, so what was picked is visible before it uploads.
  const previewUrl = useMemo(
    () => (value && isImageMimeType(value.type) ? URL.createObjectURL(value) : null),
    [value],
  );

  // An object URL is a manual allocation; release each one when it is replaced.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function choose(file: File | undefined) {
    if (!file) return;
    const verdict = validate(file);
    if (!verdict.isValid) {
      setError(verdict.error ?? "That file cannot be used.");
      onChange(null);
      return;
    }
    setError(null);
    onChange(file);
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          choose(event.target.files?.[0]);
          // Reset, so picking the same file again after clearing still fires.
          event.target.value = "";
        }}
      />

      {value ? (
        <div className="flex items-center gap-2 rounded-md border p-2">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={`Preview of ${value.name}`}
              className="h-10 w-16 shrink-0 rounded border object-cover"
            />
          ) : (
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm" title={value.name}>
            {value.name}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(value.size)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={disabled}
            aria-label={`Remove ${value.name}`}
            onClick={() => onChange(null)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="h-3.5 w-3.5" />
          {buttonLabel}
        </Button>
      )}

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
