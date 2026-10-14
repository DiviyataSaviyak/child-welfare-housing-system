/**
 * Tidies up after earlier end-to-end runs:
 * - removes the DS offices and building stages they added (everything carries TEST_MARKER), so a
 *   developer's lists don't fill up with test entries. An office with cases, or a stage a case has
 *   reached, stays: load-test cases (scripts/seed-load.ts) may use them, and they go once those are removed;
 * - deletes the cases they created (named with TEST_CASE_NAME), with their files and photos, decisions,
 *   release, installments, stage updates and notifications, and the allocation letters left with no case,
 *   with their scans;
 * - deletes the DS officer accounts they created (named TEST_OFFICER_NAME), so the admin's users screen
 *   doesn't fill up with them. Their audit records stay, with an actor id that no longer exists. An account
 *   that still holds case records is disabled instead.
 * Runs only where sample accounts are allowed (development and test databases).
 */
import "dotenv/config";
import { sampleUsersAllowed } from "../../prisma/seed-users";
import { createPrismaClient } from "../../src/server/db";
import { deleteStoredFile } from "../../src/server/files/storage";
import { TEST_CASE_NAME, TEST_MARKER, TEST_OFFICER_NAME } from "./helpers";

async function main() {
  if (!sampleUsersAllowed()) throw new Error("End-to-end cleanup only runs on development and test databases.");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const prisma = createPrismaClient(databaseUrl);
  try {
    const offices = await prisma.dsOffice.deleteMany({
      where: { nameEn: { startsWith: `${TEST_MARKER} ` }, users: { none: {} }, cases: { none: {} } },
    });
    const stages = await prisma.stageDefinition.deleteMany({
      where: { nameSi: { endsWith: ` ${TEST_MARKER}` }, updates: { none: {} } },
    });
    // Cases the tests created, with everything that hangs off them. Their audit records stay (HIS-3).
    const cases = await prisma.case.findMany({ where: { name: { startsWith: TEST_CASE_NAME } }, select: { id: true } });
    const caseIds = cases.map((c) => c.id);
    const files = await prisma.storedFile.findMany({
      where: { caseId: { in: caseIds } },
      select: { storedName: true, thumbName: true },
    });
    await prisma.storedFile.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.notification.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.installment.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.release.deleteMany({ where: { caseId: { in: caseIds } } });
    const emptyLetter = { letter: { releases: { none: {} } } };
    files.push(
      ...(await prisma.storedFile.findMany({ where: emptyLetter, select: { storedName: true, thumbName: true } })),
    );
    await prisma.storedFile.deleteMany({ where: emptyLetter });
    await prisma.releaseLetter.deleteMany({ where: { releases: { none: {} } } });
    await prisma.stageUpdate.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.decision.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    for (const name of files.flatMap((f) => [f.storedName, f.thumbName])) if (name) await deleteStoredFile(name);
    // The officer accounts the tests created, now that their cases are gone. Sessions and sign-in rows go
    // with them (cascade); their audit records stay (HIS-3). One still holding case records is only disabled.
    const officerWhere = { name: TEST_OFFICER_NAME, role: "DS_OFFICER" };
    const deletable = await prisma.user.findMany({
      where: {
        ...officerWhere,
        casesCreated: { none: {} },
        decisions: { none: {} },
        filesUploaded: { none: {} },
        releases: { none: {} },
        stageUpdates: { none: {} },
      },
      select: { id: true },
    });
    const officerIds = deletable.map((u) => u.id);
    await prisma.notification.deleteMany({ where: { userId: { in: officerIds } } });
    const deleted = await prisma.user.deleteMany({ where: { id: { in: officerIds } } });
    const disabled = await prisma.user.updateMany({
      where: { ...officerWhere, banned: false },
      data: { banned: true },
    });
    console.log(
      `Removed test entries: ${offices.count} offices, ${stages.count} stages, ${caseIds.length} cases, ` +
        `${deleted.count} test officers; disabled ${disabled.count} test officers.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
