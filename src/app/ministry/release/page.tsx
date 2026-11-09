import { requireRole } from "@/server/context";
import { ReviewScreen, type ReviewSearchParams } from "../check/review-screen";

/** The "to release" tab (REL-1). */
export default async function HoReleasePage({ searchParams }: { searchParams: ReviewSearchParams }) {
  await requireRole("MINISTRY_OFFICER");
  return <ReviewScreen queue="release" searchParams={searchParams} />;
}
