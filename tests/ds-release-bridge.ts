import type { PrismaClient } from "../src/generated/prisma/client";
import { colomboDay, dateToDay } from "../src/lib/dates";
import { recordDsRelease } from "../src/server/releases/commands";
import type { Actor } from "../src/server/cases/commands";

/**
 * Change 0006's bridge for the tests, until its task 8 lets a case whose allocation its DS received pay its
 * first installment: moves cases from ALLOCATION_RECEIVED to IN_PROGRESS, as paying installment 1 will.
 * Written straight to the database, with no audit records or notices, so only tests use it (database and
 * end-to-end).
 */
export async function startForTests(db: PrismaClient, caseIds: string[]): Promise<void> {
  const moved = await db.case.updateMany({
    where: { id: { in: caseIds }, status: "ALLOCATION_RECEIVED" },
    data: { status: "IN_PROGRESS", version: { increment: 1 } },
  });
  if (moved.count !== caseIds.length) throw new Error("Every case must have its allocation received first.");
}

/** An active District officer of the district, made for the tests when it has none. */
async function districtOfficer(db: PrismaClient, districtId: number): Promise<Actor> {
  const found = await db.user.findFirst({
    where: { districtId, role: "DISTRICT_OFFICER", banned: false },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const userId =
    found?.id ??
    (
      await db.user.create({
        data: {
          id: `ds-release-bridge-${districtId}`,
          name: "ද. පරීක්ෂණ",
          email: `ds-release-bridge-${districtId}@no-email.invalid`,
          role: "DISTRICT_OFFICER",
          designation: "DISTRICT_CRPO",
          districtId,
        },
        select: { id: true },
      })
    ).id;
  return {
    userId,
    role: "DISTRICT_OFFICER",
    designation: "DISTRICT_CRPO",
    districtId,
    provinceId: null,
    dsOfficeId: null,
  };
}

/**
 * For the database tests: the District's release (REL-6, REL-7) of cases the Ministry allocated, through
 * `recordDsRelease`, one release for each DS office where they are built, dated the latest of their letters
 * (or `on`), by a District officer of its district. Until task 8 the cases then move on to IN_PROGRESS
 * (`startForTests`), unless `start` is false.
 */
export async function releaseToDsForTests(
  db: PrismaClient,
  caseIds: string[],
  options: { on?: Date; start?: boolean } = {},
): Promise<void> {
  const cases = await db.case.findMany({
    where: { id: { in: caseIds }, status: "ALLOCATED_TO_DISTRICT" },
    orderBy: { id: "asc" },
    select: {
      id: true,
      version: true,
      buildDsOfficeId: true,
      buildDsOffice: { select: { districtId: true } },
      release: { select: { releasedOn: true } },
    },
  });
  if (cases.length !== caseIds.length) throw new Error("Every case must be allocated to its district first.");
  const byOffice = new Map<number, typeof cases>();
  for (const c of cases) byOffice.set(c.buildDsOfficeId, [...(byOffice.get(c.buildDsOfficeId) ?? []), c]);
  for (const [dsOfficeId, theirs] of byOffice) {
    const latestLetter = theirs
      .map((c) => dateToDay(c.release!.releasedOn))
      .sort()
      .at(-1)!;
    const result = await recordDsRelease(db, await districtOfficer(db, theirs[0].buildDsOffice.districtId), {
      dsOfficeId,
      cases: theirs.map((c) => ({ id: c.id, version: c.version })),
      form: {
        referenceNumber: "DS/පරීක්ෂණ",
        releasedOn: options.on ? dateToDay(options.on) : (latestLetter ?? colomboDay(new Date())),
        note: "",
      },
      scanId: null,
    });
    if (!result.ok) throw new Error(String(result.error ?? JSON.stringify(result.errors)));
  }
  if (options.start !== false) await startForTests(db, caseIds);
}
