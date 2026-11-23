import { expect, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Journey: salary-day steps (backlog items 11 and 12, spec 6). Salary day changes
// the whole cycle, so this runs as a fresh demo user of its own; the other
// journeys share the one demo user and would see their rows move to an ended cycle.

test("salary arrived: leftover, unpaid ones, steps filled from Every cycle, new pot, Start new cycle", async ({
  page,
}) => {
  await signInFreshToToday(page);
  const tabs = page.getByRole("navigation", { name: "Main" });

  // A commitment with "Every cycle" on: Rs 36,000 due today. And Water, Rs 2,000.
  await tabs.getByRole("link", { name: "Plan" }).click();
  await page.getByRole("link", { name: "+ Add" }).click();
  await page.getByLabel("Name").fill("Rent");
  await page.getByLabel("Amount (LKR)").fill("36000");
  await page.getByRole("checkbox", { name: /Every cycle/ }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Commitment saved");
  await page.getByRole("link", { name: "+ Add" }).click();
  await page.getByLabel("Name").fill("Water");
  await page.getByLabel("Amount (LKR)").fill("2000");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Commitment saved");

  // Every cycle page lists it.
  await page.getByRole("link", { name: "Every cycle" }).click();
  await expect(page.getByRole("heading", { name: "Every cycle" })).toBeVisible();
  await expect(page.getByText("Rs 36,000 on the")).toBeVisible();
  await page.getByRole("link", { name: "← Back" }).click();

  // Salary arrived (Today header) → step 1: salary.
  await tabs.getByRole("link", { name: "Today" }).click();
  await page.getByRole("link", { name: "Salary arrived" }).click();
  await expect(page.getByRole("heading", { name: "Salary", exact: true })).toBeVisible();
  await expect(tabs).toBeHidden();
  await page.getByLabel("Salary (LKR)").fill("250000");
  await page.getByRole("button", { name: "Next" }).click();

  // Step 2: Rent was paid; Water carries on to the new cycle.
  await expect(page.getByRole("heading", { name: "Last cycle's unpaid commitments" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await page.getByRole("region", { name: "Rent" }).getByRole("radio", { name: "Paid it" }).click();
  await page
    .getByRole("region", { name: "Water" })
    .getByRole("radio", { name: "Carry to new cycle" })
    .click();
  await page.getByRole("button", { name: "Next" }).click();

  // Step 3: leftover 90,000 − 38,000 set aside = 52,000; Rs 50,000 in hand, all to savings.
  await expect(page.getByRole("heading", { name: "Last cycle's leftover" })).toBeVisible();
  await expect(page.getByTestId("leftover")).toHaveText("Rs 52,000");
  await page.getByLabel("Actually have in hand (LKR)").fill("50000");
  await page.getByLabel("To savings (LKR)").fill("50001");
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await page.getByLabel("To savings (LKR)").fill("50000");
  await expect(page.getByTestId("leftover-to-cycle")).toHaveText("Rs 0");
  await page.getByRole("button", { name: "Next" }).click();

  // Step 4: Rent filled in from Every cycle; change it, add a gym bill.
  await expect(page.getByRole("heading", { name: "This cycle's commitments" })).toBeVisible();
  const first = page.getByRole("group", { name: "Commitment 1" });
  await expect(first.getByLabel("Name")).toHaveValue("Rent");
  await expect(first.getByLabel("Amount (LKR)")).toHaveValue("36000");
  await first.getByLabel("Amount (LKR)").fill("37000");
  await page.getByRole("button", { name: "+ Add" }).click();
  const second = page.getByRole("group", { name: "Commitment 2" });
  await second.getByLabel("Name").fill("Gym");
  await second.getByLabel("Amount (LKR)").fill("5000");
  await page.getByRole("button", { name: "Next" }).click();

  // Step 5: a new pot.
  await expect(page.getByRole("heading", { name: "Pots" })).toBeVisible();
  await page.getByLabel("New pot name").fill("Fuel");
  await page.getByLabel("New pot amount (LKR)").fill("5000");
  await page.getByRole("button", { name: "Add pot" }).click();
  await expect(page.getByLabel("Fuel (LKR)")).toHaveValue("5000");
  await page.getByRole("button", { name: "Next" }).click();

  // Step 6: the salary came early (before this cycle's expected 25th), so the
  // suggestion is the 25th after that one, not the pay day it just covered (SAB-87).
  await expect(page.getByRole("heading", { name: "Next salary day" })).toBeVisible();
  const payDayAfterCovered = await page.evaluate(() => {
    const now = new Date();
    const covered = now.getMonth() + (now.getDate() >= 25 ? 1 : 0);
    const d = new Date(now.getFullYear(), covered + 1, 25);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-25`;
  });
  await expect(page.getByLabel("Expected next salary day")).toHaveValue(payDayAfterCovered);
  await page.getByRole("button", { name: "Next" }).click();

  // Step 7: summary. 250,000 + 2,000 Water's money − 37,000 − 5,000 − 2,000 Water − 5,000 = 203,000.
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(page.getByTestId("salary-day-from-last")).toHaveText("Rs 2,000");
  await expect(page.getByTestId("salary-day-free")).toHaveText("Rs 203,000");
  await expect(page.getByTestId("salary-day-gap")).toHaveCount(0);
  await page.getByRole("button", { name: "Start new cycle" }).click();

  // Today in the new cycle: the commitments set aside, the pot.
  await expect(page.getByRole("status")).toContainText("New cycle started");
  await expect(page.getByTestId("free-money")).toHaveText("Rs 203,000");
  const nextUp = page.getByRole("region", { name: "Next up · already set aside" });
  await expect(nextUp.getByText("Rent")).toBeVisible();
  await expect(nextUp.getByText("Gym")).toBeVisible();
  await expect(nextUp.getByText("Water")).toBeVisible();

  // The leftover saved shows in Savings.
  await tabs.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: /^Savings/ }).click();
  await expect(page.getByText("Saved leftover")).toBeVisible();
  await page.getByRole("link", { name: "← Back" }).click();

  // Every cycle keeps the confirmed amount; pause it.
  await tabs.getByRole("link", { name: "Plan" }).click();
  await page.getByRole("link", { name: "Every cycle" }).click();
  await expect(page.getByText("Rs 37,000 on the")).toBeVisible();
  // The switch follows the saved state, so it flips once the change is saved.
  const rentSwitch = page.getByRole("checkbox", { name: "Rent every cycle" });
  await rentSwitch.click();
  await expect(page.getByRole("status")).toContainText("Rent paused");
  await expect(rentSwitch).not.toBeChecked();
  await expect(page.getByText(/Rs 37,000 on the .* · paused/)).toBeVisible();
});

// Journey: Undo salary day and the salary amount (item 13, spec 2).
test("salary amount changed on Plan, then Undo salary day reopens last cycle", async ({ page }) => {
  await signInFreshToToday(page);
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(page.getByTestId("free-money")).toHaveText("Rs 90,000");

  // A salary day with only the salary: Rs 90,000 left over comes along.
  await page.getByRole("link", { name: "Salary arrived" }).click();
  await page.getByLabel("Salary (LKR)").fill("250000");
  while (!(await page.getByRole("button", { name: "Start new cycle" }).isVisible())) {
    await page.getByRole("button", { name: "Next" }).click();
  }
  await page.getByRole("button", { name: "Start new cycle" }).click();
  await expect(page.getByRole("status")).toContainText("New cycle started");
  await expect(page.getByTestId("free-money")).toHaveText("Rs 340,000");

  // Plan: the salary can still be changed.
  await tabs.getByRole("link", { name: "Plan" }).click();
  const thisCycle = page.getByRole("region", { name: "This cycle" });
  await expect(thisCycle.getByTestId("salary-amount")).toHaveText("Rs 250,000");
  await thisCycle.getByRole("button", { name: "Change" }).first().click();
  await thisCycle.getByLabel("Salary (LKR)").fill("260000");
  await thisCycle.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Salary changed");
  await expect(thisCycle.getByTestId("salary-amount")).toHaveText("Rs 260,000");

  // Undo salary day, asked once more first: last cycle is back as it was.
  await thisCycle.getByRole("button", { name: "Undo salary day" }).click();
  await thisCycle.getByRole("button", { name: "Undo salary day" }).click();
  await expect(page.getByRole("status")).toContainText("Salary day undone");
  await expect(thisCycle.getByTestId("salary-amount")).toHaveCount(0);
  await expect(thisCycle.getByRole("button", { name: "Undo salary day" })).toHaveCount(0);
  await tabs.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("free-money")).toHaveText("Rs 90,000");
});
