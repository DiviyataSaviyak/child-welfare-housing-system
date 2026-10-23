"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { normaliseUsername } from "@/server/auth/accounts";
import { checkResetCode, resetPasswordWithCode, sendResetCode } from "@/server/auth/password-reset";
import { clientIp, resetCodeLimiter, signInLimiter } from "@/server/auth/rate-limit";
import { resetCodeEmail } from "@/server/auth/reset-email";
import { homeFor, safeReturnPath } from "@/server/auth/roles";
import { attemptSignIn, changeOwnPassword, signOutCurrentSession } from "@/server/auth/sign-in";
import { requireSignedIn } from "@/server/context";
import { db } from "@/server/db";
import { logEvent } from "@/server/log";
import { mailSetup, sendMail } from "@/server/mail";
import {
  checkChosenPassword,
  checkNewPassword,
  checkResetCodeForm,
  checkSignInForm,
  type ChosenPasswordError,
  type NewPasswordError,
  readResetCode,
  type ResetCodeFormError,
  type SignInFormError,
} from "@/lib/validation/auth";

export type SignInState = {
  error: SignInFormError | "wrong" | "locked" | null;
  username: string;
  /** With "wrong": tries left before the account locks. With "locked": minutes until it opens. */
  count?: number;
};

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

export async function signIn(_previous: SignInState, form: FormData): Promise<SignInState> {
  const username = text(form, "username");
  const password = text(form, "password");

  const problem = checkSignInForm({ username, password });
  if (problem) return { error: problem, username };

  const requestHeaders = await headers();
  if (!(await signInLimiter.allow(db, clientIp(requestHeaders)))) {
    logEvent("sign_in_refused", { reason: "rate_limited" });
    return { error: "tooMany", username };
  }

  const result = await attemptSignIn({ username, password }, requestHeaders);
  if (!result.ok) {
    const { refusal } = result;
    return refusal.kind === "locked"
      ? { error: "locked", username, count: refusal.minutesLeft }
      : { error: "wrong", username, count: refusal.attemptsLeft };
  }

  if (result.mustChangePassword) redirect("/change-password");
  redirect(safeReturnPath(text(form, "next"), result.role) ?? homeFor(result.role));
}

export type AskForCodeState = {
  error: "required" | "tooMany" | "emailFailed" | "emailOff" | null;
  username: string;
  /** Carries the officer from step to step; never shown or put in an address, and stored only as a hash. */
  ticket: string | null;
};

/**
 * AUTH-7, step 1: sends a code by email to the address in the account. The answer is the same for any
 * username (src/server/auth/password-reset.ts); only an empty box, the rate limit, a server with no mail
 * server and an email that didn't go are refused. The email is in the screen's language.
 */
export async function askForCode(_previous: AskForCodeState, form: FormData): Promise<AskForCodeState> {
  const username = text(form, "username").trim();
  if (username === "") return { error: "required", username, ticket: null };
  if (!mailSetup()) return { error: "emailOff", username, ticket: null };

  if (!(await resetCodeLimiter.allow(db, clientIp(await headers())))) {
    logEvent("reset_code_refused", { reason: "rate_limited" });
    return { error: "tooMany", username, ticket: null };
  }

  const [t, app, locale] = await Promise.all([
    getTranslations("forgotPassword.email"),
    getTranslations("app"),
    getLocale(),
  ]);
  const words = {
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
  const result = await sendResetCode(db, username, (email, code) =>
    sendMail(email, resetCodeEmail(words, code, normaliseUsername(username), locale)),
  );
  if (!result.ok) {
    logEvent("reset_code_refused", { reason: "email_failed" });
    return { error: "emailFailed", username, ticket: null };
  }
  logEvent("reset_code_sent", { userId: result.userId });
  return { error: null, username, ticket: result.ticket };
}

export type CheckCodeState = {
  error: ResetCodeFormError | "wrong" | "tooManyTries" | "expired" | null;
  /** With "wrong": tries left before the code stops working. */
  count?: number;
  checked: boolean;
};

/** AUTH-7, step 2: the code from the email. */
export async function checkCode(_previous: CheckCodeState, form: FormData): Promise<CheckCodeState> {
  const code = readResetCode(text(form, "code"));
  const problem = checkResetCodeForm(code);
  if (problem) return { error: problem, checked: false };

  const result = await checkResetCode(db, text(form, "ticket"), code);
  if (result.ok) return { error: null, checked: true };
  if (result.error === "wrong") return { error: "wrong", count: result.triesLeft, checked: false };
  return { error: result.error, checked: false };
}

export type SetNewPasswordState = { error: ChosenPasswordError | "expired" | null };

/** AUTH-7, step 3: the new password. Then the officer signs in with it. */
export async function setNewPassword(_previous: SetNewPasswordState, form: FormData): Promise<SetNewPasswordState> {
  const input = { next: text(form, "next"), confirm: text(form, "confirm") };
  const problem = checkChosenPassword(input);
  if (problem) return { error: problem };

  const result = await resetPasswordWithCode(db, text(form, "ticket"), input.next);
  if (!result.ok) return { error: "expired" };
  logEvent("password_reset_by_code", { userId: result.userId });
  redirect("/login?notice=passwordReset");
}

export type ChangePasswordState = { error: NewPasswordError | "currentWrong" | null };

export async function changePassword(_previous: ChangePasswordState, form: FormData): Promise<ChangePasswordState> {
  const context = await requireSignedIn({ allowTemporaryPassword: true });
  const input = { current: text(form, "current"), next: text(form, "next"), confirm: text(form, "confirm") };

  const problem = checkNewPassword(input);
  if (problem) return { error: problem };

  const result = await changeOwnPassword(context, input, await headers());
  if (!result.ok) return { error: result.error };
  redirect(homeFor(context.role));
}

export async function signOut(): Promise<void> {
  await signOutCurrentSession(await headers());
  redirect("/login");
}
