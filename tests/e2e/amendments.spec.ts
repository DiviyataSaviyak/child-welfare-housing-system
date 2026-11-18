import { expect, type Page, test } from "@playwright/test";
import ExcelJS from "exceljs";
import {
  AWAITING,
  fillCase,
  newSavedCase,
  openAs,
  RECEIVED,
  randomApplicationNumber,
  randomNic,
  recordDsReleaseFor,
  recordLetterFor,
  releasedCase,
  TODAY,
} from "./case-helpers";
import { chooseLanguage, randomLetters, signInAs, TEST_CASE_NAME } from "./helpers";

/**
 * Change 0008: amendments (AMD-1 to AMD-10) in the browser. The rules each screen relies on, and the refusals
 * of direct requests to the server, are in the database tests (src/server/amendments/amendments.db.test.ts)
 * and tests/security/access.test.ts; the period and the Excel file's filters (AC-70) in exports.spec.ts.
 */
test("AMD-1, AMD-3: a CRPO proposes another beneficiary, and the case shows the amendment waiting", async ({
  page,
  browser,
}) => {
  // Two case forms and a summary: longer than the default on a slow machine.
  test.setTimeout(120_000);
  await signInAs(page, "ds0101", /\/ds$/);
  // Digits, so the letter form's row is this case's alone.
  const existing = `${TEST_CASE_NAME} පවතින ${String(Date.now()).slice(-6)}`;
  const { url, number } = await newSavedCase(page, { name: existing, nic: randomNic() });
  await page.goto(url);

  // AMD-1: the action is on the case page, and the form names the existing beneficiary above it.
  await page.getByRole("link", { name: "සංශෝධනයක් ඉදිරිපත් කරන්න" }).click();
  // The new page's first compile on a cold dev server can take a while.
  await expect(page).toHaveURL(/\/ds\/cases\/[0-9a-f-]{36}\/amend$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "වෙනත් ප්‍රතිලාභියෙකු යෝජනා කිරීම" })).toBeVisible();
  await expect(page.getByTestId("existing-beneficiary")).toHaveText(existing);

  // The reason is required (AMD-1).
  const newcomer = `${TEST_CASE_NAME} නව`;
  const newNumber = randomApplicationNumber();
  await fillCase(page, { name: newcomer, nic: randomNic(), applicationNumber: newNumber });
  await page.getByRole("button", { name: "සංශෝධනයක් ඉදිරිපත් කරන්න" }).click();
  await expect(page.locator("#case-errors")).toContainText("සංශෝධනයට හේතුව ඇතුළත් කරන්න.");

  // The summary shows both beneficiaries and the reason before anything is sent (CASE-5).
  await page.getByLabel("සංශෝධනයට හේතුව", { exact: true }).fill("ඉඩමේ අයිතිය පිළිබඳ ගැටලුවක් ඇත");
  await page.getByRole("button", { name: "සංශෝධනයක් ඉදිරිපත් කරන්න" }).click();
  const summary = page.getByRole("dialog");
  await expect(summary.getByRole("heading", { name: "සංශෝධනය අමාත්‍යාංශයට යවන්නද?" })).toBeVisible();
  await expect(summary).toContainText(`${existing} (${number})`);
  await expect(summary).toContainText(newcomer);
  await expect(summary).toContainText("ඉඩමේ අයිතිය පිළිබඳ ගැටලුවක් ඇත");
  await summary.getByRole("button", { name: "අමාත්‍යාංශයට යවන්න" }).click();

  // Back on the case page: the existing beneficiary is unchanged, with the amendment waiting (AMD-3).
  await expect(page).toHaveURL(`${url}?notice=amendmentSubmitted`);
  await expect(page.getByText("සංශෝධනය අනුමැතිය සඳහා අමාත්‍යාංශයට යවන ලදී.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(existing);
  const box = page.getByTestId("amendment-waiting");
  await expect(box).toContainText("සංශෝධනයක් අනුමැතිය සඳහා ඇත");
  await expect(box).toContainText(`${newcomer} (${newNumber})`);
  // No second amendment, and no deleting it, while it waits (AMD-3, CASE-8).
  await expect(page.getByRole("link", { name: "සංශෝධනයක් ඉදිරිපත් කරන්න" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "මකන්න" })).toHaveCount(0);
  // The history says it was submitted, with its reason (AMD-1).
  await expect(page.getByText(`මෙම ප්‍රතිලාභියා වෙනුවට ${newcomer} (${newNumber}) යෝජනා කළා`)).toBeVisible();

  // The amendment page can't be opened again for it.
  await page.goto(`${url}/amend`);
  await expect(page).toHaveURL(url);

  // AC-47: the Ministry's letter form flags the case while its amendment waits.
  const ho = await openAs(browser, "ho0001");
  await ho.goto(url.replace("/ds/", "/ministry/"));
  await ho.getByRole("link", { name: "ලිපිය සටහන් කිරීමට යන්න →" }).click();
  await expect(ho.locator("label").filter({ hasText: existing })).toContainText("සංශෝධනයක් අනුමැතිය සඳහා ඇත");
  await ho.context().close();
});

