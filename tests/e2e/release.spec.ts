import { expect, type Locator, type Page, test } from "@playwright/test";
import { CONFIRM, fillCase, newSavedCase, openAs, randomNic, recordLetterFor, SAVE, saveNew } from "./case-helpers";
import { signInAs, TEST_CASE_NAME } from "./helpers";

/** Screen text the tests look for (messages/si.json). */
const CHECK_MENU = "පරීක්ෂා කිරීම සහ ප්‍රතිපාදන මුදා හැරීම";
const VERIFY = "අනුමත කරන්න";
const SEND_BACK = "නිවැරදි කිරීමට ආපසු යවන්න";
const REJECT = "ප්‍රතික්ෂේප කරන්න";
const SEND_BACK_REASON = "ප්‍රා.ලේ. කාර්යාලය නිවැරදි කළ යුත්තේ කුමක්ද? *";
const REJECT_REASON = "ප්‍රතික්ෂේප කිරීමට හේතුව *";
const LETTER = /^ලිපිය සටහන් කරන්න · /;
const NOT_STARTED = "තවම ආරම්භ කර නැත";

/** Chooses a district or DS office by its name; each option reads "<name> (<cases waiting>)" (CHK-4). */
async function choosePlace(select: Locator, name: string) {
  const option = select.locator("option").filter({ hasText: new RegExp(`^${name} \\(\\d+\\)$`) });
  await select.selectOption((await option.getAttribute("value")) ?? "");
}

/** Opens a case from Head Office's check queue and waits for its details on the right. */
async function openFromQueue(ho: Page, number: string, name: string) {
  await ho.goto("/ministry/check");
  const list = ho.getByRole("region", { name: "පරීක්ෂා කිරීමට ඇති ප්‍රතිලාභීන්" });
  await list.getByRole("link", { name: new RegExp(number) }).click();
  await expect(ho.getByRole("heading", { level: 2, name })).toBeVisible();
}

