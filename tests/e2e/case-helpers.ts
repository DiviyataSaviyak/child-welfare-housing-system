import { type Browser, expect, type Page } from "@playwright/test";
import { signInAs, TEST_CASE_NAME } from "./helpers";

/** Screen text the case tests look for (messages/si.json). */
export const SAVE = "සුරකින්න";
export const CONFIRM = "ඔව්, සුරකින්න";
export const AWAITING = "ප්‍රතිපාදන මුදා හැරීමට ඇත";
/** The statuses a case has around installment 1 (INS-5). */
export const RECEIVED = "ප්‍රතිපාදන ලැබී ඇත";
export const IN_PROGRESS = "වැඩ සිදුවෙමින්";
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

/** The kinds of help as the form names them (CASE-17). */
export const KIND = {
  NEW_HOUSE: "නව නිවසක් ඉදිකිරීම",
  RENOVATION: "නිවස අලුත්වැඩියා කිරීම",
  LAND_ONLY: "ඉඩමක් පමණක් මිලදී ගැනීම",
  LAND_AND_BUILD: "ඉඩමක් මිලදී ගෙන නිවසක් ඉදිකිරීම",
  LAND_WITH_HOUSE: "ඉඩමක් සහ නිවසක් එකවර මිලදී ගැනීම",
} as const;
export type KindName = keyof typeof KIND;

export type CaseInput = { name: string; nic: string; atRisk?: boolean; applicationNumber?: string; kind?: KindName };

/**
 * Fills in a complete case, built in the DS division of residence (CASE-13), with change 0007's required
 * details (CASE-14 to CASE-16): a care leaver who left care, with one centre, or a child at risk and their
 * mother; a family of four with no children with disabilities. A new house unless `kind` says otherwise.
 */
export async function fillCase(page: Page, input: CaseInput) {
  await page.getByRole("radio", { name: input.atRisk ? /^අවදානම් දරුවන්/ : /^නිවාසගත/ }).check();
  if (!input.atRisk) await page.getByRole("radio", { name: /^වයස 18 පිරී සමාජගත වූ/ }).check();
  await page.getByRole("radio", { name: new RegExp(`^${KIND[input.kind ?? "NEW_HOUSE"]}`) }).check();
  await page.getByLabel("ඉල්ලුම් අංකය *").fill(input.applicationNumber ?? randomApplicationNumber());
  if (input.atRisk) {
    await page.getByLabel("දරුවාගේ නම *").fill("පරීක්ෂණ දරුවා");
    await page.getByLabel("දරුවාගේ උපන් දිනය *").fill("2012-04-03");
  } else {
    await page.getByLabel("උපන් දිනය *", { exact: true }).fill("2006-08-21");
  }
  await page.getByLabel(input.atRisk ? "භාරකරුගේ නම *" : "නම *", { exact: true }).fill(input.name);
  if (input.atRisk) await page.getByRole("radio", { name: "මව", exact: true }).check();
  else await page.getByRole("radio", { name: "අවිවාහක", exact: true }).check();
  await page.getByLabel(input.atRisk ? "භාරකරුගේ ජාතික හැඳුනුම්පත් අංකය" : "ජාතික හැඳුනුම්පත් අංකය").fill(input.nic);
  await page.getByLabel("ලිපිනය", { exact: true }).fill("නො. 1, පරීක්ෂණ පාර, නගරය");
  await page.getByLabel("දුරකතන අංකය", { exact: true }).fill("071 000 0401");
  if (!input.atRisk) {
    await page.getByLabel("මධ්‍යස්ථානයේ නම *").first().fill("පරීක්ෂණ ළමා නිවාසය");
    await page.getByLabel("පළාත *").first().selectOption({ label: "බස්නාහිර" });
  }
  await page.getByLabel("පවුලේ සාමාජිකයින් ගණන *").fill("4");
  await page.getByRole("radio", { name: "නැත", exact: true }).check();
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

/** Where each sample account lands after signing in. */
function landing(username: string): RegExp {
  if (username.startsWith("ho")) return /\/ministry$/;
  if (username.startsWith("ad")) return /\/admin\/users$/;
  if (username.startsWith("dt") || username.startsWith("pv") || username.startsWith("pd")) return /\/oversight$/;
  return /\/ds$/;
}

/** A second person's browser window, beside the first, signed in and on their home page. */
export async function asUser(browser: Browser, username: string, run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "si-LK" });
  try {
    const page = await context.newPage();
    await signInAs(page, username, landing(username));
    await run(page);
  } finally {
    await context.close();
  }
}

