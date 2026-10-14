import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { logError, logWarning } from "./log";

/**
 * Text messages, used for the codes that reset a forgotten password (AUTH-7, 14 Oct 2026).
 *
 * On the server, SMS_URL is the SMS gateway's address for sending one message, with `{to}` where the
 * number goes (94XXXXXXXXX) and `{text}` where the message goes; the app calls it with GET. Most Sri
 * Lankan gateways take one, for example Notify.lk's
 *   https://app.notify.lk/api/v1/send?user_id=…&api_key=…&sender_id=…&to={to}&message={text}
 *
 * In development and CI, with no SMS_URL, nothing is sent: each message is added as one JSON line to
 * the file SMS_OUTBOX (default data/sms-outbox.jsonl, which git ignores), where the end-to-end tests
 * read it. Staging and production without SMS_URL can't send at all.
 */
export type SmsSetup = { kind: "gateway"; url: string } | { kind: "outbox"; file: string } | null;

const OUTBOX_ENVIRONMENTS = ["development", "ci", "test"];

export function smsSetup(env: Record<string, string | undefined> = process.env): SmsSetup {
  const url = env.SMS_URL?.trim();
  if (url) return { kind: "gateway", url };
  if (!OUTBOX_ENVIRONMENTS.includes(env.APP_ENV ?? "development")) return null;
  return { kind: "outbox", file: env.SMS_OUTBOX || join(process.cwd(), "data", "sms-outbox.jsonl") };
}

/** A stored mobile number (0XXXXXXXXX, ADM-2) in the form gateways take: 94XXXXXXXXX. */
export function internationalNumber(mobile: string): string {
  return `94${mobile.slice(1)}`;
}

/** The gateway's address for one message, with the number and the text put in, encoded for a URL. */
export function gatewayAddress(template: string, mobile: string, text: string): string {
  return template.replace(/\{(to|text)\}/g, (_, key: string) =>
    encodeURIComponent(key === "to" ? internationalNumber(mobile) : text),
  );
}

/**
 * Sends one message and says whether it went. The number, the text and the gateway's address, which
 * holds its key, are never logged (SEC-8); a failure is logged by its HTTP status only.
 */
export async function sendSms(mobile: string, text: string, setup: SmsSetup = smsSetup()): Promise<boolean> {
  if (!setup) {
    logWarning("sms_not_set_up");
    return false;
  }

  if (setup.kind === "outbox") {
    await mkdir(dirname(setup.file), { recursive: true });
    await appendFile(setup.file, `${JSON.stringify({ at: new Date().toISOString(), to: mobile, text })}\n`, "utf8");
    // On a developer's own computer, show it where they are looking.
    if ((process.env.APP_ENV ?? "development") === "development") console.info(`SMS (not sent) to ${mobile}: ${text}`);
    return true;
  }

  try {
    const response = await fetch(gatewayAddress(setup.url, mobile, text), {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return true;
    logWarning("sms_failed", { status: response.status });
    return false;
  } catch (error) {
    logError("sms_failed", error);
    return false;
  }
}
