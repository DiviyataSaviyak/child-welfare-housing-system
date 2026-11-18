import type { BuildSetting } from "@/components/forms/case-form";
import { afterLetter } from "@/server/amendments/rules";
import type { CaseDetails } from "@/server/cases/queries";
import type { DistrictOptions } from "@/server/lists/queries";

/**
 * AMD-8: an amendment form's "where is the land?": any DS office before the Ministry's letter, and a DS
 * office of the letter's district after it, with where the existing case's money has reached, so the form
 * says when the chosen place sends it back to the District (AMD-11). Shared by the CRPO's amendment and the
 * District's nomination (AMD-13).
 */
export function amendBuild(details: CaseDetails, districts: DistrictOptions[]): BuildSetting {
  const letter = afterLetter(details.status);
  return {
    kind: "choose",
    districts: letter ? districts.filter((d) => d.id === details.buildDistrictId) : districts,
    districtId: letter ? details.buildDistrictId : null,
    dsOfficeId: null,
    money: {
      status: details.status,
      buildDsOffice: { id: details.buildDsOfficeId, districtId: details.buildDistrictId },
      districtName: details.buildDistrictName,
      officeName: details.buildOfficeName,
      residenceDistrictId: details.districtId,
    },
  };
}
