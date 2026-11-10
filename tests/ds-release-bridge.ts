import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../src/generated/prisma/client";
import { INSTALLMENT_AMOUNT, INSTALLMENT_COUNT } from "../src/lib/money";

/**
 * Change 0006's bridge for the tests, until its task 7 records the District's release and task 8 lets a
 * case received by the DS pay its first installment: puts cases the Ministry allocated where version 1's
 * letter left them. For each DS office where they are built, one District release dated the letter's day
 * (or `on`); each case gets its four NOT_STARTED installments and moves to IN_PROGRESS. Written straight to
 * the database, with no audit records or notices, so only tests use it (database and end-to-end).
 */
export async function releaseToDsForTests(
  db: PrismaClient,
  caseIds: string[],
  options: { byId?: string; on?: Date } = {},
): Promise<void> {
  const cases = await db.case.findMany({
    where: { id: { in: caseIds }, status: "ALLOCATED_TO_DISTRICT" },
    orderBy: { id: "asc" },
    select: {
      id: true,
      buildDsOfficeId: true,
      buildDsOffice: { select: { districtId: true } },
      release: { select: { id: true, releasedOn: true, byId: true, letter: { select: { letterNumber: true } } } },
    },
  });
  if (cases.length !== caseIds.length) throw new Error("Every case must be allocated to its district first.");
  await db.$transaction(async (tx) => {
    const byOffice = new Map<number, string>();
    for (const c of cases) {
      const release = c.release!;
      const on = options.on ?? release.releasedOn;
      let dsReleaseId = byOffice.get(c.buildDsOfficeId);
      if (!dsReleaseId) {
        dsReleaseId = randomUUID();
        byOffice.set(c.buildDsOfficeId, dsReleaseId);
        await tx.dsRelease.create({
          data: {
            id: dsReleaseId,
            districtId: c.buildDsOffice.districtId,
            dsOfficeId: c.buildDsOfficeId,
            referenceNumber: release.letter.letterNumber,
            releasedOn: on,
            byId: options.byId ?? release.byId,
          },
        });
      }
      await tx.release.update({ where: { id: release.id }, data: { dsReleaseId, dsReleasedOn: on } });
      await tx.installment.createMany({
        data: Array.from({ length: INSTALLMENT_COUNT }, (_, index) => ({
          id: randomUUID(),
          caseId: c.id,
          number: index + 1,
          amount: INSTALLMENT_AMOUNT,
        })),
      });
      await tx.case.update({
        where: { id: c.id },
        data: { status: "IN_PROGRESS", version: { increment: 1 } },
      });
    }
  });
}