/** A signed-in window kept open for the whole test, for back-and-forth between two people. */
export async function openAs(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "si-LK" });
  const page = await context.newPage();
  await signInAs(page, username, landing(username));
  return page;
}

/**
 * On the allocation screen, with a district's allocation letter open (REL-2): ticks only the named cases,
 * then records the letter under this number, dated today. Nothing is ticked to start with, and other
 * tests' cases may wait in the same district, so only the named boxes are ticked.
 */
export async function recordLetterFor(ho: Page, names: string[], letterNumber: string) {
  // The letter's section is named after its district; find it by its list of cases.
  const letter = ho.getByRole("region").filter({ has: ho.getByRole("group", { name: "ලිපියේ ප්‍රතිලාභීන්" }) });
  const boxes = letter.getByRole("checkbox");
  await expect(boxes.first()).toBeVisible();
  for (const box of await boxes.all()) await expect(box).not.toBeChecked();
  for (const name of names) await letter.getByRole("checkbox", { name: new RegExp(name) }).check();
  await letter.getByLabel("මගේ අංකය *").fill(letterNumber);
  await letter.getByRole("button", { name: /^ලිපිය සටහන් කරන්න · / }).click();
  await expect(ho).toHaveURL(/\/ministry\/allocate\?notice=letterRecorded&letter=[\w-]+&districtId=\d+$/);
  await expect(ho.getByRole("status")).toContainText(`ලිපිය ${letterNumber} සටහන් කළා`);
}

/**
 * On a DS office's release form (REL-6), as the District CRPO: ticks only the named cases, then records the
 * release under this reference, dated today. Nothing is ticked to start with, and other tests' cases may
 * wait for the same office, so only the named boxes are ticked.
 */
export async function recordDsReleaseFor(district: Page, names: string[], reference: string) {
  const form = district.getByRole("group", { name: "මුදා හරින ප්‍රතිලාභීන්" });
  const boxes = form.getByRole("checkbox");
  await expect(boxes.first()).toBeVisible();
  for (const box of await boxes.all()) await expect(box).not.toBeChecked();
  for (const name of names) await form.getByRole("checkbox", { name: new RegExp(name) }).check();
  await district.getByLabel("යොමු අංකය *").fill(reference);
  await district.getByRole("button", { name: /^මුදා හැරීම සටහන් කරන්න · / }).click();
  await expect(district).toHaveURL(/\/oversight\/release\?notice=released&release=[\w-]+$/);
  await expect(district.getByRole("status")).toContainText(`මුදා හැරීම ${reference} සටහන් කළා`);
}

/**
 * A saved case allocated today on its district's allocation letter, which the Ministry opens from the case's
 * own page, then released to its DS office (named as the release screen names it, such as "හෝමාගම") by the
 * District CRPO from the release screen: its allocation received (REL-2, REL-6).
 */
export async function allocateAndRelease(
  ho: Page,
  district: Page,
  saved: { caseId: string; name: string },
  office: string,
  label: string,
) {
  await ho.goto(`/ministry/cases/${saved.caseId}`);
  await ho.getByRole("link", { name: "ලිපිය සටහන් කිරීමට යන්න →" }).click();
  await recordLetterFor(ho, [saved.name], `MWCA/E2E/${label}`);
  await district.goto("/oversight/release");
  await district.getByRole("link", { name: new RegExp(`^${office} ප්‍රා\\.ලේ\\. කාර්යාලය`) }).click();
  await recordDsReleaseFor(district, [saved.name], `DS/E2E/${label}`);
}

/**
 * A case of Homagama (ds0101), a new house unless `kind` says otherwise, allocated and released to the DS
 * (`allocateAndRelease`): its allocation received, ready for its installments and building progress (INS-5,
 * STG-5).
 */
export async function releasedCase(ds: Page, ho: Page, district: Page, label: string, kind?: KindName) {
  const name = `${TEST_CASE_NAME} ${label} ${Date.now()}`;
  const { url, number } = await newSavedCase(ds, { name, nic: randomNic(), kind });
  const caseId = url.split("/").at(-1) ?? "";
  await allocateAndRelease(ho, district, { caseId, name }, "හෝමාගම", label);
  return { caseId, url, name, number };
}
