import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { newPasswordRequestsNow } from "@/server/users/queries";

/** AUTH-7: the menu's count of requests for a new password, read again after each client-side move. */
export async function GET() {
  await requireRole("ADMIN");
  return Response.json(await newPasswordRequestsNow(db));
}
