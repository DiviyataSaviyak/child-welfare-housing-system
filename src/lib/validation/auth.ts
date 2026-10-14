/** Form checks shared by the sign-in and password pages. The error codes match keys in messages/si.json. */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type SignInFormError = "required" | "invalid" | "tooMany";

export function checkSignInForm(input: { username: string; password: string }): SignInFormError | null {
  if (input.username.trim() === "" || input.password === "") return "required";
  if (input.username.length > 64 || input.password.length > PASSWORD_MAX_LENGTH) return "invalid";
  return null;
}

export type ChosenPasswordError = "required" | "tooShort" | "tooLong" | "mismatch";

/** AUTH-3: a new password has at least 8 characters and is typed the same twice. */
export function checkChosenPassword(input: { next: string; confirm: string }): ChosenPasswordError | null {
  if (input.next === "" || input.confirm === "") return "required";
  if (input.next.length < PASSWORD_MIN_LENGTH) return "tooShort";
  if (input.next.length > PASSWORD_MAX_LENGTH) return "tooLong";
  if (input.next !== input.confirm) return "mismatch";
  return null;
}

export type NewPasswordError = ChosenPasswordError | "sameAsCurrent";

/** AUTH-3: changing one's password also needs the current one, and the new one must differ from it. */
export function checkNewPassword(input: { current: string; next: string; confirm: string }): NewPasswordError | null {
  if (input.current === "") return "required";
  const problem = checkChosenPassword(input);
  if (problem) return problem;
  return input.next === input.current ? "sameAsCurrent" : null;
}

/** AUTH-7: the code sent by email, as typed, without spaces. */
export const readResetCode = (typed: string) => typed.replace(/\s/g, "");

export type ResetCodeFormError = "required" | "format";

/** AUTH-7: the code is six digits; anything else isn't counted as a wrong try. */
export function checkResetCodeForm(code: string): ResetCodeFormError | null {
  if (code === "") return "required";
  return /^\d{6}$/.test(code) ? null : "format";
}
