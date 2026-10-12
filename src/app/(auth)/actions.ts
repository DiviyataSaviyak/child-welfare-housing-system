"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp, signInLimiter } from "@/server/auth/rate-limit";
import { homeFor, safeReturnPath } from "@/server/auth/roles";
import { attemptSignIn, changeOwnPassword, signOutCurrentSession } from "@/server/auth/sign-in";
import { requireSignedIn } from "@/server/context";
import { logEvent } from "@/server/log";
import { checkNewPassword, checkSignInForm, type NewPasswordError, type SignInFormError } from "@/lib/validation/auth";

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
