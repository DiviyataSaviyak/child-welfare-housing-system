import { expect, test } from "@playwright/test";
import { changePasswordError, signIn, signInAs, signInError, TEMPORARY_PASSWORD, TEXT } from "./helpers";

test("a signed-out visitor is sent to sign in, then back to the page they asked for (ERR-4)", async ({ page }) => {
  await page.goto("/ds/cases/new");
  await expect(page).toHaveURL(/\/login\?next=%2Fds%2Fcases%2Fnew$/);

  await signIn(page, "ds0101");
  await expect(page).toHaveURL(/\/ds\/cases\/new$/);
});

for (const [username, home] of [
  ["ds0101", /\/ds$/],
  ["ho0001", /\/ho$/],
  ["ad0001", /\/admin\/users$/],
] as const) {
  test(`${username} lands on their own home page`, async ({ page }) => {
    await signInAs(page, username, home);
  });
}

test("a DS officer gets 'not found' on Head Office and admin pages (PRM-1, ERR-2)", async ({ page }) => {
  await signInAs(page, "ds0101", /\/ds$/);
  for (const path of ["/ho", "/ho/check", "/admin/users"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TEXT.notFound);
  }
});

test("an admin gets 'not found' on DS and Head Office pages (PRM-2)", async ({ page }) => {
  await signInAs(page, "ad0001", /\/admin\/users$/);
  for (const path of ["/ds", "/ho"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TEXT.notFound);
  }
});

test("a wrong password shows the general message and keeps the username", async ({ page }) => {
  await signIn(page, "ds0101", "not-the-password");
  await expect(signInError(page)).toHaveText(TEXT.wrongSignIn);
  await expect(page.getByLabel(TEXT.username)).toHaveValue("ds0101");
  await expect(page).toHaveURL(/\/login/);
});

test("AC-4: each wrong password shows the attempts left, the fifth locks the account, and an unknown username reads the same", async ({
  page,
}) => {
  const messages = async (username: string) => {
    const seen: string[] = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await signIn(page, username, `wrong-password-${attempt}`);
      if (attempt < 5) await expect(signInError(page)).toHaveText(TEXT.attemptsLeft(5 - attempt));
      else await expect(signInError(page)).toHaveText(TEXT.locked);
      seen.push(await signInError(page).innerText());
    }
    return seen;
  };

  const known = await messages("ds0199");

  // Now even the right password is refused.
  await signIn(page, "ds0199");
  await expect(page).toHaveURL(/\/login/);
  await expect(signInError(page)).toHaveText(TEXT.locked);

  const unknown = await messages(`nobody-${Date.now()}`);
  expect(unknown).toEqual(known);
});

test("a temporary password must be replaced before anything else (AUTH-3)", async ({ page }) => {
  await signIn(page, "ds0102", TEMPORARY_PASSWORD);
  await expect(page).toHaveURL(/\/change-password$/);

  // Other pages send the officer back until the password is changed.
  await page.goto("/ds");
  await expect(page).toHaveURL(/\/change-password$/);

  await page.getByLabel("දැනට ඇති මුරපදය").fill(TEMPORARY_PASSWORD);
  await page.getByLabel("නව මුරපදය", { exact: true }).fill("My-New-Pass-2026");
  await page.getByLabel("නව මුරපදය නැවත").fill("Something-Else-1");
  await page.getByRole("button", { name: "සුරකින්න" }).click();
  await expect(changePasswordError(page)).toHaveText("නව මුරපදය දෙවරම එක ලෙස ඇතුළත් කරන්න.");

  await page.getByLabel("දැනට ඇති මුරපදය").fill(TEMPORARY_PASSWORD);
  await page.getByLabel("නව මුරපදය", { exact: true }).fill("My-New-Pass-2026");
  await page.getByLabel("නව මුරපදය නැවත").fill("My-New-Pass-2026");
  await page.getByRole("button", { name: "සුරකින්න" }).click();
  await expect(page).toHaveURL(/\/ds$/);

  // The new password works; the temporary one no longer does.
  await page.getByRole("button", { name: TEXT.signOutButton }).click();
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, "ds0102", TEMPORARY_PASSWORD);
  await expect(signInError(page)).toHaveText(TEXT.wrongSignIn);
  await signIn(page, "ds0102", "My-New-Pass-2026");
  await expect(page).toHaveURL(/\/ds$/);
});

test("signing out ends the session", async ({ page }) => {
  await signInAs(page, "ho0001", /\/ho$/);
  await page.getByRole("button", { name: TEXT.signOutButton }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/ho");
  await expect(page).toHaveURL(/\/login\?next=%2Fho$/);
});

test("pages carry a Content Security Policy with a fresh nonce each time (SEC-5)", async ({ page }) => {
  const first = await page.goto("/login");
  const second = await page.goto("/login");
  const policy = (response: typeof first) => response?.headers()["content-security-policy"] ?? "";

  expect(policy(first)).toMatch(/script-src 'self' 'nonce-[^']+'/);
  expect(policy(first)).toContain("frame-ancestors 'none'");
  expect(policy(first)).not.toBe(policy(second));
  expect(first?.headers()["x-content-type-options"]).toBe("nosniff");
});
