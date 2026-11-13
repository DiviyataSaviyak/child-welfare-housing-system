import { expect, type Page, test } from "@playwright/test";
import {
  allocateAndRelease,
  fillCase,
  IN_PROGRESS,
  KIND,
  newSavedCase,
  openAs,
  randomNic,
  RECEIVED,
  releasedCase,
  saveNew,
  TODAY,
} from "./case-helpers";
import { signInAs, TEST_CASE_NAME } from "./helpers";

/** Change 0007's land kinds (CASE-17): their installments of amounts of their own, stages and completion. */

/** Screen text the tests look for (messages/si.json). */
const MONEY = "මූල්‍ය ප්‍රගතිය";
const STAGES = "භෞතික ප්‍රගතිය";
const HISTORY = "සිදු වූ දේ";
const START = "ගෙවීම ආරම්භ කරන්න";
const PAY = "ගෙවූ බව සටහන් කරන්න";
const CORRECT = "නිවැරදි කරන්න";
const UPDATE_STAGES = "භෞතික ප්‍රගතිය යාවත්කාලීන කරන්න";
const SAVE = "සුරකින්න";
const AMOUNT = "වාරිකයේ මුදල (රු.) *";
const ALL_STARTED = "මුළු ප්‍රතිපාදනයම ගෙවා ඇත හෝ ගෙවමින් පවතී.";
const NO_STAGE_LIST = "මෙම ආධාර වර්ගයට ඉදිකිරීම් මට්ටම් නැත.";
const SHOWN_TODAY = TODAY.replaceAll("-", ".");
/** The kind of help among the case page's details. */
const KIND_LABEL = "ලබා දෙන ආධාරය";

const money = (page: Page) => page.getByRole("region", { name: MONEY });

/** The value beside a label in a list of terms, such as the case page's details or the money panel. */
function figure(scope: Page | ReturnType<Page["getByRole"]>, label: string) {
  return scope.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");
}

/** INS-7: starts the next installment of a land case with its amount; the field offers the balance first. */
async function startLand(ds: Page, installment: string, amount: string, balance: string, purpose = "") {
  await money(ds).getByRole("button", { name: START }).click();
  const dialog = ds.getByRole("dialog", { name: `${installment}: ${START}` });
  await expect(dialog.getByLabel(AMOUNT)).toHaveValue(balance);
  await dialog.getByLabel(AMOUNT).fill(amount);
  await dialog.getByLabel("ගෙවීමට බලාපොරොත්තු වන දිනය *").fill(TODAY);
  if (purpose) await dialog.getByLabel("මෙම මුදල කුමකටද? (අවශ්‍ය නම් පමණි)").fill(purpose);
  await dialog.getByRole("button", { name: SAVE }).click();
  await expect(ds).toHaveURL(/\?notice=started$/);
}

/** INS-4: marks the installment being paid as paid today. */
async function markPaid(ds: Page, installment: string, notice: "paid" | "completed" = "paid") {
  await money(ds).getByRole("button", { name: PAY }).click();
  await ds
    .getByRole("dialog", { name: `${installment} ${PAY}` })
    .getByRole("button", { name: SAVE })
    .click();
  await expect(ds).toHaveURL(new RegExp(`\\?notice=${notice}$`));
}

