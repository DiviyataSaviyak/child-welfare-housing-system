import { describe, expect, it } from "vitest";
import {
  ageOn,
  type CaseField,
  centreInput,
  formatPartialDate,
  formReader,
  HOUSE_KINDS,
  isHouseKind,
  KINDS,
  LAND_KINDS,
  parseBuildAnswer,
  parseCaseForm,
  parseOfficeId,
  parsePartialDate,
  stageKind,
  untilBeforeFrom,
  withoutOtherCategory,
} from "./case";

/** The day the tests check dates against. */
const TODAY = "2026-11-12";

/** A complete care leaver as the form sends it, with one centre (made up, SEC-11). */
const COMPLETE: Record<string, string> = {
  category: "CARE_LEAVER",
  careGroup: "IN_CARE",
  kind: "NEW_HOUSE",
  landGnDivision: "",
  applicationNumber: "  KDW/147  ",
  childName: "",
  name: "  ප්‍රතිලාභී නම  ",
  dateOfBirth: "2009-05-20",
  relationship: "",
  relationshipOther: "",
  maritalStatus: "UNMARRIED",
  nic: "880001234v",
  address: "නො. 1, පාර, නගරය",
  gnDivision: "  හෝමාගම නැගෙනහිර  ",
  mobile1: "071 234 5678",
  mobile2: "",
  remark: "",
  familyMembers: "4",
  disabledChildren: "no",
  aid: "",
  aidOther: "",
  [centreInput(0, "name")]: "  පරීක්ෂණ ළමා නිවාසය  ",
  [centreInput(0, "provinceId")]: "1",
  [centreInput(0, "fromYear")]: "2012",
  [centreInput(0, "untilYear")]: "2015",
  [centreInput(0, "untilMonth")]: "6",
};

/** A complete child at risk as the form sends it (AC-61). */
const AT_RISK: Record<string, string> = {
  ...COMPLETE,
  category: "CHILD_AT_RISK",
  careGroup: "",
  maritalStatus: "",
  childName: "පරීක්ෂණ දරුවා",
  name: "පරීක්ෂණ භාරකරු",
  relationship: "MOTHER",
  [centreInput(0, "name")]: "",
  [centreInput(0, "provinceId")]: "",
  [centreInput(0, "fromYear")]: "",
  [centreInput(0, "untilYear")]: "",
  [centreInput(0, "untilMonth")]: "",
};

const form =
  (values: Record<string, string>) =>
  (field: string): string =>
    values[field] ?? "";
const parse = (values: Record<string, string>) => parseCaseForm(form(values), TODAY);

