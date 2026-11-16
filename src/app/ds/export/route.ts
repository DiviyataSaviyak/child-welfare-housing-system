import { notFound } from "next/navigation";
import type { NextRequest } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { exportCaseList } from "@/server/exports/case-list";
import { xlsxResponse } from "@/server/exports/workbook";
import { readHomeList } from "../list";

/**
 * EXP-1: the DS officer's own cases as an Excel file, with the tab and search the home page shows (HOME-2).
 * An amendment tab has no file (AMD-9).
 */
export async function GET(request: NextRequest) {
  const viewer = await requireRole("DS_OFFICER");
  const params = request.nextUrl.searchParams;
  const { filter, amendments } = readHomeList({
    tab: params.get("tab") ?? undefined,
    q: params.get("q") ?? undefined,
  });
  if (amendments) notFound();
  const [t, locale] = await Promise.all([getTranslations("cases"), getLocale()]);
  const file = await exportCaseList(db, viewer, "ds_cases", filter, t, locale);
  if (!file) notFound();
  return xlsxResponse(file.bytes, file.fileName, file.asciiName);
}
