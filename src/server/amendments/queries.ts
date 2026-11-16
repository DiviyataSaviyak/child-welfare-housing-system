import type { PrismaClient } from "@/generated/prisma/client";
import type { AmendmentStatus } from "@/generated/prisma/enums";
import type { Locale } from "@/i18n/locales";
import { localName, NAMES } from "@/lib/names";
import { type CaseValues, completeValues } from "@/lib/validation/case";
import { type CaseDetails, type CaseLink, type CentreDetails, getCase } from "../cases/queries";
import { canSeeCase, CASE_PLACES, type Viewer } from "../permissions";
import { accountLabel, LABEL_SELECT } from "../users/label";
import { readDetails } from "./details";

/**
 * The new beneficiary as the amendment holds them, with the place names the case page's details show (in
 * the screen's language). The DS of residence is the existing case's (AMD-8). The values are as submitted,
 * so a detail the form didn't ask for is null.
 */
export type ProposedBeneficiary = Omit<CaseValues, "category" | "kind" | "applicationNumber" | "centres"> & {
  category: NonNullable<CaseValues["category"]>;
  kind: NonNullable<CaseValues["kind"]>;
  applicationNumber: string;
  centres: CentreDetails[];
  provinceName: string;
  districtName: string;
  officeName: string;
  buildDsOfficeId: number;
  buildOfficeName: string;
  buildDistrictName: string;
  buildProvinceName: string;
  /** Not a case yet: it has no day it was entered. */
  createdAt: null;
};

export type AmendmentView = {
  id: string;
  status: AmendmentStatus;
  version: number;
  reason: string;
  submittedAt: Date;
  submittedByName: string;
  decidedAt: Date | null;
  decidedByName: string | null;
  rejectionReason: string | null;
  /** The case whose beneficiary it replaces, as it is now. */
  existing: CaseDetails;
  /** Null only for a row whose details can't be read; the page then shows the reason alone. */
  proposed: ProposedBeneficiary | null;
  /** The new beneficiary's documents: on the amendment until it is approved, then on the new case. */
  documents: { id: string; name: string }[];
  /** The case the approval made, when the viewer may see it. */
  newCase: CaseLink | null;
};

/**
 * AMD-4: one amendment, with the existing and the new beneficiary, for whoever may see its case (PRM-4);
 * null for anyone else (PRM-1). Place names are in the screen's language (UI-9).
 */
export async function getAmendment(
  db: PrismaClient,
  viewer: Viewer,
  id: string,
  locale: Locale,
): Promise<AmendmentView | null> {
  const found = await db.amendment.findUnique({
    where: { id },
    select: {
      id: true,
      caseId: true,
      status: true,
      version: true,
      reason: true,
      details: true,
      submittedAt: true,
      submittedBy: { select: LABEL_SELECT },
      decidedAt: true,
      decidedBy: { select: LABEL_SELECT },
      rejectionReason: true,
      files: {
        where: { kind: "DOCUMENT", removedAt: null },
        orderBy: { uploadedAt: "asc" },
        select: { id: true, originalName: true },
      },
      newCase: {
        select: {
          id: true,
          applicationNumber: true,
          name: true,
          childName: true,
          ...CASE_PLACES,
          files: {
            where: { kind: "DOCUMENT", removedAt: null },
            orderBy: { uploadedAt: "asc" },
            select: { id: true, originalName: true },
          },
        },
      },
    },
  });
  if (!found) return null;
  // getCase applies the viewer's area to the existing case (PRM-1, PRM-4).
  const existing = await getCase(db, viewer, found.caseId, locale);
  if (!existing) return null;

  const newCase = found.newCase && canSeeCase(viewer, found.newCase) ? found.newCase : null;
  const files = found.status === "APPROVED" ? (newCase?.files ?? []) : found.files;
  return {
    id: found.id,
    status: found.status,
    version: found.version,
    reason: found.reason,
    submittedAt: found.submittedAt,
    submittedByName: accountLabel(found.submittedBy, locale),
    decidedAt: found.decidedAt,
    decidedByName: found.decidedBy && accountLabel(found.decidedBy, locale),
    rejectionReason: found.rejectionReason,
    existing,
    proposed: await proposedBeneficiary(db, found.details, existing, locale),
    documents: files.map((file) => ({ id: file.id, name: file.originalName })),
    newCase: newCase && {
      id: newCase.id,
      applicationNumber: newCase.applicationNumber,
      name: newCase.name,
      childName: newCase.childName,
    },
  };
}

async function proposedBeneficiary(
  db: PrismaClient,
  details: Parameters<typeof readDetails>[0],
  existing: CaseDetails,
  locale: Locale,
): Promise<ProposedBeneficiary | null> {
  const stored = readDetails(details);
  const values = stored && completeValues(stored.values);
  if (!stored || !values) return null;
  const provinceIds = [...new Set(values.centres.map((centre) => centre.provinceId))];
  const [office, provinces] = await Promise.all([
    db.dsOffice.findUnique({
      where: { id: stored.buildDsOfficeId },
      select: { ...NAMES, district: { select: { ...NAMES, province: { select: NAMES } } } },
    }),
    provinceIds.length > 0
      ? db.province.findMany({ where: { id: { in: provinceIds } }, select: { id: true, ...NAMES } })
      : Promise.resolve([]),
  ]);
  if (!office) return null;
  const provinceName = new Map(provinces.map((province) => [province.id, localName(province, locale)]));
  return {
    ...values,
    centres: values.centres.map((centre) => ({ ...centre, provinceName: provinceName.get(centre.provinceId) ?? "" })),
    provinceName: existing.provinceName,
    districtName: existing.districtName,
    officeName: existing.officeName,
    buildDsOfficeId: stored.buildDsOfficeId,
    buildOfficeName: localName(office, locale),
    buildDistrictName: localName(office.district, locale),
    buildProvinceName: localName(office.district.province, locale),
    createdAt: null,
  };
}
