import { expect, test } from "@playwright/test";
import { CONFIRM, fillCase, newSubmittedCase, openAs, randomNic, SEND } from "./case-helpers";
import { signInAs, TEST_CASE_NAME } from "./helpers";

/** Screen text the test looks for (messages/si.json). */
const REJECT = "ප්‍රතික්ෂේප කරන්න";
const REJECT_REASON = "ප්‍රතික්ෂේප කිරීමට හේතුව *";
const ASK_NAME = "වෙනත් නමක් ඉදිරිපත් කරන ලෙස ප්‍රා.ලේ. කාර්යාලයෙන් ඉල්ලන්න";
const REJECT_ASK = "ප්‍රතික්ෂේප කර වෙනත් නමක් ඉල්ලන්න";
const ANSWER_NEEDED = "මෙම ප්‍රතිලාභියා ප්‍රධාන කාර්යාලය ඉල්ලූ නම වෙනුවටදැයි තෝරන්න.";

test("AC-30: Head Office rejects and asks for another name; the DS office enters it in that case's place", async ({
  page: ds,
  browser,
}) => {
  test.slow();
  await signInAs(ds, "ds0101", /\/ds$/);
  const oldName = `${TEST_CASE_NAME} පැරණි ${Date.now()}`;
  const old = await newSubmittedCase(ds, { name: oldName, nic: randomNic() });
  const oldId = old.url.split("/").at(-1) ?? "";

  // Head Office rejects it from its page, ticking the box (CHK-3).
  const ho = await openAs(browser, "ho0001");
  await ho.goto(`/ho/cases/${oldId}`);
  await ho.getByRole("button", { name: REJECT }).click();
  await ho.getByLabel(REJECT_REASON).fill("පවුලට දැනටමත් නිවසක් ඇත.");
  await ho.getByRole("checkbox", { name: new RegExp(`^${ASK_NAME}`) }).check();
  await ho.getByRole("button", { name: REJECT_ASK }).click();
  await expect(ho).toHaveURL(new RegExp(`/ho/cases/${oldId}\\?notice=rejectedAskName$`));
  await expect(ho.getByRole("status")).toContainText("ඒ වෙනුවට වෙනත් නමක් ඉදිරිපත් කරන ලෙස");
  await expect(ho.getByRole("region", { name: "මෙය වෙනුවට වෙනත් නමක් ඉල්ලා ඇත" })).toContainText(
    "ප්‍රා.ලේ. කාර්යාලය තවම නමක් ඇතුළත් කර නැත.",
  );

  // The DS office sees the request first on its to-do list (HOME-3), which leads to the new-case form.
  await ds.goto("/ds");
  const request = ds.getByRole("link", { name: new RegExp(`^${oldName}: වෙනත් නමක් ඉල්ලා ඇත`) });
  await expect(request).toContainText(old.number);
  await request.click();
  await expect(ds).toHaveURL(/\/ds\/cases\/new$/);

  // The form asks first, and won't send without an answer (CASE-11).
  await ds.getByRole("button", { name: SEND }).click();
  await expect(ds.locator("#case-errors")).toContainText(ANSWER_NEEDED);
  const newName = `${TEST_CASE_NAME} නව ${Date.now()}`;
  await fillCase(ds, { name: newName, nic: randomNic() });
  await ds.getByRole("radio", { name: new RegExp(`^ඔව්, ${old.number} වෙනුවට`) }).check();
  await ds.getByRole("button", { name: SEND }).click();
  const confirm = ds.getByRole("dialog");
  await expect(confirm).toContainText(`${old.number} (${oldName})`);
  await confirm.getByRole("button", { name: CONFIRM }).click();
  await expect(ds).toHaveURL(/\/ds\/cases\/[0-9a-f-]{36}\?notice=submitted$/);
  const newNumber = await ds.getByTestId("case-number").innerText();
  const newId = ds.url().split("?")[0]?.split("/").at(-1) ?? "";
  await expect(
    ds.getByRole("region", { name: `${old.number} (${oldName}) වෙනුවට ඇතුළත් කළ ප්‍රතිලාභියෙකි` }),
  ).toContainText("පවුලට දැනටමත් නිවසක් ඇත.");

  // The request has left the to-do list.
  await ds.goto("/ds");
  await expect(ds.getByRole("link", { name: new RegExp(`^${oldName}: වෙනත් නමක් ඉල්ලා ඇත`) })).toBeHidden();

  // Head Office sees the link on the check view and on the old case's page.
  await ho.goto(`/ho/check?case=${newId}`);
  await expect(ho.getByRole("heading", { level: 2, name: newName })).toBeVisible();
  await expect(ho.locator('a[aria-current="true"]')).toContainText(`${old.number} වෙනුවට`);
  await expect(
    ho.getByRole("region", { name: `${old.number} (${oldName}) වෙනුවට ඇතුළත් කළ ප්‍රතිලාභියෙකි` }),
  ).toBeVisible();
  await ho.goto(`/ho/cases/${oldId}`);
  const asked = ho.getByRole("region", { name: "මෙය වෙනුවට වෙනත් නමක් ඉල්ලා ඇත" });
  await expect(asked).toContainText(`ඒ වෙනුවට ${newNumber} (${newName}) ඇතුළත් කර ඇත.`);
  await asked.getByRole("link", { name: `${newNumber} විවෘත කරන්න` }).click();
  await expect(ho).toHaveURL(new RegExp(`/ho/cases/${newId}$`));
  await ho.context().close();
});
