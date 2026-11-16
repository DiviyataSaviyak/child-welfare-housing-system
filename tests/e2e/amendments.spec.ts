import { expect, test } from "@playwright/test";
import { fillCase, newSavedCase, randomApplicationNumber, randomNic } from "./case-helpers";
import { signInAs, TEST_CASE_NAME } from "./helpers";

/**
 * Change 0008: amendments (AMD). Task 2 submits one from the DS's case page; the Ministry's decision and the
 * lists follow in later tasks, with the rest of AC-44 to AC-49 and AC-66 to AC-71.
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
