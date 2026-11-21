import { expect, type Page, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Journeys: where my money is (tickets SAB-50, SAB-51 and SAB-52, spec 6 and 16). A demo user of its
// own, so free money starts at Rs 90,000 and there are no places yet.

/** A spend from the + sheet; `from` picks the place it is paid from (none: the one the sheet starts on). */
async function addSpend(page: Page, digits: string, from?: string) {
  await page.getByRole("button", { name: "Add a spend" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a spend" });
  for (const d of digits) await sheet.getByRole("button", { name: d, exact: true }).click();
  if (from) await sheet.getByLabel("Paid from").selectOption({ label: from });
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toHaveCount(0);
}

async function addPlace(page: Page, name: string, holds: string, kept = false) {
  await page.getByRole("link", { name: /\+ Add (a|another) place/ }).click();
  await page.getByLabel("Name").fill(name);
  if (kept) await page.getByRole("radio", { name: "Kept aside" }).click();
  await page.getByLabel("It holds now (LKR)").fill(holds);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText(`${name} added`);
}

test("add places, type their balances, see them follow spends, payments and moves", async ({ page }) => {
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

  // Today: what can be spent from each place. A spend starts on the first For spending place (no extra
  // tap) and comes out of it by itself.
  await page.getByRole("link", { name: "← Back" }).click();
  await expect(page.getByTestId("money-places")).toContainText("Rs 90,000");
  await main.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("places-line")).toHaveText("In hand Rs 20,000 · Pan Asia Rs 70,000");
  await addSpend(page, "500");
  await expect(page.getByTestId("free-money")).toHaveText("Rs 89,500");
  await expect(page.getByTestId("places-line")).toHaveText("In hand Rs 19,500 · Pan Asia Rs 70,000");
  // Undo puts the money back in the place.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("places-line")).toHaveText("In hand Rs 20,000 · Pan Asia Rs 70,000");
  await addSpend(page, "500");
  await expect(page.getByTestId("places-line")).toHaveText("In hand Rs 19,500 · Pan Asia Rs 70,000");

  // Paid from the bank: the sheet remembers it for the next spend.
  await addSpend(page, "1000", "Pan Asia");
  await expect(page.getByTestId("places-line")).toHaveText("In hand Rs 19,500 · Pan Asia Rs 69,000");
  await page.getByRole("button", { name: "Add a spend" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a spend" });
  await expect(sheet.getByLabel("Paid from").locator("option:checked")).toHaveText("Pan Asia");
  await sheet.getByRole("button", { name: "Close" }).click();

  // The places still match what the app counts: nothing was typed again.
  await page.getByTestId("places-line").click();
  await expect(page.getByTestId("place-balance-In hand")).toHaveText("Rs 19,500");
  await expect(page.getByTestId("place-balance-Pan Asia")).toHaveText("Rs 69,000");
  await expect(page.getByTestId("places-difference-LKR")).toContainText("Matches what the app counts");

  // Move money: Rs 5,000 from the bank into the hand, like an ATM; free money stays. Undo takes it back.
  await page.getByRole("button", { name: "Move money" }).click();
  const moving = page.getByRole("region", { name: "Move money" });
  await moving.getByLabel("From").selectOption({ label: "Pan Asia" });
  await expect(moving.getByLabel("To").locator("option:checked")).toHaveText("In hand");
  await moving.getByLabel("Amount (LKR)").fill("5000");
  await moving.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Moved Rs 5,000 · Pan Asia → In hand");
  await expect(page.getByTestId("place-balance-In hand")).toHaveText("Rs 24,500");
  await expect(page.getByTestId("place-balance-Pan Asia")).toHaveText("Rs 64,000");
  await expect(page.getByTestId("places-total-LKR")).toHaveText("Rs 88,500");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("place-balance-In hand")).toHaveText("Rs 19,500");
  await expect(page.getByTestId("place-balance-Pan Asia")).toHaveText("Rs 69,000");

  // A place's page: what it held when set and what went out since.
  await page.getByRole("link", { name: /Pan Asia/ }).click();
  await expect(page.getByTestId("place-balance")).toHaveText("Rs 69,000");
  await expect(page.getByTestId("place-since")).toHaveText("Rs 70,000 when set · Rs 1,000 out since");
  await page.getByRole("link", { name: "← Back" }).click();

  // A bill paid from the bank comes out of it; free money already had it set aside.
  await page.getByRole("link", { name: "← Back" }).click();
  await main.getByRole("link", { name: "Plan" }).click();
  await page.getByRole("link", { name: "+ Add" }).click();
  await page.getByLabel("Name").fill("Rent");
  await page.getByLabel("Amount (LKR)").fill("30000");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("link", { name: / Rent / }).click();
  await page.getByRole("link", { name: "Pay", exact: true }).click();
  await expect(page.getByLabel("Paid from").locator("option:checked")).toHaveText("Pan Asia");
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Rent paid · finished");
  await page.getByRole("link", { name: "← Back" }).click();
  await main.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: /Where my money is/ }).click();
  await expect(page.getByTestId("place-balance-Pan Asia")).toHaveText("Rs 39,000");
  await expect(page.getByTestId("places-difference-LKR")).toContainText("Matches what the app counts");

  // A spend out of no place leaves the places Rs 200 above what the app counts.
  await page.getByRole("link", { name: "← Back" }).click();
  await main.getByRole("link", { name: "Today" }).click();
  await addSpend(page, "200", "No place");
  await page.getByTestId("places-line").click();
  await expect(page.getByTestId("places-difference-LKR")).toHaveText(
    "Rs 200 more than the app counts: income not entered?",
  );

  // Delete asks once more for a place with a balance.
  await page.getByRole("link", { name: /In hand/ }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Yes, delete it" }).click();
  await expect(page.getByRole("status")).toContainText("In hand deleted");
  await expect(page.getByTestId("place-balance-In hand")).toHaveCount(0);
  await expect(page.getByTestId("place-balance-Pan Asia")).toHaveText("Rs 39,000");
});

test("income, money lent, savings and the salary move their place; salary day starts in hand from the places", async ({
  page,
}) => {
  const main = page.getByRole("navigation", { name: "Main" });
  const places = async () => {
    await main.getByRole("link", { name: "Money" }).click();
    await page.getByRole("link", { name: /Where my money is/ }).click();
  };
  await signInFreshToToday(page);
  await places();
  await addPlace(page, "Bank", "70,000", true);
  await addPlace(page, "In hand", "20,000");
  await expect(page.getByTestId("places-difference-LKR")).toContainText("Matches what the app counts");

  // Extra income: the sheet starts on the first For spending place; this one landed in the bank.
  await page.getByRole("link", { name: "← Back" }).click();
  await page.getByRole("link", { name: /^Add income/ }).click();
  await page.getByLabel("Amount (LKR)").fill("5000");
  await expect(page.getByLabel("Received in").locator("option:checked")).toHaveText("In hand");
  await page.getByLabel("Received in").selectOption({ label: "Bank" });
  await page.getByRole("button", { name: "Add income" }).click();
  await expect(page.getByRole("status")).toContainText("Income added");

  // Money lent comes out of the hand: money out remembers its own place, apart from money in.
  await page.getByRole("link", { name: /People/ }).click();
  await page.getByRole("link", { name: "I lent money" }).click();
  await page.getByLabel("To whom").fill("Nimal");
  await page.getByLabel("Amount (LKR)").fill("2000");
  await expect(page.getByLabel("Paid from").locator("option:checked")).toHaveText("In hand");
  await page.getByRole("button", { name: "Lend" }).click();
  await expect(page.getByRole("status")).toContainText("Lent Rs 2,000 to Nimal");

  // Put in savings: money from outside; it starts on the bank, where money came in last.
  await page.getByRole("link", { name: "← Back" }).click();
  await page.getByRole("link", { name: /^Savings/ }).click();
  await page.getByRole("link", { name: "Put in" }).click();
  await page.getByLabel("Amount (LKR)").fill("3000");
  await expect(page.getByLabel("Received in").locator("option:checked")).toHaveText("Bank");
  await page.getByRole("button", { name: "Put in" }).click();
  await expect(page.getByRole("status")).toContainText("Rs 3,000 put in savings");
  // Taken out into free money, the money stays where it is: no place is asked.
  await page.getByRole("link", { name: "Take out" }).click();
  await expect(page.getByLabel("Amount (LKR)")).toBeVisible();
  await expect(page.getByLabel("Received in")).toHaveCount(0);
  await expect(page.getByLabel("Paid from")).toHaveCount(0);
  await page.getByRole("link", { name: "← Back" }).click();
  await page.getByRole("link", { name: "← Back" }).click();

  // Nothing was typed again: the places still match the app.
  await page.getByRole("link", { name: /Where my money is/ }).click();
  await expect(page.getByTestId("place-balance-Bank")).toHaveText("Rs 78,000");
  await expect(page.getByTestId("place-balance-In hand")).toHaveText("Rs 18,000");
  await expect(page.getByTestId("places-difference-LKR")).toContainText("Matches what the app counts");
  await page.getByRole("link", { name: /Bank/ }).click();
  await expect(page.getByTestId("place-since")).toHaveText("Rs 70,000 when set · Rs 8,000 in since");
  await page.getByRole("link", { name: "← Back" }).click();

  // Rs 1,000 of cash was spent and never entered: the hand holds Rs 17,000.
  await page.getByRole("link", { name: /In hand/ }).click();
  await page.getByLabel("It holds now (LKR)").fill("17000");
  await page.getByRole("button", { name: "Set balance" }).click();
  await expect(page.getByTestId("place-balance")).toHaveText("Rs 17,000");
  await page.getByRole("link", { name: "← Back" }).click();
  await expect(page.getByTestId("places-difference-LKR")).toHaveText(
    "Rs 1,000 less than the app counts: spends not entered?",
  );

  // Salary day: the salary lands in the bank (where money came in last).
  await page.getByRole("link", { name: "← Back" }).click();
  await main.getByRole("link", { name: "Today" }).click();
  await page.getByRole("link", { name: "Salary arrived" }).click();
  await page.getByLabel("Salary (LKR)").fill("100000");
  await expect(page.getByLabel("Received in").locator("option:checked")).toHaveText("Bank");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Last cycle's unpaid commitments" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  // Step 3: the leftover is Rs 93,000; in hand starts Rs 1,000 lower, from the places.
  await expect(page.getByTestId("leftover")).toHaveText("Rs 93,000");
  await expect(page.getByLabel("Actually have in hand (LKR)")).toHaveValue("92000");
  await expect(page.getByTestId("in-hand-from-places")).toHaveText(
    "From your places: they hold Rs 1,000 less than the app counts. Clear it to keep the leftover.",
  );
  await expect(page.getByTestId("leftover-to-cycle")).toHaveText("Rs 92,000");
  // Cleared, the leftover stands; typed again, it is what was typed.
  await page.getByLabel("Actually have in hand (LKR)").fill("");
  await expect(page.getByTestId("leftover-to-cycle")).toHaveText("Rs 93,000");
  await expect(page.getByTestId("in-hand-from-places")).toHaveCount(0);
  await page.getByLabel("Actually have in hand (LKR)").fill("92000");
  for (const heading of ["This cycle's commitments", "Pots", "Next salary day", "Summary"]) {
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(page.getByTestId("salary-day-free")).toHaveText("Rs 192,000");
  await page.getByRole("button", { name: "Start new cycle" }).click();
  await expect(page.getByRole("status")).toContainText("New cycle started");

  // The bank has the salary; with the leftover corrected, the places match the app again.
  await expect(page.getByTestId("places-line")).toHaveText("Bank Rs 175,000 · In hand Rs 17,000");
  await page.getByTestId("places-line").click();
  await expect(page.getByTestId("place-balance-Bank")).toHaveText("Rs 178,000");
  await expect(page.getByTestId("places-difference-LKR")).toContainText("Matches what the app counts");

  // Undo salary day takes the salary out of the bank again.
  await page.getByRole("link", { name: "← Back" }).click();
  await main.getByRole("link", { name: "Plan" }).click();
  const thisCycle = page.getByRole("region", { name: "This cycle" });
  await thisCycle.getByRole("button", { name: "Undo salary day" }).click();
  await thisCycle.getByRole("button", { name: "Undo salary day" }).click();
  await expect(page.getByRole("status")).toContainText("Salary day undone");
  await places();
  await expect(page.getByTestId("place-balance-Bank")).toHaveText("Rs 78,000");
  await expect(page.getByTestId("place-balance-In hand")).toHaveText("Rs 17,000");
});
