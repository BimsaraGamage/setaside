import { expect, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Journey: people (backlog item 20, spec 9 and 16). A demo user of its own, so
// free money starts at Rs 90,000.

test("lend, get some back, borrow with a payback, then settle", async ({ page }) => {
  const main = page.getByRole("navigation", { name: "Main" });
  await signInFreshToToday(page);
  await expect(page.getByTestId("free-money")).toHaveText("Rs 90,000");

  // I lent money: Rs 10,000 to Nimal comes out of free money now.
  await main.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: /People/ }).click();
  await page.getByRole("link", { name: "I lent money" }).click();
  await page.getByLabel("To whom").fill("Nimal");
  await page.getByLabel("Amount (LKR)").fill("10000");
  await page.getByRole("button", { name: "Lend" }).click();
  await expect(page.getByRole("status")).toContainText("Lent Rs 10,000 to Nimal");
  await expect(page.getByTestId("person-owed-Nimal")).toContainText("Owes you Rs 10,000");

  // Got it back: Rs 4,000, Rs 1,000 of it to savings.
  await page.getByRole("link", { name: /Nimal/ }).click();
  await page.getByRole("link", { name: "Got it back" }).click();
  await expect(page.getByLabel("Amount (LKR)")).toHaveValue("10000");
  await page.getByLabel("Amount (LKR)").fill("4000");
  await page.getByLabel("To savings (LKR)").fill("1000");
  await page.getByRole("button", { name: "Add income" }).click();
  await expect(page.getByRole("status")).toContainText("Got Rs 4,000 back from Nimal");
  await expect(page.getByTestId("person-owed-Nimal")).toContainText("Owes you Rs 6,000");

  // I borrowed Rs 20,000 from Kamal (Add income, kind Borrowed), no payback date yet.
  await page.getByRole("link", { name: "I borrowed" }).click();
  await expect(page.getByRole("radio", { name: "Borrowed" })).toBeChecked();
  await page.getByLabel("From whom").fill("Kamal");
  await page.getByLabel("Amount (LKR)").fill("20000");
  await page.getByRole("button", { name: "Add income" }).click();
  await expect(page.getByRole("status")).toContainText("Borrowed Rs 20,000 from Kamal");
  await expect(page.getByTestId("person-owed-Kamal")).toContainText("You owe Rs 20,000");

  // Free money: 90,000 − 10,000 lent + 3,000 back (1,000 saved) + 20,000 borrowed.
  await page.getByRole("link", { name: "← Back" }).click();
  await main.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("free-money")).toHaveText("Rs 103,000");

  // A payback from Kamal's page, due today: set aside, shown on Next up.
  await main.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: /People/ }).click();
  await page.getByRole("link", { name: /Kamal/ }).click();
  await expect(page.getByLabel("Pay back (LKR)")).toHaveValue("20000");
  await page.getByRole("button", { name: "Add a payback" }).click();
  await expect(page.getByRole("status")).toContainText("Payback to Kamal set aside");
  await page.getByRole("link", { name: "← Back" }).click();
  await page.getByRole("link", { name: "← Back" }).click();
  await main.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("free-money")).toHaveText("Rs 83,000");
  const nextUp = page.getByRole("region", { name: "Next up · already set aside" });
  await expect(nextUp).toContainText("Borrowed from Kamal");

  // Settled: the payback is finished, its money free again; Kamal moves to Settled.
  await main.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: /People/ }).click();
  await page.getByRole("link", { name: /Kamal/ }).click();
  await page.getByRole("button", { name: "Settled" }).click();
  await expect(page.getByRole("status")).toContainText("Kamal settled");
  await expect(page.getByTestId("person-owed")).toContainText("Settled");
  await page.getByRole("link", { name: "← Back" }).click();
  await expect(page.getByRole("region", { name: "Settled" })).toContainText("Kamal");
  await page.getByRole("link", { name: "← Back" }).click();
  await main.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("free-money")).toHaveText("Rs 103,000");
});
