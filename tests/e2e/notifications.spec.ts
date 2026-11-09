import { expect, test } from "@playwright/test";
import { asUser, newSubmittedCase, openAs, randomNic } from "./case-helpers";
import { signInAs, TEST_CASE_NAME, TEXT } from "./helpers";

/** Screen text the tests look for (messages/si.json). */
const CHECK_MENU = "පරීක්ෂා කිරීම සහ ප්‍රතිපාදන මුදා හැරීම";
const WAITING = "ඔබේ ක්‍රියාව අවශ්‍යයි";
const BELL = "දැනුම්දීම්";

// The menu's count and the bell sit in layouts, which a client-side move doesn't render again. These
// tests move only by the menu, never by page.goto, which would load everything afresh (NTF-1).

test("the menu's waiting count agrees with the dashboard after a DS office sends a case (NTF-1)", async ({
  page: ho,
  browser,
}) => {
  test.slow();
  await signInAs(ho, "ho0001", /\/ministry$/);
  await asUser(browser, "ds0101", async (ds) => {
    await newSubmittedCase(ds, { name: `${TEST_CASE_NAME} මෙනුව ${Date.now()}`, nic: randomNic() });
  });

  const nav = ho.getByRole("navigation");
  const waiting = ho.getByRole("region", { name: WAITING });
  const queue = (name: RegExp) => waiting.getByRole("link", { name });
  // Other tests change the queues at the same time, so move again until the two readings meet.
  await expect(async () => {
    await nav.getByRole("link", { name: "ප්‍රතිලාභීන්", exact: true }).click();
    await expect(ho).toHaveURL(/\/ministry\/cases$/);
    await nav.getByRole("link", { name: "සාරාංශය" }).click();
    await expect(ho).toHaveURL(/\/ministry$/);
    const count = async (name: RegExp) => Number((await queue(name).innerText()).replace(/\D/g, ""));
    const total = (await count(/^පරීක්ෂා කිරීමට/)) + (await count(/^ප්‍රතිපාදන මුදා හැරීමට/));
    expect(total).toBeGreaterThan(0);
    await expect(
      nav.getByRole("link", { name: `${CHECK_MENU} (බලා සිටින ප්‍රතිලාභීන් ${total})`, exact: true }),
    ).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
});

test("the bell counts a new notice while the DS moves by the menu, and clears when all are read (NTF-1)", async ({
  page: ds,
  browser,
}) => {
  test.slow();
  // Kaduwela's officer: no other test has Head Office decide a Kaduwela case, so its notices are this test's.
  await signInAs(ds, "ds0103", /\/ds$/);
  const bell = ds.getByRole("banner").getByRole("link", { name: new RegExp(`^${BELL}`) });
  await bell.click();
  await expect(ds).toHaveURL(/\/ds\/notifications$/);
  const markAll = ds.getByRole("button", { name: "සියල්ල කියවූ ලෙස සලකුණු කරන්න" });
  if (await markAll.isVisible()) await markAll.click();
  await expect(bell).toHaveAccessibleName(BELL);

  const name = `${TEST_CASE_NAME} සීනුව ${Date.now()}`;
  const { url } = await newSubmittedCase(ds, { name, nic: randomNic() });
  const ho = await openAs(browser, "ho0001");
  await ho.goto(url.replace("/ds/", "/ministry/"));
  await ho.getByRole("button", { name: "අනුමත කරන්න", exact: true }).click();
  await ho.getByRole("dialog").getByRole("button", { name: "ඔව්, අනුමත කරන්න" }).click();
  await expect(ho).toHaveURL(/\?notice=verified$/);
  await ho.context().close();

  // The DS was on its case page when Head Office decided; one move by the menu shows the notice.
  await ds.getByRole("navigation").getByRole("link", { name: "මගේ ප්‍රතිලාභීන්" }).click();
  await expect(ds).toHaveURL(/\/ds$/);
  await expect(bell).toHaveAccessibleName(`${BELL}, නොකියවූ 1`);

  await bell.click();
  await expect(ds.getByRole("button", { name: new RegExp(`^${name} අනුමත කර ඇත`) })).toContainText("අලුත්");
  await markAll.click();
  await expect(bell).toHaveAccessibleName(BELL);
  await expect(markAll).toBeHidden();
});

test("the counts answer only their own role (PRM-1)", async ({ page }) => {
  await signInAs(page, "ds0101", /\/ds$/);
  const unread = await (await page.request.get("/ds/notifications/unread")).json();
  expect(unread).toEqual({ count: expect.any(Number), at: expect.any(Number) });
  expect((await page.request.get("/ministry/waiting")).status()).toBe(404);

  await asUser(page.context().browser()!, "ho0001", async (ho) => {
    const waiting = await (await ho.request.get("/ministry/waiting")).json();
    expect(waiting).toEqual({ count: expect.any(Number), at: expect.any(Number) });
    expect((await ho.request.get("/ds/notifications/unread")).status()).toBe(404);
  });

  // Signed out: the sign-in page, never a count.
  await page.getByRole("button", { name: TEXT.signOutButton }).click();
  await expect(page).toHaveURL(/\/login/);
  const response = await page.request.get("/ministry/waiting");
  expect(response.url()).toMatch(/\/login\?next=%2Fministry%2Fwaiting$/);
});
