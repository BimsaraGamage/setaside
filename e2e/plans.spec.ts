import { expect, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Journey: instalment plans (backlog item 19, spec 9 and 16). A demo user of its
// own, so free money starts at Rs 90,000.

test("new instalments, this cycle's payment set aside, pay extra, then pay it all off", async ({ page }) => {
  const main = page.getByRole("navigation", { name: "Main" });
  await signInFreshToToday(page);
  await expect(page.getByTestId("free-money")).toHaveText("Rs 90,000");

  // A phone on 3 payments of Rs 10,000 (price Rs 27,000), the first one today.
  await main.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: "+ New loan or instalments" }).click();
  await page.getByLabel("Name").fill("Phone");
  await page.getByLabel("Total price (LKR)").fill("27000");
  await page.getByLabel("Number of payments").fill("3");
  await page.getByLabel("Each payment (LKR)").fill("10000");
  await expect(page.getByTestId("plan-interest")).toContainText("interest Rs 3,000");
  await page.getByLabel("Normal monthly price (LKR)").fill("11000");
  await expect(page.getByTestId("plan-saving-new")).toContainText("Saved Rs 3,000 vs paying monthly");
  await expect(page.getByTestId("plan-after")).toContainText("Rs 10,000 set aside now");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Phone added");
  await expect(page.getByTestId("plan-left-Phone")).toContainText("Rs 30,000 left");

  // Free money only feels the payment; Next up shows which payment it is.
  await main.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("free-money")).toHaveText("Rs 80,000");
  const nextUp = page.getByRole("region", { name: "Next up · already set aside" });
  await expect(nextUp).toContainText("Payment 1 of 3");

  // The plan page: progress, and Pay extra Rs 10,000 from free money.
  await main.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: /Phone/ }).click();
  await expect(page.getByTestId("plan-of")).toHaveText("0 of 3 payments");
  await expect(page.getByTestId("plan-interest")).toContainText("of Rs 3,000");
  await page.getByLabel("Amount (LKR)").fill("10000");
  await expect(page.getByTestId("plan-extra-after")).toContainText("Rs 20,000, 2 payments");
  await page.getByRole("button", { name: "Pay extra", exact: true }).last().click();
  await expect(page.getByRole("status")).toContainText("Paid extra on Phone");
  await expect(page.getByTestId("plan-of")).toHaveText("0 of 2 payments");
  await expect(page.getByTestId("plan-paid")).toContainText("Paid Rs 10,000");

  // Pay it all off from free money, filled with everything still to pay.
  await page.getByRole("button", { name: "Pay it all off" }).first().click();
  await expect(page.getByLabel("Amount (LKR)")).toHaveValue("20000");
  await page.getByRole("button", { name: "Pay it all off" }).last().click();
  await expect(page.getByRole("status")).toContainText("Phone paid off");
  await expect(page.getByTestId("plan-of")).toHaveText("Paid off");

  // This cycle's payment is finished: Rs 30,000 out of free money in all.
  await page.getByRole("link", { name: "← Back" }).click();
  await main.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("free-money")).toHaveText("Rs 60,000");
});
