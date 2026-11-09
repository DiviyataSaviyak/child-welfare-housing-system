import { expect, test } from "@playwright/test";
import { asUser, CONFIRM, fillCase, newSubmittedCase, randomNic, SEND, submit, SUBMITTED, YEAR } from "./case-helpers";
import { signInAs, TEST_CASE_NAME, TEXT } from "./helpers";

const SAVE_DRAFT = "පසුව සම්පූර්ණ කිරීමට සුරකින්න";

/** The old 9-digit form of a 12-digit NIC whose eighth digit is 0 (CASE-6): "19" + 5 digits + "0" + 4 digits. */
function oldFormOf(nic: string): string {
  return `${nic.slice(2, 7)}${nic.slice(8, 12)}V`;
}

/** A new NIC that has an old form too: 19YYDDD0SSSS. */
function nicWithOldForm(): string {
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
  return `19${digits(5)}0${digits(4)}`;
}

const PDF = { name: "ලේඛනය.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% made up\n") };

test("AC-5: submitting with required fields empty saves nothing and lists every error", async ({ page }) => {
  await signInAs(page, "ds0101", /\/ds$/);
  await page.goto("/ds/cases/new");
  await page.getByRole("button", { name: SEND }).click();

  const summary = page.locator("#case-errors");
  await expect(summary).toContainText("යැවීමට පෙර මේවා නිවැරදි කරන්න:");
  for (const message of ["කාණ්ඩය තෝරන්න.", "ආධාරයේ වර්ගය තෝරන්න.", "නම ඇතුළත් කරන්න."]) {
    await expect(summary.getByText(message)).toBeVisible();
  }
  // Each error also sits next to its field; the NIC, address and phone numbers are optional.
  await expect(page.locator("#name-error")).toHaveText("නම ඇතුළත් කරන්න.");
  await expect(page.getByLabel("නම *", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#nic-error")).toHaveCount(0);
  // Nothing was saved: no confirmation, and the page did not move to a saved case.
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page).toHaveURL(/\/ds\/cases\/new$/);
});

test("AC-6: a wrong NIC is refused; both formats are accepted and kept as typed", async ({ page }) => {
  await signInAs(page, "ds0101", /\/ds$/);
  await page.goto("/ds/cases/new");
  await fillCase(page, { name: `${TEST_CASE_NAME} ඒ`, nic: "12345" });
  await page.getByRole("button", { name: SEND }).click();
  await expect(page.locator("#nic-error")).toContainText("හැඳුනුම්පත් අංකය වැරදියි");
  await expect(page.getByLabel("නම *", { exact: true })).toHaveValue(`${TEST_CASE_NAME} ඒ`);

  const nic = nicWithOldForm();
  await page.getByLabel("ජාතික හැඳුනුම්පත් අංකය", { exact: true }).fill(oldFormOf(nic).toLowerCase());
  const { number } = await submit(page, "ds");
  expect(number).toMatch(new RegExp(`^HMG-${YEAR}-\\d{3,}$`));
  await expect(page.getByText(oldFormOf(nic), { exact: true })).toBeVisible();
});

test("AC-8 (first half): a submitted case gets its number and shows as sent on the DS home", async ({ page }) => {
  test.slow();
  await signInAs(page, "ds0101", /\/ds$/);
  await page.goto("/ds/cases/new");
  const nic = randomNic();
  await fillCase(page, { name: `${TEST_CASE_NAME} බී`, nic, atRisk: true });
  await page.getByTestId("document-input").setInputFiles(PDF);
  await expect(page.getByText("උඩුගත කළා. සුරැකූ විට ප්‍රතිලාභියාට එක් වේ.")).toBeVisible();

  const { number } = await submit(page, "ds");
  expect(number).toMatch(new RegExp(`^HMG-${YEAR}-\\d{3,}$`));
  await expect(page.getByRole("heading", { name: "අමාත්‍යංශයට යවන ලදී" })).toBeVisible();
  const documentLink = page.getByRole("link", { name: "ලේඛනය.pdf" });
  const file = await page.request.get((await documentLink.getAttribute("href")) ?? "");
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toBe("application/pdf");

  await page.goto(`/ds?q=${nic}`);
  const row = page.getByRole("row", { name: new RegExp(number) });
  await expect(row).toContainText(SUBMITTED);
  await expect(row).toContainText("පරීක්ෂණ දරුවා");
});

test("AC-7: a duplicate NIC shows the number and name in the same DS, only the number and DS elsewhere", async ({
  page,
  browser,
}) => {
  test.slow();
  await signInAs(page, "ds0101", /\/ds$/);
  const nic = nicWithOldForm();
  const first = await newSubmittedCase(page, { name: `${TEST_CASE_NAME} සී`, nic });

  // The same office, typing the old form of the same number.
  await page.goto("/ds/cases/new");
  await page.getByLabel("ජාතික හැඳුනුම්පත් අංකය", { exact: true }).fill(oldFormOf(nic));
  await page.getByLabel("ලිපිනය", { exact: true }).focus();
  await expect(page.getByTestId("nic-matches")).toContainText(`${first.number} (${TEST_CASE_NAME} සී)`);

  // Another office: the number and the office, never the name. Submitting still works.
  await asUser(browser, "ds0103", async (kaduwela) => {
    await kaduwela.goto("/ds/cases/new");
    await fillCase(kaduwela, { name: `${TEST_CASE_NAME} ඩී`, nic });
    await kaduwela.getByLabel("ලිපිනය", { exact: true }).focus();
    const warning = kaduwela.getByTestId("nic-matches");
    await expect(warning).toContainText(`හෝමාගම ප්‍රා.ලේ. කාර්යාලයේ ${first.number}`);
    await expect(warning).not.toContainText(TEST_CASE_NAME);

    await kaduwela.getByRole("button", { name: SEND }).click();
    await expect(kaduwela.getByRole("dialog").getByTestId("nic-matches")).toBeVisible();
    await kaduwela.getByRole("button", { name: CONFIRM }).click();
    await expect(kaduwela.getByTestId("case-number")).toHaveText(new RegExp(`^KDW-${YEAR}-\\d{3,}$`));
  });
});

test("AC-1: a DS officer sees only their own office's cases, and another office's case is 'not found'", async ({
  page,
  browser,
}) => {
  test.slow();
  await signInAs(page, "ds0103", /\/ds$/);
  await page.goto("/ds/cases/new");
  const nic = randomNic();
  await fillCase(page, { name: `${TEST_CASE_NAME} ඊ`, nic });
  await page.getByTestId("document-input").setInputFiles(PDF);
  await expect(page.getByText("උඩුගත කළා. සුරැකූ විට ප්‍රතිලාභියාට එක් වේ.")).toBeVisible();
  const kaduwelaCase = await submit(page, "ds");
  const fileHref = (await page.getByRole("link", { name: "ලේඛනය.pdf" }).getAttribute("href")) ?? "";

  await asUser(browser, "ds0101", async (homagama) => {
    for (const path of [kaduwelaCase.url, `${kaduwelaCase.url}/edit`]) {
      await homagama.goto(path);
      await expect(homagama.getByRole("heading", { level: 1 })).toHaveText(TEXT.notFound);
    }
    expect((await homagama.request.get(fileHref)).status()).toBe(404);

    await homagama.goto(`/ds?q=${nic}`);
    await expect(homagama.getByText("ගැළපෙන ප්‍රතිලාභීන් නැත.")).toBeVisible();
  });
});

test("a draft keeps what was typed, shows in the to-do panel, and can be deleted (CASE-4, CASE-8)", async ({
  page,
}) => {
  test.slow();
  await signInAs(page, "ds0101", /\/ds$/);
  await page.goto("/ds/cases/new");
  const name = `${TEST_CASE_NAME} එෆ් ${Date.now()}`;
  await page.getByLabel("නම *", { exact: true }).fill(name);
  await page.getByLabel("දුරකතන අංකය", { exact: true }).fill("123");
  await page.getByRole("button", { name: SAVE_DRAFT }).click();
  // Format rules still apply to a draft.
  await expect(page.locator("#mobile1-error")).toContainText("දුරකතන අංකය වැරදියි");

  await page.getByLabel("දුරකතන අංකය", { exact: true }).fill("");
  await page.getByRole("button", { name: SAVE_DRAFT }).click();
  await expect(page).toHaveURL(/\/ds\/cases\/[0-9a-f-]{36}\/edit\?notice=saved$/);
  await expect(page.getByLabel("නම *", { exact: true })).toHaveValue(name);

  await page.goto("/ds");
  await expect(page.getByRole("complementary").getByText(`${name}: තවම යවා නැත`)).toBeVisible();
  await page.getByRole("complementary").getByText(`${name}: තවම යවා නැත`).click();
  await page.getByRole("button", { name: "කෙටුම්පත මකන්න" }).click();
  await page.getByRole("button", { name: "ඔව්, මකන්න" }).click();
  await expect(page).toHaveURL(/\/ds\?notice=deleted$/);
  await expect(page.getByText(`${name}: තවම යවා නැත`)).toBeHidden();
});

test("a file that is not a PDF, JPEG or PNG is refused on its own; the others still upload (ERR-5)", async ({
  page,
}) => {
  await signInAs(page, "ds0101", /\/ds$/);
  await page.goto("/ds/cases/new");
  await page
    .getByTestId("document-input")
    .setInputFiles([{ name: "බොරු.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html></html>") }, PDF]);

  await expect(page.getByText("PDF, JPEG හෝ PNG ගොනුවක් පමණක් අමුණන්න.")).toBeVisible();
  await expect(page.getByText("උඩුගත කළා. සුරැකූ විට ප්‍රතිලාභියාට එක් වේ.")).toBeVisible();
});

