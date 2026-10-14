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
import type { Role } from "../src/server/auth/roles";
import { createPrismaClient } from "../src/server/db";

/** Password of the sample accounts that are ready to use. */
export const SAMPLE_PASSWORD = "Sample-Pass-2026";
/** Temporary password of the sample account that must set a new one at first sign-in. */
export const SAMPLE_TEMPORARY_PASSWORD = "Temp-Pass-2026";

type SampleUser = { username: string; name: string; role: Role; officeCode?: string; temporary?: boolean };

// An office can have several officers (ADM-3), but each sample officer has their own, so tests signed in as
// different officers don't see each other's cases.
export const SAMPLE_USERS: SampleUser[] = [
  { username: "ds0101", name: "එන්. පෙරේරා", role: "DS_OFFICER", officeCode: "HMG" },
  { username: "ds0102", name: "එස්. නවරත්න", role: "DS_OFFICER", officeCode: "MHG", temporary: true },
  { username: "ds0103", name: "ඩී. වීරසිංහ", role: "DS_OFFICER", officeCode: "KDW" },
  // Used only by the lockout test, which locks it on purpose.
  { username: "ds0199", name: "ටී. ඒකනායක", role: "DS_OFFICER", officeCode: "KSB" },
  { username: "ho0001", name: "එස්. ජයසිංහ", role: "HO_OFFICER" },
  { username: "ad0001", name: "ආර්. සිල්වා", role: "ADMIN" },
];

export function sampleUsersAllowed(): boolean {
  return ["development", "ci", "test"].includes(process.env.APP_ENV ?? "development");
}

export async function putSampleUsers(prisma: PrismaClient, { reset }: { reset: boolean }): Promise<number> {
  if (!sampleUsersAllowed())
    throw new Error(`Sample accounts are not allowed when APP_ENV is "${process.env.APP_ENV}".`);

  const offices = new Map(
    (await prisma.dsOffice.findMany({ select: { id: true, code: true } })).map((o) => [o.code, o.id]),
  );
  const now = new Date();
  let written = 0;

  for (const sample of SAMPLE_USERS) {
    const id = `sample-${sample.username}`;
    if (!reset && (await prisma.user.findUnique({ where: { id }, select: { id: true } }))) continue;

    const dsOfficeId = sample.officeCode ? offices.get(sample.officeCode) : null;
    if (dsOfficeId === undefined) throw new Error(`DS office ${sample.officeCode} is missing: run the seed first.`);

    const fields = {
      name: sample.name,
      email: placeholderEmail(sample.username),
      username: sample.username,
      displayUsername: sample.username,
      role: sample.role,
      banned: false,
      dsOfficeId,
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
