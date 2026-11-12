import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { inject } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { CaseValues } from "@/lib/validation/case";

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
 * Change 0007's required details of a made-up care leaver (CASE-14, CASE-16; SEC-11), for tests that save a
 * case: the group, date of birth, marital status, family and one centre (province 1, which the seed adds first).
 */
export const CARE_LEAVER_DETAILS = {
  careGroup: "LEFT_CARE",
  landGnDivision: null,
  dateOfBirth: "2005-03-14",
  relationship: null,
  relationshipOther: null,
  maritalStatus: "UNMARRIED",
  familyMembers: 3,
  disabledChildren: false,
  aid: [],
  aidOther: null,
  centres: [{ name: "පරීක්ෂණ ළමා නිවාසය", provinceId: 1, from: { year: 2012, month: null, day: null }, until: null }],
} as const satisfies Omit<
  CaseValues,
  | "category"
  | "kind"
  | "applicationNumber"
  | "childName"
  | "name"
  | "nic"
  | "address"
  | "gnDivision"
  | "mobile1"
  | "mobile2"
  | "remark"
>;

/** A made-up Application Number (CASE-12), different for every case a test saves. */
export const testApplicationNumber = (): string => `T/${randomUUID().slice(0, 13)}`;
