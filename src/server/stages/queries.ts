import type { PrismaClient } from "@/generated/prisma/client";
import type { Kind } from "@/generated/prisma/enums";
import type { Locale } from "@/i18n/locales";
import { dateToDay } from "@/lib/dates";
import { localName, NAMES, type Names } from "@/lib/names";

export type Photo = { id: string; name: string };

export type StageRow = {
  id: number;
  /** In the screen's language (UI-9). */
  name: string;
  /** "YYYY-MM-DD", once reached. */
  reachedOn: string | null;
  note: string | null;
  photos: Photo[];
  /** A stage the admin has since deactivated; shown only because this case reached it. */
  inactive: boolean;
};

/** A visit that reached no new stage: a note, with any photos (STG-1). */
export type VisitRow = { id: string; visitedOn: string; note: string | null; photos: Photo[] };

export type StageProgress = {
  /** The kind's active stages in order, plus any inactive one this case reached. */
  stages: StageRow[];
  /** Note-only visits, newest first. */
  visits: VisitRow[];
  /** The highest stage reached, with its day; null before the first. */
  current: { id: number; reachedOn: string } | null;
  /** What a new update may choose (STG-1): the active stages later than the current one. */
  choices: { id: number; name: string; names: Names }[];
};

type Definition = Names & { id: number; sortOrder: number; active: boolean };
type Reached = { id: string; stageId: number | null; visitedOn: string; note: string | null; photos: Photo[] };

/**
 * Pure: the case's stages from its kind's list and its stage updates. A case's current stage is the
 * highest stage it has reached (application spec, Data model); only active stages after it can be chosen next.
 */
export function stageProgress(
  definitions: readonly Definition[],
  updates: readonly Reached[],
  locale: Locale,
): StageProgress {
  const ordered = [...definitions].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const byStage = new Map(updates.flatMap((u) => (u.stageId === null ? [] : [[u.stageId, u] as const])));
  const stages = ordered
    .filter((d) => d.active || byStage.has(d.id))
    .map((d) => {
      const reached = byStage.get(d.id);
      return {
        id: d.id,
        name: localName(d, locale),
        reachedOn: reached?.visitedOn ?? null,
        note: reached?.note ?? null,
        photos: reached?.photos ?? [],
        inactive: !d.active,
      };
    });
  const currentIndex = ordered.findLastIndex((d) => byStage.has(d.id));
  const currentDef = ordered[currentIndex];
  const currentUpdate = currentDef && byStage.get(currentDef.id);
  return {
    stages,
    visits: updates
      .filter((u) => u.stageId === null)
      .map((u) => ({ id: u.id, visitedOn: u.visitedOn, note: u.note, photos: u.photos }))
      .reverse(),
    current: currentDef && currentUpdate ? { id: currentDef.id, reachedOn: currentUpdate.visitedOn } : null,
    choices: ordered.slice(currentIndex + 1).flatMap(({ id, nameSi, nameTa, nameEn, active }) => {
      const names = { nameSi, nameTa, nameEn };
      return active ? [{ id, name: localName(names, locale), names }] : [];
    }),
  };
}

/** A case's building progress. The caller has already checked that the viewer may see the case (PRM-1). */
export async function getStageProgress(
  db: PrismaClient,
  caseId: string,
  kind: Kind | null,
  locale: Locale,
): Promise<StageProgress> {
  const [definitions, updates] = await Promise.all([
    kind
      ? db.stageDefinition.findMany({
          where: { kind },
          select: { id: true, ...NAMES, sortOrder: true, active: true },
        })
      : Promise.resolve([]),
    db.stageUpdate.findMany({
      where: { caseId },
      orderBy: [{ at: "asc" }, { id: "asc" }],
      select: {
        id: true,
        stageId: true,
        visitedOn: true,
        note: true,
        photos: {
          where: { kind: "PHOTO", removedAt: null },
          orderBy: { uploadedAt: "asc" },
          select: { id: true, originalName: true },
        },
      },
    }),
  ]);
  return stageProgress(
    definitions,
    updates.map((u) => ({
      ...u,
      visitedOn: dateToDay(u.visitedOn),
      photos: u.photos.map((p) => ({ id: p.id, name: p.originalName })),
    })),
    locale,
  );
}
