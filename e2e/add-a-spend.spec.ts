import { expect, type Page, test } from "@playwright/test";
import { signInToToday } from "./helpers";

// Journey: add a spend (spec 16, backlog item 4). Notes are unique per run,
// because a local run shares one demo user between the two browsers.

async function typeAmount(page: Page, digits: string) {
  const sheet = page.getByRole("dialog");
  for (const d of digits) await sheet.getByRole("button", { name: d, exact: true }).click();
}

test("add a spend, undo it, add it again, change it on Money › Spends, delete it", async ({ page }) => {
  const note = `Tea ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await signInToToday(page);
  const card = page.getByRole("region", { name: "You can spend today" });
  const row = (amount: string) => page.getByRole("button", { name: `${note} ${amount}` });

  // The + sheet: number pad, live "left today" line, note, Save.
  await page.getByRole("button", { name: "Add a spend" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a spend" });
  await expect(sheet.getByLabel("Date")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);

  // No amount yet (SAB-84): Save is off and a line says how to save; Finish later or an amount clears it.
  const hint = sheet.getByTestId("save-hint");
  await sheet.getByLabel("Note").fill(note);
  await expect(sheet.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(hint).toHaveText("Enter an amount, or tick Finish later to add it later");
  await sheet.getByLabel("Finish later").check();
  await expect(hint).toHaveCount(0);
  await sheet.getByLabel("Finish later").uncheck();
  await expect(hint).toBeVisible();

  await typeAmount(page, "1234");
  await expect(hint).toHaveCount(0);
  await expect(sheet.getByTestId("sheet-amount")).toHaveText("Rs 1,234");
  await expect(sheet.getByTestId("sheet-left")).toHaveText(/(left today after this|Over today by)/);
  await sheet.getByLabel("Note").fill(note);
  await sheet.getByRole("button", { name: "Save" }).click();

  // Saved: toast with Undo; the spend shows under today's card.
  await expect(page.getByRole("status")).toContainText("Spend saved");
  await expect(card.getByRole("button", { name: `${note} Rs 1,234` })).toBeVisible();
  await expect(page.getByTestId("spent-today")).toHaveText(/^Spent Rs [\d,]+ · /);

  // Undo takes it away again.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row("Rs 1,234")).toHaveCount(0);

  // Add it again, then change it from Money › Spends.
  await page.getByRole("button", { name: "Add a spend" }).click();
  await typeAmount(page, "1234");
  await sheet.getByLabel("Note").fill(note);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(row("Rs 1,234")).toBeVisible();

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: /Spends/ }).click();
  await expect(page.getByRole("heading", { name: "Spends" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await row("Rs 1,234").click();
  const change = page.getByRole("dialog", { name: "Change spend" });
  await change.getByRole("button", { name: "Delete digit" }).click();
  await change.getByRole("button", { name: "5", exact: true }).click();
  await expect(change.getByTestId("sheet-amount")).toHaveText("Rs 1,235");
  await change.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Spend changed");
  await expect(row("Rs 1,235")).toBeVisible();

  // Delete it.
  await row("Rs 1,235").click();
  await change.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Spend deleted");
  await expect(row("Rs 1,235")).toHaveCount(0);

  await page.getByRole("link", { name: "← Back" }).click();
  await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
});
