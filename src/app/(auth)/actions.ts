"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { askForNewPassword } from "@/server/auth/new-password";
import { clientIp, newPasswordLimiter, signInLimiter } from "@/server/auth/rate-limit";
import { homeFor, safeReturnPath } from "@/server/auth/roles";
import { attemptSignIn, changeOwnPassword, signOutCurrentSession } from "@/server/auth/sign-in";
import { requireSignedIn } from "@/server/context";
import { db } from "@/server/db";
import { logEvent } from "@/server/log";
import {
  type AskForPasswordError,
  checkAskForPasswordForm,
  checkNewPassword,
  checkSignInForm,
  type NewPasswordError,
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
  if (!signInLimiter.allow(clientIp(requestHeaders))) {
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

export type AskForPasswordState = { error: AskForPasswordError | null; username: string; sent: boolean };

/**
 * AUTH-7: asks the admin for a new password. The answer is "sent" whether or not the username exists,
 * so the page never shows which usernames do; only the rate limit and an empty box are refused.
 */
export async function askForPassword(_previous: AskForPasswordState, form: FormData): Promise<AskForPasswordState> {
  const username = text(form, "username");

  const problem = checkAskForPasswordForm({ username });
  if (problem) return { error: problem, username, sent: false };

  if (!newPasswordLimiter.allow(clientIp(await headers()))) {
    logEvent("new_password_refused", { reason: "rate_limited" });
    return { error: "tooMany", username, sent: false };
  }

  // No username is longer than 64 characters (ADM-2), so a longer one opens nothing.
  const userId = username.length > 64 ? null : await askForNewPassword(db, username);
  logEvent("new_password_asked", { userId });
  return { error: null, username: "", sent: true };
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
