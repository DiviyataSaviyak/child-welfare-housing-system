import type { PrismaClient } from "../../src/generated/prisma/client";
import { colomboDay, dateToDay } from "../../src/lib/dates";
import { recordDsRelease } from "../../src/server/releases/commands";
import type { Actor } from "../../src/server/cases/commands";

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
          id: `ds-release-crpo-${districtId}`,
          name: "ද. පරීක්ෂණ",
          email: `ds-release-crpo-${districtId}@no-email.invalid`,
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
 * For the database tests, until change 0006's task 10 makes the load-test data hold them: moves `count` of
 * the load-test cases whose allocation was received, and nothing paid, back to waiting for the District's
 * release (`ALLOCATED_TO_DISTRICT`), as if the District hadn't released them yet. Their installments go, and
 * a District release left with no case is removed with the load-test data. `buildDsOfficeId` takes them from
 * one DS office. Gives the moved cases' ids.
 */
export async function backToTheDistrictForTests(
  db: PrismaClient,
  idPrefix: string,
  count: number,
  buildDsOfficeId?: number,
): Promise<string[]> {
  const cases = await db.case.findMany({
    where: { id: { startsWith: idPrefix }, status: "ALLOCATION_RECEIVED", ...(buildDsOfficeId && { buildDsOfficeId }) },
    orderBy: { id: "asc" },
    take: count,
    select: { id: true },
  });
  const ids = cases.map((c) => c.id);
  await db.$transaction([
    db.installment.deleteMany({ where: { caseId: { in: ids } } }),
    db.release.updateMany({ where: { caseId: { in: ids } }, data: { dsReleaseId: null, dsReleasedOn: null } }),
    db.case.updateMany({ where: { id: { in: ids } }, data: { status: "ALLOCATED_TO_DISTRICT" } }),
  ]);
  return ids;
}

/**
 * For the database tests: the District's release (REL-6, REL-7) of cases the Ministry allocated, through
 * `recordDsRelease`, one release for each DS office where they are built, dated the latest of their letters
 * (or `on`), by a District officer of its district. The cases are then `ALLOCATION_RECEIVED`, with four
 * `NOT_STARTED` installments; paying installment 1 moves one on to `IN_PROGRESS` (INS-5).
 */
export async function releaseToDsForTests(
  db: PrismaClient,
  caseIds: string[],
  options: { on?: Date } = {},
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
}
