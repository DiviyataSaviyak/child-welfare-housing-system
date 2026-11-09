import { expect, type Page, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { newSubmittedCase, openAs, randomNic, SUBMITTED } from "./case-helpers";
import { signInAs, TEST_CASE_NAME } from "./helpers";

/** Screen and file text the test looks for (messages/si.json). */
const EXPORT = "එක්සෙල් ගොනුවක් ලෙස බාගන්න";
const FILE_NAME = /^දිවියට සවියක් ලැයිස්තුව \d{4}-\d{2}-\d{2}\.xlsx$/;
const HEADERS = ["ලියාපදිංචි අංකය", "කාණ්ඩය", "ආධාරය", "තත්ත්වය", "නම (අවදානම් දරුවන් සඳහා භාරකරුගේ නම)"];

/** Clicks the export button and opens the file it downloads. */
async function exportList(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: EXPORT }).click(),
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await download.path());
  const sheet = workbook.worksheets[0];
  // Two header rows: the progress groups stand over their columns.
  const rows = sheet.getSheetValues().slice(3) as unknown[][];
  return { fileName: download.suggestedFilename(), sheet, rows: rows.map((row) => row.slice(1, 6)) };
}

test("the DS officer and Head Office take their lists to Excel, with the screen's search and filters (EXP-1)", async ({
  page,
  browser,
}) => {
  test.slow();
  await signInAs(page, "ds0101", /\/ds$/);
  const name = `${TEST_CASE_NAME} එක්සෙල් ${Date.now()}`;
  const nic = randomNic();
  const { number } = await newSubmittedCase(page, { name, nic });
  const row = [number, "නිවාසගත", "නව නිවසක්", SUBMITTED, name];

  // The DS officer's own list, with the search the screen shows.
  await page.goto("/ds");
  await page.getByRole("searchbox").fill(nic);
  await page.getByRole("button", { name: "සොයන්න" }).click();
  await expect(page).toHaveURL(new RegExp(`/ds\\?q=${nic}$`));
  const own = await exportList(page);
  expect(own.fileName).toMatch(FILE_NAME);
  expect(own.sheet.name).toBe("ප්‍රතිලාභීන්");
  expect((own.sheet.getRow(1).values as unknown[]).slice(1, 6)).toEqual(HEADERS);
  expect(own.rows).toEqual([row]);

  // Head Office's list, with its filters.
  const ho = await openAs(browser, "ho0001");
  await ho.goto(`/ministry/cases?q=${nic}&status=SUBMITTED`);
  await expect(ho.getByText("ගැළපෙන ප්‍රතිලාභීන් 1")).toBeVisible();
  const all = await exportList(ho);
  expect(all.fileName).toMatch(FILE_NAME);
  expect(all.rows).toEqual([row]);

  // Each list's file belongs to its own role (PRM-1).
  expect((await page.request.get("/ministry/cases/export")).status()).toBe(404);
  expect((await ho.request.get("/ds/export")).status()).toBe(404);
  await ho.context().close();
});

test("an admin can't export any list (PRM-2, AC-2)", async ({ page }) => {
  await signInAs(page, "ad0001", /\/admin\/users$/);
  for (const path of ["/ministry/cases/export", "/ds/export"])
    expect((await page.request.get(path)).status()).toBe(404);
});
