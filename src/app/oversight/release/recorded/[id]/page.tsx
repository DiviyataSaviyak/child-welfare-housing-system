import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { dsReleaseWithCases } from "@/server/releases/queries";

/**
 * REL-11: a District release opens as a pop-up over the release screen (`?open=`); this older address goes
 * there. A release of another district is "not found" (PRM-1).
 */
export default async function DistrictReleaseRecordedPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireRole("DISTRICT_OFFICER");
  const { id } = await params;
  const release = id.length <= 64 ? await dsReleaseWithCases(db, viewer, id, await getLocale()) : null;
  if (!release) notFound();
  redirect(`/oversight/release?${new URLSearchParams({ open: id })}`);
}
