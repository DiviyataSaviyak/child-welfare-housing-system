import { describe, expect, it } from "vitest";
import { parseAccountForm, parseProfileForm } from "@/lib/validation/user";
import en from "../../../messages/en.json";
import si from "../../../messages/si.json";
import { accountLabel, designationsNamed } from "./label";
import { generateTemporaryPassword } from "./passwords";
import { checkDisable, checkRoleChange } from "./rules";
import { nextUsername } from "./usernames";

describe("usernames (ADM-2)", () => {
  it("uses the office type's prefix and the next number", () => {
    expect(nextUsername("DS", [])).toBe("ds0001");
    expect(nextUsername("DS", ["ds0101", "ds0199", "ds0102"])).toBe("ds0200");
    expect(nextUsername("MINISTRY", ["ds0101", "ho0001"])).toBe("ho0002");
    expect(nextUsername("ADMINISTRATOR", ["ho0009"])).toBe("ad0001");
  });

  it("gives the new office types their own prefixes", () => {
    expect(nextUsername("DISTRICT", ["ds0007"])).toBe("dt0001");
    expect(nextUsername("PROVINCE", ["pd0004", "pv0002"])).toBe("pv0003");
    expect(nextUsername("DEPARTMENT", ["pv0009"])).toBe("pd0001");
  });

  it("ignores names that don't follow the pattern", () => {
    expect(nextUsername("DS", ["ds12", "dsx999", "ds0005"])).toBe("ds0006");
  });

  it("keeps counting past 9999", () => {
    expect(nextUsername("DS", ["ds9999"])).toBe("ds10000");
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

describe("account form (ADM-2, ADM-8)", () => {
  const form = (values: Record<string, string>) => parseAccountForm((field) => values[field] ?? "");
  const crpo = {
    name: "කේ. පෙරේරා",
    mobile: "071 000 0101",
    officeType: "DS",
    designation: "DS_CRPO",
    districtId: "1",
    dsOfficeId: "1",
  };

  it("accepts a CRPO with an office, tidies the mobile number and keeps only the office", () => {
    expect(form(crpo)).toEqual({
      ok: true,
      value: {
        name: "කේ. පෙරේරා",
        mobile: "0710000101",
        contactEmail: null,
        designation: "DS_CRPO",
        role: "DS_OFFICER",
        dsOfficeId: 1,
        districtId: null,
        provinceId: null,
      },
    });
  });

  it("leaves the name, mobile and email optional (AC-37)", () => {
    expect(form({ officeType: "DISTRICT", designation: "DISTRICT_CHIEF_ACCOUNTANT", districtId: "4" })).toEqual({
      ok: true,
      value: {
        name: "",
        mobile: null,
        contactEmail: null,
        designation: "DISTRICT_CHIEF_ACCOUNTANT",
        role: "VIEWER",
        dsOfficeId: null,
        districtId: 4,
        provinceId: null,
      },
    });
  });

  it("asks each office type for its own place only (AC-38)", () => {
    const place = (officeType: string, designation: string) => {
      const result = form({ officeType, designation, dsOfficeId: "1", districtId: "2", provinceId: "3" });
      return result.ok && [result.value.dsOfficeId, result.value.districtId, result.value.provinceId];
    };
    expect(place("DS", "DS_ACCOUNTANT")).toEqual([1, null, null]);
    expect(place("DISTRICT", "DISTRICT_CRPO")).toEqual([null, 2, null]);
    expect(place("PROVINCE", "PROVINCE_COMMISSIONER")).toEqual([null, null, 3]);
    expect(place("DEPARTMENT", "DEPARTMENT_COMMISSIONER")).toEqual([null, null, null]);
    expect(place("MINISTRY", "MINISTRY_SECRETARY")).toEqual([null, null, null]);
    expect(place("ADMINISTRATOR", "")).toEqual([null, null, null]);

    expect(form({ officeType: "DS", designation: "DS_CRPO" })).toMatchObject({ errors: { dsOfficeId: "office" } });
    expect(form({ officeType: "DISTRICT", designation: "DISTRICT_SECRETARY" })).toMatchObject({
      errors: { districtId: "district" },
    });
    expect(form({ officeType: "PROVINCE", designation: "PROVINCE_COMMISSIONER", provinceId: "x" })).toMatchObject({
      errors: { provinceId: "province" },
    });
  });

  it("sets the role from the designation, whatever else is sent", () => {
    const result = form({ officeType: "MINISTRY", designation: "MINISTRY_CHIEF_ACCOUNTANT", role: "ADMIN" });
    expect(result.ok && result.value.role).toBe("HO_OFFICER");
    const secretary = form({ officeType: "MINISTRY", designation: "MINISTRY_SECRETARY" });
    expect(secretary.ok && secretary.value.role).toBe("VIEWER");
  });

  it("refuses a designation of another office type, or one not on the list (AC-38)", () => {
    for (const [officeType, designation] of [
      ["DS", "DISTRICT_CRPO"],
      ["DISTRICT", "DS_CRPO"],
      ["MINISTRY", "DEPARTMENT_COMMISSIONER"],
      ["MINISTRY", "සංවර්ධන නිලධාරී"],
      ["PROVINCE", ""],
    ]) {
      expect(form({ officeType, designation, districtId: "1", provinceId: "1" }), designation).toMatchObject({
        ok: false,
        errors: { designation: "designation" },
      });
    }
  });

  it("gives an administrator no designation and no place (AC-38)", () => {
    const admin = form({ officeType: "ADMINISTRATOR", designation: "DS_CRPO", dsOfficeId: "1" });
    expect(admin).toMatchObject({ ok: true, value: { designation: null, role: "ADMIN", dsOfficeId: null } });
  });

  it("names each problem", () => {
    const result = form({ name: "ක", mobile: "12345", contactEmail: "not-an-address", officeType: "DS" });
    expect(result).toEqual({
      ok: false,
      errors: {
        name: "tooShort",
        mobile: "mobile",
        contactEmail: "email",
        designation: "designation",
        dsOfficeId: "office",
      },
    });
    expect(form({})).toEqual({ ok: false, errors: { officeType: "officeType" } });
    expect(form({ ...crpo, officeType: "HEAD_OFFICE" })).toMatchObject({
      ok: false,
      errors: { officeType: "officeType" },
    });
    expect(form({ ...crpo, name: "x".repeat(101) })).toMatchObject({ ok: false, errors: { name: "tooLong" } });
  });
});

describe("profile form", () => {
  const form = (values: Record<string, string>) => parseProfileForm((field) => values[field] ?? "");

  it("reads only the officer's own details, never a role, a designation or an office", () => {
    const result = form({
      name: " කේ. පෙරේරා ",
      designation: "DS_CRPO",
      mobile: "071 000 0101",
      contactEmail: "kp@example.lk",
      role: "ADMIN",
      dsOfficeId: "7",
    });
    expect(result).toEqual({
      ok: true,
      value: { name: "කේ. පෙරේරා", mobile: "0710000101", contactEmail: "kp@example.lk" },
    });
  });

  it("checks the fields as the account form does", () => {
    expect(form({ name: "ක", mobile: "12345", contactEmail: "not-an-address" })).toEqual({
      ok: false,
      errors: { name: "tooShort", mobile: "mobile", contactEmail: "email" },
    });
  });

  it("lets the officer leave the name, mobile and email empty (ADM-11)", () => {
    expect(form({})).toEqual({ ok: true, value: { name: "", mobile: null, contactEmail: null } });
    expect(form({ name: "  ", mobile: " ", contactEmail: " " })).toEqual({
      ok: true,
      value: { name: "", mobile: null, contactEmail: null },
    });
  });
});

describe("accountLabel (ADM-10)", () => {
  const names = (si: string, ta: string, en: string) => ({ nameSi: si, nameTa: ta, nameEn: en });
  const weligama = names("වැලිගම", "வெலிகம", "Weligama");
  const nameless = { name: "", designation: null, dsOffice: null, district: null, province: null };

  it("is the name when the account has one", () => {
    expect(
      accountLabel({ ...nameless, name: "කේ. පෙරේරා", designation: "DS_ACCOUNTANT", dsOffice: weligama }, "si"),
    ).toBe("කේ. පෙරේරා");
  });

  it("is the designation and the place of an account with no name, in the screen's language", () => {
    const accountant = { ...nameless, designation: "DS_ACCOUNTANT", dsOffice: weligama };
    expect(accountLabel(accountant, "si")).toBe(`${si.users.designations.DS_ACCOUNTANT}, වැලිගම`);
    expect(accountLabel(accountant, "en")).toBe(`${en.users.designations.DS_ACCOUNTANT}, Weligama`);
    const district = { ...nameless, designation: "DISTRICT_SECRETARY", district: names("මාතලේ", "மாத்தளை", "Matale") };
    expect(accountLabel(district, "en")).toBe(`${en.users.designations.DISTRICT_SECRETARY}, Matale District`);
    const province = {
      ...nameless,
      designation: "PROVINCE_COMMISSIONER",
      province: names("මධ්‍යම", "மத்திய", "Central"),
    };
    expect(accountLabel(province, "en")).toBe(`${en.users.designations.PROVINCE_COMMISSIONER}, Central Province`);
  });

  it("is the designation alone where there is no place, and Administrator for a nameless admin", () => {
    expect(accountLabel({ ...nameless, designation: "MINISTRY_SECRETARY" }, "en")).toBe(
      en.users.designations.MINISTRY_SECRETARY,
    );
    expect(accountLabel(nameless, "si")).toBe(si.users.officeTypes.ADMINISTRATOR);
  });
});

describe("searching by designation (ADM-1)", () => {
  it("finds the designations whose label holds the text, in the screen's language", () => {
    expect(designationsNamed(en.users.designations.DS_ACCOUNTANT.toUpperCase(), "en")).toContain("DS_ACCOUNTANT");
    expect(designationsNamed(si.users.designations.DS_CRPO, "si")).toContain("DS_CRPO");
    expect(designationsNamed("nothing like it", "en")).toEqual([]);
  });
});
