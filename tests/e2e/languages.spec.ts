import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { asUser, newSubmittedCase, randomNic } from "./case-helpers";
import { chooseLanguage, screenText, signInAs, TEST_CASE_NAME } from "./helpers";

/** UI-9: the screens come in Sinhala, Tamil and English. Each browser keeps its own choice. */

const SINHALA = /\p{Script=Sinhala}/u;
const TAMIL = /\p{Script=Tamil}/u;
const LATIN = /[A-Za-z]/;

test("the sign-in page offers Sinhala, Tamil and English, and the browser keeps the choice", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("පද්ධතියට ඇතුළු වන්න");

  await chooseLanguage(page, "தமிழ்");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("முறைமைக்குள் உள்நுழைக");
  await expect(page.getByLabel("பயனர் பெயர்")).toBeVisible();
  const tamil = await screenText(page);
  expect(tamil).not.toMatch(LATIN);
  expect(tamil).not.toMatch(SINHALA);

  // Kept after a reload: the choice is the browser's.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ta");

  await chooseLanguage(page, "English");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to the system");
  const english = await screenText(page);
  expect(english).not.toMatch(SINHALA);
  expect(english).not.toMatch(TAMIL);

  await chooseLanguage(page, "සිංහල");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("පද්ධතියට ඇතුළු වන්න");
});

test("a DS officer works in Tamil: the menu, the office's name and the money are in Tamil", async ({ page }) => {
  await signInAs(page, "ds0101", /\/ds$/);
  await chooseLanguage(page, "தமிழ்");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("எனது பயனாளிகள்");
  await expect(page.getByRole("banner")).toContainText("ஹோமாகம பிரதேச செயலகம்");
  await expect(page.getByRole("link", { name: "எனது பயனாளிகள்" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("கொழும்பு மாவட்டம்")).toBeVisible();
  // Names and other details the officers typed stay as typed; the screen's own text has no Latin letters.
  expect(await screenText(page)).not.toMatch(LATIN);

  // The choice stays while moving around.
  await page.getByRole("link", { name: "புதிய பயனாளியைச் சேர்த்தல்" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("புதிய பயனாளியைச் சேர்த்தல்");
});

test("Head Office works in English, and its Excel file comes in English", async ({ page, browser }) => {
  test.slow();
  // A case of its own, so the list has something to export. Typed details stay as typed.
  const name = `${TEST_CASE_NAME} English ${Date.now()}`;
  const nic = randomNic();
  await asUser(browser, "ds0101", (ds) => newSubmittedCase(ds, { name, nic }).then(() => undefined));

  await signInAs(page, "ho0001", /\/ho$/);
  await chooseLanguage(page, "English");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Summary");
  const menu = await page.getByRole("navigation", { name: "Main menu" }).innerText();
  expect(menu).not.toMatch(SINHALA);
  expect(menu).not.toMatch(TAMIL);
  await expect(page.getByRole("banner")).toContainText("Head Office");
  // Districts carry their English names.
  await expect(page.getByRole("link", { name: "Colombo", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Beneficiaries", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Beneficiaries");
  await page.goto(`/ho/cases?q=${nic}`);
  await expect(page.getByText("Matching beneficiaries: 1")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: name })).toContainText("Sent for checking");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download as an Excel file" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^Diviyata Saviyak list \d{4}-\d{2}-\d{2}\.xlsx$/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await download.path());
  const sheet = workbook.worksheets[0];
  expect(sheet.name).toBe("Beneficiaries");
  expect(sheet.getRow(1).getCell(1).value).toBe("Registration number");
  expect((sheet.getRow(3).values as unknown[]).slice(2, 6)).toEqual([
    "Care leaver",
    "New house",
    "Sent for checking",
    name,
  ]);
});
