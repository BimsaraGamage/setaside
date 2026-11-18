import { expect, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Next cycle preview (spec 6): an Every cycle bill shows on Plan's Next cycle card.
// A fresh demo user, so the card holds only this run's rows.

test("an Every cycle bill shows in Plan's Next cycle card", async ({ page }) => {
  await signInFreshToToday(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Plan" }).click();
  const card = page.getByTestId("next-cycle");
  await expect(card).toContainText("Nothing to set aside yet.");
  await expect(card).toContainText("No salary yet to compare with.");

  await page.getByRole("link", { name: "+ Add" }).click();
  await page.getByLabel("Name").fill("Rent");
  await page.getByLabel("Amount (LKR)").fill("36,000");
  await page.getByRole("checkbox", { name: /Every cycle/ }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();

  await expect(page.getByTestId("next-cycle-bills")).toContainText("Rs 36,000");
  await expect(page.getByTestId("next-cycle-total")).toHaveText("Rs 36,000");
  await page.getByTestId("next-cycle-bills").getByText("Bills").click();
  await expect(page.getByTestId("next-cycle-bills")).toContainText("Rent");
  await page.reload();
  await page.getByTestId("next-cycle-bills").getByText("Bills").click();
  await card.screenshot({ path: "test-results/next-cycle-card.png" });
});
