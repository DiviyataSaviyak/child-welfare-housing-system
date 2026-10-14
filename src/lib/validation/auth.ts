/** Form checks shared by the sign-in and password pages. The error codes match keys in messages/si.json. */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type SignInFormError = "required" | "invalid" | "tooMany";

export function checkSignInForm(input: { username: string; password: string }): SignInFormError | null {
  if (input.username.trim() === "" || input.password === "") return "required";
  if (input.username.length > 64 || input.password.length > PASSWORD_MAX_LENGTH) return "invalid";
  return null;
}

export type AskForPasswordError = "required" | "tooMany";

/** AUTH-7: a request for a new password needs only the username. */
export function checkAskForPasswordForm(input: { username: string }): AskForPasswordError | null {
  return input.username.trim() === "" ? "required" : null;
}

export type NewPasswordError = "required" | "tooShort" | "tooLong" | "mismatch" | "sameAsCurrent";

/** AUTH-3: at least 8 characters, typed the same twice, and different from the current password. */
export function checkNewPassword(input: { current: string; next: string; confirm: string }): NewPasswordError | null {
  if (input.current === "" || input.next === "" || input.confirm === "") return "required";
  if (input.next.length < PASSWORD_MIN_LENGTH) return "tooShort";
  if (input.next.length > PASSWORD_MAX_LENGTH) return "tooLong";
  if (input.next !== input.confirm) return "mismatch";
  if (input.next === input.current) return "sameAsCurrent";
  return null;
}