/** On the DS's case page: proposes `newcomer` in the beneficiary's place, with a reason, and sends it. */
async function propose(page: Page, url: string, newcomer: string, applicationNumber: string) {
  await page.goto(url);
  await page.getByRole("link", { name: "සංශෝධනයක් ඉදිරිපත් කරන්න" }).click();
  await expect(page).toHaveURL(/\/amend$/, { timeout: 60_000 });
  await fillCase(page, { name: newcomer, nic: randomNic(), applicationNumber });
  await page.getByLabel("සංශෝධනයට හේතුව", { exact: true }).fill("ඉඩමේ අයිතිය පිළිබඳ ගැටලුවක් ඇත");
  await page.getByRole("button", { name: "සංශෝධනයක් ඉදිරිපත් කරන්න" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "අමාත්‍යාංශයට යවන්න" }).click();
  await expect(page).toHaveURL(`${url}?notice=amendmentSubmitted`);
}

test("AMD-4 to AMD-6: the Ministry rejects an amendment with a reason, then approves another", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await signInAs(page, "ds0101", /\/ds$/);
  const existing = `${TEST_CASE_NAME} පවතින ${randomLetters(4)}`;
  const existingNic = randomNic();
  const { url, number } = await newSavedCase(page, { name: existing, nic: existingNic });
  const caseId = url.split("/").pop() ?? "";
  const first = `${TEST_CASE_NAME} ප්‍රතික්ෂේපිත`;
  await propose(page, url, first, randomApplicationNumber());

  // AMD-4: the Ministry opens it from the case page, and sees both beneficiaries side by side.
  const ho = await openAs(browser, "ho0001");
  await ho.goto(`/ministry/cases/${caseId}`);
  await ho.getByTestId("amendment-waiting").getByRole("link", { name: "සංශෝධනය විවෘත කරන්න" }).click();
  await expect(ho).toHaveURL(/\/ministry\/amendments\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(ho.getByRole("heading", { level: 1 })).toHaveText("සංශෝධනය");
  await expect(ho.getByText("අනුමැතිය සඳහා ඉදිරිපත් කළ", { exact: true })).toBeVisible();
  await expect(ho.getByTestId("existing-beneficiary")).toContainText(existing);
  await expect(ho.getByTestId("new-beneficiary")).toContainText(first);
  await expect(ho.getByTestId("amendment-reason")).toContainText("ඉඩමේ අයිතිය පිළිබඳ ගැටලුවක් ඇත");

  // AMD-6: rejecting needs a reason, which the DS then sees.
  await ho.getByRole("button", { name: "ප්‍රතික්ෂේප කරන්න" }).click();
  const reject = ho.getByRole("dialog");
  await reject.getByLabel("ප්‍රතික්ෂේප කිරීමට හේතුව *").fill("ඉඩම් ඔප්පුව අමුණා නැත.");
  await reject.getByRole("button", { name: "ප්‍රතික්ෂේප කරන්න" }).click();
  await expect(ho).toHaveURL(/\?notice=rejected$/);
  await expect(ho.getByText("ප්‍රතික්ෂේප කළ", { exact: true })).toBeVisible();
  await expect(ho.getByTestId("rejection-reason")).toContainText("ඉඩම් ඔප්පුව අමුණා නැත.");
  await expect(ho.getByRole("button", { name: "අනුමත කරන්න" })).toHaveCount(0);

  await page.goto(url);
  const rejected = page.getByTestId("amendment-rejected");
  await expect(rejected).toContainText("ඉඩම් ඔප්පුව අමුණා නැත.");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(existing);

  // The DS sends another, and the Ministry approves it (AMD-5), asked once to confirm.
  const second = `${TEST_CASE_NAME} අනුමත ${randomLetters(4)}`;
  const secondNumber = randomApplicationNumber();
  await propose(page, url, second, secondNumber);
  await ho.goto(`/ministry/cases/${caseId}`);
  await ho.getByTestId("amendment-waiting").getByRole("link", { name: "සංශෝධනය විවෘත කරන්න" }).click();
  await expect(ho.getByTestId("new-beneficiary")).toContainText(second);
  await ho.getByRole("button", { name: "අනුමත කරන්න" }).click();
  const approve = ho.getByRole("dialog");
  await expect(approve).toContainText(`${existing} (${number})`);
  await approve.getByRole("button", { name: "අනුමත කරන්න" }).click();
  await expect(ho).toHaveURL(/\?notice=approved$/);
  await expect(ho.getByText("අනුමත කළ", { exact: true })).toBeVisible();

  // The new case awaits its allocation in the same DS, and names the one it replaced (AC-44).
  await ho.getByRole("link", { name: `${secondNumber} විවෘත කරන්න` }).click();
  await expect(ho.getByRole("heading", { level: 1 })).toHaveText(second);
  await expect(ho.getByText(AWAITING, { exact: true }).first()).toBeVisible();
  await expect(ho.getByText(`${number} (${existing}) වෙනුවට ඇතුළත් කළ ප්‍රතිලාභියෙකි`)).toBeVisible();

  // The existing case is replaced, links to the new one, and offers no action (AC-71).
  await page.goto(url);
  await expect(page.getByText("ප්‍රතිස්ථාපනය කළ", { exact: true })).toBeVisible();
  await expect(page.getByText(`මෙම ප්‍රතිලාභියා වෙනුවට ${secondNumber} (${second}) පත් විය`)).toBeVisible();
  await expect(page.getByRole("link", { name: "සංශෝධනයක් ඉදිරිපත් කරන්න" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "විස්තර සංස්කරණය කරන්න" })).toHaveCount(0);
  await ho.context().close();

  // AC-49: the replacement's row in the Excel file names the previous beneficiary and address in its Notes,
  // in the file's language, and never their NIC or Application Number.
  await page.goto(`/ds?q=${encodeURIComponent(secondNumber)}`);
  const si = await exportedCase(page, "එක්සෙල් ගොනුවක් ලෙස බාගන්න");
  expect(si.get("නම (අවදානම් දරුවන් සඳහා භාරකරුගේ නම)")).toBe(second);
  expect(si.get("සටහන්")).toBe(`පෙර ප්‍රතිලාභියා: ${existing}, නො. 1, පරීක්ෂණ පාර, නගරය`);
  await chooseLanguage(page, "English");
  const en = await exportedCase(page, "Download as an Excel file");
  expect(en.get("Notes")).toBe(`Previous beneficiary: ${existing}, නො. 1, පරීක්ෂණ පාර, නගරය`);
  const cells = JSON.stringify([...si.values(), ...en.values()]);
  expect(cells).not.toContain(existingNic);
  expect(cells).not.toContain(number);
});

