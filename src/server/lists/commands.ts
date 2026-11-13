import type { PrismaClient } from "@/generated/prisma/client";
import type { Kind } from "@/generated/prisma/enums";
import type { Names } from "@/lib/names";
import { isHouseKind } from "@/lib/validation/case";
import { writeAudit } from "../audit";

export type ListCommandError = "notFound" | "nameTaken" | "codeTaken";
type Result = { ok: true } | { ok: false; error: ListCommandError };

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "P2002";

/**
 * LST-2: adds a DS office with its name in Sinhala, Tamil and English (UI-9). Sinhala names are unique
 * within a district; codes are unique nationally.
 */
export async function addOffice(
  db: PrismaClient,
  actorId: string,
  districtId: number,
  input: Names & { code: string },
): Promise<Result> {
  if (!(await db.district.findUnique({ where: { id: districtId }, select: { id: true } }))) {
    return { ok: false, error: "notFound" };
  }
  if (await db.dsOffice.findUnique({ where: { code: input.code }, select: { id: true } })) {
    return { ok: false, error: "codeTaken" };
  }
  if (await db.dsOffice.findFirst({ where: { districtId, nameSi: input.nameSi }, select: { id: true } })) {
    return { ok: false, error: "nameTaken" };
  }
  try {
    await db.$transaction(async (tx) => {
      const office = await tx.dsOffice.create({ data: { ...input, districtId } });
      await writeAudit(tx, {
        actorId,
        action: "office_added",
        entityType: "ds_office",
        entityId: String(office.id),
        after: { ...input, districtId },
      });
    });
    return { ok: true };
  } catch (error) {
    // Someone added the same office at the same moment.
    if (isUniqueViolation(error)) return { ok: false, error: "codeTaken" };
    throw error;
  }
}

/** LST-3: renames an office. Its code never changes, because it is part of every case number. */
export async function renameOffice(db: PrismaClient, actorId: string, id: number, input: Names): Promise<Result> {
  const office = await db.dsOffice.findUnique({
    where: { id },
    select: { districtId: true, nameSi: true, nameTa: true, nameEn: true },
  });
  if (!office) return { ok: false, error: "notFound" };
  const clash = await db.dsOffice.findFirst({
    where: { districtId: office.districtId, nameSi: input.nameSi, id: { not: id } },
    select: { id: true },
  });
  if (clash) return { ok: false, error: "nameTaken" };

  await db.$transaction(async (tx) => {
    await tx.dsOffice.update({ where: { id }, data: input });
    await writeAudit(tx, {
      actorId,
      action: "office_renamed",
      entityType: "ds_office",
      entityId: String(id),
      before: { nameSi: office.nameSi, nameTa: office.nameTa, nameEn: office.nameEn },
      after: input,
    });
  });
  return { ok: true };
}

/** LST-3: an inactive office gets no new accounts or cases, but keeps what it has. Never deleted. */
export async function setOfficeActive(db: PrismaClient, actorId: string, id: number, active: boolean): Promise<Result> {
  const office = await db.dsOffice.findUnique({ where: { id }, select: { active: true } });
  if (!office) return { ok: false, error: "notFound" };
  if (office.active === active) return { ok: true };
  await db.$transaction(async (tx) => {
    await tx.dsOffice.update({ where: { id }, data: { active } });
    await writeAudit(tx, {
      actorId,
      action: active ? "office_activated" : "office_deactivated",
      entityType: "ds_office",
      entityId: String(id),
    });
  });
  return { ok: true };
}

/**
 * LST-4: adds a stage, named in Sinhala, Tamil and English (UI-9), at the end of its kind's list. Only the
 * house kinds have a list; a land kind is `notFound`, as the screen offers none (and a database check
 * refuses it too).
 */
