/**
 * File storage — the parts that are safe in the browser.
 *
 * Serving URLs and pre-flight validation live here; anything that writes bytes
 * lives in `files-server.ts`. This module ships to the client, so it must stay
 * free of node imports.
 *
 * Uploads are deferred: a file chosen in the UI is previewed locally and only
 * crosses the wire when the form is saved. The server action then does the real
 * work — see `uploadImageFile` — so nothing here ever touches the database.
 *
 * Bytes live in the `File` table rather than in object storage. The columns
 * that used to hold R2 keys now hold `File` ids, and `/api/files/[id]` serves
 * them.
 */

// ── Types ──────────────────────────────────────────────────────────

export interface StoredFileResult {
    success: boolean;
    objectKey?: string;
    error?: string;
    width?: number;
    height?: number;
    format?: string;
    bytes?: number;
}

/**
 * What an image is for. The kind decides where it is stored, how large it may
 * be, and how hard it is re-encoded — a favicon and a task screenshot have
 * nothing in common but the file dialog.
 */
export type ImageKind =
    | "task-attachment"
    | "task-cover"
    | "avatar"
    | "logo-light"
    | "logo-dark"
    | "favicon";

/** Every valid ImageKind, so an action can validate without repeating the union. */
export const IMAGE_KINDS = [
    "task-attachment",
    "task-cover",
    "avatar",
    "logo-light",
    "logo-dark",
    "favicon",
] as const;

export function isImageKind(value: string): value is ImageKind {
    return (IMAGE_KINDS as readonly string[]).includes(value);
}

export interface ImageValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

// ── Serving ────────────────────────────────────────────────────────

/** Serving prefix. One constant so the route and every caller cannot drift. */
export const FILE_ROUTE = "/api/files";

/**
 * The URL that serves a stored file.
 *
 * Replaces `buildR2Url`. The seam is the same shape — a column holds an
 * opaque key, this turns it into a URL — so nothing above it knows whether the
 * bytes live in a bucket or a LONGBLOB. The key is now a `File` id.
 */
export function buildFileUrl(fileId: string): string {
    return `${FILE_ROUTE}/${fileId}`;
}

/**
 * Whether next/image can run its optimizer on this src without throwing.
 *
 * Every stored file is now same-origin, so this is true for anything
 * root-relative and false for an arbitrary external link — which still needs
 * `unoptimized` set explicitly or the page errors at render time. The R2 host
 * check this used to carry is gone along with the `remotePatterns` entry.
 *
 * Worth knowing: same-origin means the optimizer proxies each image through
 * this server rather than fetching it from a CDN, so a cache miss on an avatar
 * is a database read.
 */
export function isOptimizableImageSrc(src: string): boolean {
    // A stored file is never optimizable, even though it is same-origin. The
    // optimizer fetches the source itself, server-side, without the viewer's
    // cookies — so `/api/files/[id]` redirects it to /signin, it receives HTML
    // instead of an image, and `/_next/image` answers 400. The image then does
    // not render at all. Verified in the browser: the only thing that works is
    // letting the browser request the route directly, with its own session.
    if (src.startsWith(`${FILE_ROUTE}/`)) return false;
    return src.startsWith("/");
}

/**
 * Whether uploads can work. Always true now.
 *
 * Kept rather than deleted because the upload controls branch on it: R2 could
 * be unconfigured, and each control explained that instead of offering
 * something that could not work. A database column has nothing to configure,
 * so the explanation is gone and the controls are simply available.
 */
export function isFileStorageConfigured(): boolean {
    return true;
}

/**
 * What may be served inline. Everything else downloads.
 *
 * This is the whole defence against stored XSS. Bytes are served from this
 * app's own origin now, so an uploaded `.html` or `.svg` rendered inline
 * would run with access to the session cookie. SVG is excluded deliberately —
 * it is an image to a person and a script host to a browser.
 */
export const INLINE_MIME_TYPES = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
    "application/pdf",
] as const;

export function isInlineMimeType(mimeType: string): boolean {
    return (INLINE_MIME_TYPES as readonly string[]).includes(mimeType.toLowerCase());
}

// ── Basic file validation (shared) ─────────────────────────────────