/**
 * Downloads the list's Excel file, which holds one case, and gives its cells by the header over each column:
 * the second header row names every column, and the data starts on the third.
 */
async function exportedCase(page: Page, button: string): Promise<Map<string, unknown>> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: button }).click(),
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await download.path());
  const sheet = workbook.worksheets[0];
  expect(sheet.rowCount).toBe(3);
  const values = sheet.getRow(3).values as unknown[];
  const cells = new Map<string, unknown>();
  sheet.getRow(2).eachCell((cell, column) => cells.set(String(cell.value), values[column] ?? null));
  return cells;
}

/** The money panel of a DS case page, and its buttons (tests/e2e/progress.spec.ts). */
const money = (page: Page) => page.getByRole("region", { name: "මූල්‍ය ප්‍රගතිය" });
const START = "ගෙවීම ආරම්භ කරන්න";
const PAY = "ගෙවූ බව සටහන් කරන්න";

test("AC-45 to AC-47: an amendment of a case whose allocation was received holds its payments, then moves the allocation", async ({
  page,
  browser,
}) => {
  // A letter, a District release, two amendments and a payment: about 30 trips to the server.
  test.setTimeout(300_000);
  await signInAs(page, "ds0101", /\/ds$/);
  const ho = await openAs(browser, "ho0001");
  const district = await openAs(browser, "dt0103");
  // Digits, not letters: the rejection stays on the DS's to-do panel, which the smoke test reads (AC-20).
  const unique = String(Date.now()).slice(-6);
  const label = `සංශෝධන ${unique}`;
  const { caseId, url, name } = await releasedCase(page, ho, district, label);
  await page.goto(url);
  await expect(page.getByText(RECEIVED, { exact: true }).first()).toBeVisible();
  await expect(money(page).getByRole("button", { name: START })).toHaveCount(1);

  // AC-47: while the amendment waits, installment 1 can't start and no stage can be recorded.
  const first = `${TEST_CASE_NAME} ලැබූ ප්‍රතික්ෂේපිත ${unique}`;
  await propose(page, url, first, randomApplicationNumber());
  await expect(page.getByTestId("amendment-waiting")).toContainText(first);
  await expect(money(page).getByRole("button", { name: START })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "භෞතික ප්‍රගතිය යාවත්කාලීන කරන්න" })).toHaveCount(0);

  // The Ministry rejects it; the DS is told, and its to-do panel shows the reason (AMD-6, AMD-10).
  await ho.goto(`/ministry/cases/${caseId}`);
  await ho.getByTestId("amendment-waiting").getByRole("link", { name: "සංශෝධනය විවෘත කරන්න" }).click();
  await expect(ho).toHaveURL(/\/ministry\/amendments\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await ho.getByRole("button", { name: "ප්‍රතික්ෂේප කරන්න" }).click();
  await ho.getByRole("dialog").getByLabel("ප්‍රතික්ෂේප කිරීමට හේතුව *").fill("ඉඩම් ඔප්පුව අමුණා නැත.");
  await ho.getByRole("dialog").getByRole("button", { name: "ප්‍රතික්ෂේප කරන්න" }).click();
  await expect(ho).toHaveURL(/\?notice=rejected$/);
  await page.goto("/ds/notifications");
  await expect(page.getByText(`${name} වෙනුවට යෝජනා කළ සංශෝධනය ප්‍රතික්ෂේප කර ඇත`).first()).toBeVisible();
  await page.goto("/ds");
  const todo = page
    .getByRole("complementary", { name: "ඔබ කළ යුතු දේ" })
    .getByRole("listitem")
    .filter({ hasText: `${name}: සංශෝධනය ප්‍රතික්ෂේප කළා` });
  await expect(todo).toContainText("ඉඩම් ඔප්පුව අමුණා නැත.");

  // The existing beneficiary is unchanged, and the DS can pay again or send another amendment (AMD-6).
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(money(page).getByRole("button", { name: START })).toHaveCount(1);
  const second = `${TEST_CASE_NAME} ලැබූ අනුමත ${unique}`;
  const secondNumber = randomApplicationNumber();
  await propose(page, url, second, secondNumber);

  // AC-45: approved, the new beneficiary takes the allocation received, on the same letter and District
  // release, with four installments not started; the existing case holds no money.
  await ho.goto(`/ministry/cases/${caseId}`);
  await ho.getByTestId("amendment-waiting").getByRole("link", { name: "සංශෝධනය විවෘත කරන්න" }).click();
  await expect(ho.getByTestId("new-beneficiary")).toContainText(second);
  await ho.getByRole("button", { name: "අනුමත කරන්න" }).click();
  await ho.getByRole("dialog").getByRole("button", { name: "අනුමත කරන්න" }).click();
  await expect(ho).toHaveURL(/\?notice=approved$/);
  await ho.getByRole("link", { name: `${secondNumber} විවෘත කරන්න` }).click();
  await expect(ho.getByRole("heading", { level: 1 })).toHaveText(second);
  const newUrl = ho.url().replace("/ministry/", "/ds/").split("?")[0] ?? "";
  await ho.context().close();

  await page.goto(newUrl);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(second);
  await expect(page.getByText(RECEIVED, { exact: true }).first()).toBeVisible();
  await expect(money(page)).toContainText(`MWCA/E2E/${label}`);
  await expect(money(page)).toContainText(`DS/E2E/${label}`);
  await expect(money(page).getByText("තවම ආරම්භ කර නැත", { exact: true })).toHaveCount(4);
  await page.goto(url);
  await expect(page.getByText("ප්‍රතිස්ථාපනය කළ", { exact: true })).toBeVisible();
  // The allocation moved with the beneficiary, so the replaced case has no money panel at all.
  await expect(money(page)).toHaveCount(0);

  // AMD-10: the District CRPO, whose district holds the money, is told of the approval.
  await district.goto("/oversight/notifications");
  await expect(district.getByText(`සංශෝධනය අනුමත කළා: ${second} දැන් ප්‍රතිලාභියා වේ`).first()).toBeVisible();
  await district.context().close();

  // AC-46: once the new beneficiary's installment 1 is paid, no amendment can be proposed.
  await page.goto(newUrl);
  await expect(page.getByRole("link", { name: "සංශෝධනයක් ඉදිරිපත් කරන්න" })).toHaveCount(1);
  await money(page).getByRole("button", { name: START }).click();
  const start = page.getByRole("dialog", { name: `පළමු වාරිකය: ${START}` });
  await start.getByLabel("ගෙවීමට බලාපොරොත්තු වන දිනය *").fill(TODAY);
  await start.getByRole("button", { name: "සුරකින්න" }).click();
  await expect(page).toHaveURL(/\?notice=started$/);
  await money(page).getByRole("button", { name: PAY }).click();
  await page
    .getByRole("dialog", { name: `පළමු වාරිකය ${PAY}` })
    .getByRole("button", { name: "සුරකින්න" })
    .click();
  await expect(page).toHaveURL(/\?notice=paid$/);
  await expect(page.getByRole("link", { name: "සංශෝධනයක් ඉදිරිපත් කරන්න" })).toHaveCount(0);
  await page.goto(`${newUrl}/amend`);
  await expect(page).toHaveURL(newUrl);
});

