"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, viewerCan } from "@/lib/session";

export type ActionResult = { ok: boolean; error?: string };

/** Hours in the longest month — a ceiling that catches a typo without guessing at a policy. */
const MAX_MONTHLY_HOURS = 744;

/**
 * Update your own profile.
 *
 * Scoped to the signed-in user by `requireUser()` rather than taking an id, so
 * there is no parameter an attacker could point at somebody else's account.
 *
 * Everyone may change their display name. Email and monthly hours need
 * `members.invite` — the same permission that governs editing anyone else's
 * profile in Admin → Users, so whoever may set these fields for others may set
 * them for themselves. For everybody else they are read-only: email is the
 * sign-in identity, and monthly hours is the denominator of every utilization
 * figure on the timesheet and member analytics.
 */
export async function updateProfileAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  // `viewerCan`, not `can(user.role, …)`: `user.role` is the base enum carried
  // on the JWT, so a custom role that narrows `members.invite` away would still
  // pass this check while the form — which reads `hasPermission` — has already
  // rendered the fields read-only. Only the resolver knows the narrowed subset.
  const manages = await viewerCan("members.invite");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (name.length > 80) return { ok: false, error: "Name must be 80 characters or fewer." };

  const data: { name: string; email?: string; monthlyHours?: number } = { name };

  if (manages) {
    // Lowercased to match `authorize()`, which looks the account up by the
    // lowercased address — storing a capitalised one would lock you out.
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    if (!email) return { ok: false, error: "Email is required." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email." };
    if (email !== user.email.toLowerCase()) {
      const taken = await prisma.user.findFirst({
        where: { email, id: { not: user.id } },
        select: { id: true },
      });
      if (taken) return { ok: false, error: "That email is already in use." };
      data.email = email;
    }

    const raw = String(formData.get("monthlyHours") ?? "").trim();
    const monthlyHours = Number(raw);
    if (!raw || !Number.isInteger(monthlyHours) || monthlyHours < 0 || monthlyHours > MAX_MONTHLY_HOURS) {
      return { ok: false, error: `Monthly hours must be a whole number between 0 and ${MAX_MONTHLY_HOURS}.` };
    }
    data.monthlyHours = monthlyHours;
  }

  await prisma.user.update({ where: { id: user.id }, data });

  revalidatePath("/profile");
  // The name is in the sidebar and the header on every page, so the shell has
  // to be revalidated too, not just this route.
  revalidatePath("/", "layout");
  return { ok: true };
}
