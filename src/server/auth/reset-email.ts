import type { Mail } from "../mail";

/** The words of the email, in the screen's language (messages/*.json, forgotPassword.email and app). */
export type ResetEmailWords = {
  appName: string;
  ministry: string;
  subject: string;
  heading: string;
  intro: string;
  codeLabel: string;
  account: string;
  valid: string;
  secret: string;
  notYou: string;
  automatic: string;
};

const BRAND = "#0e5a4b";
const FONTS = "'Noto Sans Sinhala','Iskoola Pota','Noto Sans Tamil','Latha',Arial,Helvetica,sans-serif";

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The email with the code for a forgotten password (AUTH-7): an HTML page for mail apps that show one,
 * and the same words as plain text for the rest. Mail apps drop <style> blocks, so every style is inline
 * and the layout is a table. In the text the code comes before the username, so the first 6 digits in it
 * are the code (tests/e2e/helpers.ts).
 */
export function resetCodeEmail(words: ResetEmailWords, code: string, username: string, lang: string): Mail {
  const w = Object.fromEntries(Object.entries(words).map(([key, value]) => [key, escape(value)])) as ResetEmailWords;
  const name = escape(username);

  const text = [
    words.heading,
    "",
    words.intro,
    "",
    `${words.codeLabel}: ${code}`,
    `${words.account}: ${username}`,
    "",
    `${words.valid} ${words.secret}`,
    "",
    words.notYou,
    "",
    "--",
    words.automatic,
    `${words.appName} | ${words.ministry}`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="${escape(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${w.subject}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f4;font-family:${FONTS};color:#1f2937;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${w.codeLabel}: ${code}. ${w.valid}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f4;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #dfe7e5;">
<tr><td style="background:${BRAND};padding:18px 24px;">
<div style="font-size:20px;font-weight:bold;color:#ffffff;">${w.appName}</div>
<div style="font-size:13px;color:#cfe5df;margin-top:4px;">${w.ministry}</div>
</td></tr>
<tr><td style="padding:28px 24px 8px;">
<h1 style="margin:0 0 12px;font-size:20px;color:${BRAND};">${w.heading}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.7;">${w.intro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="background:#e8f2ef;border:1px solid #b9d6ce;border-radius:8px;padding:18px 12px;">
<div style="font-size:13px;color:#4b5563;margin-bottom:6px;">${w.codeLabel}</div>
<div style="font-family:Consolas,'Courier New',monospace;font-size:34px;font-weight:bold;letter-spacing:8px;color:${BRAND};">${code}</div>
<div style="font-size:13px;color:#4b5563;margin-top:8px;">${w.account}: <strong>${name}</strong></div>
</td></tr>
</table>
<p style="margin:20px 0 0;font-size:15px;line-height:1.7;">${w.valid}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
<tr><td style="background:#fff7e6;border-left:4px solid #d97706;padding:10px 14px;font-size:14px;line-height:1.6;color:#7c4a03;">${w.secret}</td></tr>
</table>
<p style="margin:20px 0 0;font-size:14px;line-height:1.7;color:#4b5563;">${w.notYou}</p>
</td></tr>
<tr><td style="padding:20px 24px 24px;">
<div style="border-top:1px solid #e5e7eb;padding-top:14px;font-size:12px;line-height:1.6;color:#6b7280;">${w.automatic}<br>${w.appName} | ${w.ministry}</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject: words.subject, text, html };
}