test("AMD-9, HOME-2: the amendments lists of the DS, the Ministry and a District, each in its own area", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await signInAs(page, "ds0101", /\/ds$/);
  // Digits, not letters: the rejected amendment stays on the DS's to-do panel, which the smoke test reads for
  // Latin letters (AC-20).
  const unique = String(Date.now()).slice(-6);
  const existing = `${TEST_CASE_NAME} ලැයිස්තුව ${unique}`;
  const { url } = await newSavedCase(page, { name: existing, nic: randomNic() });

  // HOME-2: a case awaiting its allocation is under "not yet allocated", not under "allocation received".
  await page.goto(`/ds?tab=notAllocated&q=${encodeURIComponent(existing)}`);
  await expect(page.getByRole("link", { name: /^ප්‍රතිපාදන නොලැබූ \(\d+\)$/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: existing })).toBeVisible();
  await page.getByRole("link", { name: /^ප්‍රතිපාදන ලැබූ \(\d+\)$/ }).click();
  await expect(page).toHaveURL(/tab=received/);
  await expect(page.getByRole("link", { name: existing })).toHaveCount(0);

  const newcomer = `${TEST_CASE_NAME} ලැයිස්තු නව ${unique}`;
  const newNumber = randomApplicationNumber();
  await propose(page, url, newcomer, newNumber);

  // The DS's amendment tab lists it, with no search or Excel file, and opens its page.
  await page.goto("/ds");
  await page.getByRole("link", { name: /^අනුමැතිය සඳහා ඉදිරිපත් කළ \(\d+\)$/ }).click();
  await expect(page).toHaveURL(/\/ds\?tab=amendmentsWaiting$/);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /එක්සෙල්/ })).toHaveCount(0);
  expect((await page.request.get("/ds/export?tab=amendmentsWaiting")).status()).toBe(404);
  const dsRow = page.getByTestId("amendment-table").getByRole("row").filter({ hasText: newcomer });
  await expect(dsRow).toContainText(existing);
  await expect(dsRow).toContainText(newNumber);
  await dsRow.getByRole("link", { name: newcomer }).click();
  await expect(page).toHaveURL(/\/ds\/amendments\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const amendmentPath = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("සංශෝධනය");
  await expect(page.getByTestId("new-beneficiary")).toContainText(newcomer);
  // Only the Ministry decides (AMD-4).
  await expect(page.getByRole("button", { name: "අනුමත කරන්න" })).toHaveCount(0);
  // The case page's box links to the same page.
  await page.goto(url);
  await page.getByTestId("amendment-waiting").getByRole("link", { name: "සංශෝධනය විවෘත කරන්න" }).click();
  await expect(page).toHaveURL(amendmentPath);

  // AC-68: the Ministry's menu counts the waiting ones, and its list has the new one in the queue.
  const ho = await openAs(browser, "ho0001");
  const menu = ho.getByRole("navigation", { name: "ප්‍රධාන මෙනුව" }).getByRole("link", { name: /^සංශෝධන/ });
  await expect(menu).toContainText(/\d+/);
  await menu.click();
  await expect(ho).toHaveURL(/\/ministry\/amendments$/, { timeout: 60_000 });
  await expect(ho.getByRole("heading", { level: 1 })).toHaveText("සංශෝධන");
  const hoRow = ho.getByTestId("amendment-table").getByRole("row").filter({ hasText: newcomer });
  await expect(hoRow).toContainText(existing);
  await hoRow.getByRole("link", { name: newcomer }).click();
  await expect(ho).toHaveURL(`/ministry${amendmentPath.replace(/^\/ds/, "")}`);

  // The Ministry rejects it: it leaves the queue for the rejected tab, with the reason.
  await ho.getByRole("button", { name: "ප්‍රතික්ෂේප කරන්න" }).click();
  const reject = ho.getByRole("dialog");
  await reject.getByLabel("ප්‍රතික්ෂේප කිරීමට හේතුව *").fill("ඉඩම් ඔප්පුව අමුණා නැත.");
  await reject.getByRole("button", { name: "ප්‍රතික්ෂේප කරන්න" }).click();
  await expect(ho).toHaveURL(/\?notice=rejected$/);
  await ho.goto("/ministry/amendments");
  await expect(ho.getByTestId("amendment-table").getByRole("row").filter({ hasText: newcomer })).toHaveCount(0);
  await ho.getByRole("link", { name: /^ප්‍රතික්ෂේප කළ \(\d+\)$/ }).click();
  await expect(ho).toHaveURL(/\/ministry\/amendments\?tab=rejected$/);
  await expect(ho.getByTestId("amendment-table").getByRole("row").filter({ hasText: newcomer })).toContainText(
    "ඉඩම් ඔප්පුව අමුණා නැත.",
  );
  await ho.context().close();

  // AC-68, PRM-4: Colombo's District Secretary sees it; Kandy's District CRPO doesn't, nor its page.
  const colombo = await openAs(browser, "dt0101");
  await colombo.goto("/oversight/amendments?tab=rejected", { timeout: 60_000 });
  const colomboRow = colombo.getByTestId("amendment-table").getByRole("row").filter({ hasText: newcomer });
  await colomboRow.getByRole("link", { name: newcomer }).click();
  await expect(colombo).toHaveURL(`/oversight${amendmentPath.replace(/^\/ds/, "")}`);
  await expect(colombo.getByTestId("rejection-reason")).toContainText("ඉඩම් ඔප්පුව අමුණා නැත.");
  await expect(colombo.getByRole("button", { name: "ප්‍රතික්ෂේප කරන්න" })).toHaveCount(0);
  await colombo.context().close();

  const kandy = await openAs(browser, "dt0102");
  await kandy.goto("/oversight/amendments?tab=rejected");
  await expect(kandy.getByText(newcomer)).toHaveCount(0);
  const response = await kandy.goto(`/oversight${amendmentPath.replace(/^\/ds/, "")}`);
  expect(response?.status()).toBe(404);
  await kandy.context().close();

  // The DS's rejected tab has it too.
  await page.goto("/ds?tab=amendmentsRejected");
  await expect(page.getByTestId("amendment-table").getByRole("row").filter({ hasText: newcomer })).toContainText(
    "ඉඩම් ඔප්පුව අමුණා නැත.",
  );
});

