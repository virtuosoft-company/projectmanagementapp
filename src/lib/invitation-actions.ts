"use server";

/**
 * Invitations: bringing somebody into a workspace who has no account yet.
 *
 * No `User` row is written when the invitation is sent. The account is created
 * on acceptance, by the invitee, with a password they choose — so an admin can
 * invite without ever handling someone else's credentials.
 *
 * Sending is `members.invite`, the same permission that governs adding an
 * existing account. **Accepting is deliberately unauthenticated**: the person
 * accepting has no session yet, and the token in the link is the whole of their
 * authority. Everything that makes that safe is in `consumeToken` below.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { roleToDb } from "@/lib/mappers";
import { isMailConfigured, sendMail } from "@/lib/mailer";
import { notify } from "@/lib/notifications";
import { requirePermission } from "@/lib/session";
import { roleRowIdFor } from "@/lib/resolve-role";
import {
  type AcceptInvitationInput,
  acceptInvitationSchema,
  firstError,
  type InviteInput,
  inviteSchema,
} from "@/lib/validations";
import type { Role } from "@/lib/domain";

export type ActionResult = { ok: boolean; error?: string };

/** How long an invitation stays usable. */
const VALID_FOR_DAYS = 7;

function refresh() {
  revalidatePath("/admin/users");
  revalidatePath("/team-members");
}

/**
 * The public origin, for building the link that goes in the email.
 *
 * Taken from configuration rather than from the incoming request: a `Host`
 * header is attacker-controlled, and an invitation link is exactly the kind of
 * thing that must not be pointed at someone else's domain.
 */
function appOrigin(): string {
  const configured = process.env.APP_URL?.trim() || process.env.AUTH_URL?.trim();
  return (configured || "http://localhost:3000").replace(/\/+$/, "");
}

/** Tokens are compared by hash, so only the digest is ever stored. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A fresh invitation token and its digest.
 *
 * 32 random bytes, base64url — the link is the only credential, so it is sized
 * like a session secret rather than like a coupon code.
 */
function mintToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

/** Send, or re-send, an invitation. */
export async function inviteUserAction(input: InviteInput): Promise<ActionResult> {
  const actor = await requirePermission("members.invite");

  // Checked before anything is written. The alternative — store the invitation
  // and fail the send — leaves an admin holding an invitation they have no way
  // to deliver, and a row that looks pending to everyone else.
  if (!isMailConfigured()) {
    return {
      ok: false,
      error:
        "Email is not configured on this server, so an invitation cannot be sent. Set the SMTP_* variables and restart.",
    };
  }

  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  // Someone who already has an account is added directly, not invited — that
  // path exists on this screen already and does not need a password set.
  const existing = await prisma.user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: false,
      error: "That email already has an account. Use Add member to put them in this workspace.",
    };
  }

  const [workspace, inviter] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: actor.workspaceId },
      select: { name: true },
    }),
    prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }),
  ]);
  if (!workspace) return { ok: false, error: "That workspace no longer exists." };

  const { token, tokenHash } = mintToken();
  const expiresAt = new Date(Date.now() + VALID_FOR_DAYS * 24 * 60 * 60 * 1000);
  const customRoleId = await roleRowIdFor(actor.workspaceId, data.role as Role);

  // Any earlier invitation for this address in this workspace is retired first,
  // so a re-send invalidates the previous link rather than leaving two live.
  await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({
      where: {
        workspaceId: actor.workspaceId,
        email: data.email,
        acceptedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    await tx.invitation.create({
      data: {
        workspaceId: actor.workspaceId,
        email: data.email,
        role: roleToDb[data.role as Role],
        customRoleId,
        tokenHash,
        expiresAt,
        invitedById: actor.id,
      },
    });
  });

  const link = `${appOrigin()}/invite/${token}`;
  const sent = await sendMail({
    to: data.email,
    subject: `${inviter?.name ?? "Someone"} invited you to ${workspace.name}`,
    text: invitationText(workspace.name, inviter?.name ?? null, link),
    html: invitationHtml(workspace.name, inviter?.name ?? null, link),
  });

  if (!sent.ok) {
    // The row is withdrawn rather than left pending: nobody received the link,
    // so an invitation listed as outstanding would be a lie.
    await prisma.invitation.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
    refresh();
    return { ok: false, error: sent.error };
  }

  refresh();
  return { ok: true };
}

/** Withdraw an outstanding invitation, so its link stops working. */
export async function revokeInvitationAction(invitationId: string): Promise<ActionResult> {
  const actor = await requirePermission("members.invite");

  const invitation = await prisma.invitation.findFirst({
    where: { id: invitationId, workspaceId: actor.workspaceId },
    select: { id: true, acceptedAt: true },
  });
  if (!invitation) return { ok: false, error: "That invitation no longer exists." };
  if (invitation.acceptedAt) {
    return { ok: false, error: "That invitation was already accepted." };
  }

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { revokedAt: new Date() },
  });

  refresh();
  return { ok: true };
}

