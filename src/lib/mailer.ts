import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outbound email, over SMTP.
 *
 * Configured entirely from the environment and **never** half-configured: a
 * transport is only built when every required variable is present, so the one
 * failure mode is "mail is switched off", which the caller can report plainly.
 * A partially-filled config would otherwise surface as a connection timeout
 * inside a server action, minutes after the admin pressed the button.
 */

export type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  from: string;
};

/**
 * The SMTP settings, or null when they are not all there.
 *
 * `SMTP_USER`/`SMTP_PASSWORD` are optional on purpose — a local relay or
 * Mailpit needs no credentials — but host and a from-address are not, since
 * there is nowhere to send and nothing to send as without them.
 */
export function mailConfig(): MailConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !from) return null;

  const port = Number(process.env.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return null;

  return {
    host,
    port,
    // Implicit TLS is port 465's convention; 587 upgrades with STARTTLS, which
    // nodemailer does on its own. `SMTP_SECURE` overrides when a relay differs.
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    user: process.env.SMTP_USER?.trim() || null,
    password: process.env.SMTP_PASSWORD || null,
    from,
  };
}

/** Whether mail can be sent at all — what the invite UI asks before offering. */
export function isMailConfigured(): boolean {
  return mailConfig() !== null;
}

/**
 * One transport per process.
 *
 * Nodemailer pools connections, so rebuilding it per send would open a fresh
 * SMTP conversation every time. Cached on `globalThis` for the same reason
 * `lib/prisma.ts` is: dev hot-reload re-evaluates modules and would otherwise
 * leak a transport per reload.
 */
const globalForMail = globalThis as unknown as { transporter?: Transporter };

function transport(config: MailConfig): Transporter {
  if (!globalForMail.transporter) {
    globalForMail.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.password ?? "" } : undefined,
    });
  }
  return globalForMail.transporter;
}

export type SendResult = { ok: true } | { ok: false; error: string };

/**
 * Send one message.
 *
 * Errors are returned rather than thrown: every caller is a server action that
 * has to tell the admin what happened, and an SMTP refusal is an expected
 * outcome — a wrong password or a blocked port — not a bug to crash on.
 *
 * Deliberately narrow: `to`, a subject and a body. No attachments, no `raw`,
 * no caller-supplied address lists, which is what keeps the advisories against
 * nodemailer's file/URL access and address parsing out of reach here.
 */
export async function sendMail(message: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<SendResult> {
  const config = mailConfig();
  if (!config) return { ok: false, error: "Email is not configured on this server." };

  try {
    await transport(config).sendMail({
      from: config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { ok: true };
  } catch (error) {
    // The SMTP message can name the host and the account, so it is logged for
    // the operator and summarised for the admin rather than shown verbatim.
    console.error("[mailer] send failed:", error);
    return { ok: false, error: "The email could not be sent. Check the SMTP settings." };
  }
}
