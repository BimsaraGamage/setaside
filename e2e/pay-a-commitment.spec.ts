import { expect, test } from "@playwright/test";
import { signInToToday } from "./helpers";

// Journey: pay a commitment (backlog item 6, spec 3 and 16). Names are unique per
// run, because a local run shares one demo user between the two browsers.

test("pay a commitment in parts, mark it finished, reopen it", async ({ page }) => {
  const name = `Phone ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const main = page.getByRole("navigation", { name: "Main" });
  await signInToToday(page);

  // A Rs 300 bill due today.
  await main.getByRole("link", { name: "Plan" }).click();
  await page.getByRole("link", { name: "+ Add" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Amount (LKR)").fill("300");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Commitment saved");
  const row = page.getByRole("link", { name: new RegExp(`^.*${name}`) });

  // Part payment: Rs 100, not finished; still to pay Rs 200.
  await row.click();
  await expect(page.getByTestId("still-to-pay")).toContainText("still to pay Rs 300");
  await page.getByRole("link", { name: "Pay", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Pay · ${name}` })).toBeVisible();
  await expect(page.getByLabel("Amount paid (LKR)")).toHaveValue("300");
  await expect(page.getByLabel("This finishes it")).toBeChecked();
  await page.getByLabel("Amount paid (LKR)").fill("100");
  await expect(page.getByLabel("This finishes it")).not.toBeChecked();
  await expect(page.getByTestId("pay-note")).toContainText("Still to pay after this: Rs 200");
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Payment saved");
  await expect(page.getByTestId("still-to-pay")).toContainText("Paid Rs 100 · still to pay Rs 200");

  // Today's Next up shows what is still to pay.
  await page.getByRole("link", { name: "← Back" }).click();
  await main.getByRole("link", { name: "Today" }).click();
  const nextUp = page.getByRole("region", { name: "Next up · already set aside" });
  const upRow = nextUp.locator(".li", { hasText: name });
  await expect(upRow).toContainText("Paid Rs 100 of Rs 300");
  await expect(upRow).toContainText(/Rs 200$/);

  // Second payment, Rs 250: paid more than planned, finishes it.
  await main.getByRole("link", { name: "Plan" }).click();
  await row.click();
  await page.getByRole("link", { name: "Pay", exact: true }).click();
  await expect(page.getByLabel("Amount paid (LKR)")).toHaveValue("200");
  await page.getByLabel("Amount paid (LKR)").fill("250");
  await expect(page.getByLabel("This finishes it")).toBeChecked();
  await expect(page.getByTestId("pay-note")).toContainText("Rs 50 more than planned");
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(`${name} paid · finished`);
  await expect(page.getByTestId("still-to-pay")).toContainText("Paid Rs 350 · Rs 50 more than planned");
  await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();

  // Off Next up; listed under Finished on Plan.
  await page.getByRole("link", { name: "← Back" }).click();
  await main.getByRole("link", { name: "Today" }).click();
  await expect(nextUp.getByText(name)).toHaveCount(0);
  await main.getByRole("link", { name: "Plan" }).click();
  await expect(page.getByRole("region", { name: "Finished" }).getByText(name)).toBeVisible();

  // Reopen, then Mark finished with Undo; then delete it (payments go with it).
  await row.click();
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByRole("status")).toContainText(`${name} reopened`);
  await page.getByRole("button", { name: "Mark finished" }).click();
  await expect(page.getByRole("status")).toContainText(`${name} finished`);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: "Mark finished" })).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("status")).toContainText("Commitment deleted");
  await expect(row).toHaveCount(0);
});