describe("saving a case (CASE-2, CASE-5, CASE-12, CASE-14 to CASE-16)", () => {
  it("accepts a complete care leaver and tidies its values", () => {
    expect(parse(COMPLETE)).toEqual({
      ok: true,
      value: {
        category: "CARE_LEAVER",
        careGroup: "IN_CARE",
        kind: "NEW_HOUSE",
        landGnDivision: null,
        applicationNumber: "KDW/147",
        childName: null,
        name: "ප්‍රතිලාභී නම",
        dateOfBirth: "2009-05-20",
        relationship: null,
        relationshipOther: null,
        maritalStatus: "UNMARRIED",
        nic: "880001234V",
        address: "නො. 1, පාර, නගරය",
        gnDivision: "හෝමාගම නැගෙනහිර",
        mobile1: "0712345678",
        mobile2: null,
        remark: null,
        familyMembers: 4,
        disabledChildren: false,
        aid: [],
        aidOther: null,
        centres: [
          {
            name: "පරීක්ෂණ ළමා නිවාසය",
            provinceId: 1,
            from: { year: 2012, month: null, day: null },
            until: { year: 2015, month: 6, day: null },
          },
        ],
      },
    });
  });

  it("names every empty required field (AC-5)", () => {
    expect(parse({})).toEqual({
      ok: false,
      errors: {
        category: "categoryRequired",
        kind: "kindRequired",
        applicationNumber: "applicationNumberRequired",
        name: "nameRequired",
        dateOfBirth: "dateOfBirthRequired",
        familyMembers: "familyMembersRequired",
        disabledChildren: "disabledChildrenRequired",
      },
    });
  });

  it("lets the NIC, address, GN divisions and phone numbers stay empty, and puts a lone phone number first", () => {
    const result = parse({ ...COMPLETE, nic: "", address: "", mobile1: "", mobile2: "0771234567" });
    expect(result).toMatchObject({
      ok: true,
      value: { nic: null, address: null, mobile1: "0771234567", mobile2: null, landGnDivision: null },
    });
  });

  it("keeps the land's GN division as typed (CASE-17)", () => {
    expect(parse({ ...COMPLETE, landGnDivision: "  ඉඹුල්ගොඩ  " })).toMatchObject({
      ok: true,
      value: { landGnDivision: "ඉඹුල්ගොඩ" },
    });
  });

  it("refuses wrong formats and lengths (AC-6)", () => {
    const result = parse({
      ...COMPLETE,
      nic: "12345",
      mobile1: "712345678",
      mobile2: "0712",
      name: "අ",
      remark: "x".repeat(1001),
    });
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
    expect(parse({ ...COMPLETE, nic: "198800012345" }).ok).toBe(true);
    expect(parse({ ...COMPLETE, nic: "880001234V" }).ok).toBe(true);
  });

  it("treats an unknown category, group or kind as not chosen", () => {
    expect(parse({ ...COMPLETE, careGroup: "x", kind: "x" })).toEqual({
      ok: false,
      errors: { careGroup: "careGroupRequired", kind: "kindRequired" },
    });
    expect(parse({ ...COMPLETE, category: "LAND" })).toMatchObject({
      ok: false,
      errors: { category: "categoryRequired" },
    });
  });
});

describe("a care leaver (CASE-14, AC-60)", () => {
  it("needs the group, the marital status and at least one centre", () => {
    const none = { ...COMPLETE, careGroup: "", maritalStatus: "", [centreInput(0, "name")]: "" };
    for (const field of ["provinceId", "fromYear", "untilYear", "untilMonth"] as const)
      none[centreInput(0, field)] = "";
    expect(parse(none)).toEqual({
      ok: false,
      errors: {
        careGroup: "careGroupRequired",
        maritalStatus: "maritalStatusRequired",
        centres: "centresRequired",
      },
    });
  });

  it("drops a child's name and relationship typed before the category changed", () => {
    const result = parse({ ...COMPLETE, childName: "x", relationship: "OTHER", relationshipOther: "ආච්චි" });
    expect(result).toMatchObject({ ok: true, value: { childName: null, relationship: null, relationshipOther: null } });
  });

  it("takes centres in order, skips an empty box, and keeps a centre with only its name and province", () => {
    const result = parse({
      ...COMPLETE,
      [centreInput(2, "name")]: "දෙවන නිවාසය",
      [centreInput(2, "provinceId")]: "3",
    });
    expect(result.ok && result.value.centres).toEqual([
      expect.objectContaining({ name: "පරීක්ෂණ ළමා නිවාසය" }),
      { name: "දෙවන නිවාසය", provinceId: 3, from: null, until: null },
    ]);
  });

  it("names each centre's problem by its box", () => {
    const result = parse({
      ...COMPLETE,
      [centreInput(0, "untilYear")]: "",
      [centreInput(0, "untilMonth")]: "3",
      [centreInput(1, "name")]: "x",
      [centreInput(1, "fromYear")]: "2016",
      [centreInput(1, "fromMonth")]: "2",
      [centreInput(1, "fromDay")]: "30",
      [centreInput(2, "fromYear")]: "2015",
      [centreInput(2, "fromMonth")]: "3",
      [centreInput(2, "untilYear")]: "2015",
      [centreInput(2, "untilMonth")]: "2",
      [centreInput(2, "name")]: "තුන්වන නිවාසය",
      [centreInput(2, "provinceId")]: "2",
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        "centres.0.until": "monthNeedsYear",
        "centres.1.name": "tooShort",
        "centres.1.provinceId": "centreProvinceRequired",
        "centres.1.from": "dateInvalid",
        "centres.2.until": "untilBeforeFrom",
      },
    });
  });

  it("takes at most 10 centres", () => {
    const many = { ...COMPLETE };
    for (let i = 0; i <= 10; i += 1) {
      many[centreInput(i, "name")] = `නිවාසය ${i + 1}`;
      many[centreInput(i, "provinceId")] = "1";
    }
    expect(parse(many)).toEqual({ ok: false, errors: { centres: "tooManyCentres" } });
    delete many[centreInput(10, "name")];
    delete many[centreInput(10, "provinceId")];
    expect(parse(many).ok && (parse(many) as { value: { centres: unknown[] } }).value.centres).toHaveLength(10);
  });

  it("asks a centre's name when anything else of it is filled in", () => {
    expect(parse({ ...COMPLETE, [centreInput(0, "name")]: "" })).toEqual({
      ok: false,
      errors: { "centres.0.name": "centreNameRequired", centres: "centresRequired" },
    });
  });
});

