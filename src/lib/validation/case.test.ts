import { describe, expect, it } from "vitest";
import {
  type CaseField,
  HOUSE_KINDS,
  isHouseKind,
  KINDS,
  LAND_KINDS,
  parseBuildAnswer,
  parseCaseForm,
  parseOfficeId,
  stageKind,
} from "./case";

const COMPLETE: Record<CaseField, string> = {
  category: "CARE_LEAVER",
  kind: "NEW_HOUSE",
  applicationNumber: "  KDW/147  ",
  childName: "",
  name: "  ප්‍රතිලාභී නම  ",
  nic: "880001234v",
  address: "නො. 1, පාර, නගරය",
  gnDivision: "  හෝමාගම නැගෙනහිර  ",
  mobile1: "071 234 5678",
  mobile2: "",
  remark: "",
};

const form =
  (values: Partial<Record<CaseField, string>>) =>
  (field: CaseField): string =>
    values[field] ?? "";

describe("saving a case (CASE-2, CASE-5, CASE-12)", () => {
  it("accepts a complete case and tidies its values", () => {
    const result = parseCaseForm(form(COMPLETE));
    expect(result).toEqual({
      ok: true,
      value: {
        category: "CARE_LEAVER",
        kind: "NEW_HOUSE",
        applicationNumber: "KDW/147",
        childName: null,
        name: "ප්‍රතිලාභී නම",
        nic: "880001234V",
        address: "නො. 1, පාර, නගරය",
        gnDivision: "හෝමාගම නැගෙනහිර",
        mobile1: "0712345678",
        mobile2: null,
        remark: null,
      },
    });
  });

  it("names every empty required field (AC-5)", () => {
    expect(parseCaseForm(form({}))).toEqual({
      ok: false,
      errors: {
        category: "categoryRequired",
        kind: "kindRequired",
        applicationNumber: "applicationNumberRequired",
        name: "nameRequired",
      },
    });
  });

  it("lets the NIC, address and phone numbers stay empty, and puts a lone phone number first", () => {
    const result = parseCaseForm(form({ ...COMPLETE, nic: "", address: "", mobile1: "", mobile2: "0771234567" }));
    expect(result).toMatchObject({
      ok: true,
      value: { nic: null, address: null, mobile1: "0771234567", mobile2: null },
    });
  });

  it("needs the child's name for a child at risk, and calls the name the guardian's", () => {
    const result = parseCaseForm(form({ ...COMPLETE, category: "CHILD_AT_RISK", name: "" }));
    expect(result).toEqual({
      ok: false,
      errors: { childName: "childNameRequired", name: "guardianNameRequired" },
    });
  });

  it("drops a child's name typed before the category changed to care leaver", () => {
    const result = parseCaseForm(form({ ...COMPLETE, childName: "x" }));
    expect(result.ok && result.value.childName).toBe(null);
  });

  it("refuses wrong formats and lengths (AC-6)", () => {
    const result = parseCaseForm(
      form({ ...COMPLETE, nic: "12345", mobile1: "712345678", mobile2: "0712", name: "අ", remark: "x".repeat(1001) }),
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        nic: "nicInvalid",
        mobile1: "mobileInvalid",
        mobile2: "mobileInvalid",
        name: "tooShort",
        remark: "tooLong",
      },
    });
  });

  it("accepts both NIC formats (AC-6)", () => {
    expect(parseCaseForm(form({ ...COMPLETE, nic: "198800012345" })).ok).toBe(true);
    expect(parseCaseForm(form({ ...COMPLETE, nic: "880001234V" })).ok).toBe(true);
  });

  it("treats an unknown category or kind as not chosen", () => {
    const result = parseCaseForm(form({ ...COMPLETE, category: "LAND", kind: "x" }));
    expect(result).toEqual({ ok: false, errors: { category: "categoryRequired", kind: "kindRequired" } });
  });
});

describe("the Application Number (CASE-12)", () => {
  it("takes up to 30 characters", () => {
    expect(parseCaseForm(form({ ...COMPLETE, applicationNumber: "x".repeat(30) })).ok).toBe(true);
    expect(parseCaseForm(form({ ...COMPLETE, applicationNumber: "x".repeat(31) }))).toEqual({
      ok: false,
      errors: { applicationNumber: "tooLong" },
    });
  });

  it("counts spaces alone as empty", () => {
    expect(parseCaseForm(form({ ...COMPLETE, applicationNumber: "   " }))).toEqual({
      ok: false,
      errors: { applicationNumber: "applicationNumberRequired" },
    });
  });
});

describe("where it is built (CASE-13)", () => {
  it("is the same DS division unless the form says another", () => {
    expect(parseBuildAnswer("same", "12")).toEqual({ kind: "same" });
    expect(parseBuildAnswer("", "")).toEqual({ kind: "same" });
    expect(parseBuildAnswer("other", "12")).toEqual({ kind: "other", dsOfficeId: 12 });
    expect(parseBuildAnswer("other", "")).toEqual({ kind: "other", dsOfficeId: null });
  });
});

describe("parseOfficeId", () => {
  it("reads a positive whole number, and nothing else", () => {
    expect(parseOfficeId("12")).toBe(12);
    for (const raw of ["", "0", "-1", "1.5", "abc"]) expect(parseOfficeId(raw), raw).toBeNull();
  });
});

describe("the kinds of help (CASE-17, INS-1, STG-4)", () => {
  it("has five kinds, the house kinds first", () => {
    expect(KINDS).toEqual(["NEW_HOUSE", "RENOVATION", "LAND_ONLY", "LAND_AND_BUILD", "LAND_WITH_HOUSE"]);
    expect([...HOUSE_KINDS, ...LAND_KINDS].toSorted()).toEqual([...KINDS].toSorted());
  });

  it("tells the house kinds from the land kinds", () => {
    expect(KINDS.filter(isHouseKind)).toEqual(["NEW_HOUSE", "RENOVATION"]);
  });

  it("gives buying land and building the new-house stages, and the other land kinds none", () => {
    expect(KINDS.map(stageKind)).toEqual(["NEW_HOUSE", "RENOVATION", null, "NEW_HOUSE", null]);
  });

  it("takes only the house kinds on the form until the land kinds' installments are built", () => {
    for (const kind of LAND_KINDS) {
      expect(parseCaseForm(form({ ...COMPLETE, kind }))).toEqual({ ok: false, errors: { kind: "kindRequired" } });
    }
  });
});
