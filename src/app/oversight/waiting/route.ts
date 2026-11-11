import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { awaitingDsRelease } from "@/server/releases/queries";

/** NTF-1, REL-5: the menu's count of cases waiting for the District's release, read again after each move. */
export async function GET() {
  return Response.json(await awaitingDsRelease(db, await requireRole("DISTRICT_OFFICER")));
}