describe("a child at risk (CASE-15, AC-61)", () => {
  it("is saved with the child's name and date of birth, the guardian and the relationship", () => {
    expect(parse({ ...AT_RISK, relationship: "OTHER", relationshipOther: " ආච්චි " })).toMatchObject({
      ok: true,
      value: { childName: "පරීක්ෂණ දරුවා", relationship: "OTHER", relationshipOther: "ආච්චි", centres: [] },
    });
  });

  it("needs the child's name, the guardian's name and the relationship", () => {
    expect(parse({ ...AT_RISK, childName: "", name: "", relationship: "" })).toEqual({
      ok: false,
      errors: {
        childName: "childNameRequired",
        name: "guardianNameRequired",
        relationship: "relationshipRequired",
      },
    });
  });

  it("needs the relationship typed for other, 2 to 50 characters", () => {
    expect(parse({ ...AT_RISK, relationship: "OTHER" })).toEqual({
      ok: false,
      errors: { relationshipOther: "relationshipOtherRequired" },
    });
    expect(parse({ ...AT_RISK, relationship: "OTHER", relationshipOther: "x".repeat(51) })).toEqual({
      ok: false,
      errors: { relationshipOther: "tooLong" },
    });
  });

  it("drops a typed relationship when it isn't other", () => {
    expect(parse({ ...AT_RISK, relationshipOther: "ආච්චි" })).toMatchObject({
      ok: true,
      value: { relationship: "MOTHER", relationshipOther: null },
    });
  });

  it("never stores a care leaver's group, marital status or centres, even sent directly", () => {
    const result = parse({
      ...AT_RISK,
      careGroup: "IN_CARE",
      maritalStatus: "MARRIED",
      [centreInput(0, "name")]: "x",
      [centreInput(0, "fromMonth")]: "2",
    });
    expect(result).toMatchObject({ ok: true, value: { careGroup: null, maritalStatus: null, centres: [] } });
  });
});

