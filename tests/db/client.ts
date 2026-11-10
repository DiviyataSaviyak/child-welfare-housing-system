import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { inject } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

/** A Prisma client bound to this test run's own schema (see global-setup.ts). */
export function createTestClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject("testDatabaseUrl") }, { schema: inject("testSchema") }),
  });
}

/**
 * An active DS office that has no active DS officer yet, for a test that adds one and wants the office's
 * cases and notices to itself. An office can have several officers (ADM-3), but test files share the
 * schema, so they don't count on any particular office being free.
 */
export async function freeOfficeId(db: PrismaClient): Promise<number> {
  const office = await db.dsOffice.findFirstOrThrow({
    where: { active: true, users: { none: { role: "DS_OFFICER", banned: false } } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  return office.id;
}

/**
 * Change 0006's bridge, until its tasks 5 to 8 replace the tests that use it: puts a case saved as
 * `AWAITING_ALLOCATION` where version 1's submit left it, `SUBMITTED` with its `SUBMIT` decision, so the
 * tests of the check, stopping and version 1's letter still start from there. No screen submits now.
 */
export async function asSubmittedV1(db: PrismaClient, caseId: string, byId: string): Promise<void> {
  const at = new Date();
  await db.case.update({
    where: { id: caseId },
    data: { status: "SUBMITTED", submittedAt: at, version: { increment: 1 } },
  });
  await db.decision.create({ data: { id: randomUUID(), caseId, type: "SUBMIT", byId, at } });
}

/** A made-up Application Number (CASE-12), different for every case a test saves. */
export const testApplicationNumber = (): string => `T/${randomUUID().slice(0, 13)}`;
