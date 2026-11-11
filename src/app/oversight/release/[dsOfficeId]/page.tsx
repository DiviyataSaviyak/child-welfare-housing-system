import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { caseName, PageHeader } from "@/components/cases/page-header";
import { positive } from "@/components/cases/list-filters";
import { DsReleaseForm, type DsReleaseFormCase } from "@/components/review/ds-release-form";
import { colomboDay, formatDate } from "@/lib/dates";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { casesForDsRelease } from "@/server/releases/queries";
import { recordDsReleaseAction, uploadDsReleaseScanAction } from "../actions";

/**
 * REL-6: the District's release to one DS office of the district, with the office's cases the Ministry
 * allocated, none ticked to start with. An office of another district answers "not found" (PRM-1); an
 * office with no case waiting says so.
 */
export default async function DistrictReleaseFormPage({ params }: { params: Promise<{ dsOfficeId: string }> }) {
  const viewer = await requireRole("DISTRICT_OFFICER");
  const dsOfficeId = positive((await params).dsOfficeId);
  const locale = await getLocale();
  const found = dsOfficeId ? await casesForDsRelease(db, viewer, dsOfficeId, locale) : null;
  if (!found) notFound();
  const [t, tc] = await Promise.all([getTranslations("review"), getTranslations("cases")]);
  const { office, cases } = found;

  const rows: DsReleaseFormCase[] = cases.map((c) => ({
    id: c.id,
    version: c.version,
    name: caseName(tc, c.name, c.childName),
    detail: t("district.caseDetail", {
      number: c.applicationNumber,
      category: tc(`category.${c.category}`),
      kind: tc(`kindShort.${c.kind}`),
    }),
    letter: t("district.letter", { number: c.letterNumber, date: formatDate(c.letterDate) }),
    residence: c.residenceName && t("letters.livesIn", { office: c.residenceName }),
    letterDate: c.letterDate,
  }));

  return (
    <div className="flex flex-col gap-4.5">
      <PageHeader
        backHref="/oversight/release"
        backLabel={t("district.back")}
        title={t("district.formTitle", { office: office.name })}
        subtitle={t("district.formIntro", { office: office.name })}
      />
      <section
        aria-label={t("district.formTitle", { office: office.name })}
        className="flex max-w-5xl flex-col gap-4.5 rounded-xl border bg-card px-6.5 py-6"
      >
        {rows.length === 0 ? (
          <p className="text-center text-muted-foreground">{t("district.noneHere")}</p>
        ) : (
          <DsReleaseForm
            // A case that changed or left the list starts the form again.
            key={rows.map((c) => `${c.id}.${c.version}`).join(",")}
            dsOfficeId={office.id}
            officeName={office.name}
            cases={rows}
            today={colomboDay(new Date())}
            action={recordDsReleaseAction}
            upload={uploadDsReleaseScanAction}
          />
        )}
      </section>
    </div>
  );
}
