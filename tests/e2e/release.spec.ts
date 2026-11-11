import { expect, test } from "@playwright/test";
import { fillCase, newSavedCase, openAs, randomNic, recordLetterFor, SAVE, saveNew, TODAY } from "./case-helpers";
import { signInAs, TEST_CASE_NAME, TEXT } from "./helpers";

/** Screen text the tests look for (messages/si.json). */
const LETTERS_MENU = "ප්‍රතිපාදන මුදා හැරීමට";
const LETTER = /^ලිපිය සටහන් කරන්න · /;
const NOT_STARTED = "තවම ආරම්භ කර නැත";
const ALLOCATED = "දිස්ත්‍රික්කයට මුදා හැර ඇත";

test("AC-52: the DS saves a case, and the Ministry allocates it to its district on a letter, with nothing ticked to start with", async ({
  page: ds,
  browser,
}) => {
  test.slow();
  const ho = await openAs(browser, "ho0001");
  const name = `${TEST_CASE_NAME} ප්‍රතිපාදන ${Date.now()}`;
  await signInAs(ds, "ds0101", /\/ds$/);
  const { url } = await newSavedCase(ds, { name, nic: randomNic() });
  const caseId = url.split("/").at(-1) ?? "";

  // The case awaits its allocation at once, and the menu counts it (REL-1, NTF-1). There is no check queue,
  // and the old addresses lead to the allocation screen.
  await ho.goto("/ministry");
  await expect(
    ho.getByRole("link", { name: new RegExp(`^${LETTERS_MENU} \\(බලා සිටින ප්‍රතිලාභීන් \\d+\\)$`) }),
  ).toBeVisible();
  for (const old of ["/ministry/check", "/ministry/release"]) {
    await ho.goto(old);
    await expect(ho).toHaveURL(/\/ministry\/allocate$/);
  }

  // REL-2: under Colombo's letter with Homagama's cases, nothing ticked; "tick all" ticks the district;
  // a letter with no case or no number is refused, and the total follows the ticks.
  await ho.getByRole("link", { name: /^කොළඹ දිස්ත්‍රික්කය/ }).click();
  const letter = ho.getByRole("region", { name: "කොළඹ දිස්ත්‍රික්කය", exact: true });
  const box = letter.getByRole("checkbox", { name: new RegExp(name) });
  await expect(box).not.toBeChecked();
  await expect(letter.getByTestId("letter-total")).toHaveText("රු. 0");
  const all = letter.getByRole("checkbox", { name: "කොළඹ දිස්ත්‍රික්කයේ සියල්ල තෝරන්න" });
  await all.check();
  await expect(box).toBeChecked();
  await all.uncheck();
  await expect(box).not.toBeChecked();
  await letter.getByRole("button", { name: LETTER }).click();
  await expect(letter.locator("#letter-error")).toHaveText("ලිපියේ නම් ඇති අවම වශයෙන් එක් ප්‍රතිලාභියෙකු තෝරන්න.");
  await box.check();
  await expect(letter.getByTestId("letter-total")).toHaveText("රු. 2,000,000");
  await letter.getByRole("button", { name: LETTER }).click();
  await expect(letter.locator("#letter-letterNumber-error")).toHaveText("මගේ අංකය ඇතුළත් කරන්න.");
  await letter.getByLabel("මගේ අංකය *").fill("MWCA/3/8/16/E2E-2026");
  await letter.getByRole("button", { name: LETTER }).click();
  await expect(ho).toHaveURL(/\/ministry\/allocate\?notice=letterRecorded&letter=[\w-]+&districtId=\d+$/);
  await expect(ho.getByRole("status")).toContainText(
    "කොළඹ දිස්ත්‍රික්කයට ලිපිය MWCA/3/8/16/E2E-2026 සටහන් කළා: ප්‍රතිලාභීන් 1, රු. 2,000,000.",
  );
  await expect(
    ho.getByRole("region", { name: "සටහන් කළ ලිපි" }).getByText("කොළඹ · MWCA/3/8/16/E2E-2026"),
  ).toBeVisible();

  // REL-3: released to the district, with the letter on the case and no installments yet.
  await ho.goto(`/ministry/cases/${caseId}`);
  await expect(ho.getByText(ALLOCATED, { exact: true }).first()).toBeVisible();
  const money = ho.getByRole("region", { name: "මූල්‍ය ප්‍රගතිය" });
  await expect(money).toContainText("ප්‍රතිපාදන ලිපිය MWCA/3/8/16/E2E-2026");
  await expect(money).toContainText("කොළඹ දිස්ත්‍රික් ලේකම් වෙත · ප්‍රතිලාභීන් 1, මුළු රු. 2,000,000");
  await expect(money).toContainText("අමාත්‍යංශය කොළඹ දිස්ත්‍රික්කයට රු. 2,000,000 මුදා හැර ඇත.");
  await expect(money.getByText(NOT_STARTED, { exact: true })).toHaveCount(0);

  // NTF-1: the DS is notified; opening the notice shows the case, still waiting for the District.
  await ds.goto("/ds/notifications");
  const notice = ds.getByRole("button", {
    name: new RegExp(`^${name} සඳහා ප්‍රතිපාදන දිස්ත්‍රික්කයට මුදා හැර ඇත`),
  });
  await expect(notice).toContainText("අලුත්");
  await notice.click();
  await expect(ds).toHaveURL(new RegExp(`/ds/cases/${caseId}$`));
  const dsMoney = ds.getByRole("region", { name: "මූල්‍ය ප්‍රගතිය" });
  await expect(dsMoney).toContainText(
    "අමාත්‍යංශය මෙම ප්‍රතිලාභියා සඳහා කොළඹ දිස්ත්‍රික්කයට රු. 2,000,000 මුදා හැර ඇත.",
  );
  await expect(dsMoney.getByText(NOT_STARTED, { exact: true })).toHaveCount(0);
  await ds.goto("/ds/notifications");
  await expect(ds.getByRole("button", { name: new RegExp(`^${name} සඳහා`) })).not.toContainText("අලුත්");

  await ho.context().close();
});

