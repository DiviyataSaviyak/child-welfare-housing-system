import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

/** Screen text the test looks for (messages/si.json). */
const BY_DISTRICT = "දිස්ත්‍රික්ක අනුව";
const COLOMBO_OFFICES = "කොළඹ දිස්ත්‍රික්කය: ප්‍රා.ලේ. කොට්ඨාස අනුව";
const ALL_DISTRICTS = "සියලු දිස්ත්‍රික්ක පෙන්වන්න";

// The figures themselves are checked against the database in src/server/dashboard/dashboard.db.test.ts
// (AC-17): other tests add cases at the same time, so the numbers on screen keep changing here.
test("the Ministry's dashboard: totals, a district's DS offices, filters and the waiting count (DSH-1)", async ({
  page,
}) => {
  await signInAs(page, "ho0001", /\/ministry$/);

  for (const label of ["මුළු ප්‍රතිලාභීන්", "වැඩ සිදුවෙමින්", "නිම කළ", "නිදහස් කළ මුදල (රු.)"])
    await expect(page.getByRole("term").filter({ hasText: label })).toBeVisible();
  const districts = page.getByRole("table", { name: BY_DISTRICT });
  await expect(districts.getByRole("link")).toHaveCount(25);
  await expect(districts.getByRole("rowheader", { name: "එකතුව" })).toBeVisible();

  // Choosing a district shows its DS offices.
  await districts.getByRole("link", { name: "කොළඹ", exact: true }).click();
  await expect(page).toHaveURL(/\/ministry\?districtId=\d+$/);
  const offices = page.getByRole("table", { name: COLOMBO_OFFICES });
  await expect(offices.getByRole("rowheader", { name: "හෝමාගම", exact: true })).toBeVisible();
  await expect(page.getByLabel("දිස්ත්‍රික්කය", { exact: true })).toHaveValue(/^\d+$/);

  // A filter keeps the district, and going back to every district keeps the filter.
  await page.getByLabel("කාණ්ඩය").selectOption({ label: "නිවාසගත" });
  await page.getByLabel("ආධාරය").selectOption({ label: "නව නිවසක්" });
  await page.getByRole("button", { name: "පෙන්වන්න" }).click();
  await expect(page).toHaveURL(/\/ministry\?districtId=\d+&category=CARE_LEAVER&kind=NEW_HOUSE$/);
  await expect(page.getByText(/^කොළඹ දිස්ත්‍රික්කය · නිවාසගත · නව නිවසක් · \d{4}\.\d{2}\.\d{2} දක්වා$/)).toBeVisible();
  await expect(offices).toBeVisible();

  await page.getByRole("link", { name: ALL_DISTRICTS }).click();
  await expect(page).toHaveURL(/\/ministry\?category=CARE_LEAVER&kind=NEW_HOUSE$/);
  await expect(page.getByRole("table", { name: BY_DISTRICT })).toBeVisible();
  await page.getByRole("link", { name: "පෙරහන් ඉවත් කරන්න" }).click();
  await expect(page).toHaveURL(/\/ministry$/);

  // The waiting count leads to the allocation letters; there is no check queue (change 0006).
  const waiting = page.getByRole("region", { name: "ඔබේ ක්‍රියාව අවශ්‍යයි" });
  await expect(waiting.getByRole("link", { name: /^පරීක්ෂා කිරීමට/ })).toHaveCount(0);
  await waiting.getByRole("link", { name: /^ප්‍රතිපාදන මුදා හැරීමට/ }).click();
  await expect(page).toHaveURL(/\/ministry\/allocate$/);
});
