import { type Browser, expect, type Page } from "@playwright/test";
import { signInAs, TEST_CASE_NAME } from "./helpers";

/** Screen text the case tests look for (messages/si.json). */
export const SAVE = "සුරකින්න";
export const CONFIRM = "ඔව්, සුරකින්න";
export const AWAITING = "ප්‍රතිපාදන මුදා හැරීමට ඇත";
export const YEAR = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric" }).format(new Date());
/** Today in Colombo as a date field takes it, "YYYY-MM-DD". */
export const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date());

/** A made-up 12-digit NIC (SEC-11), different in every test. */
export function randomNic(): string {
  return `2${Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join("")}`;
}

/** A made-up Application Number (CASE-12), different in every test. */
export function randomApplicationNumber(): string {
  return `E2E/${Date.now()}/${Math.floor(Math.random() * 1000)}`;
}

export type CaseInput = { name: string; nic: string; atRisk?: boolean; applicationNumber?: string };

/** Fills in a complete case, built in the DS division of residence (CASE-13). */
export async function fillCase(page: Page, input: CaseInput) {
  await page.getByRole("radio", { name: input.atRisk ? /^අවදානම් දරුවන්/ : /^නිවාසගත/ }).check();
  await page.getByRole("radio", { name: /^නව නිවසක් ඉදිකිරීම/ }).check();
  await page.getByLabel("ඉල්ලුම් අංකය *").fill(input.applicationNumber ?? randomApplicationNumber());
  if (input.atRisk) await page.getByLabel("දරුවාගේ නම *").fill("පරීක්ෂණ දරුවා");
  await page.getByLabel(input.atRisk ? "භාරකරුගේ නම *" : "නම *", { exact: true }).fill(input.name);
  await page.getByLabel(input.atRisk ? "භාරකරුගේ ජාතික හැඳුනුම්පත් අංකය" : "ජාතික හැඳුනුම්පත් අංකය").fill(input.nic);
  await page.getByLabel("ලිපිනය", { exact: true }).fill("නො. 1, පරීක්ෂණ පාර, නගරය");
  await page.getByLabel("දුරකතන අංකය", { exact: true }).fill("071 000 0401");
}

/**
 * Saves the filled form through the confirmation (CASE-5), and returns the new case's page and its
 * Application Number.
 */
export async function saveNew(page: Page, area: "ds" | "ministry"): Promise<{ url: string; number: string }> {
  await page.getByRole("button", { name: SAVE, exact: true }).click();
  await expect(page.getByRole("heading", { name: "මෙම ප්‍රතිලාභියා සුරකින්නද?" })).toBeVisible();
  await page.getByRole("button", { name: CONFIRM }).click();
  await expect(page).toHaveURL(new RegExp(`/${area}/cases/[0-9a-f-]{36}\\?notice=created$`));
  return { url: page.url().split("?")[0] ?? "", number: await page.getByTestId("case-number").innerText() };
}

/** Enters and saves a complete case as the signed-in DS officer. */
export async function newSavedCase(page: Page, input: CaseInput) {
  await page.goto("/ds/cases/new");
  await fillCase(page, input);
  return saveNew(page, "ds");
}

/** A second person's browser window, beside the first, signed in and on their home page. */
export async function asUser(browser: Browser, username: string, run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "si-LK" });
  try {
    const page = await context.newPage();
    await signInAs(page, username, username.startsWith("ho") ? /\/ministry$/ : /\/ds$/);
    await run(page);
  } finally {
    await context.close();
  }
}

/** A signed-in window kept open for the whole test, for back-and-forth between two people. */
export async function openAs(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "si-LK" });
  const page = await context.newPage();
  await signInAs(page, username, username.startsWith("ho") ? /\/ministry$/ : /\/ds$/);
  return page;
}

/**
 * On the letters screen, with a district's allocation letter open (REL-2): ticks only the named cases,
 * then records the letter under this number, dated today. Other tests' cases may wait in the same
 * district, so every other box is unticked first.
 */
export async function recordLetterFor(ho: Page, names: string[], letterNumber: string) {
  // The letter's section is named after its district; find it by its list of cases.
  const letter = ho.getByRole("region").filter({ has: ho.getByRole("group", { name: "ලිපියේ ප්‍රතිලාභීන්" }) });
  const boxes = letter.getByRole("checkbox");
  await expect(boxes.first()).toBeVisible();
  for (const box of await boxes.all()) await box.uncheck();
  for (const name of names) await letter.getByRole("checkbox", { name: new RegExp(name) }).check();
  await letter.getByLabel("මගේ අංකය *").fill(letterNumber);
  await letter.getByRole("button", { name: /^ලිපිය සටහන් කරන්න · / }).click();
  await expect(ho).toHaveURL(/\/ministry\/release\?notice=letterRecorded&letter=[\w-]+&districtId=\d+$/);
  await expect(ho.getByRole("status")).toContainText(`ලිපිය ${letterNumber} සටහන් කළා`);
}

/**
 * A case of the DS officer's office, released today on its district's allocation letter, which the
 * Ministry opens from the case's own page: ready for its installments and building progress (Phase 6).
 * Nobody checks it first (change 0006).
 */
export async function releasedCase(ds: Page, ho: Page, label: string) {
  const name = `${TEST_CASE_NAME} ${label} ${Date.now()}`;
  const { url, number } = await newSavedCase(ds, { name, nic: randomNic() });
  const caseId = url.split("/").at(-1) ?? "";
  await ho.goto(`/ministry/cases/${caseId}`);
  await ho.getByRole("link", { name: "ලිපිය සටහන් කිරීමට යන්න →" }).click();
  await recordLetterFor(ho, [name], `MWCA/E2E/${label}`);
  return { caseId, url, name, number };
}
