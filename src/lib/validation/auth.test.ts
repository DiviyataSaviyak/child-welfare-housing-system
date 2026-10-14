import { describe, expect, it } from "vitest";
import { checkAskForPasswordForm, checkNewPassword, checkSignInForm } from "./auth";

describe("sign-in form", () => {
  it("needs both fields", () => {
    expect(checkSignInForm({ username: " ", password: "x" })).toBe("required");
    expect(checkSignInForm({ username: "ds0101", password: "" })).toBe("required");
    expect(checkSignInForm({ username: "ds0101", password: "secret" })).toBeNull();
  });

  it("treats absurdly long input as a wrong sign-in, not an error page", () => {
    expect(checkSignInForm({ username: "x".repeat(65), password: "p" })).toBe("invalid");
  });
});

describe("asking for a new password (AUTH-7)", () => {
  it("needs only the username", () => {
    expect(checkAskForPasswordForm({ username: "  " })).toBe("required");
    expect(checkAskForPasswordForm({ username: "ds0101" })).toBeNull();
  });
});

describe("new password (AUTH-3)", () => {
  const valid = { current: "Temp-Pass-2026", next: "my-new-pass-99", confirm: "my-new-pass-99" };

  it("accepts a new password of at least 8 characters, typed twice", () => {
    expect(checkNewPassword(valid)).toBeNull();
    expect(checkNewPassword({ ...valid, next: "abcd1234", confirm: "abcd1234" })).toBeNull();
    expect(checkNewPassword({ ...valid, next: "abcd123", confirm: "abcd123" })).toBe("tooShort");
  });

  it("explains what is wrong", () => {
    expect(checkNewPassword({ ...valid, confirm: "" })).toBe("required");
    expect(checkNewPassword({ ...valid, next: "short", confirm: "short" })).toBe("tooShort");
    expect(checkNewPassword({ ...valid, next: "x".repeat(129), confirm: "x".repeat(129) })).toBe("tooLong");
    expect(checkNewPassword({ ...valid, confirm: "my-new-pass-98" })).toBe("mismatch");
    expect(checkNewPassword({ current: "same-password-1", next: "same-password-1", confirm: "same-password-1" })).toBe(
      "sameAsCurrent",
    );
  });
});
