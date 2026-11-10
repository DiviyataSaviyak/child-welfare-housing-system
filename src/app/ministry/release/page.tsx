import { requireRole } from "@/server/context";
import { LetterScreen, type LetterSearchParams } from "./letter-screen";

/** The allocation letters (REL-1, REL-2). */
export default async function MinistryReleasePage({ searchParams }: { searchParams: LetterSearchParams }) {
  await requireRole("MINISTRY_OFFICER");
  return <LetterScreen searchParams={searchParams} />;
}
