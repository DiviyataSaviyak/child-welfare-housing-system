import { type Browser, expect, type Page, test } from "@playwright/test";
import { transliterate } from "../../src/lib/transliterate";
import {
  askForCode,
  chooseLanguage,
  lastCodeSentTo,
  randomLetters,
  signIn,
  signInAs,
  signInError,
  TEST_MARKER,
  TEST_OFFICER_NAME,
  TEXT,
} from "./helpers";

const DS_OFFICER = /ප්‍රාදේශීය ලේකම් කාර්යාල නිලධාරී/;

/**
 * The Gampaha offices have no sample officer. Each test that creates one uses its own office, so it sees
 * only its own officers; tests/e2e/cleanup.ts deletes them again before each run.
 */
const OFFICES = {
  signIn: "ගම්පහ",
  second: "වත්තල",
  moveFrom: "මීගමුව",
  moveTo: "කැලණිය",
  disable: "මිනුවන්ගොඩ",
  resetByEmail: "අත්තනගල්ල",
} as const;

/** Creates a Divisional Secretariat Officer through the admin screens; returns the credentials shown once. */
async function createOfficer(page: Page, office: string, email = ""): Promise<{ username: string; password: string }> {
  await page.goto("/admin/users");
  await page.getByRole("link", { name: "නව පරිශීලකයෙකු එක් කරන්න" }).click();
  await page.getByLabel("සම්පූර්ණ නම *").fill(TEST_OFFICER_NAME);
  await page.getByLabel("තනතුර (අවශ්‍ය නම් පමණි)").fill("සංවර්ධන නිලධාරී");
  await page.getByLabel("ජංගම දුරකතන අංකය *").fill("071 000 0301");
  await page.getByLabel("ඊමේල් (අවශ්‍ය නම් පමණි)").fill(email);
  await page.getByRole("radio", { name: DS_OFFICER }).check();
  await page.getByLabel("දිස්ත්‍රික්කය *").selectOption({ label: "ගම්පහ" });
  await page.getByRole("radio", { name: new RegExp(`^${office}`) }).check();
  await page.getByRole("button", { name: "ගිණුම සාදන්න" }).click();

  await expect(page.getByRole("heading", { name: "ගිණුම සාදන ලදී" })).toBeVisible();
  return {
    username: await page.getByTestId("new-username").innerText(),
    password: await page.getByTestId("new-password").innerText(),
  };
}

/** A second browser window for the new officer, next to the admin's. */
async function asNewOfficer(browser: Browser, run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "si-LK" });
  try {
    await run(await context.newPage());
  } finally {
    await context.close();
  }
}

async function openRow(page: Page, username: string) {
  await page.goto(`/admin/users?q=${username}`);
  await expect(page.getByRole("row")).toHaveCount(2);
}

test("AC-3: the admin creates a DS officer, who signs in and must set a new password", async ({ page, browser }) => {
  // Two browser windows and several page loads; the dev server compiles each page on first use.
  test.slow();
  await signInAs(page, "ad0001", /\/admin\/users$/);
  const { username, password } = await createOfficer(page, OFFICES.signIn);
  expect(username).toMatch(/^ds\d{4}$/);
  expect(password).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);

  await asNewOfficer(browser, async (officer) => {
    await signIn(officer, username, password);
    await expect(officer).toHaveURL(/\/change-password$/);
    await officer.getByLabel("දැනට ඇති මුරපදය").fill(password);
    await officer.getByLabel("නව මුරපදය", { exact: true }).fill("Officer-Own-Pass-1");
    await officer.getByLabel("නව මුරපදය නැවත").fill("Officer-Own-Pass-1");
    await officer.getByRole("button", { name: "සුරකින්න" }).click();
    await expect(officer).toHaveURL(/\/ds$/);
    await expect(officer.getByRole("banner")).toContainText(`${OFFICES.signIn} ප්‍රාදේශීය ලේකම් කාර්යාලය`);
  });
});

