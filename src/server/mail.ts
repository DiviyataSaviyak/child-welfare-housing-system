import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createTransport } from "nodemailer";
import { logError, logWarning } from "./log";

/**
 * Email, used for the codes that reset a forgotten password (AUTH-7, 14 Oct 2026; until then they went
 * by SMS).
 *
 * On the server, SMTP_HOST names the mail server the app sends through, with SMTP_PORT (465, the
 * default, speaks TLS from the start; any other port must switch to TLS with STARTTLS), SMTP_USER and
 * SMTP_PASSWORD. MAIL_FROM is the sender's address, by default SMTP_USER. Any mail service with SMTP
 * works: a Gmail account with an app password (smtp.gmail.com), Brevo, or Amazon SES.
 *
 * In development and CI, with no SMTP_HOST, nothing is sent: each email is added as one JSON line to the
 * file MAIL_OUTBOX (default data/mail-outbox.jsonl, which git ignores), where the end-to-end tests read
 * it. Staging and production without SMTP_HOST can't send at all.
 */
export type MailSetup =
  | { kind: "smtp"; host: string; port: number; user: string; password: string; from: string }
  | { kind: "outbox"; file: string }
  | null;

/** html, when given, is what most mail apps show; text is for the rest and for the outbox's readers. */
export type Mail = { subject: string; text: string; html?: string };

const OUTBOX_ENVIRONMENTS = ["development", "ci", "test"];

export function mailSetup(env: Record<string, string | undefined> = process.env): MailSetup {
  const host = env.SMTP_HOST?.trim();
  if (host) {
    const user = env.SMTP_USER?.trim() ?? "";
    return {
      kind: "smtp",
      host,
      port: Number(env.SMTP_PORT?.trim() || 465),
      user,
      password: env.SMTP_PASSWORD ?? "",
      from: env.MAIL_FROM?.trim() || user,
    };
  }
  if (!OUTBOX_ENVIRONMENTS.includes(env.APP_ENV ?? "development")) return null;
  return { kind: "outbox", file: env.MAIL_OUTBOX || join(process.cwd(), "data", "mail-outbox.jsonl") };
}

/**
 * Sends one email and says whether the mail server took it. The address, the text and the
 * password are never logged (SEC-8, SEC-9); a failure is logged by its error code only (EAUTH for a
 * wrong user or password, ECONNECTION or ETIMEDOUT when the server can't be reached).
 */
export async function sendMail(to: string, mail: Mail, setup: MailSetup = mailSetup()): Promise<boolean> {
  if (!setup) {
    logWarning("email_not_set_up");
    return false;
  }

  if (setup.kind === "outbox") {
    await mkdir(dirname(setup.file), { recursive: true });
    await appendFile(setup.file, `${JSON.stringify({ at: new Date().toISOString(), to, ...mail })}\n`, "utf8");
    // On a developer's own computer, show it where they are looking.
    if ((process.env.APP_ENV ?? "development") === "development") {
      console.info(`Email (not sent) to ${to}: ${mail.subject}\n${mail.text}`);
    }
    return true;
  }

  const transport = createTransport({
    host: setup.host,
    port: setup.port,
    secure: setup.port === 465,
    // Never send the password over a connection that stayed plain.
    requireTLS: setup.port !== 465,
    auth: setup.user ? { user: setup.user, pass: setup.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await transport.sendMail({ from: setup.from, to, subject: mail.subject, text: mail.text, html: mail.html });
    return true;
  } catch (error) {
    logError("email_failed", error);
    return false;
  } finally {
    transport.close();
  }
}