// This module ships to the browser, so it can't read server-only env vars —
// keep this in sync with the cap the upload action enforces. Only a pre-flight
// UX check anyway; the action is the actual enforcement point.
//
// 4MB, not 10, because bytes now land in a LONGBLOB rather than a bucket, and
// MySQL refuses any statement larger than `max_allowed_packet` (5MB here). The
// app has to refuse first: otherwise the file uploads, sharp processes it, and
// the INSERT is rejected by the server — the person waits through all of that
// for a driver error instead of being told the file is too large. The gap
// between 4 and 5 is headroom for statement overhead.
//
// Images are re-encoded by sharp anyway, so a 4MB input usually stores far
// smaller; this mostly binds documents, which pass through byte-for-byte.
export const MAX_SIZE = 4 * 1024 * 1024; // 4MB

// Deliberately no GIF or SVG: every upload is re-encoded by sharp server-side,
// which flattens an animated GIF to one frame and rasterises an SVG — silently
// producing something other than what was uploaded.
const ALLOWED_TYPES = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/avif",
];
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif"];

/** Human list for the "PNG, JPEG…" hint under a file picker. */
export const ALLOWED_LABEL = "JPEG, PNG, WebP or AVIF";

/** The `accept` attribute for a file input. */
export const ACCEPT_ATTRIBUTE = ALLOWED_TYPES.join(",");

/** Quick type/size check before any upload starts. */
export function validateImageFile(file: File): {
    isValid: boolean;
    error?: string;
} {
    const fileName = file.name.toLowerCase();
    const hasValidExtension = ALLOWED_EXTENSIONS.some((ext) =>
        fileName.endsWith(ext)
    );
    const hasValidMimeType = ALLOWED_TYPES.includes(file.type);
    const isGenericMimeType =
        file.type === "" || file.type === "application/octet-stream" || !file.type;

    if (!hasValidMimeType && !hasValidExtension) {
        return {
            isValid: false,
            error: `Invalid file type. Please upload ${ALLOWED_LABEL} images.`,
        };
    }
    if (isGenericMimeType && !hasValidExtension) {
        return {
            isValid: false,
            error: `Invalid file type. Please upload ${ALLOWED_LABEL} images.`,
        };
    }
    if (file.size > MAX_SIZE) {
        return {
            isValid: false,
            error: `File size too large. Please upload images smaller than ${Math.round(MAX_SIZE / 1024 / 1024)}MB.`,
        };
    }

    return { isValid: true };
}

export const IMAGE_VALIDATION: Record<
    ImageKind,
    {
        minDimensions: { width: number; height: number };
        maxDimensions: { width: number; height: number };
        recommended: { width: number; height: number };
        /**
         * Whether a shape unlike `recommended` is worth warning about. False
         * for anything whose shape is genuinely arbitrary — warning about the
         * aspect ratio of a screenshot is noise, not help.
         */
        ratioMatters: boolean;
        note: string;
    }
> = {
    "task-attachment": {
        // A screenshot, a photo of a whiteboard, a crop of a design — the floor
        // is "big enough to read", and there is no right shape.
        minDimensions: { width: 64, height: 64 },
        maxDimensions: { width: 8000, height: 8000 },
        recommended: { width: 1600, height: 900 },
        ratioMatters: false,
        note: "Attachments are shown as square thumbnails and open full size.",
    },
    "task-cover": {
        // A banner across the top of a card and of the task page.
        minDimensions: { width: 320, height: 120 },
        maxDimensions: { width: 8000, height: 8000 },
        recommended: { width: 1600, height: 600 },
        ratioMatters: false,
        note: "Cropped to a wide strip across the top of the card.",
    },
    avatar: {
        // Rendered as a small circle everywhere it appears.
        minDimensions: { width: 200, height: 200 },
        maxDimensions: { width: 4000, height: 4000 },
        recommended: { width: 400, height: 400 },
        ratioMatters: true,
        note: "Profile photos are cropped to a circle wherever they're shown.",
    },
    "logo-light": {
        minDimensions: { width: 120, height: 40 },
        maxDimensions: { width: 4000, height: 4000 },
        recommended: { width: 400, height: 120 },
        ratioMatters: false,
        note: "Shown on the sign-in screen and in the sidebar, on a light background.",
    },
    "logo-dark": {
        minDimensions: { width: 120, height: 40 },
        maxDimensions: { width: 4000, height: 4000 },
        recommended: { width: 400, height: 120 },
        ratioMatters: false,
        note: "The same logo for dark mode — usually the light one with inverted text.",
    },
    favicon: {
        // Browsers scale this down hard; a square source keeps it crisp.
        minDimensions: { width: 64, height: 64 },
        maxDimensions: { width: 1024, height: 1024 },
        recommended: { width: 512, height: 512 },
        ratioMatters: true,
        note: "Shown in the browser tab. A square image with generous padding reads best at 16px.",
    },
};