/**
 * AMD-11: an amendment's new beneficiary built in `office` of `district`, proposed by Homagama (ds0101) for
 * a case whose allocation it has received; the form says where the money goes back (`back`).
 */
async function proposeElsewhere(
  page: Page,
  url: string,
  newcomer: string,
  place: { district: string; office: string },
  back: string,
) {
  await page.goto(url);
  await page.getByRole("link", { name: "සංශෝධනයක් ඉදිරිපත් කරන්න" }).click();
  await expect(page).toHaveURL(/\/amend$/, { timeout: 60_000 });
  const applicationNumber = randomApplicationNumber();
  await fillCase(page, { name: newcomer, nic: randomNic(), applicationNumber });
  await expect(page.getByTestId("money-back")).toHaveCount(0);
  await page.getByRole("radio", { name: /^වෙනත් ප්‍රාදේශීය ලේකම් කොට්ඨාසයක/ }).check();
  await page.getByLabel("ඉඩම පිහිටි දිස්ත්‍රික්කය *").selectOption({ label: place.district });
  await page.getByLabel("ඉඩම පිහිටි ප්‍රාදේශීය ලේකම් කොට්ඨාසය *").selectOption({ label: place.office });
  await expect(page.getByTestId("money-back")).toContainText(back);
  await page.getByLabel("සංශෝධනයට හේතුව", { exact: true }).fill("ඉඩම වෙනත් ප්‍රදේශයක ඇත");
  await page.getByRole("button", { name: "සංශෝධනයක් ඉදිරිපත් කරන්න" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "අමාත්‍යාංශයට යවන්න" }).click();
  await expect(page).toHaveURL(`${url}?notice=amendmentSubmitted`);
  return applicationNumber;
}