test("AC-62: a case to buy land and build, in Mahara, is paid in two installments of its own amounts", async ({
  page: ds,
  browser,
}) => {
  test.setTimeout(240_000);
  await signInAs(ds, "ds0106", /\/ds$/);
  const ho = await openAs(browser, "ho0001");
  const gampaha = await openAs(browser, "dt0104");

  // CASE-17: the land kind, with the land asked once, in the same DS division, and its GN division.
  await ds.goto("/ds/cases/new");
  const name = `${TEST_CASE_NAME} ඉඩම ${Date.now()}`;
  await fillCase(ds, { name, nic: randomNic(), kind: "LAND_AND_BUILD" });
  await expect(ds.getByRole("heading", { name: "ඉඩම පිහිටි ස්ථානය *" })).toHaveCount(1);
  await expect(ds.getByTestId("land-place")).toContainText("මහර");
  await ds.getByLabel("ඉඩම පිහිටි ග්‍රාම නිලධාරී වසම").fill("පරීක්ෂණ වසම");
  const { url } = await saveNew(ds, "ds");
  const caseId = url.split("/").at(-1) ?? "";
  await expect(figure(ds, KIND_LABEL)).toHaveText(KIND.LAND_AND_BUILD);
  await expect(figure(ds, "ඉඩම පිහිටි ස්ථානය")).toContainText("ගම්පහ");
  await expect(figure(ds, "ඉඩමේ ග්‍රාම නිලධාරී වසම")).toHaveText("පරීක්ෂණ වසම");

  // REL-7: the Ministry's letter goes to Gampaha, whose District CRPO releases it to Mahara; the case has its
  // allocation and no installments, only the next one to start, for the whole balance.
  await allocateAndRelease(ho, gampaha, { caseId, name }, "මහර", `AC-62-${Date.now()}`);
  await ds.goto(url);
  await expect(ds.getByText(RECEIVED, { exact: true }).first()).toBeVisible();
  await expect(money(ds).getByRole("row")).toHaveCount(2);
  await expect(money(ds)).toContainText("ගෙවීමට ඉතිරි මුදල රු. 2,000,000");

  // INS-7: installment 1 buys the land for Rs. 900,000; paying it puts the case in progress (INS-5).
  await startLand(ds, "පළමු වාරිකය", "900,000", "2000000", "ඉඩම මිලදී ගැනීම");
  await expect(money(ds)).toContainText("රු. 900,000 · ඉඩම මිලදී ගැනීම");
  await markPaid(ds, "පළමු වාරිකය");
  await expect(ds.getByText(IN_PROGRESS, { exact: true }).first()).toBeVisible();
  await expect(money(ds)).toContainText("ගෙවීමට ඉතිරි මුදල රු. 1,100,000");

  // More than the balance is refused; Rs. 450,000 is accepted.
  await money(ds).getByRole("button", { name: START }).click();
  const second = ds.getByRole("dialog", { name: `දෙවන වාරිකය: ${START}` });
  await expect(second).toContainText("ගෙවීමට ඉතිරි මුදල රු. 1,100,000.");
  await second.getByLabel(AMOUNT).fill("1200000");
  await second.getByLabel("ගෙවීමට බලාපොරොත්තු වන දිනය *").fill(TODAY);
  await second.getByRole("button", { name: SAVE }).click();
  await expect(ds.locator("#installment-2-amount-error")).toHaveText("මුදල ගෙවීමට ඉතිරි මුදලට වඩා වැඩි විය නොහැක.");
  await second.getByLabel(AMOUNT).fill("450000");
  await second.getByRole("button", { name: SAVE }).click();
  await expect(ds).toHaveURL(`${url}?notice=started`);
  await expect(money(ds)).toContainText("රු. 450,000");

  // INS-8: corrected to Rs. 400,000 while it is being paid, then paid.
  await money(ds).getByRole("button", { name: CORRECT }).click();
  const correct = ds.getByRole("dialog", { name: `දෙවන වාරිකය: විස්තර ${CORRECT}` });
  await expect(correct.getByLabel(AMOUNT)).toHaveValue("450000");
  await correct.getByLabel(AMOUNT).fill("400000");
  await correct.getByRole("button", { name: SAVE }).click();
  await expect(ds).toHaveURL(`${url}?notice=corrected`);
  await expect(ds.getByRole("status")).toHaveText("වාරිකයේ විස්තර නිවැරදි කළා.");
  await expect(money(ds)).toContainText("රු. 400,000");
  await markPaid(ds, "දෙවන වාරිකය");
  await expect(money(ds)).toContainText("ගෙවීමට ඉතිරි මුදල රු. 700,000");

  // HIS-1, HIS-2: the history names each amount and the correction.
  const history = ds.getByRole("region", { name: HISTORY });
  await expect(history).toContainText(`පළමු වාරිකය ගෙවන ලදී: රු. 900,000 (ගෙවූ දිනය ${SHOWN_TODAY})`);
  await expect(history).toContainText("දෙවන වාරිකය විස්තර නිවැරදි කළා");
  await expect(history).toContainText(`දෙවන වාරිකය ගෙවන ලදී: රු. 400,000 (ගෙවූ දිනය ${SHOWN_TODAY})`);

  // STG-4: buying land and building follows the new-house stages.
  await expect(ds.getByRole("region", { name: STAGES })).not.toContainText(NO_STAGE_LIST);
  await ds.getByRole("button", { name: UPDATE_STAGES }).click();
  expect(await ds.getByRole("dialog").getByTestId("stage-choice").count()).toBeGreaterThanOrEqual(4);
  await ds.keyboard.press("Escape");

  // HOME-4: Mahara's money panel counts Rs. 1,300,000 paid out; no other test pays in Mahara.
  await ds.goto("/ds");
  const panel = ds.getByRole("region", { name: "මුදල්" });
  await expect(figure(panel, "දිස්ත්‍රික් ලේකම් කාර්යාලයෙන් ලැබුණු")).toHaveText("රු. 2,000,000");
  await expect(figure(panel, "ප්‍රතිලාභීන්ට ගෙවූ")).toHaveText("රු. 1,300,000");
  await expect(figure(panel, "ඔබ සතුව ඉතිරි")).toHaveText("රු. 700,000");

  // DSH-1: so does the Ministry's dashboard, for Gampaha's cases to buy land and build.
  await ho.goto("/ministry");
  await ho.getByRole("table", { name: "දිස්ත්‍රික්ක අනුව" }).getByRole("link", { name: "ගම්පහ", exact: true }).click();
  await expect(ho).toHaveURL(/\/ministry\?districtId=\d+$/);
  await ho.getByLabel("ආධාරය").selectOption({ label: "ඉඩමක් සහ ඉදිකිරීම" });
  await ho.getByRole("button", { name: "පෙන්වන්න" }).click();
  await expect(ho).toHaveURL(/\/ministry\?districtId=\d+&category=&kind=LAND_AND_BUILD$/);
  await expect(figure(ho, "ප්‍රතිලාභීන්ට ගෙවූ \\(රු\\.\\)")).toHaveText("1,300,000");

  for (const page of [ho, gampaha]) await page.context().close();
});