describe("the family and aid (CASE-16)", () => {
  it("takes 1 to 30 family members", () => {
    expect(parse({ ...COMPLETE, familyMembers: "30" }).ok).toBe(true);
    for (const familyMembers of ["0", "31", "2.5", "abc", "-1"]) {
      expect(parse({ ...COMPLETE, familyMembers }), familyMembers).toEqual({
        ok: false,
        errors: { familyMembers: "familyMembersInvalid" },
      });
    }
  });

  it("reads children with disabilities as yes or no, with no default", () => {
    expect(parse({ ...COMPLETE, disabledChildren: "yes" })).toMatchObject({
      ok: true,
      value: { disabledChildren: true },
    });
    expect(parse({ ...COMPLETE, disabledChildren: "" })).toEqual({
      ok: false,
      errors: { disabledChildren: "disabledChildrenRequired" },
    });
  });

  it("keeps the ticked aid in the list's order, each once, and ignores anything else", () => {
    expect(parse({ ...COMPLETE, aid: "SAMURDHI,ARTHA,x,SAMURDHI" })).toMatchObject({
      ok: true,
      value: { aid: ["ARTHA", "SAMURDHI"], aidOther: null },
    });
  });

  it("needs the other aid's name, 2 to 200 characters, and drops it when other isn't ticked", () => {
    expect(parse({ ...COMPLETE, aid: "SAMURDHI,OTHER" })).toEqual({
      ok: false,
      errors: { aidOther: "aidOtherRequired" },
    });
    expect(parse({ ...COMPLETE, aid: "SAMURDHI,OTHER", aidOther: " ගම් ආධාර " })).toMatchObject({
      ok: true,
      value: { aid: ["SAMURDHI", "OTHER"], aidOther: "ගම් ආධාර" },
    });
    expect(parse({ ...COMPLETE, aid: "SAMURDHI", aidOther: "ගම් ආධාර" })).toMatchObject({
      ok: true,
      value: { aidOther: null },
    });
  });
});

describe("the date of birth (CASE-2)", () => {
  it("is a real day, not in the future and not more than 100 years ago", () => {
    expect(parse({ ...COMPLETE, dateOfBirth: TODAY }).ok).toBe(true);
    expect(parse({ ...COMPLETE, dateOfBirth: "1926-11-12" }).ok).toBe(true);
    const cases: [string, string][] = [
      ["2009-02-30", "dateInvalid"],
      ["20.05.2009", "dateInvalid"],
      ["2026-11-13", "dateInFuture"],
      ["1926-11-11", "dateTooOld"],
    ];
    for (const [dateOfBirth, error] of cases) {
      expect(parse({ ...COMPLETE, dateOfBirth }), dateOfBirth).toEqual({ ok: false, errors: { dateOfBirth: error } });
    }
  });

  it("gives the age in whole years", () => {
    expect(ageOn("2009-11-12", TODAY)).toBe(17);
    expect(ageOn("2009-11-13", TODAY)).toBe(16);
    expect(ageOn("2008-02-29", "2026-02-28")).toBe(17);
  });
});

