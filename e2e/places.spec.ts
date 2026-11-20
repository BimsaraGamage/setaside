import { expect, type Page, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Journey: where my money is (ticket SAB-50, spec 6 and 16). A demo user of its
// own, so free money starts at Rs 90,000 and there are no places yet.

async function addPlace(page: Page, name: string, holds: string, kept = false) {
  await page.getByRole("link", { name: /\+ Add (a|another) place/ }).click();
  await page.getByLabel("Name").fill(name);
  if (kept) await page.getByRole("radio", { name: "Kept aside" }).click();
  await page.getByLabel("It holds now (LKR)").fill(holds);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText(`${name} added`);
}

test("add places, type their balances, see what can be spent from each", async ({ page }) => {
  const main = page.getByRole("navigation", { name: "Main" });
  await signInFreshToToday(page);
  await expect(page.getByTestId("free-money")).toHaveText("Rs 90,000");
  // No place yet: nothing about places on Today.
  await expect(page.getByTestId("places-line")).toHaveCount(0);

  await main.getByRole("link", { name: "Money" }).click();
  await expect(page.getByTestId("money-places")).toContainText("Add a place");
  await page.getByRole("link", { name: /Where my money is/ }).click();

  // The kept-aside bank first, then cash in hand: free money is counted in hand first.
  await addPlace(page, "Pan Asia", "60,000", true);
  await addPlace(page, "In hand", "20,000");
  await expect(page.getByTestId("place-balance-In hand")).toHaveText("Rs 20,000");
  await expect(page.getByTestId("place-can-spend-In hand")).toHaveText("Can spend Rs 20,000");
  await expect(page.getByTestId("place-can-spend-Pan Asia")).toHaveText("Can spend Rs 60,000");
  await expect(page.getByTestId("places-total-LKR")).toHaveText("Rs 80,000");
  await expect(page.getByTestId("places-difference-LKR")).toHaveText(
    "Rs 10,000 less than the app counts: spends not entered?",
  );

  // Set balance: the bank holds Rs 70,000 after all; Undo puts Rs 60,000 back.
  await page.getByRole("link", { name: /Pan Asia/ }).click();
  await expect(page.getByTestId("place-balance")).toHaveText("Rs 60,000");
  await page.getByLabel("It holds now (LKR)").fill("70000");
  await page.getByRole("button", { name: "Set balance" }).click();
  await expect(page.getByRole("status")).toContainText("Pan Asia set to Rs 70,000");
  await expect(page.getByTestId("place-balance")).toHaveText("Rs 70,000");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("place-balance")).toHaveText("Rs 60,000");
  await page.getByLabel("It holds now (LKR)").fill("70000");
  await page.getByRole("button", { name: "Set balance" }).click();
  await expect(page.getByTestId("place-balance")).toHaveText("Rs 70,000");
  await page.getByRole("link", { name: "← Back" }).click();
  await expect(page.getByTestId("places-difference-LKR")).toContainText("Matches what the app counts");

  // In hand moves above the bank; the amounts stay (it is the For spending one either way).
  await page.getByRole("link", { name: /In hand/ }).click();
  await page.getByRole("button", { name: "Move up" }).click();
  await expect(page.getByRole("status")).toContainText("Order changed");
  await page.getByRole("link", { name: "← Back" }).click();
  await expect(page.getByRole("region", { name: "Places" }).getByRole("link").first()).toContainText(
    "In hand",
  );

  // Today: what can be spent from each place; a spend takes it from the last place counted.
  await page.getByRole("link", { name: "← Back" }).click();
  await expect(page.getByTestId("money-places")).toContainText("Rs 90,000");
  await main.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("places-line")).toHaveText("In hand Rs 20,000 · Pan Asia Rs 70,000");
  await page.getByRole("button", { name: "Add a spend" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a spend" });
  for (const d of "500") await sheet.getByRole("button", { name: d, exact: true }).click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("free-money")).toHaveText("Rs 89,500");
  await expect(page.getByTestId("places-line")).toHaveText("In hand Rs 20,000 · Pan Asia Rs 69,500");

  // The places now hold Rs 500 more than the app counts, until a balance is typed again.
  await page.getByTestId("places-line").click();
  await expect(page.getByTestId("places-difference-LKR")).toHaveText(
    "Rs 500 more than the app counts: balances out of date, or income not entered?",
  );

  // Delete asks once more for a place with a balance.
  await page.getByRole("link", { name: /In hand/ }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Yes, delete it" }).click();
  await expect(page.getByRole("status")).toContainText("In hand deleted");
  await expect(page.getByTestId("place-balance-In hand")).toHaveCount(0);
  await expect(page.getByTestId("place-can-spend-Pan Asia")).toHaveText("Can spend Rs 70,000");
});