test("the form explains what is wrong and keeps what was typed", async ({ page }) => {
  await signInAs(page, "ad0001", /\/admin\/users$/);
  await page.goto("/admin/users/new");
  await page.getByLabel("සම්පූර්ණ නම *").fill(TEST_OFFICER_NAME);
  await page.getByLabel("ජංගම දුරකතන අංකය *").fill("12345");
  await page.getByRole("radio", { name: DS_OFFICER }).check();
  await page.getByRole("button", { name: "ගිණුම සාදන්න" }).click();

  await expect(page.getByText("0 න් පටන් ගන්නා ඉලක්කම් 10ක දුරකතන අංකයක් ඇතුළත් කරන්න.")).toBeVisible();
  await expect(page.getByText("ප්‍රාදේශීය ලේකම් කාර්යාලය තෝරන්න.")).toBeVisible();
  await expect(page.getByLabel("සම්පූර්ණ නම *")).toHaveValue(TEST_OFFICER_NAME);
});

// AC-23: both officers getting the office's notices is in src/server/cases/review.db.test.ts.
test("AC-23: an office that has an officer takes a second one (ADM-3)", async ({ page }) => {
  test.slow();
  await signInAs(page, "ad0001", /\/admin\/users$/);
  const officersOnList = async () => {
    await page.goto("/admin/lists");
    await page.getByRole("link", { name: /^ගම්පහ/ }).click();
    await expect(page.getByRole("heading", { name: "ගම්පහ දිස්ත්‍රික්කය" })).toBeVisible();
    return page.getByRole("row").filter({ hasText: OFFICES.second }).getByText(TEST_OFFICER_NAME);
  };
  await createOfficer(page, OFFICES.second);
  const before = await (await officersOnList()).count();
  expect(before).toBeGreaterThan(0);

  // The form still offers the office, by its name alone.
  await page.goto("/admin/users/new");
  await page.getByRole("radio", { name: DS_OFFICER }).check();
  await page.getByLabel("දිස්ත්‍රික්කය *").selectOption({ label: "ගම්පහ" });
  await expect(page.getByText("කාර්යාලයකට ගිණුම් කිහිපයක් තිබිය හැක.")).toBeVisible();
  await expect(page.getByRole("radio", { name: OFFICES.second, exact: true })).toBeEnabled();

  await createOfficer(page, OFFICES.second);
  await expect(await officersOnList()).toHaveCount(before + 1);
});

test("moving an officer to another office is recorded in the account's history (ADM-4)", async ({ page }) => {
  test.slow();
  await signInAs(page, "ad0001", /\/admin\/users$/);
  const { username } = await createOfficer(page, OFFICES.moveFrom);

  await openRow(page, username);
  await page.getByRole("link", { name: `සංස්කරණය: ${TEST_OFFICER_NAME}` }).click();
  await page.getByRole("radio", { name: new RegExp(`^${OFFICES.moveTo}`) }).check();
  await page.getByRole("button", { name: "සුරකින්න" }).click();

  await expect(page).toHaveURL(/notice=transferred/);
  await expect(page.getByRole("status")).toContainText("කාර්යාලය වෙනස් කළා");
  await openRow(page, username);
  await expect(page.getByRole("row").nth(1)).toContainText(OFFICES.moveTo);
  await page.getByRole("link", { name: `සංස්කරණය: ${TEST_OFFICER_NAME}` }).click();
  await expect(page.getByRole("region", { name: "ගිණුමේ ඉතිහාසය" })).toContainText(
    `කාර්යාලය: ${OFFICES.moveFrom} → ${OFFICES.moveTo}`,
  );
});

