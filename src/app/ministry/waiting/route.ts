import { waitingNow } from "@/server/cases/queues";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";

/** NTF-1: the menu's waiting count, read again after each client-side move (src/components/shell/live-count.ts). */
export async function GET() {
  return Response.json(await waitingNow(db, await requireRole("MINISTRY_OFFICER")));
}
