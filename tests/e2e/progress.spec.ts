import { expect, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { asUser, openAs, releasedCase, TODAY } from "./case-helpers";
import { signInAs } from "./helpers";

/** Screen text the tests look for (messages/si.json). */
const MONEY = "මූල්‍ය ප්‍රගතිය";
const STAGES = "භෞතික ප්‍රගතිය";
const HISTORY = "සිදු වූ දේ";
const START = "ගෙවීම ආරම්භ කරන්න";
const PAY = "ගෙවූ බව සටහන් කරන්න";
const UPDATE_STAGES = "භෞතික ප්‍රගතිය යාවත්කාලීන කරන්න";
const SAVE = "සුරකින්න";
const PROCESSING = "ගෙවීමට කටයුතු කරමින්";
const INSTALLMENTS = ["පළමු වාරිකය", "දෙවන වාරිකය", "තුන්වන වාරිකය", "සිව්වන වාරිකය"] as const;
const SHOWN_TODAY = TODAY.replaceAll("-", ".");

/** A made-up site photo with a GPS position in it, as a phone would save it (AC-16). */
function sitePhoto(): Promise<Buffer> {
  return sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#7d6650" } })
    .jpeg()
    .withExifMerge({
      IFD0: { Make: "E2ETestPhone" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "6/1 54/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "79/1 51/1 0/1" },
    })
    .toBuffer();
}

const money = (page: Page) => page.getByRole("region", { name: MONEY });

/** INS-3: starts the next installment's payment from the case page. */
async function startPayment(ds: Page, installment: string, purpose = "") {
  await money(ds).getByRole("button", { name: START }).click();
  const dialog = ds.getByRole("dialog", { name: `${installment}: ${START}` });
  await dialog.getByLabel("ගෙවීමට බලාපොරොත්තු වන දිනය *").fill(TODAY);
  if (purpose) await dialog.getByLabel("මෙම මුදල කුමකටද? (අවශ්‍ය නම් පමණි)").fill(purpose);
  await dialog.getByRole("button", { name: SAVE }).click();
  await expect(ds).toHaveURL(/\?notice=started$/);
}

/** INS-4: marks it paid today. */
async function markPaid(ds: Page, installment: string) {
  await money(ds).getByRole("button", { name: PAY }).click();
  const dialog = ds.getByRole("dialog", { name: `${installment} ${PAY}` });
  await expect(dialog.getByLabel("ගෙවූ දිනය *")).toHaveValue(TODAY);
  await dialog.getByRole("button", { name: SAVE }).click();
  await expect(ds).toHaveURL(/\?notice=(paid|completed)$/);
}

test("AC-11 to AC-13: the DS office pays in order, records progress with a photo, and the case finishes", async ({
  page: ds,
  browser,
}) => {
  // One case from release to completion: about 25 trips to the server, slower while other tests run.
  test.setTimeout(240_000);
  await signInAs(ds, "ds0101", /\/ds$/);
  const ho = await openAs(browser, "ho0001");
  const { url, name } = await releasedCase(ds, ho, "ප්‍රගතිය");
  await ds.goto(url);

  // AC-11: only the first installment has a button; the others wait for the one before.
  await expect(money(ds).getByRole("button", { name: START })).toHaveCount(1);
  await expect(money(ds)).toContainText("පළමු වාරිකය ගෙවූ පසු");
  await expect(money(ds)).toContainText("තුන්වන වාරිකය ගෙවූ පසු");

  // INS-3: the expected day is required.
  await money(ds).getByRole("button", { name: START }).click();
  const startDialog = ds.getByRole("dialog", { name: `පළමු වාරිකය: ${START}` });
  await startDialog.getByRole("button", { name: SAVE }).click();
  await expect(ds.locator("#installment-1-expectedOn-error")).toHaveText("දිනය ඇතුළත් කරන්න.");
  await startDialog.getByLabel("ගෙවීමට බලාපොරොත්තු වන දිනය *").fill(TODAY);
  await startDialog.getByLabel("මෙම මුදල කුමකටද? (අවශ්‍ය නම් පමණි)").fill("අත්තිවාරම සඳහා");
  await startDialog.getByRole("button", { name: SAVE }).click();
  await expect(ds).toHaveURL(`${url}?notice=started`);
  await expect(ds.getByRole("status")).toHaveText("ගෙවීම ආරම්භ කළ බව සුරකින ලදී.");
  await expect(money(ds).getByText(PROCESSING, { exact: true })).toBeVisible();
  await expect(money(ds)).toContainText("රු. 500,000 · අත්තිවාරම සඳහා");

  await markPaid(ds, "පළමු වාරිකය");
  await expect(ds.getByRole("status")).toHaveText("ගෙවූ බව සුරකින ලදී.");
  await expect(money(ds)).toContainText(`ගෙවූ දිනය: ${SHOWN_TODAY}`);

  // AC-12: choosing the third stage marks the two before it on the same day. The admin may have
  // renamed or reordered the stages, so their names come from the form.
  await ds.getByRole("button", { name: UPDATE_STAGES }).click();
  const stageDialog = ds.getByRole("dialog", { name: UPDATE_STAGES });
  const names = await stageDialog.getByTestId("stage-choice").allInnerTexts();
  const [first, second, third] = names;
  expect(names.length).toBeGreaterThanOrEqual(4);
  await expect(stageDialog.getByText(`${first}, ${second} ද එම දිනයෙන් ළඟා වූ ලෙස සටහන් වේ.`)).toBeVisible();
  await stageDialog.getByRole("radio", { name: new RegExp(`^${third}`) }).check();
  await ds
    .getByTestId("photo-input")
    .setInputFiles({ name: "site.png", mimeType: "image/png", buffer: await sitePhoto() });
  await expect(stageDialog.getByText("එක් කළා")).toBeVisible();
  await stageDialog.getByLabel("සටහන (අවශ්‍ය නම් පමණි)").fill("වහලය සවි කර ඇත.");
  await stageDialog.getByRole("button", { name: SAVE }).click();
  await expect(ds).toHaveURL(`${url}?notice=stage`);
  const stages = ds.getByRole("region", { name: STAGES });
  await expect(stages.getByText(`ළඟා වූ දිනය: ${SHOWN_TODAY}`)).toHaveCount(3);
  await expect(stages.getByText("ඊළඟ මට්ටම")).toBeVisible();

  // AC-16: the stored photo has no metadata, and another office can't open it.
  const thumbnail = stages.getByRole("button", { name: `${third}: ඡායාරූපය 1 විශාල කර බලන්න` });
  const thumbSrc = (await thumbnail.locator("img").getAttribute("src")) ?? "";
  const photoHref = thumbSrc.replace(/\/thumb$/, "");
  const stored = await ds.request.get(photoHref);
  expect(stored.status()).toBe(200);
  expect(stored.headers()["content-type"]).toBe("image/jpeg");
  const metadata = await sharp(await stored.body()).metadata();
  expect(metadata.exif).toBeUndefined();
  expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBe(1600);
  await asUser(browser, "ds0103", async (kaduwela) => {
    expect((await kaduwela.request.get(photoHref)).status()).toBe(404);
    expect((await kaduwela.request.get(thumbSrc)).status()).toBe(404);
  });

  // STG-6, HIS-2: Head Office sees the stages with the photo, and the history in plain sentences.
  await ho.goto(url.replace("/ds/", "/ministry/"));
  await ho
    .getByRole("region", { name: STAGES })
    .getByRole("button", { name: `${third}: ඡායාරූපය 1 විශාල කර බලන්න` })
    .click();
  const viewer = ho.getByRole("dialog", { name: `${third}: ඡායාරූපය 1 / 1` });
  await expect(viewer.getByRole("img", { name: `${third}: ඡායාරූපය 1` })).toBeVisible();
  await viewer.getByRole("button", { name: "වසන්න" }).click();
  const history = ho.getByRole("region", { name: HISTORY });
  await expect(history).toContainText(`ළඟා වූ මට්ටම: ${first}, ${second}, ${third} (${SHOWN_TODAY})`);
  await expect(history).toContainText(`පළමු වාරිකය ගෙවන ලදී (ගෙවූ දිනය ${SHOWN_TODAY})`);
  await expect(history).toContainText("(ප්‍රා.ලේ.)");
  await expect(history).toContainText("(අමාත්‍යංශය)");
  // Head Office records no progress itself.
  await expect(ho.getByRole("button", { name: UPDATE_STAGES })).toBeHidden();
  await expect(money(ho).getByRole("button", { name: START })).toBeHidden();

  // The other three installments, in order; paying the fourth doesn't finish the case yet.
  for (const installment of INSTALLMENTS.slice(1)) {
    await startPayment(ds, installment);
    await markPaid(ds, installment);
  }
  await expect(ds.getByRole("status")).toHaveText("ගෙවූ බව සුරකින ලදී.");
  await expect(money(ds).getByRole("button")).toHaveCount(0);

  // AC-13: reaching the last stage finishes it.
  await ds.getByRole("button", { name: UPDATE_STAGES }).click();
  await ds
    .getByRole("dialog")
    .getByRole("radio", { name: new RegExp(`^${names.at(-1)}`) })
    .check();
  await ds.getByRole("dialog").getByRole("button", { name: SAVE }).click();
  await expect(ds).toHaveURL(`${url}?notice=completed`);
  await expect(ds.getByText(`මෙම ව්‍යාපෘතිය ${SHOWN_TODAY} දින නිම විය.`, { exact: false })).toBeVisible();
  await expect(ds.getByRole("button", { name: UPDATE_STAGES })).toBeHidden();

  // The DS home shows the four paid, and the office is told.
  await ds.goto(`/ds?q=${encodeURIComponent(name)}`);
  const row = ds.getByRole("row", { name: new RegExp(name) });
  await expect(row).toContainText("4 / 4");
  await expect(row).toContainText("නිමයි");
  await expect(ds.getByRole("region", { name: "මුදල්" })).toContainText("දිස්ත්‍රික් ලේකම් කාර්යාලයෙන් ලැබුණු");
  await ds.goto("/ds/notifications");
  await expect(ds.getByRole("button", { name: new RegExp(`^${name} නිම කර ඇත`) })).toBeVisible();

  await ho.context().close();
});

test("INS-6: the Ministry undoes a payment, with a reason, and the DS can pay it again", async ({
  page: ds,
  browser,
}) => {
  test.slow();
  await signInAs(ds, "ds0101", /\/ds$/);
  const ho = await openAs(browser, "ho0001");
  const { url } = await releasedCase(ds, ho, "අවලංගු");
  await ds.goto(url);
  await startPayment(ds, "පළමු වාරිකය");
  await markPaid(ds, "පළමු වාරිකය");

  // INS-6: the last payment goes back, with a reason.
  const hoUrl = url.replace("/ds/", "/ministry/");
  await ho.goto(hoUrl);
  await money(ho).getByRole("button", { name: "ගෙවූ බව අවලංගු කරන්න" }).click();
  const undo = ho.getByRole("dialog", { name: "පළමු වාරිකය ගෙවූ බව අවලංගු කරන්නද?" });
  await undo.getByRole("button", { name: "ඔව්, අවලංගු කරන්න" }).click();
  await expect(ho.locator("#undo-reason-error")).toHaveText("හේතුව ඇතුළත් කරන්න.");
  await undo.getByLabel("අවලංගු කිරීමට හේතුව *").fill("ගෙවූ දිනය වැරදියි.");
  await undo.getByRole("button", { name: "ඔව්, අවලංගු කරන්න" }).click();
  await expect(ho).toHaveURL(`${hoUrl}?notice=undone`);
  await expect(money(ho).getByText(PROCESSING, { exact: true })).toBeVisible();
  await expect(ho.getByRole("region", { name: HISTORY })).toContainText("හේතුව: ගෙවූ දිනය වැරදියි.");

  // Nobody stops a case any more (change 0006).
  await expect(ho.getByRole("button", { name: "ව්‍යාපෘතිය නවත්වන්න" })).toHaveCount(0);

  await ds.goto(url);
  await expect(money(ds).getByRole("button", { name: PAY })).toBeVisible();

  await ho.context().close();
});
