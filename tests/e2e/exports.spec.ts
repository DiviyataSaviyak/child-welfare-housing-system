import { expect, type Page, test } from "@playwright/test";
import ExcelJS from "exceljs";
import {
  allocateAndRelease,
  AWAITING,
  fillCase,
  newSavedCase,
  openAs,
  randomNic,
  saveNew,
  TODAY,
} from "./case-helpers";
import { chooseLanguage, signInAs, TEST_CASE_NAME } from "./helpers";

/** Screen and file text the test looks for (messages/si.json). */
const EXPORT = "එක්සෙල් ගොනුවක් ලෙස බාගන්න";
const FILE_NAME = /^දිවියට සවියක් ලැයිස්තුව \d{4}-\d{2}-\d{2}\.xlsx$/;
const HEADERS = ["ඉල්ලුම් අංකය", "කාණ්ඩය", "ආධාරය", "තත්ත්වය", "නම (අවදානම් දරුවන් සඳහා භාරකරුගේ නම)"];

/** Clicks the export button, named in the screen's language, and opens the file it downloads. */
async function exportList(page: Page, button = EXPORT) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: button }).click(),
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await download.path());
  const sheet = workbook.worksheets[0];
  // Two header rows: the progress groups stand over their columns.
  const rows = sheet.getSheetValues().slice(3) as unknown[][];
  return { fileName: download.suggestedFilename(), sheet, rows: rows.map((row) => row.slice(1, 6)) };
}

/** The file's one case, by the header over each column: the second header row names every column. */
async function exportedCase(page: Page, button = EXPORT): Promise<Map<string, unknown>> {
  const { sheet } = await exportList(page, button);
  expect(sheet.rowCount).toBe(3);
  // ExcelJS numbers columns from 1, so each row's values start with an empty slot.
  const values = sheet.getRow(3).values as unknown[];
  const cells = new Map<string, unknown>();
  sheet.getRow(2).eachCell((cell, column) => cells.set(String(cell.value), values[column] ?? null));
  return cells;
}

