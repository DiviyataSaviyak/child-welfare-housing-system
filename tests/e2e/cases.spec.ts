import { expect, test } from "@playwright/test";
import {
  asUser,
  AWAITING,
  CONFIRM,
  fillCase,
  newSavedCase,
  randomApplicationNumber,
  randomNic,
  SAVE,
  saveNew,
} from "./case-helpers";
import { signInAs, TEST_CASE_NAME, TEXT } from "./helpers";

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

test("AC-5, AC-50: saving with required fields empty saves nothing and lists every error", async ({ page }) => {
  await signInAs(page, "ds0101", /\/ds$/);
  await page.goto("/ds/cases/new");
  // There is no draft: one save button (CASE-4 removed).
  await expect(page.getByRole("button", { name: /සුරකින්න/ })).toHaveCount(1);
  await page.getByRole("button", { name: SAVE, exact: true }).click();

  const summary = page.locator("#case-errors");
  await expect(summary).toContainText("සුරැකීමට පෙර මේවා නිවැරදි කරන්න:");
  for (const message of ["කාණ්ඩය තෝරන්න.", "ආධාරයේ වර්ගය තෝරන්න.", "ඉල්ලුම් අංකය ඇතුළත් කරන්න.", "නම ඇතුළත් කරන්න."]) {
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
  test.slow();
  await signInAs(page, "ds0101", /\/ds$/);
  await page.goto("/ds/cases/new");
  await fillCase(page, { name: `${TEST_CASE_NAME} ඒ`, nic: "12345" });
  await page.getByRole("button", { name: SAVE, exact: true }).click();
  await expect(page.locator("#nic-error")).toContainText("හැඳුනුම්පත් අංකය වැරදියි");
  await expect(page.getByLabel("නම *", { exact: true })).toHaveValue(`${TEST_CASE_NAME} ඒ`);

  const nic = nicWithOldForm();
  await page.getByLabel("ජාතික හැඳුනුම්පත් අංකය", { exact: true }).fill(oldFormOf(nic).toLowerCase());
  await saveNew(page, "ds");
  await expect(page.getByText(oldFormOf(nic), { exact: true })).toBeVisible();
});

test("AC-50: a saved case awaits fund allocation at once, under the Application Number the DS typed", async ({
  page,
  browser,
}) => {
  test.slow();
  await signInAs(page, "ds0101", /\/ds$/);
  await page.goto("/ds/cases/new");
  const nic = randomNic();
  const typed = `${randomApplicationNumber()}A`;
  await fillCase(page, { name: `${TEST_CASE_NAME} බී`, nic, atRisk: true, applicationNumber: `  ${typed}  ` });
  await page.getByTestId("document-input").setInputFiles(PDF);
  await expect(page.getByText("උඩුගත කළා. සුරැකූ විට ප්‍රතිලාභියාට එක් වේ.")).toBeVisible();

  const { number } = await saveNew(page, "ds");
  expect(number).toBe(typed);
  await expect(page.getByRole("heading", { name: "සුරකින ලදී" })).toBeVisible();
  await expect(page.getByText(AWAITING).first()).toBeVisible();
  const documentLink = page.getByRole("link", { name: "ලේඛනය.pdf" });
  const file = await page.request.get((await documentLink.getAttribute("href")) ?? "");
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toBe("application/pdf");

  await page.goto(`/ds?q=${encodeURIComponent(typed)}`);
  const row = page.getByRole("row", { name: new RegExp(typed) });
  await expect(row).toContainText(AWAITING);
  await expect(row).toContainText("පරීක්ෂණ දරුවා");

  // The same number in the same DS, in small letters and with spaces, is refused (CASE-12).
  await page.goto("/ds/cases/new");
  await fillCase(page, {
    name: `${TEST_CASE_NAME} බී 2`,
    nic: randomNic(),
    applicationNumber: typed.toLowerCase().replaceAll("/", " / "),
  });
  await page.getByRole("button", { name: SAVE, exact: true }).click();
  await page.getByRole("button", { name: CONFIRM }).click();
  await expect(page.locator("#case-error")).toHaveText(
    "මෙම ප්‍රාදේශීය ලේකම් කොට්ඨාසයේ වෙනත් ප්‍රතිලාභියෙකුට මෙම ඉල්ලුම් අංකය දැනටමත් ඇත.",
  );
  await expect(page).toHaveURL(/\/ds\/cases\/new$/);

  // Another DS may use it.
  await asUser(browser, "ds0103", async (kaduwela) => {
    await newSavedCase(kaduwela, { name: `${TEST_CASE_NAME} බී 3`, nic: randomNic(), applicationNumber: typed });
    await expect(kaduwela.getByTestId("case-number")).toHaveText(typed);
  });
});

test("AC-7: a duplicate NIC shows the number and name in the same DS, only the number and DS elsewhere", async ({
  page,
  browser,
}) => {
  test.slow();
  await signInAs(page, "ds0101", /\/ds$/);
  const nic = nicWithOldForm();
  const first = await newSavedCase(page, { name: `${TEST_CASE_NAME} සී`, nic });

  // The same office, typing the old form of the same number.
  await page.goto("/ds/cases/new");
  await page.getByLabel("ජාතික හැඳුනුම්පත් අංකය", { exact: true }).fill(oldFormOf(nic));
  await page.getByLabel("ලිපිනය", { exact: true }).focus();
  await expect(page.getByTestId("nic-matches")).toContainText(`${first.number} (${TEST_CASE_NAME} සී)`);

  // Another office: the number and the office, never the name. Saving still works.
  await asUser(browser, "ds0103", async (kaduwela) => {
    await kaduwela.goto("/ds/cases/new");
    await fillCase(kaduwela, { name: `${TEST_CASE_NAME} ඩී`, nic });
    await kaduwela.getByLabel("ලිපිනය", { exact: true }).focus();
    const warning = kaduwela.getByTestId("nic-matches");
    await expect(warning).toContainText(`හෝමාගම ප්‍රා.ලේ. කාර්යාලයේ ${first.number}`);
    await expect(warning).not.toContainText(TEST_CASE_NAME);

    await kaduwela.getByRole("button", { name: SAVE, exact: true }).click();
    await expect(kaduwela.getByRole("dialog").getByTestId("nic-matches")).toBeVisible();
    await kaduwela.getByRole("button", { name: CONFIRM }).click();
    await expect(kaduwela).toHaveURL(/\?notice=created$/);
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
  const kaduwelaCase = await saveNew(page, "ds");
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

test("AC-51: while a case awaits its allocation, the DS changes its name and NIC, and deletes one with a reason", async ({
  page,
}) => {
  test.slow();
  await signInAs(page, "ds0101", /\/ds$/);
  const name = `${TEST_CASE_NAME} එෆ් ${Date.now()}`;
  const saved = await newSavedCase(page, { name, nic: randomNic() });

  // CASE-9: any detail, the name and the NIC included; the history keeps what changed.
  await page.getByRole("link", { name: "විස්තර සංස්කරණය කරන්න" }).click();
  await expect(page).toHaveURL(`${saved.url}/edit`);
  await page.getByLabel("නම *", { exact: true }).fill(`${name} නිවැරදි`);
  const newNic = randomNic();
  await page.getByLabel("ජාතික හැඳුනුම්පත් අංකය", { exact: true }).fill(newNic);
  await page.getByRole("button", { name: "වෙනස්කම් සුරකින්න" }).click();
  await expect(page).toHaveURL(`${saved.url}?notice=changed`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${name} නිවැරදි`);
  await expect(page.getByText(newNic, { exact: true })).toBeVisible();
  await expect(page.getByText(/වෙනස් කළ විස්තර: .*නම.*හැඳුනුම්පත් අංකය/)).toBeVisible();

  // CASE-8: deleting asks for a reason, then once more.
  await page.getByRole("button", { name: "මකන්න", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "ඔව්, මකන්න" }).click();
  await expect(dialog.getByText("හේතුව ඇතුළත් කරන්න.")).toBeVisible();
  await dialog.getByLabel("මකා දැමීමට හේතුව *").fill("දෙවරක් ඇතුළත් කර ඇත.");
  await dialog.getByRole("button", { name: "ඔව්, මකන්න" }).click();
  await expect(page).toHaveURL(/\/ds\?notice=deleted$/);
  await expect(page.getByText("ප්‍රතිලාභියා මකා දැමුවා.")).toBeVisible();

  await page.goto(saved.url);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TEXT.notFound);
});

test("a case built in another DS division is entered by the DS of residence and seen by both (CASE-13)", async ({
  page,
  browser,
}) => {
  test.slow();
  await signInAs(page, "ds0101", /\/ds$/);
  await page.goto("/ds/cases/new");
  const name = `${TEST_CASE_NAME} ජේ ${Date.now()}`;
  await fillCase(page, { name, nic: randomNic() });
  await page.getByRole("radio", { name: /^වෙනත් ප්‍රාදේශීය ලේකම් කොට්ඨාසයක/ }).check();
  // Nothing is saved until the office where it is built is chosen.
  await page.getByRole("button", { name: SAVE, exact: true }).click();
  await expect(page.locator("#buildDsOfficeId-error")).toHaveText("ඉඩම පිහිටි ප්‍රාදේශීය ලේකම් කොට්ඨාසය තෝරන්න.");
  await page.getByLabel("ඉඩම පිහිටි දිස්ත්‍රික්කය *").selectOption({ label: "කොළඹ" });
  // The DS of residence isn't offered: that is "the same DS division".
  const offices = page.getByLabel("ඉඩම පිහිටි ප්‍රාදේශීය ලේකම් කොට්ඨාසය *");
  await expect(offices.getByRole("option", { name: "හෝමාගම", exact: true })).toHaveCount(0);
  await offices.selectOption({ label: "කඩුවෙල" });
  await page.getByRole("button", { name: SAVE, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("කඩුවෙල");
  await page.getByRole("button", { name: CONFIRM }).click();
  await expect(page).toHaveURL(/\?notice=created$/);
  const url = page.url().split("?")[0] ?? "";
  await expect(page.getByText("ඉදිකරන්නේ කඩුවෙල").first()).toBeVisible();

  // The DS where it is built sees it, named as entered by the other DS, with no edit or delete.
  await asUser(browser, "ds0103", async (kaduwela) => {
    await kaduwela.goto(`/ds?q=${encodeURIComponent(name)}`);
    await expect(kaduwela.getByRole("row", { name: new RegExp(name) })).toContainText("ඇතුළත් කළේ හෝමාගම");
    await kaduwela.goto(url);
    await expect(kaduwela.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(kaduwela.getByRole("link", { name: "විස්තර සංස්කරණය කරන්න" })).toBeHidden();
    await expect(kaduwela.getByRole("button", { name: "මකන්න", exact: true })).toBeHidden();
  });
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

test("the Ministry enters a case for a DS it chooses, and finds it in the case list (CASE-3, FND-1)", async ({
  page,
}) => {
  test.slow();
  await signInAs(page, "ho0001", /\/ministry$/);
  await page.getByRole("link", { name: "ප්‍රතිලාභීන්", exact: true }).click();
  await page.getByRole("link", { name: /නව ප්‍රතිලාභියෙකු ඇතුළත් කරන්න/ }).click();
  const nic = randomNic();
  await fillCase(page, { name: `${TEST_CASE_NAME} ජී`, nic });

  // Without an office nothing is saved.
  await page.getByRole("button", { name: SAVE, exact: true }).click();
  await expect(page.locator("#dsOfficeId-error")).toHaveText("ප්‍රාදේශීය ලේකම් කොට්ඨාසය තෝරන්න.");

  await page.getByLabel("දිස්ත්‍රික්කය *", { exact: true }).selectOption({ label: "කොළඹ" });
  await page.getByLabel("ප්‍රාදේශීය ලේකම් කොට්ඨාසය *", { exact: true }).selectOption({ label: "කඩුවෙල" });
  const { number } = await saveNew(page, "ministry");

  await page.goto(`/ministry/cases?q=${nic}`);
  const row = page.getByRole("row", { name: new RegExp(number) });
  await expect(row).toContainText("කඩුවෙල");
  await expect(row).toContainText(AWAITING);

  // Clearing the filters empties the search box too, not only the list's search.
  await expect(page.getByRole("searchbox")).toHaveValue(nic);
  await page.getByRole("link", { name: "පෙරහන් ඉවත් කරන්න" }).click();
  await expect(page).toHaveURL(/\/ministry\/cases$/);
  await expect(page.getByRole("searchbox")).toHaveValue("");
});
