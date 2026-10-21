"use server";

/**
 * Uploads that are not attached to a task: someone's profile photo, and the
 * deployment's own branding.
 *
 * All of it is stored through `uploadImageFile`, on save rather than on
 * selection — the file is previewed locally while the form is open and only
 * crosses the wire when the person commits to it.
 *
 * Replacing an image deletes the object it replaced. Storage is cheap, but an
 * app that never cleans up accumulates every avatar anyone ever tried, with
 * nothing left pointing at them.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { buildFileUrl, isImageKind, validateImageFile, type ImageKind } from "@/lib/files";
import { deleteStoredFile, uploadImageFile } from "@/lib/files-server";
import { requirePermission, requireUser } from "@/lib/session";

export type ActionResult = { ok: boolean; error?: string; url?: string };

/** The single AppSetting row. Its id is fixed, so this is an upsert of one row. */
const APP_SETTING_ID = "app";

/** Which branding slot a form is writing to, and the column that holds it. */
const BRANDING_COLUMN = {
  "logo-light": "logoLightKey",
  "logo-dark": "logoDarkKey",
  favicon: "faviconKey",
} as const;

type BrandingKind = keyof typeof BRANDING_COLUMN;

function isBrandingKind(value: string): value is BrandingKind {
  return value in BRANDING_COLUMN;
}

/**
 * The shared half of every upload here: check it is an image, push it to R2,
 * and hand back the key. Returns a message rather than throwing so each caller
 * can decide what to say.
 */
async function store(
  file: File,
  kind: ImageKind,
  uploadedById: string,
): Promise<{ ok: true; objectKey: string } | { ok: false; error: string }> {
  // Re-checked server-side: these actions are reachable directly, not only
  // through the picker that already validated.
  const allowed = validateImageFile(file);
  if (!allowed.isValid) return { ok: false, error: allowed.error ?? "That file is not an image." };

  const upload = await uploadImageFile(file, kind, uploadedById);
  if (!upload.success || !upload.objectKey) {
    return { ok: false, error: upload.error ?? "The upload failed." };
  }

  return { ok: true, objectKey: upload.objectKey };
}

/**
 * Best-effort cleanup of the object an upload replaced.
 *
 * Never fails the action: the new image is already stored and recorded, and
 * leaving one orphaned object behind is a far smaller problem than telling
 * somebody their photo did not save when it did.
 */
async function discard(objectKey: string | null | undefined) {
  if (objectKey) await deleteStoredFile(objectKey);
}

// --- Profile photo ---------------------------------------------------------

/**
 * Set the signed-in person's profile photo.
 *
 * Anyone may change their own — there is no permission for it, because it is
 * their own account. Changing somebody else's is not offered at all.
 */
export async function updateProfileImageAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image first." };
  }

  const stored = await store(file, "avatar", user.id);
  if (!stored.ok) return { ok: false, error: stored.error };

  const previous = await prisma.user.findUnique({
    where: { id: user.id },
    select: { imageKey: true },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { image: buildFileUrl(stored.objectKey), imageKey: stored.objectKey },
  });

  await discard(previous?.imageKey);

  revalidatePath("/profile");
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true, url: buildFileUrl(stored.objectKey) };
}

/** Remove the photo and fall back to initials. */
export async function removeProfileImageAction(): Promise<ActionResult> {
  const user = await requireUser();

  const previous = await prisma.user.findUnique({
    where: { id: user.id },
    select: { imageKey: true },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { image: null, imageKey: null },
  });

  await discard(previous?.imageKey);

  revalidatePath("/profile");
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}

// --- Branding --------------------------------------------------------------

/**
 * Set the app's logo, dark-mode logo or favicon.
 *
 * Gated on `workspace.settings` — owner and admin — because this is the whole
 * deployment's identity, not one workspace's: it is what a signed-out visitor
 * sees on the sign-in screen and in their browser tab.
 */
export async function updateBrandingAction(formData: FormData): Promise<ActionResult> {
  const user = await requirePermission("workspace.settings");

  const kind = String(formData.get("kind") ?? "");
  if (!isBrandingKind(kind) || !isImageKind(kind)) {
    return { ok: false, error: "That is not a branding image." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image first." };
  }

  const stored = await store(file, kind, user.id);
  if (!stored.ok) return { ok: false, error: stored.error };

  const column = BRANDING_COLUMN[kind];
  const previous = await prisma.appSetting.findUnique({ where: { id: APP_SETTING_ID } });

  await prisma.appSetting.upsert({
    where: { id: APP_SETTING_ID },
    update: { [column]: stored.objectKey },
    create: { id: APP_SETTING_ID, [column]: stored.objectKey },
  });

  await discard(previous?.[column]);

  // The favicon and logo are rendered from the root layout, so the whole tree
  // has to be revalidated rather than one page.
  revalidatePath("/", "layout");
  void user;
  return { ok: true, url: buildFileUrl(stored.objectKey) };
}

/** Clear one branding slot, restoring the built-in wordmark. */
export async function removeBrandingAction(kind: string): Promise<ActionResult> {
  await requirePermission("workspace.settings");

  if (!isBrandingKind(kind)) return { ok: false, error: "That is not a branding image." };

  const column = BRANDING_COLUMN[kind];
  const previous = await prisma.appSetting.findUnique({ where: { id: APP_SETTING_ID } });
  if (!previous?.[column]) return { ok: true };

  await prisma.appSetting.update({
    where: { id: APP_SETTING_ID },
    data: { [column]: null },
  });

  await discard(previous[column]);

  revalidatePath("/", "layout");
  return { ok: true };
}