test("AC-63: a case to buy land only is paid Rs. 1,500,000 and Rs. 500,000 and completed with no stage", async ({
  page: ds,
  browser,
}) => {
  test.setTimeout(180_000);
  await signInAs(ds, "ds0101", /\/ds$/);
  const ho = await openAs(browser, "ho0001");
  const district = await openAs(browser, "dt0103");
  const { url } = await releasedCase(ds, ho, district, "ඉඩම පමණක්", "LAND_ONLY");
  await ds.goto(url);

  // STG-4: no stage list, only visits with notes and photos.
  await expect(ds.getByRole("region", { name: STAGES })).toContainText(NO_STAGE_LIST);

  await startLand(ds, "පළමු වාරිකය", "1500000", "2000000", "ඉඩම මිලදී ගැනීම");
  await markPaid(ds, "පළමු වාරිකය");
  // The balance is offered; INS-7 lets the case finish in two.
  await startLand(ds, "දෙවන වාරිකය", "500000", "500000");
  await expect(money(ds)).toContainText(ALL_STARTED);
  await markPaid(ds, "දෙවන වාරිකය", "completed");

  // CLS-1: the money alone completes it, and no third installment can start.
  await expect(ds.getByText(`මෙම ව්‍යාපෘතිය ${SHOWN_TODAY} දින නිම විය.`, { exact: false })).toBeVisible();
  await expect(money(ds).getByRole("button")).toHaveCount(0);
  await expect(money(ds)).not.toContainText("තුන්වන වාරිකය");

  for (const page of [ho, district]) await page.context().close();
});

test("AC-63: a case to buy land and build, paid in full, is completed only at the last new-house stage", async ({
  page: ds,
  browser,
}) => {
  test.setTimeout(180_000);
  await signInAs(ds, "ds0101", /\/ds$/);
  const ho = await openAs(browser, "ho0001");
  const district = await openAs(browser, "dt0103");
  const { url } = await releasedCase(ds, ho, district, "ඉඩම සහ ඉදිකිරීම", "LAND_AND_BUILD");
  await ds.goto(url);

  // The whole Rs. 2,000,000 in one installment doesn't finish it: the stages still have to be reached.
  await startLand(ds, "පළමු වාරිකය", "2000000", "2000000", "ඉඩම මිලදී ගැනීම");
  await markPaid(ds, "පළමු වාරිකය");
  await expect(money(ds)).toContainText(ALL_STARTED);
  await expect(ds.getByText(IN_PROGRESS, { exact: true }).first()).toBeVisible();

  await ds.getByRole("button", { name: UPDATE_STAGES }).click();
  const dialog = ds.getByRole("dialog", { name: UPDATE_STAGES });
  const names = await dialog.getByTestId("stage-choice").allInnerTexts();
  await dialog.getByRole("radio", { name: new RegExp(`^${names.at(-1)}`) }).check();
  await dialog.getByRole("button", { name: SAVE }).click();
  await expect(ds).toHaveURL(`${url}?notice=completed`);
  await expect(ds.getByText(`මෙම ව්‍යාපෘතිය ${SHOWN_TODAY} දින නිම විය.`, { exact: false })).toBeVisible();

  for (const page of [ho, district]) await page.context().close();
});