export async function addStage(db: PrismaClient, actorId: string, kind: Kind, names: Names): Promise<Result> {
  if (!isHouseKind(kind)) return { ok: false, error: "notFound" };
  const { nameSi } = names;
  if (await db.stageDefinition.findUnique({ where: { kind_nameSi: { kind, nameSi } }, select: { id: true } })) {
    return { ok: false, error: "nameTaken" };
  }
  const last = await db.stageDefinition.aggregate({ where: { kind }, _max: { sortOrder: true } });
  try {
    await db.$transaction(async (tx) => {
      const stage = await tx.stageDefinition.create({
        data: { kind, ...names, sortOrder: (last._max.sortOrder ?? 0) + 1 },
      });
      await writeAudit(tx, {
        actorId,
        action: "stage_added",
        entityType: "stage_definition",
        entityId: String(stage.id),
        after: { kind, ...names },
      });
    });
    return { ok: true };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "nameTaken" };
    throw error;
  }
}

export async function renameStage(db: PrismaClient, actorId: string, id: number, names: Names): Promise<Result> {
  const stage = await db.stageDefinition.findUnique({
    where: { id },
    select: { kind: true, nameSi: true, nameTa: true, nameEn: true },
  });
  if (!stage) return { ok: false, error: "notFound" };
  const { kind, ...before } = stage;
  if (before.nameSi === names.nameSi && before.nameTa === names.nameTa && before.nameEn === names.nameEn) {
    return { ok: true };
  }
  const clash = await db.stageDefinition.findUnique({ where: { kind_nameSi: { kind, nameSi: names.nameSi } } });
  if (clash && clash.id !== id) return { ok: false, error: "nameTaken" };

  await db.$transaction(async (tx) => {
    await tx.stageDefinition.update({ where: { id }, data: names });
    await writeAudit(tx, {
      actorId,
      action: "stage_renamed",
      entityType: "stage_definition",
      entityId: String(id),
      before,
      after: names,
    });
  });
  return { ok: true };
}

/** LST-4: swaps a stage with its neighbour above or below. The order is what DS officers follow. */
export async function moveStage(
  db: PrismaClient,
  actorId: string,
  id: number,
  direction: "up" | "down",
): Promise<Result> {
  const stage = await db.stageDefinition.findUnique({ where: { id }, select: { kind: true, sortOrder: true } });
  if (!stage) return { ok: false, error: "notFound" };
  const neighbour = await db.stageDefinition.findFirst({
    where: {
      kind: stage.kind,
      sortOrder: direction === "up" ? { lt: stage.sortOrder } : { gt: stage.sortOrder },
    },
    orderBy: { sortOrder: direction === "up" ? "desc" : "asc" },
    select: { id: true, sortOrder: true },
  });
  if (!neighbour) return { ok: true };

  await db.$transaction(async (tx) => {
    await tx.stageDefinition.update({ where: { id }, data: { sortOrder: neighbour.sortOrder } });
    await tx.stageDefinition.update({ where: { id: neighbour.id }, data: { sortOrder: stage.sortOrder } });
    await writeAudit(tx, {
      actorId,
      action: "stage_moved",
      entityType: "stage_definition",
      entityId: String(id),
      before: { sortOrder: stage.sortOrder },
      after: { sortOrder: neighbour.sortOrder },
    });
  });
  return { ok: true };
}

/** LST-4: a stage that is no longer used is deactivated, never removed. */
export async function setStageActive(db: PrismaClient, actorId: string, id: number, active: boolean): Promise<Result> {
  const stage = await db.stageDefinition.findUnique({ where: { id }, select: { active: true } });
  if (!stage) return { ok: false, error: "notFound" };
  if (stage.active === active) return { ok: true };
  await db.$transaction(async (tx) => {
    await tx.stageDefinition.update({ where: { id }, data: { active } });
    await writeAudit(tx, {
      actorId,
      action: active ? "stage_activated" : "stage_deactivated",
      entityType: "stage_definition",
      entityId: String(id),
    });
  });
  return { ok: true };
}