/** The Ministry approves the case's waiting amendment, typing the return, and opens the new case. */
async function approveWithReturn(
  ho: Page,
  caseId: string,
  newcomer: { name: string; number: string },
  back: string,
  reference: string,
) {
  await ho.goto(`/ministry/cases/${caseId}`);
  await ho.getByTestId("amendment-waiting").getByRole("link", { name: "සංශෝධනය විවෘත කරන්න" }).click();
  await expect(ho.getByTestId("new-beneficiary")).toContainText(newcomer.name);
  await ho.getByRole("button", { name: "අනුමත කරන්න" }).click();
  const dialog = ho.getByRole("dialog");
  await expect(dialog.getByTestId("approve-return-text")).toContainText(back);
  // The date and reference are required (AMD-11).
  await dialog.getByRole("button", { name: "අනුමත කරන්න" }).click();
  await expect(dialog.getByText("යොමු අංකය ඇතුළත් කරන්න.", { exact: true })).toBeVisible();
  await dialog.getByLabel("ආපසු ලබා දුන් දිනය *").fill(TODAY);
  await dialog.getByLabel("යොමු අංකය *").fill(reference);
  await dialog.getByRole("button", { name: "අනුමත කරන්න" }).click();
  await expect(ho).toHaveURL(/\?notice=approved$/);
  await expect(ho.getByTestId("allocation-returned")).toContainText(reference);
  await ho.getByRole("link", { name: `${newcomer.number} විවෘත කරන්න` }).click();
  await expect(ho.getByRole("heading", { level: 1 })).toHaveText(newcomer.name);
  return ho.url().split("?")[0]?.split("/").at(-1) ?? "";
}

test("AC-76: a replacement built in another DS office of the district sends the money back to the District, which releases it there", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await signInAs(page, "ds0101", /\/ds$/);
  const ho = await openAs(browser, "ho0001");
  const district = await openAs(browser, "dt0103");
  const kaduwela = await openAs(browser, "ds0103");
  const unique = String(Date.now()).slice(-6);
  const label = `ආපසු දිස් ${unique}`;
  const { caseId, url } = await releasedCase(page, ho, district, label);

  const newcomer = `${TEST_CASE_NAME} කඩුවෙල ඉඩම ${unique}`;
  const number = await proposeElsewhere(
    page,
    url,
    newcomer,
    { district: "කොළඹ", office: "කඩුවෙල" },
    "දිස්ත්‍රික් ලේකම් කාර්යාලයට ආපසු ලබා දෙන",
  );
  const reference = `RET/E2E/${unique}`;
  const newId = await approveWithReturn(
    ho,
    caseId,
    { name: newcomer, number },
    "දිස්ත්‍රික් ලේකම් කාර්යාලයට ආපසු ලබා දෙන",
    reference,
  );
  await expect(ho.getByText("දිස්ත්‍රික්කයට මුදා හැර ඇත", { exact: true }).first()).toBeVisible();
  await ho.context().close();

  // The replaced case shows the return; it holds no money.
  await page.goto(url);
  await expect(page.getByTestId("allocation-returned")).toContainText(reference);
  await expect(money(page)).toHaveCount(0);

  // AMD-10: Colombo's District CRPO is told, sees it waiting for Kaduwela and releases it there.
  await district.goto("/oversight/notifications");
  await expect(district.getByText(newcomer).first()).toBeVisible();
  await district.goto("/oversight/release");
  await district.getByRole("link", { name: /^කඩුවෙල ප්‍රා\.ලේ\. කාර්යාලය/ }).click();
  await recordDsReleaseFor(district, [newcomer], `DS/E2E/${label}/2`);
  await district.context().close();

  // Kaduwela's CRPO pays installment 1.
  await kaduwela.goto(`/ds/cases/${newId}`);
  await expect(kaduwela.getByText(RECEIVED, { exact: true }).first()).toBeVisible();
  await money(kaduwela).getByRole("button", { name: START }).click();
  const start = kaduwela.getByRole("dialog", { name: `පළමු වාරිකය: ${START}` });
  await start.getByLabel("ගෙවීමට බලාපොරොත්තු වන දිනය *").fill(TODAY);
  await start.getByRole("button", { name: "සුරකින්න" }).click();
  await expect(kaduwela).toHaveURL(/\?notice=started$/);
  await money(kaduwela).getByRole("button", { name: PAY }).click();
  await kaduwela
    .getByRole("dialog", { name: `පළමු වාරිකය ${PAY}` })
    .getByRole("button", { name: "සුරකින්න" })
    .click();
  await expect(kaduwela).toHaveURL(/\?notice=paid$/);
  await kaduwela.context().close();
});

