import type { PrismaClient } from "@/generated/prisma/client";
import type { Kind } from "@/generated/prisma/enums";
import type { Locale } from "@/i18n/locales";
import { localName, NAMES, type Names } from "@/lib/names";

export type DistrictSummary = { id: number; name: string; province: string; offices: number };

export async function listDistricts(db: PrismaClient, locale: Locale): Promise<DistrictSummary[]> {
  const districts = await db.district.findMany({
    orderBy: { id: "asc" },
    select: { id: true, ...NAMES, province: { select: NAMES }, _count: { select: { dsOffices: true } } },
  });
  return districts.map((d) => ({
    id: d.id,
    name: localName(d, locale),
    province: localName(d.province, locale),
    offices: d._count.dsOffices,
  }));
}

/** The admin sees an office's name in the screen's language and can change all three (LST-2, UI-9). */
export type OfficeRow = Names & {
  id: number;
  code: string;
  active: boolean;
  /** The names of the office's active DS officers (ADM-3); empty if it still needs one. */
  officers: string[];
};

export async function officesOfDistrict(
  db: PrismaClient,
  districtId: number,
  locale: Locale,
): Promise<{ district: DistrictSummary; offices: OfficeRow[] } | null> {
  const district = await db.district.findUnique({
    where: { id: districtId },
    select: {
      id: true,
      ...NAMES,
      province: { select: NAMES },
      dsOffices: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          ...NAMES,
          code: true,
          active: true,
          users: { where: { role: "DS_OFFICER", banned: false }, orderBy: { name: "asc" }, select: { name: true } },
        },
      },
    },
  });
  if (!district) return null;
  return {
    district: {
      id: district.id,
      name: localName(district, locale),
      province: localName(district.province, locale),
      offices: district.dsOffices.length,
    },
    offices: district.dsOffices.map((o) => ({
      id: o.id,
      nameSi: o.nameSi,
      nameTa: o.nameTa,
      nameEn: o.nameEn,
      code: o.code,
      active: o.active,
      officers: o.users.map((u) => u.name),
    })),
  };
}

export type StageRow = Names & { id: number; sortOrder: number; active: boolean };

export async function stagesByKind(db: PrismaClient): Promise<Record<Kind, StageRow[]>> {
  const stages = await db.stageDefinition.findMany({
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
    select: { id: true, kind: true, ...NAMES, sortOrder: true, active: true },
  });
  const byKind: Record<Kind, StageRow[]> = { NEW_HOUSE: [], RENOVATION: [] };
  for (const { kind, ...stage } of stages) byKind[kind].push(stage);
  return byKind;
}

export type OfficeOption = { id: number; name: string; active: boolean };
export type DistrictOptions = { id: number; name: string; offices: OfficeOption[] };

/** Every district with its DS offices, for choosing a case's office (CASE-3) or filtering a list (FND-1). */
export async function districtsWithOffices(db: PrismaClient, locale: Locale): Promise<DistrictOptions[]> {
  const districts = await db.district.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      ...NAMES,
      dsOffices: { orderBy: { id: "asc" }, select: { id: true, ...NAMES, active: true } },
    },
  });
  return districts.map((d) => ({
    id: d.id,
    name: localName(d, locale),
    offices: d.dsOffices.map((o) => ({ id: o.id, name: localName(o, locale), active: o.active })),
  }));
}
