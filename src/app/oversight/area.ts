import { getLocale, getTranslations } from "next-intl/server";
import type { PlaceFilters } from "@/components/cases/case-filters";
import { isDesignation, officeTypeOf } from "@/server/auth/designations";
import type { Context } from "@/server/context";
import { db } from "@/server/db";
import { type ViewerArea, viewerArea } from "@/server/lists/queries";

export type OversightArea = ViewerArea & {
  /** The header's line under the system's name, such as "මාතලේ දිස්ත්‍රික් ලේකම් කාර්යාලය". */
  header: string;
  /** What the dashboard's figures cover when no district is chosen, such as "මාතලේ දිස්ත්‍රික්කය". */
  covers: string;
  /** Which place filters the case list offers: none for one DS office, only its offices for one district. */
  places: PlaceFilters;
};

/**
 * PRM-4: the places a view-only account's cases come from, read from the account, never from the
 * address. Its filters offer nothing outside them.
 */
export async function oversightArea(context: Context): Promise<OversightArea> {
  const locale = await getLocale();
  const [t, area] = await Promise.all([getTranslations(), viewerArea(db, context, locale)]);
  const name = area.name ?? "";
  switch (area.kind) {
    case "office":
      return {
        ...area,
        header: t("areas.dsOffice", { office: name }),
        covers: t("areas.dsOffice", { office: name }),
        places: "none",
      };
    case "district":
      return {
        ...area,
        header: t("areas.district", { district: name }),
        covers: t("users.districtOf", { district: name }),
        places: "office",
      };
    case "province":
      return {
        ...area,
        header: t("areas.province", { province: name }),
        covers: t("users.provinceOf", { province: name }),
        places: "district",
      };
    case "all": {
      const type = isDesignation(context.designation) ? officeTypeOf(context.designation) : null;
      return {
        ...area,
        header: type === "DEPARTMENT" || type === "MINISTRY" ? t(`users.officeTypes.${type}`) : t("areas.oversight"),
        covers: t("dashboard.allDistricts"),
        places: "district",
      };
    }
    case "none":
      return { ...area, header: t("areas.oversight"), covers: "", places: "none" };
  }
}
