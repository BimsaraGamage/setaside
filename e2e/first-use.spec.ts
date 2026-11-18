import { expect, test } from "@playwright/test";
import { signInFresh } from "./helpers";

// Journey: first use with a bill and a pot (ticket 37, spec 2 step 4). A new
// demo user of its own, so first use always shows.

test("first use: a bill with Every cycle and a starter pot are set aside in the first cycle", async ({
  page,
}) => {
  await signInFresh(page);
  await expect(page.getByRole("heading", { name: "Welcome to Setaside" })).toBeVisible();
  await page.getByLabel("Spending currency").selectOption("LKR");
  await page.getByLabel("Usual pay day").selectOption("25");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Amount (LKR)").fill("100000");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Next salary day" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  // Step 4: one bill still to pay, due today, every cycle.
  await expect(page.getByRole("heading", { name: "Bills still to pay" })).toBeVisible();
  await page.getByRole("button", { name: "+ Add" }).click();
  const bill = page.getByRole("group", { name: "Bill 1" });
  await bill.getByLabel("Name").fill("Rent");
  await bill.getByLabel("Amount (LKR)").fill("40000");
  await bill.getByRole("checkbox", { name: /Every cycle/ }).check();
  await page.getByRole("button", { name: "Next" }).click();

  // Step 5: a starter pot.
  await expect(page.getByRole("heading", { name: "Pots" })).toBeVisible();
  await page.getByRole("button", { name: "Groceries" }).click();
  await expect(page.getByLabel("New pot name")).toHaveValue("Groceries");
  await page.getByLabel("New pot amount (LKR)").fill("15000");
  await page.getByRole("button", { name: "Add pot" }).click();
  await expect(page.getByLabel("Groceries (LKR)")).toHaveValue("15000");
  await page.getByRole("button", { name: "Next" }).click();

  // Summary: 100,000 − 40,000 − 15,000 = 45,000; no gap.
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(page.getByTestId("first-use-free")).toHaveText("Rs 45,000");
  await expect(page.getByTestId("first-use-gap")).toHaveCount(0);
  await page.getByRole("button", { name: "Start" }).click();

  // Today: the bill set aside in Next up, the pot, free money.
  await expect(page.getByTestId("free-money")).toHaveText("Rs 45,000");
  const nextUp = page.getByRole("region", { name: "Next up · already set aside" });
  await expect(nextUp.getByText("Rent")).toBeVisible();

  // Plan › Every cycle has Rent.
  const tabs = page.getByRole("navigation", { name: "Main" });
  await tabs.getByRole("link", { name: "Plan" }).click();
  await expect(page.getByRole("region", { name: "Pots", exact: true }).getByText("Groceries")).toBeVisible();
  await page.getByRole("link", { name: "Every cycle" }).click();
  await expect(page.getByText("Rs 40,000 on the")).toBeVisible();
});
