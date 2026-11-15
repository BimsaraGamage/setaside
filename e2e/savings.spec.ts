import { expect, test } from "@playwright/test";
import { signInToToday } from "./helpers";

// Savings and extra income (backlog item 10). A local run shares one demo user
// between the two browsers, so totals are not checked exactly.

test("add extra income split to savings, put in, take out, a savings set-aside moved", async ({ page }) => {
  const name = `Savings ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await signInToToday(page);
  const tabs = page.getByRole("navigation", { name: "Main" });

  // Money › Add income: Rs 3 with Rs 1 to savings; the split and the new allowance show first.
  await tabs.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: /^Add income/ }).click();
  await expect(page.getByRole("heading", { name: "Add income" })).toBeVisible();
  await page.getByLabel("Amount (LKR)").fill("3");
  await page.getByLabel("To savings (LKR)").fill("4");
  await expect(page.getByText("To savings can't be more than the amount.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add income" })).toBeDisabled();
  await page.getByLabel("To savings (LKR)").fill("1");
  await expect(page.getByTestId("income-split")).toHaveText("To free money: Rs 2");
  await expect(page.getByTestId("income-after")).toContainText("You can spend today after this: Rs");
  await page.getByRole("button", { name: "Add income" }).click();
  await expect(page.getByRole("status")).toContainText("Income added");

  // Savings lists it; Put in Rs 5, then Take out Rs 1 with the new allowance shown.
  await page.getByRole("link", { name: /^Savings/ }).click();
  await expect(page.getByRole("heading", { name: "Savings" })).toBeVisible();
  const moves = page.getByRole("region", { name: "Movements" });
  await expect(moves.getByText("From extra income").first()).toBeVisible();
  await page.getByRole("link", { name: "Put in" }).click();
  await page.getByLabel("Amount (LKR)").fill("5");
  await page.getByRole("button", { name: "Put in" }).click();
  await expect(page.getByRole("status")).toContainText("Rs 5 put in savings");
  await expect(moves.getByText("Put in").first()).toBeVisible();
  await page.getByRole("link", { name: "Take out" }).click();
  await page.getByLabel("Amount (LKR)").fill("1");
  await expect(page.getByTestId("savings-after")).toContainText("You can spend today after this: Rs");
  await page.getByRole("button", { name: "Take out" }).click();
  await expect(page.getByRole("status")).toContainText("Rs 1 taken out of savings");
  await expect(moves.getByText("Taken out").first()).toBeVisible();

  // Plan › + Add a savings set-aside, then move it: it joins the movements.
  await page.getByRole("link", { name: "← Back" }).click();
  await tabs.getByRole("link", { name: "Plan" }).click();
  await page.getByRole("link", { name: "+ Add" }).click();
  await page.getByRole("button", { name: "Savings" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Amount (LKR)").fill("1");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Commitment saved");
  await page.getByRole("link", { name: new RegExp(`${name} Savings Rs 1$`) }).click();
  await page.getByRole("link", { name: "Move", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Move to savings · ${name}` })).toBeVisible();
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(`${name} moved · finished`);
  await page.getByRole("link", { name: "← Back" }).click();
  await tabs.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: /^Savings/ }).click();
  await expect(moves.getByText(name)).toBeVisible();
});
