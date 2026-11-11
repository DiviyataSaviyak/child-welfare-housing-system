import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { unreadNow } from "@/server/notifications/queries";

/** NTF-1: the District officer's bell count, read again after each client-side move (src/components/shell/live-count.ts). */
export async function GET() {
  return Response.json(await unreadNow(db, await requireRole("DISTRICT_OFFICER")));
}