test("AC-77: once the letter has gone, the new beneficiary's land is in its district; before it, anywhere", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, "ds0101", /\/ds$/);
  const ho = await openAs(browser, "ho0001");
  const unique = String(Date.now()).slice(-6);

  // A case on Colombo's letter: the form offers only Colombo for the land.
  const onLetterName = `${TEST_CASE_NAME} ලිපියේ ${unique}`;
  const onLetter = await newSavedCase(page, { name: onLetterName, nic: randomNic() });
  await ho.goto(onLetter.url.replace("/ds/", "/ministry/"));
  await ho.getByRole("link", { name: "ලිපිය සටහන් කිරීමට යන්න →" }).click();
  await recordLetterFor(ho, [onLetterName], `MWCA/E2E/AC77/${unique}`);
  await ho.context().close();
  await page.goto(onLetter.url);
  await page.getByRole("link", { name: "සංශෝධනයක් ඉදිරිපත් කරන්න" }).click();
  await expect(page).toHaveURL(/\/amend$/, { timeout: 60_000 });
  await page.getByRole("radio", { name: /^වෙනත් ප්‍රාදේශීය ලේකම් කොට්ඨාසයක/ }).check();
  const landDistrict = page.getByLabel("ඉඩම පිහිටි දිස්ත්‍රික්කය *");
  await expect(landDistrict.locator("option", { hasText: "කොළඹ" })).toHaveCount(1);
  await expect(landDistrict.locator("option", { hasText: "ගම්පහ" })).toHaveCount(0);

  // A case awaiting its allocation may still be built in Gampaha, and the form says nothing goes back.
  const waiting = await newSavedCase(page, { name: `${TEST_CASE_NAME} ප්‍රතිපාදන නැති ${unique}`, nic: randomNic() });
  await page.goto(waiting.url);
  await page.getByRole("link", { name: "සංශෝධනයක් ඉදිරිපත් කරන්න" }).click();
  await expect(page).toHaveURL(/\/amend$/, { timeout: 60_000 });
  await page.getByRole("radio", { name: /^වෙනත් ප්‍රාදේශීය ලේකම් කොට්ඨාසයක/ }).check();
  await page.getByLabel("ඉඩම පිහිටි දිස්ත්‍රික්කය *").selectOption({ label: "ගම්පහ" });
  await page.getByLabel("ඉඩම පිහිටි ප්‍රාදේශීය ලේකම් කොට්ඨාසය *").selectOption({ label: "බියගම" });
  await expect(page.getByTestId("money-back")).toHaveCount(0);
});

