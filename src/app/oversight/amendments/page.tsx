import { AmendmentsScreen } from "@/components/amendments/amendments-screen";
import { requireRole } from "@/server/context";

/** AMD-9 for a view-only account or a District officer: the amendments of its own area (PRM-4), to read only. */
export default async function OversightAmendmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireRole("VIEWER", "DISTRICT_OFFICER");
  return <AmendmentsScreen audience="oversight" viewer={viewer} params={await searchParams} />;
}
