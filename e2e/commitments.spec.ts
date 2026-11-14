import { expect, test } from "@playwright/test";
import { signInToToday } from "./helpers";

// Commitments and Next up (backlog item 5). Names are unique per run, because a
// local run shares one demo user between the two browsers.

test("add a commitment on Plan, see it on Next up, change it, delete it", async ({ page }) => {
  const name = `Rent ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await signInToToday(page);
  const nextUp = page.getByRole("region", { name: "Next up · already set aside" });
  await expect(nextUp.getByText("Salary expected")).toBeVisible();

  // Plan › + Add: name, amount, due date (today), live allowance line.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Plan" }).click();
  await page.getByRole("link", { name: "+ Add" }).click();
  await expect(page.getByRole("heading", { name: "New commitment" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Amount (LKR)").fill("1");
  await expect(page.getByTestId("commitment-after")).toContainText("You can spend today after this: Rs");
  await page.getByRole("button", { name: "Save" }).click();

  // Back on Plan with a toast; listed there and on Today's Next up with "today".
  await expect(page.getByRole("status")).toContainText("Commitment saved");
  await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();
  const planRow = page.getByRole("link", { name: new RegExp(`${name} Rs 1$`) });
  await expect(planRow).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Today" }).click();
  await expect(nextUp.getByText(name)).toBeVisible();
  await expect(nextUp.getByText("today", { exact: true }).first()).toBeVisible();

  // Change it.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Plan" }).click();
  await planRow.click();
  await expect(page.getByRole("heading", { name: "Change commitment" })).toBeVisible();
  await page.getByLabel("Amount (LKR)").fill("2");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Commitment changed");
  const changed = page.getByRole("link", { name: new RegExp(`${name} Rs 2$`) });
  await expect(changed).toBeVisible();

  // Delete it; Undo brings it back; delete again.
  await changed.click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("status")).toContainText("Commitment deleted");
  await expect(changed).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(changed).toBeVisible();
  await changed.click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(changed).toHaveCount(0);
});
