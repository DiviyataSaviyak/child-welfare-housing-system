import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../../prisma/seed-data";
import { createTestClient, freeOfficeId } from "../../../tests/db/client";
import { DESIGNATIONS, officeTypeOf, placeOf, roleOf } from "./designations";

const prisma = createTestClient();
let office: number;
let district: number;
let province: number;

beforeAll(async () => {
  await seed(prisma);
  office = await freeOfficeId(prisma);
  const row = await prisma.dsOffice.findUniqueOrThrow({ where: { id: office }, include: { district: true } });
  district = row.districtId;
  province = row.district.provinceId;
});

afterAll(() => prisma.$disconnect());

type Fields = {
  role: string;
  designation?: string | null;
  dsOfficeId?: number | null;
  districtId?: number | null;
  provinceId?: number | null;
  banned?: boolean;
};

const account = (id: string, fields: Fields) =>
  prisma.user.create({ data: { id, name: "පරීක්ෂණ", email: `${id}@no-email.invalid`, username: id, ...fields } });

const crpo = { role: "DS_OFFICER", designation: "DS_CRPO" };
const programmeOfficer = { role: "HO_OFFICER", designation: "MINISTRY_PROGRAMME_OFFICER" };

describe("account rules kept by the database (application spec, Roles and permissions)", () => {
  it("accepts every designation with its role and its own place, and an admin with neither", async () => {
    for (const designation of DESIGNATIONS) {
      const place = placeOf(officeTypeOf(designation));
      await expect(
        account(`rule-${designation}`, {
          role: roleOf(designation),
          designation,
          dsOfficeId: place === "dsOffice" ? office : null,
          districtId: place === "district" ? district : null,
          provinceId: place === "province" ? province : null,
        }),
      ).resolves.toBeTruthy();
    }
    await expect(account("rule-admin", { role: "ADMIN" })).resolves.toBeTruthy();
  });

  it("refuses any other role", async () => {
    await expect(account("rule-bad-role", { role: "user" })).rejects.toThrow(
      /app_user_designation_check|app_user_role_check/,
    );
  });

  it("refuses a designation that doesn't go with the role (ADM-8)", async () => {
    const refused = /app_user_designation_check/;
    await expect(account("rule-no-designation", { role: "DS_OFFICER", dsOfficeId: office })).rejects.toThrow(refused);
    await expect(account("rule-no-designation-or-place", { role: "DS_OFFICER" })).rejects.toThrow(refused);
    await expect(account("rule-ho-no-designation", { role: "HO_OFFICER" })).rejects.toThrow(refused);
    await expect(account("rule-viewer-no-designation", { role: "VIEWER" })).rejects.toThrow(refused);
    await expect(
      account("rule-free-text", { role: "DS_OFFICER", designation: "සංවර්ධන නිලධාරී", dsOfficeId: office }),
    ).rejects.toThrow(refused);
    await expect(
      account("rule-viewer-acts", { role: "HO_OFFICER", designation: "MINISTRY_SECRETARY" }),
    ).rejects.toThrow(refused);
    await expect(
      account("rule-crpo-views", { role: "VIEWER", designation: "DS_CRPO", dsOfficeId: office }),
    ).rejects.toThrow(refused);
    await expect(
      account("rule-admin-designation", { role: "ADMIN", designation: "MINISTRY_SECRETARY" }),
    ).rejects.toThrow(refused);
  });

  it("refuses an account without the place its office type belongs to", async () => {
    const refused = /app_user_place_check/;
    await expect(account("rule-ds-no-office", crpo)).rejects.toThrow(refused);
    await expect(
      account("rule-district-no-place", { role: "DISTRICT_OFFICER", designation: "DISTRICT_CRPO" }),
    ).rejects.toThrow(refused);
    await expect(
      account("rule-province-no-place", { role: "VIEWER", designation: "PROVINCE_COMMISSIONER" }),
    ).rejects.toThrow(refused);
  });

  it("refuses any place but its own", async () => {
    const refused = /app_user_place_check/;
    await expect(account("rule-ho-office", { ...programmeOfficer, dsOfficeId: office })).rejects.toThrow(refused);
    await expect(account("rule-admin-district", { role: "ADMIN", districtId: district })).rejects.toThrow(refused);
    await expect(
      account("rule-department-province", {
        role: "VIEWER",
        designation: "DEPARTMENT_COMMISSIONER",
        provinceId: province,
      }),
    ).rejects.toThrow(refused);
    await expect(
      account("rule-district-office", { role: "VIEWER", designation: "DISTRICT_SECRETARY", dsOfficeId: office }),
    ).rejects.toThrow(refused);
    await expect(account("rule-two-places", { ...crpo, dsOfficeId: office, districtId: district })).rejects.toThrow(
      refused,
    );
  });

  it("lets an office have several active DS officers (ADM-3)", async () => {
    await expect(account("rule-ds-second", { ...crpo, dsOfficeId: office })).resolves.toBeTruthy();
    await expect(account("rule-ds-former", { ...crpo, dsOfficeId: office, banned: true })).resolves.toBeTruthy();
    await expect(
      prisma.user.update({ where: { id: "rule-ds-former" }, data: { banned: false } }),
    ).resolves.toBeTruthy();
    expect(await prisma.user.count({ where: { dsOfficeId: office, role: "DS_OFFICER", banned: false } })).toBe(3);
  });

  it("starts every new account with a password that must be changed (AUTH-3)", async () => {
    const created = await prisma.user.findUniqueOrThrow({ where: { id: "rule-MINISTRY_PROGRAMME_OFFICER" } });
    expect(created.mustChangePassword).toBe(true);
    expect(created.failedSignIns).toBe(0);
    expect(created.banned).toBe(false);
  });
});