/**
 * The invitation a token names, or null.
 *
 * Every reason to refuse is folded into one null: expired, already accepted,
 * withdrawn, or simply wrong. Telling an anonymous caller which of those it was
 * would confirm that an address had been invited, and the page has nothing
 * useful to do differently anyway.
 *
 * The lookup is by digest, and the digest is then re-compared with
 * `timingSafeEqual`. The index lookup alone is not a meaningful oracle, but the
 * comparison costs nothing and keeps the handling of this credential uniform
 * with how a password is checked.
 */
async function consumeToken(token: string) {
  if (!token || token.length > 512) return null;

  const tokenHash = hashToken(token);
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash },
    include: { workspace: { select: { id: true, name: true } } },
  });
  if (!invitation) return null;

  const offered = Buffer.from(tokenHash, "hex");
  const stored = Buffer.from(invitation.tokenHash, "hex");
  if (offered.length !== stored.length || !timingSafeEqual(offered, stored)) return null;

  if (invitation.acceptedAt || invitation.revokedAt) return null;
  if (invitation.expiresAt.getTime() <= Date.now()) return null;

  return invitation;
}

/**
 * What the accept page shows: who the invitation is for, and where to.
 *
 * Exported for the page rather than the page querying itself, so the rules for
 * a usable invitation live in exactly one place.
 */
export async function readInvitation(
  token: string,
): Promise<{ email: string; workspaceName: string } | null> {
  const invitation = await consumeToken(token);
  if (!invitation) return null;
  return { email: invitation.email, workspaceName: invitation.workspace.name };
}

/**
 * Accept an invitation: create the account and the membership.
 *
 * Unauthenticated, by necessity. The token is re-validated here rather than
 * trusted from the page that rendered the form — the form is the half an
 * attacker skips — and the email comes from the invitation row, never from the
 * submission, so a valid token cannot be used to claim a different address.
 */
export async function acceptInvitationAction(input: AcceptInvitationInput): Promise<ActionResult> {
  const parsed = acceptInvitationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const invitation = await consumeToken(data.token);
  if (!invitation) {
    return {
      ok: false,
      error: "This invitation is no longer valid. Ask an admin to send a new one.",
    };
  }

  // Re-checked at acceptance, not only at invitation: the address may have
  // signed up on its own in the days since.
  const clash = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  });
  if (clash) {
    return { ok: false, error: "An account already uses that email. Sign in instead." };
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: data.name,
        email: invitation.email,
        passwordHash,
        lastWorkspaceId: invitation.workspaceId,
      },
      select: { id: true },
    });

    await tx.workspaceMember.create({
      data: {
        workspaceId: invitation.workspaceId,
        userId: created.id,
        role: invitation.role,
        customRoleId: invitation.customRoleId,
      },
    });

    // Stamped inside the transaction, so the link cannot be replayed even if
    // two acceptances arrive at once — `acceptedAt` is only set on the row
    // this transaction read as unaccepted.
    await tx.invitation.update({
      where: { id: invitation.id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });

    if (invitation.invitedById) {
      await notify(tx, {
        workspaceId: invitation.workspaceId,
        userIds: [invitation.invitedById],
        actorId: created.id,
        kind: "workspace-added",
        title: `${data.name} accepted your invitation`,
        body: invitation.email,
        href: "/admin/users",
      });
    }
  });

  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Email bodies
//
// Plain text and HTML say the same thing, and both lead with the link as text
// so a client that strips the anchor still shows something usable.
// ---------------------------------------------------------------------------

function invitationText(workspace: string, inviter: string | null, link: string): string {
  return [
    `${inviter ?? "An admin"} has invited you to join ${workspace}.`,
    "",
    "Open this link to choose a password and finish setting up your account:",
    link,
    "",
    `The link stops working in ${VALID_FOR_DAYS} days.`,
    "If you were not expecting this, you can ignore this email.",
  ].join("\n");
}

/**
 * Deliberately plain, table-free HTML with inline styles: mail clients strip
 * stylesheets, and an invitation does not need a layout.
 *
 * `escape` is applied to everything interpolated. The workspace name and the
 * inviter's name are user input, and this string is rendered by a mail client
 * as HTML.
 */
function invitationHtml(workspace: string, inviter: string | null, link: string): string {
  const safeWorkspace = escape(workspace);
  const safeInviter = escape(inviter ?? "An admin");
  const safeLink = escape(link);

  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#18181b">
  <p>${safeInviter} has invited you to join <strong>${safeWorkspace}</strong>.</p>
  <p>
    <a href="${safeLink}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#18181b;color:#fff;text-decoration:none">
      Accept the invitation
    </a>
  </p>
  <p style="color:#52525b;font-size:13px">
    Or paste this into your browser:<br />
    <span style="word-break:break-all">${safeLink}</span>
  </p>
  <p style="color:#52525b;font-size:13px">
    The link stops working in ${VALID_FOR_DAYS} days. If you were not expecting this, you can ignore this email.
  </p>
</div>`;
}

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
