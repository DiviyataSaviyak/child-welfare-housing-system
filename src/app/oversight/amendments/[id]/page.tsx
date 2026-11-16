import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { AmendmentStatusChip, AmendmentView } from "@/components/amendments/amendment-view";
import { caseName, PageHeader } from "@/components/cases/page-header";
import { getAmendment } from "@/server/amendments/queries";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";

/** AMD-4 for a view-only account or a District officer: one amendment of its own area (PRM-4), to read only. */
export default async function OversightAmendmentPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireRole("VIEWER", "DISTRICT_OFFICER");
  const [locale, { id }] = await Promise.all([getLocale(), params]);
  const view = await getAmendment(db, viewer, id, locale);
  if (!view) notFound();
  const t = await getTranslations("cases");
  const { existing } = view;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        backHref={`/oversight/cases/${existing.id}`}
        backLabel={t("back.case")}
        title={t("amend.view.title")}
        subtitle={[
          existing.applicationNumber,
          caseName(t, existing.name, existing.childName),
          existing.officeName,
        ].join(" · ")}
        aside={<AmendmentStatusChip status={view.status} />}
      />
      <AmendmentView view={view} audience="oversight" />
    </div>
  );
}