/** The District CRPO opens the DS's request for a nomination from the "to nominate" tab. */
async function openRequest(district: Page, existing: string) {
  await district.goto("/oversight/amendments?tab=nominate");
  await district
    .getByTestId("nomination-table")
    .getByRole("link", { name: new RegExp(existing) })
    .click();
  await expect(district).toHaveURL(/\/oversight\/nominations\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(district.getByTestId("existing-beneficiary")).toHaveText(existing);
}

/** The DS's CRPO asks the District to nominate a new beneficiary for the case (AMD-12). */
async function askDistrict(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole("button", { name: "දිස්ත්‍රික්කයෙන් නව ප්‍රතිලාභියෙකු ඉල්ලන්න" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("ඉල්ලීමට හේතුව").fill("මෙම කොට්ඨාසයේ වෙනත් ප්‍රතිලාභියෙකු නැත");
  await dialog.getByRole("button", { name: "දිස්ත්‍රික්කයට යවන්න" }).click();
  await expect(page).toHaveURL(`${url}?notice=nominationAsked`);
}

test("AC-78: Homagama asks Colombo's District, which nominates a beneficiary of Kaduwela; the Ministry approves it", async ({
  page,
  browser,
}) => {
  test.setTimeout(360_000);
  await signInAs(page, "ds0101", /\/ds$/);
  const ho = await openAs(browser, "ho0001");
  const district = await openAs(browser, "dt0103");
  const unique = String(Date.now()).slice(-6);
  const label = `නාමයෝජන ${unique}`;
  const { caseId, url } = await releasedCase(page, ho, district, label);
  await page.goto(url);
  const existing = await page.getByRole("heading", { level: 1 }).innerText();

  // AMD-12: the request holds the case: no payment and no amendment.
  await askDistrict(page, url);
  await expect(page.getByTestId("nomination-waiting")).toContainText("දිස්ත්‍රික්කයෙන් නාමයෝජනය බලාපොරොත්තුවෙන්");
  await expect(money(page).getByRole("button", { name: START })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "සංශෝධනයක් ඉදිරිපත් කරන්න" })).toHaveCount(0);

  // The District is told, and nominates a beneficiary who lives and builds in Kaduwela.
  await district.goto("/oversight/notifications");
  await expect(district.getByText(existing).first()).toBeVisible();
  await openRequest(district, existing);
  const newcomer = `${TEST_CASE_NAME} නාමයෝජිත ${unique}`;
  const number = randomApplicationNumber();
  await fillCase(district, { name: newcomer, nic: randomNic(), applicationNumber: number });
  await district.getByLabel("ප්‍රාදේශීය ලේකම් කොට්ඨාසය *", { exact: true }).selectOption({ label: "කඩුවෙල" });
  await district.getByLabel("සංශෝධනයට හේතුව", { exact: true }).fill("හෝමාගම කොට්ඨාසයේ වෙනත් ප්‍රතිලාභියෙකු නැත");
  await district.getByRole("button", { name: "සංශෝධනයක් ඉදිරිපත් කරන්න" }).click();
  await district.getByRole("dialog").getByRole("button", { name: "අමාත්‍යාංශයට යවන්න" }).click();
  await expect(district).toHaveURL(new RegExp(`/oversight/cases/${caseId}\\?notice=nominated$`));

  // The Ministry approves it, with the return to the District.
  const reference = `RET/NOM/${unique}`;
  const newId = await approveWithReturn(
    ho,
    caseId,
    { name: newcomer, number },
    "දිස්ත්‍රික් ලේකම් කාර්යාලයට ආපසු ලබා දෙන",
    reference,
  );
  await ho.context().close();

  // Kaduwela's CRPO is told; Colombo's District releases the new case to Kaduwela.
  const kaduwela = await openAs(browser, "ds0103");
  await kaduwela.goto("/ds/notifications");
  await expect(kaduwela.getByText(newcomer).first()).toBeVisible();
  await district.goto("/oversight/release");
  await district.getByRole("link", { name: /^කඩුවෙල ප්‍රා\.ලේ\. කාර්යාලය/ }).click();
  await recordDsReleaseFor(district, [newcomer], `DS/E2E/${label}/2`);
  await district.context().close();

  // Kaduwela's CRPO pays installment 1.
  await kaduwela.goto(`/ds/cases/${newId}`);
  await money(kaduwela).getByRole("button", { name: START }).click();
  const start = kaduwela.getByRole("dialog", { name: `පළමු වාරිකය: ${START}` });
  await start.getByLabel("ගෙවීමට බලාපොරොත්තු වන දිනය *").fill(TODAY);
  await start.getByRole("button", { name: "සුරකින්න" }).click();
  await expect(kaduwela).toHaveURL(/\?notice=started$/);
  await money(kaduwela).getByRole("button", { name: PAY }).click();
  await kaduwela
    .getByRole("dialog", { name: `පළමු වාරිකය ${PAY}` })
    .getByRole("button", { name: "සුරකින්න" })
    .click();
  await expect(kaduwela).toHaveURL(/\?notice=paid$/);
  await kaduwela.context().close();

  // Homagama's history shows the request and the nomination.
  await page.goto(url);
  await expect(
    page.getByText("නව ප්‍රතිලාභියෙකු නාමයෝජනය කරන ලෙස දිස්ත්‍රික් ලේකම් කාර්යාලයෙන් ඉල්ලා සිටියා"),
  ).toBeVisible();
  await expect(
    page.getByText(`දිස්ත්‍රික් ලේකම් කාර්යාලය මෙම ප්‍රතිලාභියා වෙනුවට ${newcomer} (${number}) නාමයෝජනය කළා`),
  ).toBeVisible();
});

test("AC-79: the District sends a request back with a reason; a view-only account has no action", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, "ds0101", /\/ds$/);
  const ho = await openAs(browser, "ho0001");
  const district = await openAs(browser, "dt0103");
  const unique = String(Date.now()).slice(-6);
  const { url } = await releasedCase(page, ho, district, `ආපසු ඉල්ලීම ${unique}`);
  await ho.context().close();
  await page.goto(url);
  const existing = await page.getByRole("heading", { level: 1 }).innerText();
  await askDistrict(page, url);

  // Colombo's District Secretary only views: the request, but no link to act on it.
  const secretary = await openAs(browser, "dt0101");
  await secretary.goto(url.replace("/ds/", "/oversight/"));
  await expect(secretary.getByTestId("nomination-waiting")).toBeVisible();
  await expect(secretary.getByRole("link", { name: "ඉල්ලීම විවෘත කරන්න" })).toHaveCount(0);
  await secretary.context().close();

  await openRequest(district, existing);
  await district.getByRole("button", { name: "ඉල්ලීම ආපසු යවන්න" }).click();
  const dialog = district.getByRole("dialog");
  await dialog.getByLabel("ආපසු යැවීමට හේතුව").fill("දිස්ත්‍රික්කයේද වෙනත් ප්‍රතිලාභියෙකු නැත");
  await dialog.getByRole("button", { name: "ආපසු යවන්න" }).click();
  await expect(district).toHaveURL(/\?notice=nominationSentBack$/);
  await district.context().close();

  // Homagama sees the reason, and the case can have an installment paid again.
  await page.goto(url);
  await expect(page.getByTestId("nomination-sent-back")).toContainText("දිස්ත්‍රික්කයේද වෙනත් ප්‍රතිලාභියෙකු නැත");
  await expect(money(page).getByRole("button", { name: START })).toBeVisible();
  await expect(page.getByRole("button", { name: "දිස්ත්‍රික්කයෙන් නව ප්‍රතිලාභියෙකු ඉල්ලන්න" })).toBeVisible();
});