test("AC-63: the kind changes freely before the District's release, and only within its group after it", async ({
  page: ds,
  browser,
}) => {
  test.setTimeout(180_000);
  await signInAs(ds, "ds0101", /\/ds$/);

  // CASE-9: before the release, a new house becomes a case to buy land only.
  const before = await newSavedCase(ds, { name: `${TEST_CASE_NAME} වර්ගය ${Date.now()}`, nic: randomNic() });
  await ds.getByRole("link", { name: "විස්තර සංස්කරණය කරන්න" }).click();
  await ds.getByRole("radio", { name: new RegExp(`^${KIND.LAND_ONLY}`) }).check();
  await ds.getByRole("button", { name: "වෙනස්කම් සුරකින්න" }).click();
  await expect(ds).toHaveURL(`${before.url}?notice=changed`);
  await expect(figure(ds, KIND_LABEL)).toHaveText(KIND.LAND_ONLY);

  // After it, the Ministry is offered only the house kinds for a new house, and changes it to a renovation.
  // A land kind sent to the server directly is refused too (kindGroupLocked, progress.db.test.ts).
  const ho = await openAs(browser, "ho0001");
  const district = await openAs(browser, "dt0103");
  const { caseId } = await releasedCase(ds, ho, district, "වර්ගය");
  await ho.goto(`/ministry/cases/${caseId}/edit`);
  await expect(ho.getByRole("radio", { name: new RegExp(`^${KIND.NEW_HOUSE}`) })).toBeChecked();
  for (const kind of [KIND.LAND_ONLY, KIND.LAND_AND_BUILD, KIND.LAND_WITH_HOUSE]) {
    await expect(ho.getByRole("radio", { name: new RegExp(`^${kind}`) })).toHaveCount(0);
  }
  await ho.getByRole("radio", { name: new RegExp(`^${KIND.RENOVATION}`) }).check();
  await ho.getByRole("button", { name: "වෙනස්කම් සුරකින්න" }).click();
  await expect(ho).toHaveURL(new RegExp(`/ministry/cases/${caseId}\\?notice=changed$`));
  await expect(figure(ho, KIND_LABEL)).toHaveText(KIND.RENOVATION);

  for (const page of [ho, district]) await page.context().close();
});

test("AC-65: the kind filters offer the five kinds and find each one's cases; stage lists are for houses only", async ({
  page: ds,
  browser,
}) => {
  test.setTimeout(180_000);
  await signInAs(ds, "ds0101", /\/ds$/);
  const stamp = `${TEST_CASE_NAME} පෙරහන ${Date.now()}`;
  const kinds = Object.keys(KIND) as (keyof typeof KIND)[];
  const numbers = new Map<string, string>();
  for (const kind of kinds) {
    const { number } = await newSavedCase(ds, { name: `${stamp} ${kind}`, nic: randomNic(), kind });
    numbers.set(kind, number);
  }

  // FND-1: the Ministry's case list finds each kind's case, and only it.
  const ho = await openAs(browser, "ho0001");
  await ho.goto(`/ministry/cases?q=${encodeURIComponent(stamp)}`);
  await expect(ho.getByLabel("ආධාරය").locator("option:not([value=''])")).toHaveCount(5);
  for (const kind of kinds) {
    await ho.goto(`/ministry/cases?q=${encodeURIComponent(stamp)}&kind=${kind}`);
    await expect(ho.getByText("ගැළපෙන ප්‍රතිලාභීන් 1")).toBeVisible();
    await expect(ho.getByRole("row").filter({ hasText: numbers.get(kind)! })).toContainText(`${stamp} ${kind}`);
  }

  // DSH-1: the dashboard's kind filter offers them too.
  await ho.goto("/ministry");
  await expect(ho.getByLabel("ආධාරය").locator("option:not([value=''])")).toHaveCount(5);
  await ho.getByLabel("ආධාරය").selectOption({ label: "ඉඩමක් සහ නිවසක්" });
  await ho.getByRole("button", { name: "පෙන්වන්න" }).click();
  await expect(ho).toHaveURL(/\/ministry\?districtId=&category=&kind=LAND_WITH_HOUSE$/);

  // LST-4: the admin keeps stage lists for a new house and a renovation only.
  const admin = await openAs(browser, "ad0001");
  await admin.goto("/admin/lists?tab=stages");
  await expect(admin.getByRole("region", { name: KIND.NEW_HOUSE })).toBeVisible();
  await expect(admin.getByRole("region", { name: KIND.RENOVATION })).toBeVisible();
  for (const kind of [KIND.LAND_ONLY, KIND.LAND_AND_BUILD, KIND.LAND_WITH_HOUSE]) {
    await expect(admin.getByRole("region", { name: kind })).toHaveCount(0);
  }

  for (const page of [ho, admin]) await page.context().close();
});
