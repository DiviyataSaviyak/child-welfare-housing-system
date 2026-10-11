import { db } from "@/server/db";
import { databaseReachable } from "@/server/health";
import { logWarning } from "@/server/log";

// Read on every request, never from a cache: it answers for this moment.
export const dynamic = "force-dynamic";

/**
 * OPS-3, OPS-4: 200 when the app is up and reaches its database, 503 when it doesn't. Anyone may
 * ask, signed in or not, so it says nothing more than that.
 */
export async function GET() {
  const ok = await databaseReachable(db);
  if (!ok) logWarning("health_database_unreachable");
  return Response.json({ ok }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