test("AC-8, AC-9, AC-10: DS submits, Head Office sends back, DS corrects, Head Office verifies and releases", async ({
  page: ds,
  browser,
}) => {
  test.slow();
  const ho = await openAs(browser, "ho0001");
  const name = `${TEST_CASE_NAME} නිදහස් ${Date.now()}`;
  await signInAs(ds, "ds0101", /\/ds$/);
  const { url, number } = await newSavedCase(ds, { name, nic: randomNic() });
  const caseId = url.split("/").at(-1) ?? "";

  // AC-8: the case waits in the check queue, and the menu counts it.
  await ho.goto("/ministry/check");
  await expect(
    ho.getByRole("link", { name: new RegExp(`^${CHECK_MENU} \\(බලා සිටින ප්‍රතිලාභීන් \\d+\\)$`) }),
  ).toBeVisible();
  await openFromQueue(ho, number, name);

  // AC-9: sending back needs a reason.
  await ho.getByRole("button", { name: SEND_BACK }).click();
  await ho.getByRole("button", { name: "ආපසු යවන්න", exact: true }).click();
  await expect(ho.locator("#decision-reason-error")).toHaveText("හේතුව ඇතුළත් කරන්න.");
  await ho.getByLabel(SEND_BACK_REASON).fill("ලිපිනයේ ගම සඳහන් කරන්න.");
  await ho.getByRole("button", { name: "ආපසු යවන්න", exact: true }).click();
  await expect(ho).toHaveURL(new RegExp(`/ministry/check\\?notice=sentBack&done=${caseId}$`));
  await expect(ho.getByRole("status")).toContainText(`${name} (${number}) නිවැරදි කිරීමට හෝමාගම`);

  // The DS sees the case and the reason in its to-do panel, and corrects it.
  await ds.goto("/ds");
  const todo = ds.getByRole("complementary");
  await expect(todo.getByText(`${name}: ආපසු එවා ඇත`)).toBeVisible();
  await expect(todo).toContainText("ලිපිනයේ ගම සඳහන් කරන්න.");
  await expect(ds.getByRole("link", { name: /^දැනුම්දීම්, නොකියවූ \d+$/ })).toBeVisible();
  await todo.getByText(`${name}: ආපසු එවා ඇත`).click();
  await expect(ds.getByText("ලිපිනයේ ගම සඳහන් කරන්න.")).toBeVisible();
  await ds.getByLabel("ලිපිනය", { exact: true }).fill("නො. 1, පරීක්ෂණ පාර, පරීක්ෂණ ගම");
  await ds.getByRole("button", { name: SAVE }).click();
  await ds.getByRole("button", { name: CONFIRM }).click();
  await expect(ds.getByTestId("case-number")).toHaveText(number);

  // Back in the queue; verified after one confirmation.
  await openFromQueue(ho, number, name);
  await ho.getByRole("button", { name: VERIFY, exact: true }).click();
  await ho.getByRole("dialog").getByRole("button", { name: "ඔව්, අනුමත කරන්න" }).click();
  await expect(ho).toHaveURL(new RegExp(`/ministry/check\\?notice=verified&done=${caseId}$`));
  await expect(ho.getByRole("status")).toContainText(`${name} (${number}) අනුමත කළා`);

  // AC-10: on the release tab, under Colombo's letter with Homagama's cases; a letter without a
  // number is refused, and the total follows the ticks.
  await ho.goto("/ministry/release");
  await ho.getByRole("link", { name: /^කොළඹ දිස්ත්‍රික්කය/ }).click();
  const letter = ho.getByRole("region", { name: "කොළඹ දිස්ත්‍රික්කය", exact: true });
  const box = letter.getByRole("checkbox", { name: new RegExp(name) });
  await expect(box).toBeChecked();
  for (const other of await letter.getByRole("checkbox").all()) await other.uncheck();
  await expect(letter.getByTestId("letter-total")).toHaveText("රු. 0");
  await letter.getByRole("button", { name: LETTER }).click();
  await expect(letter.locator("#letter-error")).toHaveText("ලිපියේ නම් ඇති අවම වශයෙන් එක් ප්‍රතිලාභියෙකු තෝරන්න.");
  await box.check();
  await expect(letter.getByTestId("letter-total")).toHaveText("රු. 2,000,000");
  await letter.getByRole("button", { name: LETTER }).click();
  await expect(letter.locator("#letter-letterNumber-error")).toHaveText("මගේ අංකය ඇතුළත් කරන්න.");
  await letter.getByLabel("මගේ අංකය *").fill("MWCA/3/8/16/E2E-2026");
  await letter.getByRole("button", { name: LETTER }).click();
  await expect(ho).toHaveURL(/\/ministry\/release\?notice=letterRecorded&letter=[\w-]+&districtId=\d+$/);
  await expect(ho.getByRole("status")).toContainText(
    "කොළඹ දිස්ත්‍රික්කයට ලිපිය MWCA/3/8/16/E2E-2026 සටහන් කළා: ප්‍රතිලාභීන් 1, රු. 2,000,000.",
  );
  await expect(
    ho.getByRole("region", { name: "සටහන් කළ ලිපි" }).getByText("කොළඹ · MWCA/3/8/16/E2E-2026"),
  ).toBeVisible();

  // Four installments, none started; the letter is on the case.
  await ho.goto(`/ministry/cases/${caseId}`);
  const money = ho.getByRole("region", { name: "මූල්‍ය ප්‍රගතිය" });
  await expect(money).toContainText("ප්‍රතිපාදන ලිපිය MWCA/3/8/16/E2E-2026");
  await expect(money).toContainText("කොළඹ දිස්ත්‍රික් ලේකම් වෙත · ප්‍රතිලාභීන් 1, මුළු රු. 2,000,000");
  await expect(money.getByText(NOT_STARTED, { exact: true })).toHaveCount(4);

  // The DS is notified; opening the notice shows the case and marks it read.
  await ds.goto("/ds/notifications");
  const notice = ds.getByRole("button", { name: new RegExp(`^${name} සඳහා රු\\. 2,000,000 නිදහස් කර ඇත`) });
  await expect(notice).toContainText("අලුත්");
  await notice.click();
  await expect(ds).toHaveURL(new RegExp(`/ds/cases/${caseId}$`));
  const dsMoney = ds.getByRole("region", { name: "මූල්‍ය ප්‍රගතිය" });
  await expect(dsMoney.getByText(NOT_STARTED, { exact: true })).toHaveCount(4);
  await expect(dsMoney).toContainText("අමාත්‍යංශයෙන් කොළඹ දිස්ත්‍රික් ලේකම් හරහා");
  await ds.goto("/ds/notifications");
  await expect(ds.getByRole("button", { name: new RegExp(`^${name} සඳහා`) })).not.toContainText("අලුත්");

  await ho.context().close();
});

