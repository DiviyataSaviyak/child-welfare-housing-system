import { notFound } from "next/navigation";
import type { NextRequest } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { exportCaseList } from "@/server/exports/case-list";
import { xlsxResponse } from "@/server/exports/workbook";
import { readFilters } from "@/components/cases/list-filters";

/** EXP-1: Head Office's case list as an Excel file, with the filters the list page shows (FND-1). */
export async function GET(request: NextRequest) {
  const viewer = await requireRole("MINISTRY_OFFICER");
  const { filter } = readFilters((key) => request.nextUrl.searchParams.get(key) ?? "");
  const [t, locale] = await Promise.all([getTranslations("cases"), getLocale()]);
  const file = await exportCaseList(db, viewer, "ho_cases", filter, t, locale);
  if (!file) notFound();
  return xlsxResponse(file.bytes, file.fileName, file.asciiName);
}