test("a new password replaces the old one, and a disabled account can't sign in (ADM-5, ADM-6)", async ({
  page,
  browser,
}) => {
  test.slow();
  await signInAs(page, "ad0001", /\/admin\/users$/);
  const { username, password: firstPassword } = await createOfficer(page, OFFICES.disable);

  await openRow(page, username);
  await page.getByRole("button", { name: `නව මුරපදය: ${TEST_OFFICER_NAME}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "නව මුරපදය" }).click();
  await expect(page.getByRole("dialog")).toContainText("නව මුරපදය සාදන ලදී");
  const secondPassword = await page.getByRole("dialog").getByTestId("new-password").innerText();
  await page.getByRole("dialog").getByRole("button", { name: "හරි" }).click();

  await asNewOfficer(browser, async (officer) => {
    await signIn(officer, username, firstPassword);
    await expect(signInError(officer)).toHaveText(TEXT.wrongSignIn);
    await signIn(officer, username, secondPassword);
    await expect(officer).toHaveURL(/\/change-password$/);
  });

  await openRow(page, username);
  await page.getByRole("button", { name: `අක්‍රිය කරන්න: ${TEST_OFFICER_NAME}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "අක්‍රිය කරන්න" }).click();
  await expect(page.getByRole("row").nth(1)).toContainText("අක්‍රියයි");

  await asNewOfficer(browser, async (officer) => {
    await signIn(officer, username, secondPassword);
    await expect(signInError(officer)).toHaveText(TEXT.wrongSignIn);
  });
});

test("AC-31: an officer who forgot their password sets a new one with a code sent by email (AUTH-7)", async ({
  page,
  browser,
}) => {
  test.slow();
  await signInAs(page, "ad0001", /\/admin\/users$/);
  // An address of its own, so the test finds its own email among other tests' emails.
  const email = `reset-${Date.now()}-${randomLetters(6).toLowerCase()}@example.com`;
  const { username } = await createOfficer(page, OFFICES.resetByEmail, email);
  const newPassword = "Reset-By-Email-2026";

  await asNewOfficer(browser, async (officer) => {
    // An unknown username gets the same next step.
    await askForCode(officer, "ds9999");
    await askForCode(officer, username);
    const code = await lastCodeSentTo(email);

    const codeField = officer.getByLabel("ඊමේල් පණිවිඩයේ කේතය");
    await codeField.fill(code === "000000" ? "111111" : "000000");
    await officer.getByRole("button", { name: "ඉදිරියට" }).click();
    await expect(officer.locator("#reset-code-error")).toHaveText("කේතය වැරදියි. තවත් උත්සාහ 4ක් ඉතිරිව ඇත.");
    await codeField.fill(code);
    await officer.getByRole("button", { name: "ඉදිරියට" }).click();

    await expect(officer.getByRole("status")).toHaveText("කේතය නිවැරදියි. දැන් ඔබේ නව මුරපදය සකසන්න.");
    await officer.getByLabel("නව මුරපදය", { exact: true }).fill(newPassword);
    await officer.getByLabel("නව මුරපදය නැවත").fill(newPassword);
    await officer.getByRole("button", { name: "සුරකින්න" }).click();
    await expect(officer).toHaveURL(/\/login\?notice=passwordReset$/);
    await expect(officer.getByRole("status")).toHaveText("ඔබේ නව මුරපදය සකසන ලදී. එයින් ඇතුළු වන්න.");

    // The officer chose it, so it isn't temporary.
    await signIn(officer, username, newPassword);
    await expect(officer).toHaveURL(/\/ds$/);
  });

  await openRow(page, username);
  await page.getByRole("link", { name: `සංස්කරණය: ${TEST_OFFICER_NAME}` }).click();
  const history = page.getByRole("region", { name: "ගිණුමේ ඉතිහාසය" });
  await expect(history).toContainText("මුරපදය නැවත සැකසීමට ඊමේල් මගින් කේතයක් යැව්වා");
  await expect(history).toContainText("ඇතුළු වීමේ පිටුව");
  await expect(history).toContainText("ඊමේල් කේතයෙන් නිලධාරියා නව මුරපදයක් සැකසුවා");
});

test("the admin can't disable their own account", async ({ page }) => {
  await signInAs(page, "ad0001", /\/admin\/users$/);
  await openRow(page, "ad0001");
  await expect(page.getByRole("row").nth(1)).toContainText("(ඔබ)");
  await expect(page.getByRole("button", { name: /^අක්‍රිය කරන්න/ })).toHaveCount(0);
});

