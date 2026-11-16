import { AmendmentsScreen } from "@/components/amendments/amendments-screen";
import { requireRole } from "@/server/context";

/** AMD-9: every amendment, in three tabs: the queue waiting for the Ministry's decision, approved and rejected. */
export default async function MinistryAmendmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireRole("MINISTRY_OFFICER");
  return <AmendmentsScreen audience="ministry" viewer={viewer} params={await searchParams} />;
}
