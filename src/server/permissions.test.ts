import { describe, expect, it } from "vitest";
import { DESIGNATIONS, type Designation, officeTypeOf, roleOf } from "./auth/designations";
import { canSeeOffice, caseScope, type OfficePlace, officeFilter, type Viewer } from "./permissions";

// Two provinces; the first has two districts, the first district has two DS offices.
const PROVINCE = 1;
const OTHER_PROVINCE = 2;
const DISTRICT = 10;
const OTHER_DISTRICT = 11;
const FAR_DISTRICT = 20;
const HOMAGAMA: OfficePlace = { id: 100, districtId: DISTRICT, district: { provinceId: PROVINCE } };
const KADUWELA: OfficePlace = { id: 101, districtId: DISTRICT, district: { provinceId: PROVINCE } };
const NEIGHBOUR: OfficePlace = { id: 110, districtId: OTHER_DISTRICT, district: { provinceId: PROVINCE } };
const FAR: OfficePlace = { id: 200, districtId: FAR_DISTRICT, district: { provinceId: OTHER_PROVINCE } };
const OFFICES = [HOMAGAMA, KADUWELA, NEIGHBOUR, FAR];

const nowhere = { dsOfficeId: null, districtId: null, provinceId: null };
const viewer = (designation: Designation | null, place: Partial<Viewer> = {}): Viewer => ({
  role: roleOf(designation),
  designation,
  ...nowhere,
  ...place,
});

const crpo = viewer("DS_CRPO", { dsOfficeId: HOMAGAMA.id });
const divisionalSecretary = viewer("DS_SECRETARY", { dsOfficeId: HOMAGAMA.id });
const districtCrpo = viewer("DISTRICT_CRPO", { districtId: DISTRICT });
const districtSecretary = viewer("DISTRICT_SECRETARY", { districtId: DISTRICT });
const commissioner = viewer("PROVINCE_COMMISSIONER", { provinceId: PROVINCE });
const department = viewer("DEPARTMENT_COMMISSIONER");
const secretary = viewer("MINISTRY_SECRETARY");
const programmeOfficer = viewer("MINISTRY_PROGRAMME_OFFICER");
const admin = viewer(null);

const seen = (who: Viewer) => OFFICES.filter((office) => canSeeOffice(who, office)).map((office) => office.id);

describe("which cases each account may see (PRM-1, PRM-2, PRM-4)", () => {
  it.each([
    ["a CRPO, their own office", crpo, [HOMAGAMA.id]],
    ["a Divisional Secretary, their own office", divisionalSecretary, [HOMAGAMA.id]],
    ["a District CRPO, their district's offices", districtCrpo, [HOMAGAMA.id, KADUWELA.id]],
    ["a District Secretary, their district's offices", districtSecretary, [HOMAGAMA.id, KADUWELA.id]],
    ["a Provincial Commissioner, their province's offices", commissioner, [HOMAGAMA.id, KADUWELA.id, NEIGHBOUR.id]],
    ["the Department's Commissioner, every office", department, OFFICES.map((office) => office.id)],
    ["the Ministry's Secretary, every office", secretary, OFFICES.map((office) => office.id)],
    ["a Programme Officer, every office", programmeOfficer, OFFICES.map((office) => office.id)],
    ["an admin, no office", admin, []],
  ])("%s", (_label, who, expected) => {
    expect(seen(who)).toEqual(expected);
  });

  it("gives every designation the scope of its office type", () => {
    const place = { dsOfficeId: HOMAGAMA.id, districtId: DISTRICT, provinceId: PROVINCE };
    const expected = { DS: "office", DISTRICT: "district", PROVINCE: "province", DEPARTMENT: "all", MINISTRY: "all" };
    for (const designation of DESIGNATIONS) {
      const kind = expected[officeTypeOf(designation) as keyof typeof expected];
      expect(caseScope(viewer(designation, place)).kind, designation).toBe(kind);
    }
  });

  it("limits each query to the viewer's area, through the case's office", () => {
    expect(officeFilter(crpo)).toEqual({ dsOfficeId: HOMAGAMA.id });
    expect(officeFilter(divisionalSecretary)).toEqual({ dsOfficeId: HOMAGAMA.id });
    expect(officeFilter(districtSecretary)).toEqual({ dsOffice: { districtId: DISTRICT } });
    expect(officeFilter(commissioner)).toEqual({ dsOffice: { district: { provinceId: PROVINCE } } });
    expect(officeFilter(secretary)).toEqual({});
    expect(officeFilter(programmeOfficer)).toEqual({});
    expect(officeFilter(admin)).toBeNull();
  });

  it("decides by the designation, not by whichever place is filled in", () => {
    // A DS view-only account with a district too still sees only its office.
    expect(seen(viewer("DS_ACCOUNTANT", { dsOfficeId: HOMAGAMA.id, districtId: DISTRICT }))).toEqual([HOMAGAMA.id]);
    // A Ministry account with an office still sees every office.
    expect(seen(viewer("MINISTRY_SECRETARY", { dsOfficeId: HOMAGAMA.id }))).toHaveLength(OFFICES.length);
  });

  it("shows nothing to an account whose place is missing", () => {
    const placed: Designation[] = [
      "DS_CRPO",
      "DS_SECRETARY",
      "DISTRICT_CRPO",
      "DISTRICT_SECRETARY",
      "PROVINCE_COMMISSIONER",
    ];
    for (const designation of placed) {
      const broken = viewer(designation);
      expect(officeFilter(broken), designation).toBeNull();
      expect(seen(broken), designation).toEqual([]);
    }
  });

  it("shows nothing to an account whose designation is unknown or doesn't go with its role", () => {
    const unknown: Viewer = { role: "VIEWER", designation: "සංවර්ධන නිලධාරී", ...nowhere };
    const mismatched: Viewer = {
      role: "MINISTRY_OFFICER",
      designation: "DS_CRPO",
      ...nowhere,
      dsOfficeId: HOMAGAMA.id,
    };
    const noDesignation: Viewer = { role: "MINISTRY_OFFICER", designation: null, ...nowhere };
    const adminWithOne: Viewer = { role: "ADMIN", designation: "MINISTRY_SECRETARY", ...nowhere };
    for (const broken of [unknown, mismatched, noDesignation, adminWithOne]) {
      expect(caseScope(broken)).toEqual({ kind: "none" });
      expect(seen(broken)).toEqual([]);
    }
  });
});
