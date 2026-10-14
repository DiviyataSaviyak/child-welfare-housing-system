import { expect, test } from "@playwright/test";
import { screenText, signInAs } from "./helpers";

const shells = [
  { username: "ds0101", home: /\/ds$/, heading: "මගේ ප්‍රතිලාභීන්", office: "හෝමාගම ප්‍රාදේශීය ලේකම් කාර්යාලය" },
  { username: "ho0001", home: /\/ho$/, heading: "සාරාංශය", office: "ප්‍රධාන කාර්යාලය" },
  { username: "ad0001", home: /\/admin\/users$/, heading: "පරිශීලකයින්", office: "ප්‍රධාන කාර්යාලය · පරිපාලක" },
];

for (const shell of shells) {
  test(`${shell.username} sees their Sinhala shell and no English text`, async ({ page }) => {
    await signInAs(page, shell.username, shell.home);

    await expect(page.locator("html")).toHaveAttribute("lang", "si");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(shell.heading);
    await expect(page.getByRole("banner")).toContainText(shell.office);
    await expect(page.getByRole("link", { name: shell.heading })).toHaveAttribute("aria-current", "page");
    expect(await screenText(page)).not.toMatch(/[A-Za-z]/);
  });
}

test("the sign-in page is in Sinhala only", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("පද්ධතියට ඇතුළු වන්න");
  expect(await screenText(page)).not.toMatch(/[A-Za-z]/);
});

test("the page for a forgotten password is in Sinhala only (AUTH-7)", async ({ page }) => {
  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("මුරපදය අමතකද?");
  expect(await screenText(page)).not.toMatch(/[A-Za-z]/);
});

test("/admin opens the users page", async ({ page }) => {
  await signInAs(page, "ad0001", /\/admin\/users$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/users$/);
});

test("/health answers 200 while the app reaches its database (OPS-3)", async ({ request }) => {
  const response = await request.get("/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.json()).toEqual({ ok: true });
});