test("the Ministry corrects a case awaiting its allocation and its allocation letter, and both are saved (CASE-9, REL-4)", async ({
  page: ho,
}) => {
  test.slow();
  await signInAs(ho, "ho0001", /\/ministry$/);
  // The Ministry enters the case itself for Homagama, then allocates it from its page.
  await ho.goto("/ministry/cases/new");
  const name = `${TEST_CASE_NAME} නිවැරදි ${Date.now()}`;
  await fillCase(ho, { name, nic: randomNic() });
  await ho.getByLabel("දිස්ත්‍රික්කය *").selectOption({ label: "කොළඹ" });
  await ho.getByLabel("ප්‍රාදේශීය ලේකම් කොට්ඨාසය *", { exact: true }).selectOption({ label: "හෝමාගම" });
  const { url } = await saveNew(ho, "ministry");

  // CASE-9: one save button, and the change is kept.
  await ho.getByRole("link", { name: "විස්තර සංස්කරණය කරන්න" }).click();
  await expect(ho.getByRole("button", { name: SAVE })).toBeHidden();
  await ho.getByLabel("දුරකතන අංකය", { exact: true }).fill("077 000 0909");
  await ho.getByRole("button", { name: "වෙනස්කම් සුරකින්න" }).click();
  await expect(ho).toHaveURL(`${url}?notice=changed`);
  await expect(ho.getByText("0770000909", { exact: true })).toBeVisible();

  // A case awaiting its allocation leads to its district's letter.
  await expect(ho.getByRole("region", { name: "රු. 2,000,000 ප්‍රතිපාදන මුදා හැරීම" })).toContainText(
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

test("AC-53, AC-54, AC-57: the District CRPO releases a case to its DS office, which gets its installments, and corrects the release", async ({
  page: ds,
  browser,
}) => {
  test.slow();
  const RELEASE_MENU = "ප්‍රා.ලේ. කාර්යාලවලට මුදා හැරීමට";
  const SAVE_RELEASE = /^මුදා හැරීම සටහන් කරන්න · /;
  const yesterday = new Date(`${TODAY}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const ho = await openAs(browser, "ho0001");
  const district = await openAs(browser, "dt0103");
  await signInAs(ds, "ds0101", /\/ds$/);
  const name = `${TEST_CASE_NAME} දිස්ත්‍රික් ${Date.now()}`;
  const { url } = await newSavedCase(ds, { name, nic: randomNic() });
  const caseId = url.split("/").at(-1) ?? "";
  const letterNumber = `MWCA/E2E/D-${Date.now()}`;
  await ho.goto(`/ministry/cases/${caseId}`);
  await ho.getByRole("link", { name: "ලිපිය සටහන් කිරීමට යන්න →" }).click();
  await recordLetterFor(ho, [name], letterNumber);

  // NTF-1: the menu counts the district's cases waiting for its release, and the bell names the letter.
  await district.goto("/oversight");
  await expect(
    district.getByRole("link", { name: new RegExp(`^${RELEASE_MENU} \\(බලා සිටින ප්‍රතිලාභීන් \\d+\\)$`) }),
  ).toBeVisible();
  await district.goto("/oversight/notifications");
  await district
    .getByRole("button", { name: new RegExp(`^අමාත්‍යංශයේ ප්‍රතිපාදන ලිපිය ${letterNumber} · ප්‍රතිලාභීන් 1`) })
    .click();
  await expect(district).toHaveURL(/\/oversight\/release$/);

  // REL-5, REL-6: Homagama waits; its form starts with nothing ticked, and refuses no case and a date
  // before the Ministry's letter.
  await district.getByRole("link", { name: /^හෝමාගම ප්‍රා\.ලේ\. කාර්යාලය/ }).click();
  const box = district.getByRole("group", { name: "මුදා හරින ප්‍රතිලාභීන්" }).getByRole("checkbox", {
    name: new RegExp(name),
  });
  await expect(box).not.toBeChecked();
  await expect(district.getByTestId("release-total")).toHaveText("රු. 0");
  await district.getByRole("button", { name: SAVE_RELEASE }).click();
  await expect(district.locator("#release-error")).toHaveText("මුදා හරින අවම වශයෙන් එක් ප්‍රතිලාභියෙකු තෝරන්න.");
  await box.check();
  await expect(district.getByTestId("release-total")).toHaveText("රු. 2,000,000");
  await district.getByLabel("යොමු අංකය *").fill("DS/E2E/AC-53");
  await district.getByLabel("මුදා හැරි දිනය *").fill(yesterday.toISOString().slice(0, 10));
  await district.getByRole("button", { name: SAVE_RELEASE }).click();
  await expect(district.locator("#release-releasedOn-error")).toHaveText(
    "මුදා හැරි දිනය, එහි ඇති ප්‍රතිලාභියෙකුගේ අමාත්‍යංශ ලිපියේ දිනයට පෙර විය නොහැක.",
  );
  await district.getByLabel("මුදා හැරි දිනය *").fill(TODAY);
  await district.getByRole("button", { name: SAVE_RELEASE }).click();
  await expect(district).toHaveURL(/\/oversight\/release\?notice=released&release=[\w-]+$/);
  await expect(district.getByRole("status")).toContainText(
    "හෝමාගම ප්‍රා.ලේ. කාර්යාලයට මුදා හැරීම DS/E2E/AC-53 සටහන් කළා: ප්‍රතිලාභීන් 1, රු. 2,000,000.",
  );
  await expect(district.getByRole("region", { name: "සටහන් කළ මුදා හැරීම්" })).toContainText("හෝමාගම · DS/E2E/AC-53");

  // REL-7: the DS hears of it, and the case has its allocation received with four installments not started.
  await ds.goto("/ds/notifications");
  await ds
    .getByRole("button", { name: new RegExp(`^${name} සඳහා දිස්ත්‍රික් ලේකම් කාර්යාලය රු. 2,000,000 මුදා හැර ඇත`) })
    .click();
  await expect(ds).toHaveURL(new RegExp(`/ds/cases/${caseId}$`));
  await expect(ds.getByText("ප්‍රතිපාදන ලැබී ඇත", { exact: true }).first()).toBeVisible();
  const money = ds.getByRole("region", { name: "මූල්‍ය ප්‍රගතිය" });
  await expect(money).toContainText(`ප්‍රතිපාදන ලිපිය ${letterNumber}`);
  await expect(money).toContainText("දිස්ත්‍රික් මුදා හැරීම DS/E2E/AC-53");
  await expect(money.getByText("තවම ආරම්භ කර නැත", { exact: true })).toHaveCount(4);

  // AC-54: the District Secretary and the Ministry see the release but can't record or correct one.
  const secretary = await openAs(browser, "dt0101");
  await expect(secretary.getByRole("link", { name: new RegExp(`^${RELEASE_MENU}`) })).toHaveCount(0);
  await secretary.goto(`/oversight/cases/${caseId}`);
  await expect(secretary.getByRole("region", { name: "මූල්‍ය ප්‍රගතිය" })).toContainText("DS/E2E/AC-53");
  await expect(secretary.getByRole("button", { name: "මුදා හැරීමේ විස්තර නිවැරදි කරන්න" })).toHaveCount(0);
  for (const page of [secretary, ho]) {
    await page.goto("/oversight/release");
    await expect(page.getByRole("heading", { name: TEXT.notFound })).toBeVisible();
  }
  await secretary.context().close();

  // AC-57: the CRPO corrects the release's reference from the case page, and the history says so.
  await district.goto(`/oversight/cases/${caseId}`);
  await district.getByRole("button", { name: "මුදා හැරීමේ විස්තර නිවැරදි කරන්න" }).click();
  const dialog = district.getByRole("dialog");
  await expect(dialog).toContainText("මෙම මුදා හැරීම මෙම ප්‍රතිලාභියා සඳහා පමණි.");
  await dialog.getByLabel("යොමු අංකය *").fill("DS/E2E/AC-57");
  await dialog.getByRole("button", { name: "නිවැරදි කිරීම සුරකින්න" }).click();
  await expect(district).toHaveURL(new RegExp(`/oversight/cases/${caseId}\\?notice=dsCorrected$`));
  await expect(district.getByRole("status")).toContainText("දිස්ත්‍රික් මුදා හැරීමේ විස්තර නිවැරදි කළා.");
  await expect(district.getByRole("region", { name: "මූල්‍ය ප්‍රගතිය" })).toContainText("DS/E2E/AC-57");
  await expect(district.getByRole("region", { name: "සිදු වූ දේ" })).toContainText(
    "යොමු අංකය: DS/E2E/AC-53 → DS/E2E/AC-57",
  );

  await ho.context().close();
  await district.context().close();
});
