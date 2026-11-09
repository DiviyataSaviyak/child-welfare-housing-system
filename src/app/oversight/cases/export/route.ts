import { notFound } from "next/navigation";
import type { NextRequest } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { readFilters } from "@/components/cases/list-filters";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { exportCaseList } from "@/server/exports/case-list";
import { xlsxResponse } from "@/server/exports/workbook";

/**
 * EXP-1 for a view-only account: its case list as an Excel file, with the list page's filters, limited
 * to its own area (PRM-4) and recorded like any other download (EXP-3).
 */
export async function GET(request: NextRequest) {
  const viewer = await requireRole("VIEWER", "DISTRICT_OFFICER");
  const { filter } = readFilters((key) => request.nextUrl.searchParams.get(key) ?? "");
  const [t, locale] = await Promise.all([getTranslations("cases"), getLocale()]);
  const file = await exportCaseList(db, viewer, "oversight_cases", filter, t, locale);
  if (!file) notFound();
  return xlsxResponse(file.bytes, file.fileName, file.asciiName);
}
