import { describe, expect, it } from "vitest";
import { parseAccountForm, parseProfileForm } from "@/lib/validation/user";
import { generateTemporaryPassword } from "./passwords";
import { checkDisable, checkRoleChange } from "./rules";
import { nextUsername } from "./usernames";

describe("usernames (ADM-2)", () => {
  it("uses the role's prefix and the next number", () => {
    expect(nextUsername("DS_OFFICER", [])).toBe("ds0001");
    expect(nextUsername("DS_OFFICER", ["ds0101", "ds0199", "ds0102"])).toBe("ds0200");
    expect(nextUsername("HO_OFFICER", ["ds0101", "ho0001"])).toBe("ho0002");
    expect(nextUsername("ADMIN", ["ho0009"])).toBe("ad0001");
  });

  it("ignores names that don't follow the pattern", () => {
    expect(nextUsername("DS_OFFICER", ["ds12", "dsx999", "ds0005"])).toBe("ds0006");
  });

  it("keeps counting past 9999", () => {
    expect(nextUsername("DS_OFFICER", ["ds9999"])).toBe("ds10000");
  });
});

describe("temporary passwords (ADM-2, ADM-5)", () => {
  it("are 12 random characters in three groups of four, without look-alike characters", () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/);
      expect(password).not.toMatch(/[0O1lI]/);
    }
  });

  it("differ every time", () => {
    const passwords = new Set(Array.from({ length: 100 }, generateTemporaryPassword));
    expect(passwords.size).toBe(100);
  });
});

describe("account rules (ADM-6)", () => {
  const admin = { id: "a1", role: "ADMIN", banned: false };
  const officer = { id: "d1", role: "DS_OFFICER", banned: false };

  it("stops an admin disabling their own account", () => {
    expect(checkDisable("a1", admin, 3)).toBe("self");
  });

  it("keeps at least one active admin", () => {
    expect(checkDisable("a2", admin, 1)).toBe("lastAdmin");
    expect(checkDisable("a2", admin, 2)).toBeNull();
    expect(checkRoleChange("a2", admin, "HO_OFFICER", 1)).toBe("lastAdmin");
    expect(checkRoleChange("a1", admin, "HO_OFFICER", 3)).toBe("self");
  });

  it("allows everything else", () => {
    expect(checkDisable("a1", officer, 1)).toBeNull();
    expect(checkRoleChange("a1", officer, "HO_OFFICER", 1)).toBeNull();
    expect(checkRoleChange("a1", admin, "ADMIN", 1)).toBeNull();
  });
});

describe("account form (ADM-2)", () => {
  const form = (values: Record<string, string>) => parseAccountForm((field) => values[field] ?? "");
  const valid = { name: "කේ. පෙරේරා", mobile: "071 000 0101", role: "DS_OFFICER", dsOfficeId: "1" };

  it("accepts a DS officer with an office, and tidies the mobile number", () => {
    const result = form(valid);
    expect(result).toEqual({
      ok: true,
      value: {
        name: "කේ. පෙරේරා",
        designation: null,
        mobile: "0710000101",
        contactEmail: null,
        role: "DS_OFFICER",
        dsOfficeId: 1,
      },
    });
  });

  it("drops the office for Head Office and admin accounts", () => {
    const result = form({ ...valid, role: "HO_OFFICER" });
    expect(result.ok && result.value.dsOfficeId).toBeNull();
  });

  it("names each problem", () => {
    const result = form({ name: "ක", mobile: "12345", contactEmail: "not-an-address", role: "DS_OFFICER" });
    expect(result).toEqual({
      ok: false,
      errors: { name: "tooShort", mobile: "mobile", contactEmail: "email", dsOfficeId: "office" },
    });
    expect(form({ ...valid, name: "", mobile: "" })).toMatchObject({
      ok: false,
      errors: { name: "required", mobile: "required" },
    });
    expect(form({ ...valid, role: "user" })).toMatchObject({ ok: false, errors: { role: "role" } });
  });
});

describe("profile form", () => {
  const form = (values: Record<string, string>) => parseProfileForm((field) => values[field] ?? "");

  it("reads only the officer's own details, never a role or an office", () => {
    const result = form({
      name: " කේ. පෙරේරා ",
      designation: "",
      mobile: "071 000 0101",
      contactEmail: "kp@example.lk",
      role: "ADMIN",
      dsOfficeId: "7",
    });
    expect(result).toEqual({
      ok: true,
      value: { name: "කේ. පෙරේරා", designation: null, mobile: "0710000101", contactEmail: "kp@example.lk" },
    });
  });

  it("checks the fields as the account form does", () => {
    expect(form({ name: "ක", mobile: "12345", contactEmail: "not-an-address" })).toEqual({
      ok: false,
      errors: { name: "tooShort", mobile: "mobile", contactEmail: "email" },
    });
    expect(form({})).toEqual({ ok: false, errors: { name: "required", mobile: "required" } });
  });
});
