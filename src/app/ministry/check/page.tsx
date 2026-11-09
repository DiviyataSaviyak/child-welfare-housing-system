import { requireRole } from "@/server/context";
import { ReviewScreen, type ReviewSearchParams } from "./review-screen";

/** The "to check" tab (CHK-1). */
export default async function HoCheckPage({ searchParams }: { searchParams: ReviewSearchParams }) {
  await requireRole("MINISTRY_OFFICER");
  return <ReviewScreen queue="check" searchParams={searchParams} />;
}
