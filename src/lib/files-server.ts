import "server-only";

import sharp, { type Metadata } from "sharp";
import { prisma } from "@/lib/prisma";
import {
  documentMimeType,
  type ImageKind,
  type StoredFileResult as StoredFileResult,
} from "@/lib/files";
import { isInlineMimeType } from "@/lib/files";

/**
 * File storage — the half that writes bytes.
 *
 * Replaces `r2-server.ts`. Everything that made that module worth having is
 * still here: bytes pass through this server so every image is re-encoded by
 * sharp before it is stored, a 9MB phone photo becomes a few hundred KB, and a
 * favicon is not squashed to mush. Only the destination changed — a `File` row
 * instead of an S3 `PutObject`.
 *
 * The result type is still `StoredFileResult` (R2's shape, re-exported under a
 * neutral name) and `objectKey` still carries the identifier callers persist.
 * That is what keeps twenty-five call sites from needing to change: the seam
 * was always "a key plus a URL builder", and only the adapter behind it moved.
 */

export interface UploadOptions {
  /** Cap the longest edge; original ratio kept, never enlarged. */
  maxWidth?: number;
  /** Re-encode quality 1-100. */
  quality?: number;
}

/**
 * How hard each kind is squeezed. Unchanged from the R2 version.
 *
 * A task attachment is usually a screenshot that only needs to be readable, so
 * it is capped hard. A favicon is tiny already and is kept crisp — re-encoding
 * a 512px icon at quality 80 makes it visibly mushy at 16px.
 */
const DEFAULTS: Record<ImageKind, Required<UploadOptions>> = {
  "task-attachment": { maxWidth: 2000, quality: 80 },
  "task-cover": { maxWidth: 1600, quality: 80 },
  avatar: { maxWidth: 512, quality: 85 },
  "logo-light": { maxWidth: 800, quality: 90 },
  "logo-dark": { maxWidth: 800, quality: 90 },
  favicon: { maxWidth: 512, quality: 95 },
};

/** Branding is the only thing served without a session — see `File.public`. */
const PUBLIC_KINDS: ImageKind[] = ["logo-light", "logo-dark", "favicon"];

async function processImage(
  buffer: Buffer,
  options: Required<UploadOptions>,
): Promise<{ buffer: Buffer; metadata: Metadata }> {
  const { maxWidth, quality } = options;

  let image = sharp(buffer).resize({
    width: maxWidth,
    withoutEnlargement: true, // small images pass through untouched
  });

  const inputMeta = await sharp(buffer).metadata();
  if (inputMeta.format === "jpeg") {
    image = image.jpeg({ quality, mozjpeg: true });
  } else if (inputMeta.format === "png") {
    image = image.png({ quality });
  } else if (inputMeta.format === "webp") {
    image = image.webp({ quality });
  } else if (inputMeta.format === "heif") {
    // sharp reports AVIF as "heif" — it is HEIF-derived — so this is the
    // branch an .avif upload actually lands in. Matching on "avif" instead
    // silently skipped re-encoding and stored the original.
    image = image.avif({ quality });
  }

  const processedBuffer = await image.toBuffer();
  const metadata = await sharp(processedBuffer).metadata();
  return { buffer: processedBuffer, metadata };
}

/**
 * The MIME type for what sharp produced.
 *
 * `metadata.format` is sharp's own vocabulary, not a MIME subtype: AVIF comes
 * back as "heif", which would otherwise be stored — and later served — as
 * `image/heif`, a type browsers do not display.
 */
function mimeTypeFor(format: Metadata["format"]) {
  if (format === "heif") return "image/avif";
  return format ? `image/${format}` : "image/jpeg";
}

/**
 * Store one image and return the id to save in the database.
 *
 * Processes with sharp (width cap + re-encode) and reports the resulting
 * dimensions so callers do not have to measure the file a second time.
 */
export async function uploadImageFile(
  file: File,
  kind: ImageKind,
  uploadedById: string | null,
  options: UploadOptions = {},
): Promise<StoredFileResult> {
  try {
    if (!file.type.startsWith("image/")) {
      return { success: false, error: "Only image files can be uploaded." };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { buffer: finalBuffer, metadata } = await processImage(buffer, {
      ...DEFAULTS[kind],
      ...options,
    });

    const mimeType = mimeTypeFor(metadata.format);
    const row = await prisma.file.create({
      data: {
        name: file.name,
        mimeType,
        size: finalBuffer.length,
        // Prisma's `Bytes` wants a `Uint8Array<ArrayBuffer>`, and a Node
        // `Buffer` is `Uint8Array<ArrayBufferLike>` — which may be backed by a
        // SharedArrayBuffer and so is not assignable. Re-wrapping copies, which
        // is acceptable at these sizes and honest about the conversion.
        data: new Uint8Array(finalBuffer),
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        public: PUBLIC_KINDS.includes(kind),
        uploadedById,
      },
      select: { id: true },
    });

    return {
      success: true,
      objectKey: row.id,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      bytes: finalBuffer.length,
    };
  } catch (error) {
    console.error("[files] image upload failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

/**
 * Store a task attachment: an image is resized and re-encoded like any other,
 * a document is stored byte-for-byte under the content type its extension
 * names. Callers validate first with `validateAttachmentFile`.
 */
export async function uploadAttachmentFile(
  file: File,
  uploadedById: string | null,
): Promise<StoredFileResult & { mimeType?: string }> {
  const docType = documentMimeType(file.name);
  if (!docType) {
    const result = await uploadImageFile(file, "task-attachment", uploadedById);
    return {
      ...result,
      mimeType: result.format ? mimeTypeFor(result.format as Metadata["format"]) : file.type,
    };
  }

  try {
    const body = Buffer.from(await file.arrayBuffer());
    const row = await prisma.file.create({
      data: {
        name: file.name,
        mimeType: docType,
        size: body.length,
        data: new Uint8Array(body),
        // A document has no dimensions, and `isInlineMimeType` decides at
        // serve time whether it opens in the tab or downloads — the stored
        // type is the only input to that, so it must be the real one.
        public: false,
        uploadedById,
      },
      select: { id: true },
    });

    return { success: true, objectKey: row.id, bytes: body.length, mimeType: docType };
  } catch (error) {
    console.error("[files] attachment upload failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Upload failed" };
  }
}

/**
 * Delete a stored file (e.g. when an image is replaced).
 *
 * A missing row counts as success, the way a missing object did: the caller's
 * intent — "this file should not exist" — is already satisfied, and failing
 * would block replacing an image whose row was already gone.
 */
export async function deleteStoredFile(fileId: string): Promise<boolean> {
  try {
    const removed = await prisma.file.deleteMany({ where: { id: fileId } });
    return removed.count >= 0;
  } catch (error) {
    console.error("[files] delete failed:", error);
    return false;
  }
}

/** Metadata without the bytes — for anything that needs size or dimensions. */
export async function getStoredFileInfo(fileId: string) {
  return prisma.file.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      name: true,
      mimeType: true,
      size: true,
      width: true,
      height: true,
      public: true,
      createdAt: true,
    },
  });
}

export { isInlineMimeType };