/** Validate an image's dimensions for its intended slot. */
export function validateImageDimensions(
    width: number,
    height: number,
    kind: ImageKind
): ImageValidationResult {
    const result: ImageValidationResult = {
        isValid: true,
        errors: [],
        warnings: [],
    };
    const v = IMAGE_VALIDATION[kind];

    if (width < v.minDimensions.width || height < v.minDimensions.height) {
        result.errors.push(
            `Image dimensions (${width}x${height}) are below the minimum (${v.minDimensions.width}x${v.minDimensions.height}) — it will look blurry.`
        );
        result.isValid = false;
    }
    if (width > v.maxDimensions.width || height > v.maxDimensions.height) {
        result.errors.push(
            `Image dimensions (${width}x${height}) exceed the maximum (${v.maxDimensions.width}x${v.maxDimensions.height}) — resize before uploading.`
        );
        result.isValid = false;
    }

    if (v.ratioMatters) {
        const targetRatio = v.recommended.width / v.recommended.height;
        const actualRatio = width / height;
        if (Math.abs(actualRatio - targetRatio) > 0.15) {
            result.warnings.push(
                `Aspect ratio ${actualRatio.toFixed(2)} differs from the recommended ${v.recommended.width}x${v.recommended.height} — edges may be cropped. ${v.note}`
            );
        }
    }

    return result;
}

/** Read dimensions from a File in the browser. */
export function getImageDimensions(
    file: File
): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve({ width: img.width, height: img.height });
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to load image"));
        };

        img.src = url;
    });
}

/** Full pre-upload check: type + size + dimensions for the slot. */
export async function validateImageForSlot(
    file: File,
    kind: ImageKind
): Promise<ImageValidationResult> {
    const basic = validateImageFile(file);
    if (!basic.isValid) {
        return { isValid: false, errors: [basic.error!], warnings: [] };
    }

    try {
        const { width, height } = await getImageDimensions(file);
        return validateImageDimensions(width, height, kind);
    } catch {
        return {
            isValid: false,
            errors: ["Failed to read image dimensions."],
            warnings: [],
        };
    }
}

// ── Attachments: images and documents ──────────────────────────────

// Documents are stored exactly as uploaded; only images go through sharp.
const DOCUMENT_TYPES: Record<string, string> = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".csv": "text/csv",
};

export const ATTACHMENT_LABEL = "Images (JPEG, PNG, WebP, AVIF), PDF, Word, Excel, PowerPoint, TXT or CSV";

/** The `accept` attribute for an attachment picker. */
export const ATTACHMENT_ACCEPT = [
    ...ALLOWED_TYPES,
    ...ALLOWED_EXTENSIONS,
    ...Object.keys(DOCUMENT_TYPES),
    ...Object.values(DOCUMENT_TYPES),
].join(",");

function extensionOf(fileName: string) {
    const dot = fileName.lastIndexOf(".");
    return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}

/** The content type to store a document under, or null when it is not one we accept. */
export function documentMimeType(fileName: string): string | null {
    return DOCUMENT_TYPES[extensionOf(fileName)] ?? null;
}

export function isImageMimeType(mimeType: string) {
    return mimeType.startsWith("image/");
}

/** Type and size check for an attachment. Decided by extension, which browsers report reliably for documents. */
export function validateAttachmentFile(file: File): { isValid: boolean; error?: string } {
    const ext = extensionOf(file.name);
    const isImage = ALLOWED_EXTENSIONS.includes(ext);
    if (!isImage && !DOCUMENT_TYPES[ext]) {
        return { isValid: false, error: `${file.name}: not an allowed type. Use ${ATTACHMENT_LABEL}.` };
    }
    if (file.size > MAX_SIZE) {
        return {
            isValid: false,
            error: `${file.name} is ${formatBytes(file.size)}. Files can be at most ${formatBytes(MAX_SIZE)}.`,
        };
    }
    return { isValid: true };
}

/** `1.4 MB` — for file sizes shown next to an attachment. */
export function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
}
