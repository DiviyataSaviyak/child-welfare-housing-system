import { amendmentsWaiting } from "@/server/amendments/queries";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";

/** AMD-9, NTF-1: the menu's count of amendments waiting, read again after each client-side move (live-count.ts). */
export async function GET() {
  return Response.json(await amendmentsWaiting(db, await requireRole("MINISTRY_OFFICER")));
}