test("the admin adds a DS office to a district, typing its name once (LST-2, UI-9)", async ({ page }) => {
  // No seeded office code starts with Q.
  const code = `Q${randomLetters(2)}`;
  const nameSi = `පරීක්ෂණ කාර්යාලය ${code}`;
  const nameEn = `${TEST_MARKER} Office ${code}`;

  await signInAs(page, "ad0001", /\/admin\/users$/);
  await page.goto("/admin/lists");
  await page.getByRole("link", { name: /^කෑගල්ල/ }).click();
  await expect(page.getByRole("heading", { name: "කෑගල්ල දිස්ත්‍රික්කය" })).toBeVisible();

  // A wrong code is explained, and what was typed stays. The English name is typed; the Tamil one is not.
  await page.getByLabel("නම *", { exact: true }).fill(nameSi);
  await page.getByText("අනෙක් භාෂාවලින් නම", { exact: true }).click();
  await page.getByLabel("නම (ඉංග්‍රීසියෙන්)").fill(nameEn);
  await page.getByLabel("කේතය *").fill("Q1");
  await page.getByRole("button", { name: "එක් කරන්න" }).click();
  await expect(page.getByText("ඉංග්‍රීසි කැපිටල් අකුරු 3ක කේතයක් ඇතුළත් කරන්න.")).toBeVisible();
  await expect(page.getByLabel("නම *", { exact: true })).toHaveValue(nameSi);

  await page.getByLabel("කේතය *").fill(code.toLowerCase());
  await page.getByRole("button", { name: "එක් කරන්න" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "එක් කළා. අනෙක් භාෂාවලින් නම පද්ධතිය ලිව්වා; වැරදි නම් “නම වෙනස් කරන්න” මඟින් නිවැරදි කරන්න.",
  );
  // The list shows the name in the screen's language only.
  const row = page.getByRole("row").filter({ hasText: nameSi });
  await expect(row).toContainText(code);
  await expect(row).toContainText("ගිණුමක් නැත");
  await expect(row).not.toContainText(nameEn);

  // Each language shows its own name: the one typed in English, and the one the system wrote in Tamil.
  await chooseLanguage(page, "English");
  await expect(page.getByRole("row").filter({ hasText: code })).toContainText(nameEn);
  await expect(page.getByRole("row").filter({ hasText: code })).not.toContainText(nameSi);
  await chooseLanguage(page, "தமிழ்");
  await expect(page.getByRole("row").filter({ hasText: code })).toContainText(transliterate(nameSi, "ta"));
  await chooseLanguage(page, "සිංහල");
});

test("the admin adds and reorders renovation stages (LST-4)", async ({ page }) => {
  const suffix = `${randomLetters(4)} ${TEST_MARKER}`;
  const first = `පළමු මට්ටම ${suffix}`;
  const second = `දෙවන මට්ටම ${suffix}`;
  await signInAs(page, "ad0001", /\/admin\/users$/);
  await page.goto("/admin/lists?tab=stages");

  const renovation = page.getByRole("region", { name: "නිවස අලුත්වැඩියා කිරීම" });
  const stages = renovation.getByRole("listitem");
  // One name is enough; the system writes the Tamil and English ones.
  for (const name of [first, second]) {
    await renovation.getByLabel("නම *", { exact: true }).fill(name);
    await renovation.getByRole("button", { name: "එක් කරන්න" }).click();
    await expect(stages.filter({ hasText: name })).toBeVisible();
    await expect(renovation.getByLabel("නම *", { exact: true })).toHaveValue("");
  }

  const order = async () => {
    const texts = await stages.allInnerTexts();
    return [first, second].map((name) => texts.findIndex((text) => text.includes(name)));
  };
  const [firstAt, secondAt] = await order();
  expect(secondAt).toBeGreaterThan(firstAt);
  await renovation.getByRole("button", { name: `ඉහළට ගෙන යන්න: ${second}` }).click();
  await expect.poll(order).toEqual([secondAt, firstAt]);

  // The other kind's list is untouched.
  await expect(page.getByRole("region", { name: "නව නිවසක් ඉදිකිරීම" })).not.toContainText(suffix);
});

test("Head Office officers get 'not found' on the admin pages (PRM-2)", async ({ page }) => {
  await signInAs(page, "ho0001", /\/ho$/);
  for (const path of ["/admin/users", "/admin/users/new", "/admin/lists"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TEXT.notFound);
  }
});
