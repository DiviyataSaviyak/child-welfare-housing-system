import { describe, expect, it } from "vitest";
import {
  DESIGNATIONS,
  designationsOf,
  isDesignation,
  OFFICE_TYPES,
  officeTypeOf,
  placeOf,
  roleOf,
} from "./designations";

describe("the designations of each office type (ADM-8)", () => {
  it("lists exactly the Ministry's designations, in its order", () => {
    expect(designationsOf("DS")).toEqual(["DS_CRPO", "DS_SECRETARY", "DS_ASSISTANT_SECRETARY", "DS_ACCOUNTANT"]);
    expect(designationsOf("DISTRICT")).toEqual([
      "DISTRICT_SECRETARY",
      "DISTRICT_ADDITIONAL_SECRETARY",
      "DISTRICT_CRPO",
      "DISTRICT_CHIEF_ACCOUNTANT",
    ]);
    expect(designationsOf("PROVINCE")).toEqual(["PROVINCE_COMMISSIONER", "PROVINCE_PROBATION_OFFICER"]);
    expect(designationsOf("DEPARTMENT")).toEqual(["DEPARTMENT_ASSISTANT_COMMISSIONER", "DEPARTMENT_COMMISSIONER"]);
    expect(designationsOf("MINISTRY")).toEqual([
      "MINISTRY_SECRETARY",
      "MINISTRY_ADDITIONAL_SECRETARY",
      "MINISTRY_CHIEF_ACCOUNTANT",
      "MINISTRY_PROGRAMME_OFFICER",
    ]);
    expect(designationsOf("ADMINISTRATOR")).toEqual([]);
  });

  it("gives every designation exactly one office type", () => {
    expect(OFFICE_TYPES.flatMap(designationsOf).toSorted()).toEqual(DESIGNATIONS.toSorted());
    for (const designation of DESIGNATIONS) {
      expect(designationsOf(officeTypeOf(designation))).toContain(designation);
    }
  });

  it("knows only its own codes", () => {
    expect(isDesignation("DS_CRPO")).toBe(true);
    expect(isDesignation("සංවර්ධන නිලධාරී")).toBe(false);
    expect(isDesignation("toString")).toBe(false);
    expect(isDesignation(null)).toBe(false);
  });
});

describe("what a designation can do (roles table)", () => {
  it("lets only the CRPOs, the Programme Officers and the Ministry's Chief Accountant act", () => {
    const acting = DESIGNATIONS.filter((designation) => roleOf(designation) !== "VIEWER");
    expect(Object.fromEntries(acting.map((designation) => [designation, roleOf(designation)]))).toEqual({
      DS_CRPO: "DS_OFFICER",
      DISTRICT_CRPO: "DISTRICT_OFFICER",
      MINISTRY_CHIEF_ACCOUNTANT: "MINISTRY_OFFICER",
      MINISTRY_PROGRAMME_OFFICER: "MINISTRY_OFFICER",
    });
  });

  it("makes an account with no designation an administrator", () => {
    expect(roleOf(null)).toBe("ADMIN");
    expect(officeTypeOf(null)).toBe("ADMINISTRATOR");
  });

  it("asks for a place only where the office type has one", () => {
    expect(OFFICE_TYPES.map(placeOf)).toEqual(["dsOffice", "district", "province", null, null, null]);
  });
});
