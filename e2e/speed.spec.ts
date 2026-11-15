import { expect, test } from "@playwright/test";
import { signInToToday } from "./helpers";

// Item 8 · Spending speed and verdict: the verdict chip, the speed line and the
// One-off toggle (spec 7, 10). Notes are unique per run (shared demo user).

test("Today shows a verdict; a spend can be marked one-off and unmarked", async ({ page }) => {
  const note = `Fridge ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await signInToToday(page);
  const card = page.getByRole("region", { name: "You can spend today" });
  await expect(card.getByTestId("verdict")).toHaveText(
    /^(Too early to tell|On track|Tight|Runs out on \w{3} \d{1,2} \w{3}|Over by Rs [\d,]+)$/,
  );

  await page.getByRole("button", { name: "Add a spend" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a spend" });
  for (const d of "4321") await sheet.getByRole("button", { name: d, exact: true }).click();
  await sheet.getByLabel("Note").fill(note);
  await sheet.getByRole("checkbox", { name: /One-off/ }).check();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Spend saved");

  const row = card.getByRole("button", { name: new RegExp(`^${note}`) });
  await expect(row).toContainText("One-off");

  // Undone later from the same sheet.
  await row.click();
  const change = page.getByRole("dialog", { name: "Change spend" });
  await expect(change.getByRole("checkbox", { name: /One-off/ })).toBeChecked();
  await change.getByRole("checkbox", { name: /One-off/ }).uncheck();
  await change.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Spend changed");
  await expect(row).not.toContainText("One-off");

  // Clean up.
  await row.click();
  await change.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row).toHaveCount(0);
});
