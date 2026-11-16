import { expect, type Page, test } from "@playwright/test";
import { AWAITING, fillCase, newSavedCase, openAs, randomApplicationNumber, randomNic } from "./case-helpers";
import { randomLetters, signInAs, TEST_CASE_NAME } from "./helpers";

/**
 * Change 0008: amendments (AMD). Task 2 submits one from the DS's case page, and task 3 has the Ministry
 * reject and approve them; the lists follow in later tasks, with the rest of AC-44 to AC-49 and AC-66 to AC-71.
 */
test("AMD-1, AMD-3: a CRPO proposes another beneficiary, and the case shows the amendment waiting", async ({
  page,
}) => {
  // Two case forms and a summary: longer than the default on a slow machine.
  test.setTimeout(90_000);
  await signInAs(page, "ds0101", /\/ds$/);
  const existing = `${TEST_CASE_NAME} පවතින`;
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
  const { url, number } = await newSavedCase(page, { name: existing, nic: randomNic() });
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
});
