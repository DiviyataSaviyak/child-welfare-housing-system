"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { markAllRead, openNotification } from "@/server/notifications/commands";

/**
 * NTF-1: opening a District officer's notification marks it read. A Ministry letter's notice opens the
 * release screen, where its cases wait (REL-5); any other opens its case.
 */
export async function openNotificationAction(form: FormData) {
  const viewer = await requireRole("DISTRICT_OFFICER");
  const id = form.get("id");
  const opened = typeof id === "string" ? await openNotification(db, viewer, id) : null;
  if (!opened) notFound();
  revalidatePath("/oversight", "layout");
  redirect(opened.type === "DISTRICT_LETTER" ? "/oversight/release" : `/oversight/cases/${opened.caseId}`);
}

export async function markAllReadAction() {
  const viewer = await requireRole("DISTRICT_OFFICER");
  await markAllRead(db, viewer.userId);
  revalidatePath("/oversight", "layout");
}
