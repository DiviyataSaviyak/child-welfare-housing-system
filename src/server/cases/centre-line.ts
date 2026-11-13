import type { getTranslations } from "next-intl/server";
import { formatPartialDate, type PartialDate } from "@/lib/validation/case";

type CasesT = Awaited<ReturnType<typeof getTranslations<"cases">>>;

/** What a centre's line names: the centre, its province in the reader's language, and its dates. */
export type CentreLineValues = {
  name: string;
  provinceName: string;
  from: PartialDate | null;
  until: PartialDate | null;
};

/**
 * A centre as one line: "name, province (from – until)", each date as precise as it was entered
 * (CASE-14), such as `2015.03 – 2019`. The case page and the Excel file (EXP-1) both use it.
 */
export function centreLine(t: CasesT, centre: CentreLineValues): string {
  const from = centre.from ? formatPartialDate(centre.from) : "";
  const until = centre.until ? formatPartialDate(centre.until) : "";
  return from || until
    ? t("page.centreLine", { name: centre.name, province: centre.provinceName, dates: `${from} – ${until}`.trim() })
    : t("page.centreLineNoDates", { name: centre.name, province: centre.provinceName });
}