test("Head Office narrows the queues to a district and a DS office, and stays there after each decision (CHK-4)", async ({
  page: ds,
  browser,
}) => {
  test.slow();
  await signInAs(ds, "ds0101", /\/ds$/);
  const name = `${TEST_CASE_NAME} ප්‍රදේශය ${Date.now()}`;
  const { url, number } = await newSavedCase(ds, { name, nic: randomNic() });
  const caseId = url.split("/").at(-1) ?? "";

  const ho = await openAs(browser, "ho0001");
  await ho.goto("/ministry/check");
  const district = ho.getByRole("combobox", { name: "දිස්ත්‍රික්කය" });
  const office = ho.getByRole("combobox", { name: "ප්‍රා.ලේ. කොට්ඨාසය" });
  await expect(office).toBeDisabled();
  await choosePlace(district, "කොළඹ");
  await expect(ho).toHaveURL(/\/ministry\/check\?districtId=\d+$/);
  await choosePlace(office, "හෝමාගම");
  await expect(ho).toHaveURL(/\/ministry\/check\?districtId=\d+&dsOfficeId=\d+$/);
  const place = new URL(ho.url()).search.slice(1);

  // Only Homagama's cases are listed.
  const list = ho.getByRole("region", { name: "පරීක්ෂා කිරීමට ඇති ප්‍රතිලාභීන්" });
  const rows = list.getByRole("listitem");
  await expect(rows.first()).toBeVisible();
  for (const row of await rows.all()) await expect(row).toContainText("හෝමාගම ප්‍රා.ලේ.");
  await list.getByRole("link", { name: new RegExp(number) }).click();
  await expect(ho.getByRole("heading", { level: 2, name })).toBeVisible();
  expect(ho.url()).toContain(place);

  // Verified; back in Homagama's queue.
  await ho.getByRole("button", { name: VERIFY, exact: true }).click();
  await ho.getByRole("dialog").getByRole("button", { name: "ඔව්, අනුමත කරන්න" }).click();
  await expect(ho).toHaveURL(new RegExp(`/ministry/check\\?notice=verified&done=${caseId}&${place}$`));
  await expect(office.locator("option:checked")).toHaveText(/^හෝමාගම \(\d+\)$/);

  // The release tab opens on the same district's letter (REL-2), and the letter stays there.
  await ho.getByRole("link", { name: /^2\. ප්‍රතිපාදන මුදා හැරීමට/ }).click();
  await expect(ho).toHaveURL(new RegExp(`/ministry/release\\?${place}$`));
  await expect(ho.getByRole("link", { name: /^කොළඹ දිස්ත්‍රික්කය/ })).toHaveAttribute("aria-current", "true");
  await recordLetterFor(ho, [name], "MWCA/E2E/PLACE");
  const districtId = new URLSearchParams(place).get("districtId");
  expect(new URL(ho.url()).searchParams.get("districtId")).toBe(districtId);

  // Back on the check tab, still in the district.
  await ho.getByRole("link", { name: /^1\. පරීක්ෂා කිරීමට/ }).click();
  await expect(ho).toHaveURL(new RegExp(`/ministry/check\\?districtId=${districtId}$`));
  await ho.getByRole("link", { name: "සියලු ප්‍රදේශ පෙන්වන්න" }).click();
  await expect(ho).toHaveURL(/\/ministry\/check$/);
  await expect(district.locator("option:checked")).toHaveText(/^සියලු දිස්ත්‍රික්ක \(\d+\)$/);
  await expect(office).toBeDisabled();
  await ho.context().close();
});

