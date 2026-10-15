import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import si from "../../../messages/si.json";
import ta from "../../../messages/ta.json";
import { resetCodeEmail, type ResetEmailWords } from "./reset-email";

function wordsIn(locale: "si" | "ta" | "en"): ResetEmailWords {
  const messages = { si, ta, en }[locale];
  const t = createTranslator({ locale, messages, namespace: "forgotPassword.email" });
  const app = createTranslator({ locale, messages, namespace: "app" });
  return {
    appName: app("name"),
    ministry: app("ministry"),
    subject: t("subject"),
    heading: t("heading"),
    intro: t("intro"),
    codeLabel: t("codeLabel"),
    account: t("account"),
    valid: t("valid"),
    secret: t("secret"),
    notYou: t("notYou"),
    automatic: t("automatic"),
  };
}

describe("the email with the code for a forgotten password (AUTH-7)", () => {
  it.each(["si", "ta", "en"] as const)("in %s, says the code, the account and how long it lasts", (locale) => {
    const words = wordsIn(locale);
    const mail = resetCodeEmail(words, "042917", "ds0101", locale);

    expect(mail.subject).toBe(words.subject);
    for (const part of [mail.text, mail.html!]) {
      expect(part).toContain("042917");
      expect(part).toContain("ds0101");
      expect(part).toContain(words.ministry);
    }
    expect(mail.text).toContain(words.valid);
    expect(mail.html).toContain(`<html lang="${locale}">`);
  });

  it("puts the code before the username in the text, where the end-to-end tests look for 6 digits", () => {
    const mail = resetCodeEmail(wordsIn("si"), "123456", "ds654321", "si");
    expect(mail.text.match(/\d{6}/)?.[0]).toBe("123456");
  });

  it("escapes what goes into the HTML", () => {
    const words = { ...wordsIn("en"), intro: 'Use <b>this</b> & "that"' };
    const mail = resetCodeEmail(words, "000001", "<x>", "en");
    expect(mail.html).toContain("Use &lt;b&gt;this&lt;/b&gt; &amp; &quot;that&quot;");
    expect(mail.html).toContain("&lt;x&gt;");
    expect(mail.html).not.toContain("<x>");
    // The text part stays as written.
    expect(mail.text).toContain('Use <b>this</b> & "that"');
  });
});
