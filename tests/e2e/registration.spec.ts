import { expect, type Page, test } from "@playwright/test";
import { CONFIRM, randomApplicationNumber, randomNic, SAVE, saveNew, TODAY } from "./case-helpers";
import { signInAs, TEST_CASE_NAME } from "./helpers";

/** Change 0007's registration form (CASE-14 to CASE-16), from the form to the case page. */

/** Whole years from a date of birth to today in Colombo, as the form and the case page work it out. */
function age(dateOfBirth: string): number {
  const years = Number(TODAY.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  return TODAY.slice(5) < dateOfBirth.slice(5) ? years - 1 : years;
}

/** The value beside a label in the case page's details. */
function detail(page: Page, label: string) {
  return page.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");
}

/** One centre's box on the form, by its number. */
function centreBox(page: Page, number: number) {
  return page.getByRole("region", { name: `මධ්‍යස්ථානය ${number}`, exact: true });
}

test("AC-60: a care leaver still in care is saved with the family, the aid and two centres in order", async ({
  page,
}) => {
  test.slow();
  await signInAs(page, "ds0103", /\/ds$/);
  await page.goto("/ds/cases/new");
  // CASE-3: the province, district and DS of residence are filled in.
  await expect(page.getByTestId("residence-place")).toContainText("බස්නාහිර");
  await expect(page.getByTestId("residence-place")).toContainText("කොළඹ");
  await expect(page.getByTestId("residence-place")).toContainText("කඩුවෙල");

  const name = `${TEST_CASE_NAME} ලියාපදිංචි ${Date.now()}`;
  const dateOfBirth = "2009-05-20";
  await page.getByRole("radio", { name: /^නිවාසගත/ }).check();
  await page.getByRole("radio", { name: /^වයස 16–18, තවමත් ළමා නිවාස/ }).check();
  await page.getByRole("radio", { name: /^නව නිවසක් ඉදිකිරීම/ }).check();
  // CASE-17: the land is asked once, the same DS division by default, with its place shown.
  await expect(page.getByRole("heading", { name: "ඉඩම පිහිටි ස්ථානය *" })).toBeVisible();
  await expect(page.getByTestId("land-place")).toContainText("කඩුවෙල");
  await page.getByLabel("ඉඩම පිහිටි ග්‍රාම නිලධාරී වසම").fill("ඉඹුල්ගොඩ");
  await page.getByLabel("ඉල්ලුම් අංකය *").fill(randomApplicationNumber());
  await page.getByLabel("නම *", { exact: true }).fill(name);
  await page.getByLabel("උපන් දිනය *", { exact: true }).fill(dateOfBirth);
  await expect(page.getByTestId("age")).toHaveText(`වයස ${age(dateOfBirth)}`);
  await page.getByLabel("ජාතික හැඳුනුම්පත් අංකය", { exact: true }).fill(randomNic());
  await page.getByRole("radio", { name: "අවිවාහක", exact: true }).check();
  // A child at risk's questions aren't asked.
  await expect(page.getByLabel("දරුවාගේ නම *")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "මව", exact: true })).toHaveCount(0);

  // No centre at all saves nothing.
  await page.getByLabel("පවුලේ සාමාජිකයින් ගණන *").fill("4");
  await page.getByRole("radio", { name: "නැත", exact: true }).check();
  await page.getByRole("checkbox", { name: "සමෘද්ධි" }).check();
  await page.getByRole("checkbox", { name: "වෙනත්" }).check();
  await page.getByLabel("වෙනත් ආධාරයේ නම *").fill("ගම් ආධාර");
  await page.getByRole("button", { name: SAVE, exact: true }).click();
  await expect(page.locator("#case-errors")).toContainText("අවම වශයෙන් එක් ළමා සංවර්ධන මධ්‍යස්ථානයක් ඇතුළත් කරන්න.");
  await expect(page.getByRole("dialog")).toBeHidden();

  // The first centre: from 2012 until 2015.06, but first with 30 Feb and an "until" before its "from".
  const first = centreBox(page, 1);
  await first.getByLabel("මධ්‍යස්ථානයේ නම *").fill("පළමු ළමා නිවාසය");
  await first.getByLabel("පළාත *").selectOption({ label: "මධ්‍යම" });
  const from = first.getByRole("group", { name: "සිට" });
  const until = first.getByRole("group", { name: "දක්වා" });
  // The month waits for the year.
  await expect(from.getByLabel("මාසය")).toBeDisabled();
  await from.getByLabel("වර්ෂය").fill("2012");
  await from.getByLabel("මාසය").selectOption({ label: "පෙබරවාරි" });
  await from.getByLabel("දිනය").selectOption("30");
  await until.getByLabel("වර්ෂය").fill("2011");
  await page.getByRole("button", { name: SAVE, exact: true }).click();
  const errors = page.locator("#case-errors");
  await expect(errors).toContainText("මධ්‍යස්ථානය 1: මෙම දිනය වැරදියි.");
  await expect(page.getByRole("dialog")).toBeHidden();
  await from.getByLabel("මාසය").selectOption("");
  await page.getByRole("button", { name: SAVE, exact: true }).click();
  await expect(errors).toContainText('මධ්‍යස්ථානය 1: "දක්වා" දිනය "සිට" දිනයට පෙර විය නොහැක.');
  await until.getByLabel("වර්ෂය").fill("2015");
  await until.getByLabel("මාසය").selectOption({ label: "ජූනි" });

  // The second centre: only its name and province.
  await page.getByRole("button", { name: "තවත් මධ්‍යස්ථානයක් එක් කරන්න" }).click();
  const second = centreBox(page, 2);
  await second.getByLabel("මධ්‍යස්ථානයේ නම *").fill("දෙවන ළමා නිවාසය");
  await second.getByLabel("පළාත *").selectOption({ label: "බස්නාහිර" });

  await page.getByRole("button", { name: SAVE, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("පළමු ළමා නිවාසය, මධ්‍යම (2012 – 2015.06)");
  await expect(dialog).toContainText("සමෘද්ධි, වෙනත්: ගම් ආධාර");
  await dialog.getByRole("button", { name: CONFIRM }).click();
  await expect(page).toHaveURL(/\/ds\/cases\/[0-9a-f-]{36}\?notice=created$/);

  await expect(detail(page, "නිවාසගත කාණ්ඩය")).toHaveText("වයස 16–18, තවමත් ළමා නිවාස හෝ පරිවාස භාරයේ");
  await expect(detail(page, "උපන් දිනය")).toHaveText(`2009.05.20 (වයස ${age(dateOfBirth)})`);
  await expect(detail(page, "විවාහක / අවිවාහක බව")).toHaveText("අවිවාහක");
  await expect(detail(page, "පවුලේ සාමාජිකයින් ගණන")).toHaveText("4");
  await expect(detail(page, "ආබාධිත ළමයින් සිටීද\\?")).toHaveText("නැත");
  await expect(detail(page, "ලැබෙන ආධාර")).toHaveText("සමෘද්ධි, වෙනත්: ගම් ආධාර");
  await expect(detail(page, "ඉඩමේ ග්‍රාම නිලධාරී වසම")).toHaveText("ඉඹුල්ගොඩ");
  await expect(detail(page, "පළාත")).toHaveText("බස්නාහිර");
  await expect(detail(page, "ළමා සංවර්ධන මධ්‍යස්ථාන")).toHaveText(
    "පළමු ළමා නිවාසය, මධ්‍යම (2012 – 2015.06)\nදෙවන ළමා නිවාසය, බස්නාහිර",
  );
});

test("AC-61: a child at risk is saved with the guardian and 'other: ආච්චි' as the relationship", async ({ page }) => {
  test.slow();
  await signInAs(page, "ds0101", /\/ds$/);
  await page.goto("/ds/cases/new");
  const name = `${TEST_CASE_NAME} භාරකරු ${Date.now()}`;
  await page.getByRole("radio", { name: /^අවදානම් දරුවන්/ }).check();
  await page.getByRole("radio", { name: /^නිවස අලුත්වැඩියා කිරීම/ }).check();
  // A renovation asks where the house is.
  await expect(page.getByRole("heading", { name: "නිවස පිහිටි ස්ථානය *" })).toBeVisible();
  await page.getByLabel("ඉල්ලුම් අංකය *").fill(randomApplicationNumber());
  await page.getByLabel("දරුවාගේ නම *").fill("පරීක්ෂණ දරුවා");
  await page.getByLabel("දරුවාගේ උපන් දිනය *").fill("2014-01-09");
  await page.getByLabel("භාරකරුගේ නම *").fill(name);
  await page.getByLabel("භාරකරුගේ ජාතික හැඳුනුම්පත් අංකය").fill(randomNic());
  await page.getByLabel("පවුලේ සාමාජිකයින් ගණන *").fill("3");
  await page.getByRole("radio", { name: "ඔව්", exact: true }).check();
  // A care leaver's questions aren't asked.
  await expect(page.getByRole("radio", { name: /^වයස 16–18/ })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "අවිවාහක", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("මධ්‍යස්ථානයේ නම *")).toHaveCount(0);

  // Without the relationship, or with "other" and nothing typed, nothing is saved.
  const errors = page.locator("#case-errors");
  await page.getByRole("button", { name: SAVE, exact: true }).click();
  await expect(errors).toContainText("දරුවාට ඇති ඥාතීත්වය තෝරන්න.");
  await page.getByRole("radio", { name: "වෙනත්", exact: true }).check();
  await page.getByRole("button", { name: SAVE, exact: true }).click();
  await expect(errors).toContainText("ඥාතීත්වය ඇතුළත් කරන්න.");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByLabel("ඥාතීත්වය *", { exact: true }).fill("ආච්චි");

  await saveNew(page, "ds");
  await expect(detail(page, "දරුවාට ඇති ඥාතීත්වය")).toHaveText("වෙනත්: ආච්චි");
  await expect(detail(page, "දරුවාගේ උපන් දිනය")).toHaveText(`2014.01.09 (වයස ${age("2014-01-09")})`);
  await expect(detail(page, "ආබාධිත ළමයින් සිටීද\\?")).toHaveText("ඔව්");
  await expect(detail(page, "ලැබෙන ආධාර")).toHaveText("කිසිවක් නැත");
  await expect(page.locator("dt", { hasText: "නිවාසගත කාණ්ඩය" })).toHaveCount(0);
  await expect(page.locator("dt", { hasText: "ළමා සංවර්ධන මධ්‍යස්ථාන" })).toHaveCount(0);
});