describe("a centre's dates (CASE-14)", () => {
  it("takes a year, a year and month, or a full day, or nothing", () => {
    expect(parsePartialDate("", "", "", TODAY)).toEqual({ ok: true, value: null });
    expect(parsePartialDate("2015", "", "", TODAY)).toEqual({
      ok: true,
      value: { year: 2015, month: null, day: null },
    });
    expect(parsePartialDate("2015", "3", "", TODAY)).toEqual({ ok: true, value: { year: 2015, month: 3, day: null } });
    expect(parsePartialDate("2016", "2", "29", TODAY)).toEqual({ ok: true, value: { year: 2016, month: 2, day: 29 } });
  });

  it("refuses a month without a year, a day without a month, and a day that doesn't exist", () => {
    expect(parsePartialDate("", "3", "", TODAY)).toEqual({ ok: false, error: "monthNeedsYear" });
    expect(parsePartialDate("2015", "", "4", TODAY)).toEqual({ ok: false, error: "dayNeedsMonth" });
    expect(parsePartialDate("", "", "4", TODAY)).toEqual({ ok: false, error: "dayNeedsMonth" });
    expect(parsePartialDate("2015", "2", "30", TODAY)).toEqual({ ok: false, error: "dateInvalid" });
    expect(parsePartialDate("2015", "13", "", TODAY)).toEqual({ ok: false, error: "dateInvalid" });
    expect(parsePartialDate("15", "", "", TODAY)).toEqual({ ok: false, error: "dateInvalid" });
  });

  it("refuses a date in the future, at its own precision, and one before 1950", () => {
    expect(parsePartialDate("2026", "", "", TODAY).ok).toBe(true);
    expect(parsePartialDate("2026", "11", "", TODAY).ok).toBe(true);
    expect(parsePartialDate("2026", "11", "12", TODAY).ok).toBe(true);
    expect(parsePartialDate("2027", "", "", TODAY)).toEqual({ ok: false, error: "dateInFuture" });
    expect(parsePartialDate("2026", "12", "", TODAY)).toEqual({ ok: false, error: "dateInFuture" });
    expect(parsePartialDate("2026", "11", "13", TODAY)).toEqual({ ok: false, error: "dateInFuture" });
    expect(parsePartialDate("1949", "", "", TODAY)).toEqual({ ok: false, error: "dateTooEarly" });
  });

  it("compares from and until to the precision both have", () => {
    const d = (year: number, month: number | null = null, day: number | null = null) => ({ year, month, day });
    expect(untilBeforeFrom(d(2015, 3), d(2015))).toBe(false);
    expect(untilBeforeFrom(d(2015, 3), d(2015, 2))).toBe(true);
    expect(untilBeforeFrom(d(2015, 3, 12), d(2015, 3))).toBe(false);
    expect(untilBeforeFrom(d(2015, 3, 12), d(2015, 3, 11))).toBe(true);
    expect(untilBeforeFrom(d(2016), d(2015, 12, 31))).toBe(true);
  });

  it("is written as precisely as it was entered (UI-3)", () => {
    expect(formatPartialDate({ year: 2015, month: null, day: null })).toBe("2015");
    expect(formatPartialDate({ year: 2015, month: 3, day: null })).toBe("2015.03");
    expect(formatPartialDate({ year: 2015, month: 3, day: 12 })).toBe("2015.03.12");
  });
});

describe("the form's own state", () => {
  it("reads every field and each centre's", () => {
    const values = Object.fromEntries(Object.keys(COMPLETE).map((k) => [k, ""])) as Record<CaseField, string>;
    const read = formReader({ ...values, name: "අ" }, [
      {
        name: "x",
        provinceId: "2",
        fromYear: "",
        fromMonth: "",
        fromDay: "",
        untilYear: "",
        untilMonth: "",
        untilDay: "",
      },
    ]);
    expect(read("name")).toBe("අ");
    expect(read(centreInput(0, "provinceId"))).toBe("2");
    expect(read(centreInput(1, "name"))).toBe("");
  });

  it("drops the other category's details for any caller", () => {
    const parsed = parse(COMPLETE);
    if (!parsed.ok) throw new Error("complete");
    expect(withoutOtherCategory({ ...parsed.value, category: "CHILD_AT_RISK" })).toMatchObject({
      careGroup: null,
      maritalStatus: null,
      centres: [],
    });
  });
});

describe("the Application Number (CASE-12)", () => {
  it("takes up to 30 characters", () => {
    expect(parse({ ...COMPLETE, applicationNumber: "x".repeat(30) }).ok).toBe(true);
    expect(parse({ ...COMPLETE, applicationNumber: "x".repeat(31) })).toEqual({
      ok: false,
      errors: { applicationNumber: "tooLong" },
    });
  });

  it("counts spaces alone as empty", () => {
    expect(parse({ ...COMPLETE, applicationNumber: "   " })).toEqual({
      ok: false,
      errors: { applicationNumber: "applicationNumberRequired" },
    });
  });
});

describe("where the land is (CASE-13, CASE-17)", () => {
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

  it("takes all five kinds on the form (CASE-17)", () => {
    for (const kind of KINDS) {
      const parsed = parse({ ...COMPLETE, kind });
      expect(parsed.ok && parsed.value.kind).toBe(kind);
    }
    expect(parse({ ...COMPLETE, kind: "LAND" })).toEqual({ ok: false, errors: { kind: "kindRequired" } });
  });
});