test("Head Office enters a case for a DS it chooses, and finds it in the case list (CASE-3, FND-1)", async ({
  page,
}) => {
  test.slow();
  await signInAs(page, "ho0001", /\/ministry$/);
  await page.getByRole("link", { name: "ප්‍රතිලාභීන්", exact: true }).click();
  await page.getByRole("link", { name: /නව ප්‍රතිලාභියෙකු ඇතුළත් කරන්න/ }).click();
  const nic = randomNic();
  await fillCase(page, { name: `${TEST_CASE_NAME} ජී`, nic });

  // Without an office nothing is sent.
  await page.getByRole("button", { name: SEND }).click();
  await expect(page.locator("#dsOfficeId-error")).toHaveText("ප්‍රාදේශීය ලේකම් කොට්ඨාසය තෝරන්න.");

  await page.getByLabel("දිස්ත්‍රික්කය *").selectOption({ label: "කොළඹ" });
  await page.getByLabel("ප්‍රාදේශීය ලේකම් කොට්ඨාසය *").selectOption({ label: "කඩුවෙල" });
  const { number } = await submit(page, "ministry");
  expect(number).toMatch(new RegExp(`^KDW-${YEAR}-\\d{3,}$`));

  await page.goto(`/ministry/cases?q=${nic}`);
  const row = page.getByRole("row", { name: new RegExp(number) });
  await expect(row).toContainText("කඩුවෙල");
  await expect(row).toContainText(SUBMITTED);

  // Clearing the filters empties the search box too, not only the list's search.
  await expect(page.getByRole("searchbox")).toHaveValue(nic);
  await page.getByRole("link", { name: "පෙරහන් ඉවත් කරන්න" }).click();
  await expect(page).toHaveURL(/\/ministry\/cases$/);
  await expect(page.getByRole("searchbox")).toHaveValue("");
});
