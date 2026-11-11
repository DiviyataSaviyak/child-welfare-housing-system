/**
 * Sample accounts for development and automated tests only. They are made-up people with published
 * passwords, so they are never created in staging or production.
 *
 *   npx tsx prisma/seed-users.ts          adds any sample account that is missing
 *   npx tsx prisma/seed-users.ts --reset  puts every sample account back to its starting state
 *                                         (used before the end-to-end tests)
 */
import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "../src/generated/prisma/client";
import { placeholderEmail } from "../src/server/auth/accounts";
import { type Designation, roleOf } from "../src/server/auth/designations";
import { createPrismaClient } from "../src/server/db";

/** Password of the sample accounts that are ready to use. */
export const SAMPLE_PASSWORD = "Sample-Pass-2026";
/** Temporary password of the sample account that must set a new one at first sign-in. */
export const SAMPLE_TEMPORARY_PASSWORD = "Temp-Pass-2026";

type SampleUser = {
  username: string;
  /** Empty for an account with no name (ADM-10). */
  name: string;
  designation: Designation | null;
  /** The account's one place, by the DS office's code or the district's or province's English name. */
  officeCode?: string;
  district?: string;
  province?: string;
  temporary?: boolean;
};

// An office can have several officers (ADM-3), but each sample officer has their own, so tests signed in as
// different officers don't see each other's cases.
export const SAMPLE_USERS: SampleUser[] = [
  { username: "ds0101", name: "එන්. පෙරේරා", designation: "DS_CRPO", officeCode: "HMG" },
  { username: "ds0102", name: "එස්. නවරත්න", designation: "DS_CRPO", officeCode: "MHG", temporary: true },
  { username: "ds0103", name: "ඩී. වීරසිංහ", designation: "DS_CRPO", officeCode: "KDW" },
  // Used only by the lockout test, which locks it on purpose.
  { username: "ds0199", name: "ටී. ඒකනායක", designation: "DS_CRPO", officeCode: "KSB" },
  { username: "ho0001", name: "එස්. ජයසිංහ", designation: "MINISTRY_PROGRAMME_OFFICER" },
  { username: "ad0001", name: "ආර්. සිල්වා", designation: null },
  // The accounts that only view (PRM-4, PRM-5), one for each kind of area, where the demo data has cases
  // (scripts/seed-demo.ts). They start at 0101 so they don't meet the accounts an admin adds from 0001.
  // The DS accountant has no name, as the form allows (ADM-10). None is in Matale, whose nameless
  // accounts the end-to-end clean-up deletes.
  { username: "ds0104", name: "", designation: "DS_ACCOUNTANT", officeCode: "KDW" },
  { username: "dt0101", name: "කේ. බණ්ඩාර", designation: "DISTRICT_SECRETARY", district: "Colombo" },
  { username: "dt0102", name: "එම්. රත්නායක", designation: "DISTRICT_CRPO", district: "Kandy" },
  // Colombo's District CRPO, who releases the Ministry's allocations to Homagama and Kaduwela (REL-6).
  { username: "dt0103", name: "ඒ. ගුණසේකර", designation: "DISTRICT_CRPO", district: "Colombo" },
  { username: "pv0101", name: "ජී. දිසානායක", designation: "PROVINCE_COMMISSIONER", province: "Western" },
  { username: "pd0101", name: "යූ. කුමාරි", designation: "DEPARTMENT_COMMISSIONER" },
  { username: "ho0101", name: "පී. අබේසේකර", designation: "MINISTRY_SECRETARY" },
];

export function sampleUsersAllowed(): boolean {
  return ["development", "ci", "test"].includes(process.env.APP_ENV ?? "development");
}

export async function putSampleUsers(prisma: PrismaClient, { reset }: { reset: boolean }): Promise<number> {
  if (!sampleUsersAllowed())
    throw new Error(`Sample accounts are not allowed when APP_ENV is "${process.env.APP_ENV}".`);

  const byName = (rows: { id: number; nameEn: string }[]) => new Map(rows.map((row) => [row.nameEn, row.id]));
  const [offices, districts, provinces] = await Promise.all([
    prisma.dsOffice
      .findMany({ select: { id: true, code: true } })
      .then((rows) => new Map(rows.map((o) => [o.code, o.id]))),
    prisma.district.findMany({ select: { id: true, nameEn: true } }).then(byName),
    prisma.province.findMany({ select: { id: true, nameEn: true } }).then(byName),
  ]);
  const now = new Date();
  let written = 0;

  for (const sample of SAMPLE_USERS) {
    const id = `sample-${sample.username}`;
    if (!reset && (await prisma.user.findUnique({ where: { id }, select: { id: true } }))) continue;

    const dsOfficeId = sample.officeCode ? offices.get(sample.officeCode) : null;
    const districtId = sample.district ? districts.get(sample.district) : null;
    const provinceId = sample.province ? provinces.get(sample.province) : null;
    if (dsOfficeId === undefined || districtId === undefined || provinceId === undefined)
      throw new Error(`The place of ${sample.username} is missing: run the seed first.`);

    const fields = {
      name: sample.name,
      email: placeholderEmail(sample.username),
      username: sample.username,
      displayUsername: sample.username,
      role: roleOf(sample.designation),
      designation: sample.designation,
      banned: false,
      dsOfficeId,
      districtId,
      provinceId,
      mustChangePassword: Boolean(sample.temporary),
      temporaryPasswordSetAt: sample.temporary ? now : null,
      failedSignIns: 0,
      lockedUntil: null,
    };
    const password = await hashPassword(sample.temporary ? SAMPLE_TEMPORARY_PASSWORD : SAMPLE_PASSWORD);

    await prisma.$transaction([
      prisma.user.upsert({ where: { id }, create: { id, ...fields }, update: fields }),
      prisma.session.deleteMany({ where: { userId: id } }),
      prisma.account.deleteMany({ where: { userId: id } }),
      prisma.account.create({
        data: { id: `${id}-credential`, accountId: id, providerId: "credential", userId: id, password },
      }),
    ]);
    written += 1;
  }
  return written;
}

// Run directly: npx tsx prisma/seed-users.ts [--reset]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const prisma = createPrismaClient(databaseUrl);
  putSampleUsers(prisma, { reset: process.argv.includes("--reset") })
    .then((count) => console.log(`Sample accounts written: ${count}.`))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
