import { type Browser, expect, type Page, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { fillCase, newSubmittedCase, randomNic, submit } from "./case-helpers";
import { signInAs, TEST_CASE_NAME, TEXT } from "./helpers";

/**
 * AC-41 and AC-42: the accounts that only view (PRM-4, PRM-5), with the sample accounts of
 * prisma/seed-users.ts. Kaduwela and Homagama are in Colombo district, in the Western Province.
 */
const PDF = { name: "ලේඛනය.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% made up\n") };
const EXPORT = "එක්සෙල් ගොනුවක් ලෙස බාගන්න";

type Case = { id: string; name: string; nic: string; file?: string };

/** A view-only account's window, signed in and on its summary. */
async function viewer(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "si-LK" });
  const page = await context.newPage();
  await signInAs(page, username, /\/oversight$/);
  return page;
}

/** The case's read-only page: its name, its document, and not one form to change it (PRM-5). */
async function seesCase(page: Page, c: Case) {
  await page.goto(`/oversight/cases/${c.id}`);
  await expect(page.getByRole("heading", { name: c.name, level: 1 })).toBeVisible();
  await expect(page.locator("main form")).toHaveCount(0);
  if (c.file) expect((await page.request.get(c.file)).status()).toBe(200);
}

/** Outside the account's area, the case and its file answer "not found" (PRM-1). */
async function missesCase(page: Page, c: Case) {
  await page.goto(`/oversight/cases/${c.id}`);
  await expect(page.getByRole("heading", { name: TEXT.notFound })).toBeVisible();
  if (c.file) expect((await page.request.get(c.file)).status()).toBe(404);
}

/**
 * The names in the Excel file of the list searched for this NIC (EXP-1). The list shows the download
 * link only when something matches, so the file is fetched from the link's address, which is the same.
 */
async function exportedNames(page: Page, nic: string): Promise<unknown[]> {
  const file = await page.request.get(`/oversight/cases/export?q=${nic}`);
  expect(file.status()).toBe(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await file.body()).buffer);
  // Two header rows: the progress groups stand over their columns.
  return (workbook.worksheets[0].getSheetValues().slice(3) as unknown[][]).map((row) => row[5]);
}

test("AC-41, AC-42: each view-only account sees only its own area's cases, with no action, and downloads them", async ({
  page,
  browser,
}) => {
  // Seven accounts sign in one after another.
  test.setTimeout(300_000);
  // A case in Kaduwela, and one in Homagama with a document.
  await signInAs(page, "ds0103", /\/ds$/);
  const kaduwela: Case = { id: "", name: `${TEST_CASE_NAME} බැලීම කඩුවෙල ${Date.now()}`, nic: randomNic() };
  kaduwela.id = (await newSubmittedCase(page, kaduwela)).url.split("/").at(-1) ?? "";
  await page.context().clearCookies();

  await signInAs(page, "ds0101", /\/ds$/);
  const homagama: Case = { id: "", name: `${TEST_CASE_NAME} බැලීම හෝමාගම ${Date.now()}`, nic: randomNic() };
  await page.goto("/ds/cases/new");
  await fillCase(page, homagama);
  await page.getByTestId("document-input").setInputFiles(PDF);
  await expect(page.getByText("උඩුගත කළා. සුරැකූ විට ප්‍රතිලාභියාට එක් වේ.")).toBeVisible();
  homagama.id = (await submit(page, "ds")).url.split("/").at(-1) ?? "";
  homagama.file = (await page.getByRole("link", { name: PDF.name }).getAttribute("href")) ?? "";
  expect(homagama.file).toMatch(/^\/files\//);

  // The Kaduwela accountant, with no name (ADM-10): only Kaduwela, and no place to choose.
  const accountant = await viewer(browser, "ds0104");
  await expect(accountant.getByText("කඩුවෙල ප්‍රාදේශීය ලේකම් කාර්යාලය", { exact: true })).toBeVisible();
  await expect(accountant.getByText("ගණකාධිකාරී, කඩුවෙල", { exact: true })).toBeVisible();
  await seesCase(accountant, kaduwela);
  await missesCase(accountant, homagama);
  await accountant.goto(`/oversight/cases?q=${kaduwela.nic}`);
  await expect(accountant.getByLabel("ප්‍රා.ලේ. කොට්ඨාසය")).toHaveCount(0);
  await expect(accountant.getByRole("link", { name: EXPORT })).toHaveAttribute(
    "href",
    `/oversight/cases/export?q=${kaduwela.nic}`,
  );
  expect(await exportedNames(accountant, kaduwela.nic)).toEqual([kaduwela.name]);
  expect(await exportedNames(accountant, homagama.nic)).toEqual([]);
  // No other area's pages, and none of the Server Actions' screens (PRM-5).
  for (const path of ["/ds", "/ds/cases/new", "/ministry", "/admin/users"]) {
    await accountant.goto(path);
    await expect(accountant.getByRole("heading", { name: TEXT.notFound })).toBeVisible();
  }
  await accountant.context().close();

  // The Colombo District Secretary: both.
  const district = await viewer(browser, "dt0101");
  await expect(district.getByText("කොළඹ දිස්ත්‍රික් ලේකම් කාර්යාලය", { exact: true })).toBeVisible();
  await seesCase(district, kaduwela);
  await seesCase(district, homagama);
  await district.context().close();

  // The Kandy District CRPO: neither, even though the role is not only a viewer's.
  const kandy = await viewer(browser, "dt0102");
  await missesCase(kandy, kaduwela);
  await missesCase(kandy, homagama);
  expect(await exportedNames(kandy, homagama.nic)).toEqual([]);
  await kandy.context().close();

  // The Western Province's Commissioner, the Department's Commissioner and the Ministry's Secretary: both.
  for (const [username, header] of [
    ["pv0101", "බස්නාහිර පළාත් කාර්යාලය"],
    ["pd0101", "පරිවාස හා ළමාරක්ෂක සේවා දෙපාර්තමේන්තුව"],
    ["ho0101", "කාන්තා සහ ළමා කටයුතු අමාත්‍යංශය"],
  ]) {
    const wide = await viewer(browser, username);
    await expect(wide.getByText(header, { exact: true }).first()).toBeVisible();
    await seesCase(wide, kaduwela);
    await seesCase(wide, homagama);
    expect(await exportedNames(wide, homagama.nic)).toEqual([homagama.name]);
    await wide.context().close();
  }
});
