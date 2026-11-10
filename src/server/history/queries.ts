import type { PrismaClient } from "@/generated/prisma/client";
import type { Locale } from "@/i18n/locales";
import { localName, NAMES, type Names } from "@/lib/names";
import { isRole, type Role } from "../auth/roles";
import { CASE_PLACES, canSeeCase, type Viewer } from "../permissions";
import { accountLabel, LABEL_SELECT } from "../users/label";

export type HistoryEntry = {
  id: string;
  at: Date;
  /** The audit action, such as "case_submitted" or "installment_paid". */
  action: string;
  /**
   * Who did it: their name, or the designation and place of an account with none (ADM-10). Null for
   * something the system did by itself, such as finishing a case (CLS-1).
   */
  actor: { name: string; role: Role | null } | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const isNames = (value: unknown): value is Names => {
  const names = asObject(value);
  return typeof names.nameSi === "string" && typeof names.nameTa === "string" && typeof names.nameEn === "string";
};

const ids = (value: unknown): number[] =>
  Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id)) : [];

/**
 * The places and stages a record names, in the screen's language (UI-9). The audit log holds the
 * Sinhala names of the day, which stay as they are (HIS-3):
 * - a release names its district: it is read from the release's letter instead;
 * - a stage update names its stages: since 7 Oct 2026 in all three languages; for an older record the
 *   Sinhala screen keeps the names of the day, and the others read the stages' names now.
 */
async function localPlaces(
  db: PrismaClient,
  rows: { action: string; after: Record<string, unknown> }[],
  locale: Locale,
): Promise<{ districtOfLetter: Map<string, string>; stageName: Map<number, string> }> {
  const letterIds = rows.flatMap((row) =>
    row.action === "case_released" && typeof row.after.letterId === "string" ? [row.after.letterId] : [],
  );
  const stageIds =
    locale === "si"
      ? []
      : rows.flatMap((row) => (row.action === "stage_updated" && !row.after.stageNames ? ids(row.after.stageIds) : []));
  const [letters, stages] = await Promise.all([
    letterIds.length > 0
      ? db.releaseLetter.findMany({
          where: { id: { in: letterIds } },
          select: { id: true, district: { select: NAMES } },
        })
      : [],
    stageIds.length > 0
      ? db.stageDefinition.findMany({ where: { id: { in: stageIds } }, select: { id: true, ...NAMES } })
      : [],
  ]);
  return {
    districtOfLetter: new Map(letters.map((letter) => [letter.id, localName(letter.district, locale)])),
    stageName: new Map(stages.map((stage) => [stage.id, localName(stage, locale)])),
  };
}

/**
 * HIS-2: everything recorded about a case, newest first, from the audit log (HIS-1), with the name
 * and role of whoever did each step. Null when the viewer may not see the case (PRM-1). Place and
 * stage names come in the screen's language (UI-9).
 */
export async function caseHistory(
  db: PrismaClient,
  viewer: Viewer,
  caseId: string,
  locale: Locale,
): Promise<HistoryEntry[] | null> {
  const found = await db.case.findUnique({ where: { id: caseId }, select: CASE_PLACES });
  if (!found || !canSeeCase(viewer, found)) return null;

  const rows = await db.auditLog.findMany({
    where: { caseId },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { id: true, at: true, action: true, actorId: true, before: true, after: true },
  });
  const actorIds = [...new Set(rows.flatMap((row) => (row.actorId ? [row.actorId] : [])))];
  const actors = await db.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, role: true, ...LABEL_SELECT },
  });
  const byId = new Map(
    actors.map((a) => [a.id, { name: accountLabel(a, locale), role: isRole(a.role) ? a.role : null }]),
  );
  const records = rows.map((row) => ({ ...row, before: asObject(row.before), after: asObject(row.after) }));
  const { districtOfLetter, stageName } = await localPlaces(db, records, locale);

  return records.map((row) => {
    const after = { ...row.after };
    const district = typeof after.letterId === "string" && districtOfLetter.get(after.letterId);
    if (row.action === "case_released" && district) after.district = district;
    if (row.action === "stage_updated") {
      const names = Array.isArray(after.stageNames) ? after.stageNames : null;
      if (names?.every(isNames)) after.stages = names.map((n) => localName(n, locale));
      else if (locale !== "si") {
        const now = ids(after.stageIds).map((id) => stageName.get(id));
        if (now.length > 0 && now.every((name) => name !== undefined)) after.stages = now;
      }
    }
    return {
      id: String(row.id),
      at: row.at,
      action: row.action,
      actor: row.actorId ? (byId.get(row.actorId) ?? null) : null,
      before: row.before,
      after,
    };
  });
}