test("rejecting needs a reason the DS office then reads (CHK-3)", async ({ page: ds, browser }) => {
  test.slow();
  await signInAs(ds, "ds0101", /\/ds$/);
  const name = `${TEST_CASE_NAME} ප්‍රතික්ෂේප ${Date.now()}`;
  const { url } = await newSavedCase(ds, { name, nic: randomNic() });
  const caseId = url.split("/").at(-1) ?? "";

  // Decided from the case's own page this time.
  const ho = await openAs(browser, "ho0001");
  await ho.goto(`/ministry/cases/${caseId}`);
  await ho.getByRole("button", { name: REJECT }).click();
  await ho.getByLabel(REJECT_REASON).fill("නැත");
  await ho.getByRole("button", { name: REJECT }).click();
  await expect(ho.locator("#decision-reason-error")).toHaveText("හේතුව අවම වශයෙන් අක්ෂර 5ක් විය යුතුය.");
  await ho.getByLabel(REJECT_REASON).fill("මෙම පවුලට වෙනත් නිවාස ආධාරයක් ලැබී ඇත.");
  await ho.getByRole("button", { name: REJECT }).click();
  await expect(ho).toHaveURL(new RegExp(`/ministry/cases/${caseId}\\?notice=rejected$`));
  await expect(ho.getByRole("status")).toContainText("ප්‍රතික්ෂේප කළා");
  await expect(ho.getByRole("button", { name: VERIFY, exact: true })).toBeHidden();
  await ho.context().close();

  await ds.goto(url);
  // The reason box at the top; the history repeats the reason further down.
  await expect(ds.getByRole("region", { name: "අමාත්‍යංශය මෙය ප්‍රතික්ෂේප කර ඇත" })).toContainText(
    "මෙම පවුලට වෙනත් නිවාස ආධාරයක් ලැබී ඇත.",
  );
});

test("Head Office corrects a verified case and its release, and both are saved (CASE-9, REL-4)", async ({
  page: ho,
}) => {
  test.slow();
  await signInAs(ho, "ho0001", /\/ministry$/);
  // Head Office enters the case itself for Homagama, then checks and releases it from its page.
  await ho.goto("/ministry/cases/new");
  const name = `${TEST_CASE_NAME} නිවැරදි ${Date.now()}`;
  await fillCase(ho, { name, nic: randomNic() });
  await ho.getByLabel("දිස්ත්‍රික්කය *").selectOption({ label: "කොළඹ" });
  await ho.getByLabel("ප්‍රාදේශීය ලේකම් කොට්ඨාසය *").selectOption({ label: "හෝමාගම" });
  const { url } = await saveNew(ho, "ministry");
  await ho.getByRole("button", { name: VERIFY, exact: true }).click();
  await ho.getByRole("dialog").getByRole("button", { name: "ඔව්, අනුමත කරන්න" }).click();
  await expect(ho).toHaveURL(`${url}?notice=verified`);

  // CASE-9: one save button, and the change is kept.
  await ho.getByRole("link", { name: "විස්තර සංස්කරණය කරන්න" }).click();
  await expect(ho.getByRole("button", { name: SAVE })).toBeHidden();
  await ho.getByLabel("දුරකතන අංකය", { exact: true }).fill("077 000 0909");
  await ho.getByRole("button", { name: "වෙනස්කම් සුරකින්න" }).click();
  await expect(ho).toHaveURL(`${url}?notice=changed`);
  await expect(ho.getByText("0770000909", { exact: true })).toBeVisible();

  // A verified case leads to its district's letter.
  await expect(ho.getByRole("region", { name: "රු. 2,000,000 නිදහස් කිරීම" })).toContainText(
    "කොළඹ දිස්ත්‍රික් ලේකම්ට යවන ප්‍රතිපාදන ලිපියකිනි",
  );
  await ho.getByRole("link", { name: "ලිපිය සටහන් කිරීමට යන්න →" }).click();
  await recordLetterFor(ho, [name], "MWCA/E2E-1");
  await ho.goto(url);

  // REL-4: the letter's number is corrected in a pop-up.
  await ho.getByRole("button", { name: "ලිපියේ විස්තර නිවැරදි කරන්න" }).click();
  const dialog = ho.getByRole("dialog");
  await expect(dialog).toContainText("මෙම ලිපිය මෙම ප්‍රතිලාභියා සඳහා පමණි.");
  await dialog.getByLabel("මගේ අංකය *").fill("MWCA/E2E-2");
  await dialog.getByRole("button", { name: "නිවැරදි කිරීම සුරකින්න" }).click();
  await expect(ho).toHaveURL(`${url}?notice=corrected`);
  await expect(ho.getByRole("region", { name: "මූල්‍ය ප්‍රගතිය" })).toContainText("MWCA/E2E-2");
  await expect(ho.getByRole("region", { name: "සිදු වූ දේ" })).toContainText("මගේ අංකය: MWCA/E2E-1 → MWCA/E2E-2");
});