test("AC-64: the Excel file has the registration form's details and a land case's amounts, in Sinhala and English", async ({
  page: ds,
  browser,
}) => {
  test.setTimeout(240_000);
  await signInAs(ds, "ds0101", /\/ds$/);
  const ho = await openAs(browser, "ho0001");
  const district = await openAs(browser, "dt0103");

  // A care leaver to buy land only, with two centres, the second with its dates, and two aids, one typed.
  const name = `${TEST_CASE_NAME} එක්සෙල් ඉඩම ${Date.now()}`;
  const nic = randomNic();
  await ds.goto("/ds/cases/new");
  await fillCase(ds, { name, nic, kind: "LAND_ONLY" });
  await ds.getByLabel("ඉඩම පිහිටි ග්‍රාම නිලධාරී වසම").fill("පරීක්ෂණ වසම");
  await ds.getByRole("button", { name: "තවත් මධ්‍යස්ථානයක් එක් කරන්න" }).click();
  const second = ds.getByRole("region", { name: "මධ්‍යස්ථානය 2", exact: true });
  await second.getByLabel("මධ්‍යස්ථානයේ නම *").fill("දෙවන ළමා නිවාසය");
  await second.getByLabel("පළාත *").selectOption({ label: "මධ්‍යම" });
  const from = second.getByRole("group", { name: "සිට" });
  await from.getByLabel("වර්ෂය").fill("2015");
  await from.getByLabel("මාසය").selectOption({ label: "මාර්තු" });
  await second.getByRole("group", { name: "දක්වා" }).getByLabel("වර්ෂය").fill("2019");
  await ds.getByRole("checkbox", { name: "සමෘද්ධි" }).check();
  await ds.getByRole("checkbox", { name: "වෙනත්" }).check();
  await ds.getByLabel("වෙනත් ආධාරයේ නම *").fill("ගම් ආධාර");
  const { url } = await saveNew(ds, "ds");
  const caseId = url.split("/").at(-1) ?? "";

  // INS-7: released to the DS, which pays Rs. 850,000 for the land.
  await allocateAndRelease(ho, district, { caseId, name }, "හෝමාගම", `AC-64-${Date.now()}`);
  await ds.goto(url);
  const money = ds.getByRole("region", { name: "මූල්‍ය ප්‍රගතිය" });
  await money.getByRole("button", { name: "ගෙවීම ආරම්භ කරන්න" }).click();
  const start = ds.getByRole("dialog", { name: "පළමු වාරිකය: ගෙවීම ආරම්භ කරන්න" });
  await start.getByLabel("වාරිකයේ මුදල (රු.) *").fill("850000");
  await start.getByLabel("ගෙවීමට බලාපොරොත්තු වන දිනය *").fill(TODAY);
  await start.getByRole("button", { name: "සුරකින්න" }).click();
  await expect(ds).toHaveURL(`${url}?notice=started`);
  await money.getByRole("button", { name: "ගෙවූ බව සටහන් කරන්න" }).click();
  await ds
    .getByRole("dialog", { name: "පළමු වාරිකය ගෙවූ බව සටහන් කරන්න" })
    .getByRole("button", { name: "සුරකින්න" })
    .click();
  await expect(ds).toHaveURL(`${url}?notice=paid`);
  const shownToday = TODAY.replaceAll("-", ".");

  // EXP-1: in Sinhala.
  await ds.goto(`/ds?q=${nic}`);
  const si = await exportedCase(ds);
  expect((si.get("උපන් දිනය (අවදානම් දරුවන් සඳහා දරුවාගේ උපන් දිනය)") as Date).toISOString()).toMatch(/^2006-08-21/);
  expect(Object.fromEntries([...si].filter(([header]) => SI_COLUMNS.includes(header)))).toEqual({
    ආධාරය: "ඉඩමක් පමණක්",
    "නිවාසගත කාණ්ඩය": "වයස 18 පිරී සමාජගත වූ",
    "විවාහක / අවිවාහක බව": "අවිවාහක",
    "දරුවාට ඇති ඥාතීත්වය": null,
    "ළමා සංවර්ධන මධ්‍යස්ථාන": "පරීක්ෂණ ළමා නිවාසය, බස්නාහිර\nදෙවන ළමා නිවාසය, මධ්‍යම (2015.03 – 2019)",
    "පවුලේ සාමාජිකයින් ගණන": 4,
    "ආබාධිත ළමයින් සිටීද?": "නැත",
    "ලැබෙන ආධාර": "සමෘද්ධි, වෙනත්: ගම් ආධාර",
    "ඉඩමේ ග්‍රාම නිලධාරී වසම": "පරීක්ෂණ වසම",
    "පළමු වාරිකය": `${shownToday} දින රු. 850,000 ගෙවා ඇත`,
    "දෙවන වාරිකය": null,
  });

  // And in English: the labels and the provinces in the file's language, what was typed as typed.
  await chooseLanguage(ds, "English");
  const en = await exportedCase(ds, "Download as an Excel file");
  expect(Object.fromEntries([...en].filter(([header]) => EN_COLUMNS.includes(header)))).toEqual({
    Assistance: "Land only",
    "Care leaver group": "Left care at 18, now living in society",
    "Marital status": "Unmarried",
    "Relationship to the child": null,
    "Child development centres": "පරීක්ෂණ ළමා නිවාසය, Western\nදෙවන ළමා නිවාසය, Central (2015.03 – 2019)",
    "Family members": 4,
    "Children with disabilities?": "No",
    "Aid received": "Samurdhi, Other: ගම් ආධාර",
    "The land's GN division": "පරීක්ෂණ වසම",
    "First installment": `Rs. 850,000 paid on ${shownToday}`,
    "Second installment": null,
  });
  // A case entered before change 0007 leaves these columns empty, and asks for its new details on its next
  // save: src/server/exports/case-list.db.test.ts and src/server/cases/cases.db.test.ts (AC-64).

  for (const page of [ho, district]) await page.context().close();
});

/** The columns AC-64 reads, in each language (messages/si.json and en.json). */
const SI_COLUMNS = [
  "ආධාරය",
  "නිවාසගත කාණ්ඩය",
  "විවාහක / අවිවාහක බව",
  "දරුවාට ඇති ඥාතීත්වය",
  "ළමා සංවර්ධන මධ්‍යස්ථාන",
  "පවුලේ සාමාජිකයින් ගණන",
  "ආබාධිත ළමයින් සිටීද?",
  "ලැබෙන ආධාර",
  "ඉඩමේ ග්‍රාම නිලධාරී වසම",
  "පළමු වාරිකය",
  "දෙවන වාරිකය",
];
const EN_COLUMNS = [
  "Assistance",
  "Care leaver group",
  "Marital status",
  "Relationship to the child",
  "Child development centres",
  "Family members",
  "Children with disabilities?",
  "Aid received",
  "The land's GN division",
  "First installment",
  "Second installment",
];

test("the DS officer and the Ministry take their lists to Excel, with the screen's search and filters (EXP-1)", async ({
  page,
  browser,
}) => {
  test.slow();
  await signInAs(page, "ds0101", /\/ds$/);
  const name = `${TEST_CASE_NAME} එක්සෙල් ${Date.now()}`;
  const nic = randomNic();
  const { number } = await newSavedCase(page, { name, nic });
  const row = [number, "නිවාසගත", "නව නිවසක්", AWAITING, name];

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

  // The Ministry's list, with its filters.
  const ho = await openAs(browser, "ho0001");
  await ho.goto(`/ministry/cases?q=${nic}&status=AWAITING_ALLOCATION`);
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
