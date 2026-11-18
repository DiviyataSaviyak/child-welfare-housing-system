import { nominationsWaiting } from "@/server/amendments/queries";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";

/** AMD-12, NTF-1: the menu's count of requests waiting for the District's nomination, read again after each move. */
export async function GET() {
  return Response.json(await nominationsWaiting(db, await requireRole("DISTRICT_OFFICER")));
}
