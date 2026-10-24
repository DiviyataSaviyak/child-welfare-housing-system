import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../../prisma/seed-data";
import { createTestClient, freeOfficeId } from "../../../tests/db/client";

const prisma = createTestClient();
let office: number;

beforeAll(async () => {
  await seed(prisma);
  office = await freeOfficeId(prisma);
});

afterAll(() => prisma.$disconnect());

const account = (id: string, fields: { role: string; dsOfficeId?: number | null; banned?: boolean }) =>
  prisma.user.create({ data: { id, name: "පරීක්ෂණ", email: `${id}@no-email.invalid`, username: id, ...fields } });

describe("account rules kept by the database (application spec, Roles and permissions)", () => {
  it("accepts the three roles, with an office only for DS officers", async () => {
    await expect(account("rule-ds", { role: "DS_OFFICER", dsOfficeId: office })).resolves.toBeTruthy();
    await expect(account("rule-ho", { role: "HO_OFFICER" })).resolves.toBeTruthy();
    await expect(account("rule-admin", { role: "ADMIN" })).resolves.toBeTruthy();
  });

  it("refuses any other role", async () => {
    await expect(account("rule-bad-role", { role: "user" })).rejects.toThrow(/app_user_role_check/);
  });

  it("refuses a DS officer without an office", async () => {
    await expect(account("rule-ds-no-office", { role: "DS_OFFICER" })).rejects.toThrow(/app_user_ds_office_check/);
  });

  it("refuses an office for Head Office and admin accounts", async () => {
    await expect(account("rule-ho-office", { role: "HO_OFFICER", dsOfficeId: office })).rejects.toThrow(
      /app_user_ds_office_check/,
    );
  });

  it("lets an office have several active DS officers (ADM-3)", async () => {
    await expect(account("rule-ds-second", { role: "DS_OFFICER", dsOfficeId: office })).resolves.toBeTruthy();
    await expect(
      account("rule-ds-former", { role: "DS_OFFICER", dsOfficeId: office, banned: true }),
    ).resolves.toBeTruthy();
    await expect(
      prisma.user.update({ where: { id: "rule-ds-former" }, data: { banned: false } }),
    ).resolves.toBeTruthy();
    expect(await prisma.user.count({ where: { dsOfficeId: office, banned: false } })).toBe(3);
  });

  it("starts every new account with a password that must be changed (AUTH-3)", async () => {
    const created = await prisma.user.findUniqueOrThrow({ where: { id: "rule-ho" } });
    expect(created.mustChangePassword).toBe(true);
    expect(created.failedSignIns).toBe(0);
    expect(created.banned).toBe(false);
  });
});
