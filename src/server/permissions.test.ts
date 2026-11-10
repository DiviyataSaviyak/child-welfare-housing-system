import { describe, expect, it } from "vitest";
import { DESIGNATIONS, type Designation, officeTypeOf, roleOf } from "./auth/designations";
import {
  actingOffice,
  type CaseAction,
  type CasePlaces,
  canActOn,
  canSeeCase,
  caseScope,
  type OfficePlace,
  officeFilter,
  type Viewer,
} from "./permissions";

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

/** A case entered and built in one office, as most are. */
const at = (office: OfficePlace): CasePlaces => ({ dsOffice: office, buildDsOffice: office });
const seen = (who: Viewer) => OFFICES.filter((office) => canSeeCase(who, at(office))).map((office) => office.id);

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

  it("limits each query to the viewer's area, through either of the case's offices", () => {
    const own = { OR: [{ dsOfficeId: HOMAGAMA.id }, { buildDsOfficeId: HOMAGAMA.id }] };
    expect(officeFilter(crpo)).toEqual(own);
    expect(officeFilter(divisionalSecretary)).toEqual(own);
    expect(officeFilter(districtSecretary)).toEqual({
      OR: [{ dsOffice: { districtId: DISTRICT } }, { buildDsOffice: { districtId: DISTRICT } }],
    });
    expect(officeFilter(commissioner)).toEqual({
      OR: [
        { dsOffice: { district: { provinceId: PROVINCE } } },
        { buildDsOffice: { district: { provinceId: PROVINCE } } },
      ],
    });
    expect(officeFilter(secretary)).toEqual({});
    expect(officeFilter(programmeOfficer)).toEqual({});
    expect(officeFilter(admin)).toBeNull();
  });

  it("limits a query to one of the case's offices when asked", () => {
    expect(officeFilter(crpo, "residence")).toEqual({ dsOfficeId: HOMAGAMA.id });
    expect(officeFilter(crpo, "built")).toEqual({ buildDsOfficeId: HOMAGAMA.id });
    expect(officeFilter(districtCrpo, "built")).toEqual({ buildDsOffice: { districtId: DISTRICT } });
    expect(officeFilter(commissioner, "residence")).toEqual({ dsOffice: { district: { provinceId: PROVINCE } } });
    expect(officeFilter(programmeOfficer, "built")).toEqual({});
    expect(officeFilter(admin, "residence")).toBeNull();
    expect(officeFilter(viewer("DS_CRPO"), "built")).toBeNull();
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

describe("a case lived in one DS office and built in another (CASE-13)", () => {
  // Entered by Homagama, built in the neighbouring district.
  const built = { dsOffice: HOMAGAMA, buildDsOffice: NEIGHBOUR } satisfies CasePlaces;
  const neighbourCrpo = viewer("DS_CRPO", { dsOfficeId: NEIGHBOUR.id });
  const neighbourDistrictCrpo = viewer("DISTRICT_CRPO", { districtId: OTHER_DISTRICT });
  const kaduwelaCrpo = viewer("DS_CRPO", { dsOfficeId: KADUWELA.id });
  const farCommissioner = viewer("PROVINCE_COMMISSIONER", { provinceId: OTHER_PROVINCE });

  it("goes through the DS of residence to edit or delete, and through the DS where built for the rest", () => {
    const acting: Record<CaseAction, string> = {
      edit: "residence",
      delete: "residence",
      installment: "built",
      stage: "built",
      release: "built",
    };
    for (const [action, office] of Object.entries(acting)) expect(actingOffice(action as CaseAction)).toBe(office);
  });

  it("is seen by both offices and both districts, and by nobody else (PRM-1, PRM-4)", () => {
    for (const who of [crpo, neighbourCrpo, districtCrpo, neighbourDistrictCrpo, commissioner, programmeOfficer]) {
      expect(canSeeCase(who, built), who.designation ?? "admin").toBe(true);
    }
    for (const who of [kaduwelaCrpo, farCommissioner, admin]) {
      expect(canSeeCase(who, built), who.designation ?? "admin").toBe(false);
    }
  });

  it("gives each office only the actions whose turn it is", () => {
    const actions = (who: Viewer) =>
      (["edit", "delete", "installment", "stage", "release"] as const).filter((a) => canActOn(who, built, a));
    expect(actions(crpo)).toEqual(["edit", "delete"]);
    expect(actions(neighbourCrpo)).toEqual(["installment", "stage", "release"]);
    // The District where it is built releases it (REL-9); the District of residence only sees it.
    expect(canActOn(neighbourDistrictCrpo, built, "release")).toBe(true);
    expect(canActOn(districtCrpo, built, "release")).toBe(false);
    // The Ministry acts on any case; the role and status rules decide the rest.
    expect(actions(programmeOfficer)).toEqual(["edit", "delete", "installment", "stage", "release"]);
    expect(actions(kaduwelaCrpo)).toEqual([]);
    expect(actions(admin)).toEqual([]);
  });

  it("gives an office that both lives and builds every action", () => {
    for (const action of ["edit", "delete", "installment", "stage", "release"] as const) {
      expect(canActOn(crpo, at(HOMAGAMA), action), action).toBe(true);
    }
  });
});
