import { expect, type Page } from "@playwright/test";

/** The sample accounts' passwords, from prisma/seed-users.ts (development and tests only). */
export const PASSWORD = "Sample-Pass-2026";
export const TEMPORARY_PASSWORD = "Temp-Pass-2026";

export const TEXT = {
  username: "පරිශීලක නාමය",
  password: "මුරපදය",
  signInButton: "ඇතුළු වන්න",
  signOutButton: "ඉවත් වන්න",
  notFound: "මෙම පිටුව සොයාගත නොහැක",
  wrongSignIn: /පරිශීලක නාමය හෝ මුරපදය වැරදියි/,
  attemptsLeft: (count: number) => new RegExp(`තවත් උත්සාහ ${count}ක් ඉතිරිව ඇත`),
  locked: /ගිණුම අගුළු දමා ඇත/,
};

/** Marks the offices and stages the tests add, so tests/e2e/cleanup.ts can remove them. */
export const TEST_MARKER = "Playwright";

/** The name of every DS officer account the tests create; cleanup.ts deletes them before each run. */
export const TEST_OFFICER_NAME = "ඊ. පරීක්ෂණ";

/** Every case the tests create has a name starting with this; cleanup.ts deletes those cases before each run. */
export const TEST_CASE_NAME = "ස්වයං පරීක්ෂණ";

/** Random capital letters, to keep names and codes the tests add apart. */
export function randomLetters(count: number): string {
  return Array.from({ length: count }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
}

/**
 * Gives the page its own client address. In production Caddy passes the real one; here it keeps
 * each test's sign-ins apart, so the 10-per-minute limit (SEC-4) doesn't block a busy test run.
 */
async function giveOwnAddress(page: Page) {
  const part = () => Math.floor(Math.random() * 250) + 1;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.${part()}.${part()}.${part()}` });
}

/**
 * The page's visible screen text (UI-1). Table rows hold data, such as names and usernames, which
 * may be in any script, so they are left out. So is text marked as another language, such as the
 * language picker's names (UI-9).
 */
export function screenText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const own = document.documentElement.lang;
    const parts: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest("tbody, script, style, template") || !parent.checkVisibility()) continue;
      if ((parent.closest("[lang]")?.getAttribute("lang") ?? own) !== own) continue;
      parts.push(node.textContent ?? "");
    }
    return parts.join(" ");
  });
}

/** Chooses a screen language with the picker on the page (UI-9) and waits for the page to show it. */
export async function chooseLanguage(page: Page, language: "සිංහල" | "தமிழ்" | "English") {
  const lang = { සිංහල: "si", தமிழ்: "ta", English: "en" }[language];
  await page.getByRole("button", { name: language, exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.getByRole("button", { name: language, exact: true })).toHaveAttribute("aria-pressed", "true");
}

/** A form's error box. Next.js has its own hidden role="alert" element, so find ours by id. */
export const signInError = (page: Page) => page.locator("#sign-in-error");
export const changePasswordError = (page: Page) => page.locator("#change-password-error");

/** Fills in and sends the sign-in form. */
export async function signIn(page: Page, username: string, password = PASSWORD) {
  await giveOwnAddress(page);
  if (!page.url().includes("/login")) await page.goto("/login");
  // After a refused sign-in React clears the form; wait for that before typing again.
  const passwordField = page.getByLabel(TEXT.password, { exact: true });
  await expect(page.getByRole("button", { name: TEXT.signInButton })).toBeEnabled();
  await expect(passwordField).toHaveValue("");
  await page.getByLabel(TEXT.username).fill(username);
  await passwordField.fill(password);
  await page.getByRole("button", { name: TEXT.signInButton }).click();
}

/** Signs in and waits for the page the account lands on. */
export async function signInAs(page: Page, username: string, landsOn: RegExp) {
  await signIn(page, username);
  await expect(page).toHaveURL(landsOn);
}
