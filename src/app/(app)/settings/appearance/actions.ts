"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { THEMES, type Theme } from "@/lib/domain";
import { themeToDb } from "@/lib/mappers";
import { prisma } from "@/lib/prisma";
import { requireAccount } from "@/lib/session";
import { firstError } from "@/lib/validations";

export type ActionResult = { ok: boolean; error?: string };

const themeSchema = z.object({
  theme: z.enum(THEMES.map((option) => option.value) as [Theme, ...Theme[]]),
});

/** Local, because the schema is: this payload has no reason to be shared. */
type ThemeInput = z.input<typeof themeSchema>;

/**
 * Save the signed-in person's theme.
 *
 * `requireAccount`, not `requireUser`: how the app looks is a fact about the
 * account, not about a workspace, so someone mid-onboarding with no workspace
 * yet can still set it.
 *
 * No permission attaches to it either — you are only ever changing your own
 * row, and the id comes from the session rather than the request.
 *
 * The whole layout is revalidated because the theme is a class on `<html>`,
 * rendered by the root layout — revalidating the page alone would leave the
 * old class in place until the next full navigation.
 */
export async function setThemeAction(input: ThemeInput): Promise<ActionResult> {
  const user = await requireAccount();

  const parsed = themeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  await prisma.user.update({
    where: { id: user.id },
    data: { theme: themeToDb[parsed.data.theme] },
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
