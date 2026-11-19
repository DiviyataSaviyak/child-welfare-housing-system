import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { letterWithCases } from "@/server/releases/queries";

/**
 * REL-10: an allocation letter opens as a pop-up over the allocation screen (`?open=`); this older address
 * goes there. Any other id, or any other account, is "not found".
 */
export default async function MinistryLetterPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireRole("MINISTRY_OFFICER");
  const { id } = await params;
  const letter = id.length <= 64 ? await letterWithCases(db, viewer, id, await getLocale()) : null;
  if (!letter) notFound();
  redirect(`/ministry/allocate?${new URLSearchParams({ open: id })}`);
}
