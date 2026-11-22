import { expect, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Savings goals (ticket SAB-68, spec 5 and 10). A fresh demo user of its own: free money starts at Rs 90,000.

test("make a goal with its first share, see it on Today, Savings and the next cycle, stop and delete it", async ({
  page,
}) => {
  await signInFreshToToday(page);
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(page.getByTestId("free-money")).toHaveText("Rs 90,000");

  // Savings: Rs 50,000 put in, then a goal with Rs 20,000 of it already saved for it.
  await tabs.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: /^Savings/ }).click();
  await page.getByRole("link", { name: "Put in" }).click();
  await page.getByLabel("Amount (LKR)").fill("50000");
  await page.getByRole("button", { name: "Put in" }).click();
  await expect(page.getByTestId("savings-total")).toHaveText("Rs 50,000");

  await page.getByRole("link", { name: "+ New goal" }).click();
  await page.getByLabel("What for").fill("Trip to Japan");
  await page.getByLabel("Target (LKR)").fill("600000");
  await page.getByLabel("Already saved for it (LKR)").fill("60000");
  await expect(page.getByText("Already saved can't be more than your savings or the target.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await page.getByLabel("Already saved for it (LKR)").fill("20000");
  // The fair share is filled in; set aside Rs 10,000 now instead, and see the new allowance.
  const share = page.getByLabel("Set aside now (LKR)");
  await expect(share).not.toHaveValue("");
  await share.fill("10000");
  await expect(page.getByTestId("goal-after")).toContainText("You can spend today after this");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Trip to Japan goal saved");

  // Savings › Goals: progress, the by date and the status (less than the fair share: Behind).
  const goal = page.getByTestId("goal");
  await expect(goal).toContainText("Trip to Japan");
  await expect(goal).toContainText("Rs 20,000 of Rs 600,000");
  await expect(goal).toContainText("Behind:");

  // Today: the share is set aside, with the goal's progress as its note.
  await page.getByRole("link", { name: "← Back" }).click();
  await tabs.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("free-money")).toHaveText("Rs 80,000");
  await expect(page.getByText("Rs 20,000 of Rs 600,000 · Savings")).toBeVisible();

  // Plan's next cycle counts the goal's next share under Savings.
  await tabs.getByRole("link", { name: "Plan" }).click();
  await expect(page.getByTestId("next-cycle-savings")).toBeVisible();
  await page.getByTestId("next-cycle-savings").locator("summary").click();
  await expect(page.getByTestId("next-cycle-savings")).toContainText("Trip to Japan");

  // The goal page: its share this cycle; stop and start again; delete (nothing moved yet) takes the share too.
  await tabs.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: /^Savings/ }).click();
  await page.getByTestId("goal").click();
  await expect(page.getByTestId("goal-progress")).toHaveText("Rs 20,000 of Rs 600,000");
  await expect(page.getByTestId("goal-share")).toContainText("of Rs 10,000");
  await page.getByRole("button", { name: "Stop this goal" }).click();
  await expect(page.getByTestId("goal-status")).toContainText("Stopped");
  await page.getByRole("button", { name: "Start this goal again" }).click();
  await expect(page.getByTestId("goal-status")).toContainText("Behind:");
  await page.getByLabel("Target (LKR)").fill("500000");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("goal-progress")).toHaveText("Rs 20,000 of Rs 500,000");
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("status")).toContainText("Trip to Japan deleted");
  await expect(page.getByTestId("goal")).toHaveCount(0);
  await page.getByRole("link", { name: "← Back" }).click();
  await tabs.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("free-money")).toHaveText("Rs 90,000");
});

test("move a goal's share to savings: its progress grows and it can no longer be deleted", async ({
  page,
}) => {
  await signInFreshToToday(page);
  const tabs = page.getByRole("navigation", { name: "Main" });
  await tabs.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: /^Savings/ }).click();
  await page.getByRole("link", { name: "+ New goal" }).click();
  await page.getByLabel("What for").fill("Laptop");
  await page.getByLabel("Target (LKR)").fill("300000");
  await page.getByLabel("Set aside now (LKR)").fill("25000");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Laptop goal saved");

  // Plan: the share says which goal it is for, has no Bill/Savings switch and no Every cycle; Move it.
  await page.getByRole("link", { name: "← Back" }).click();
  await tabs.getByRole("link", { name: "Plan" }).click();
  await page.getByRole("link", { name: /Laptop Rs 0 of Rs 300,000/ }).click();
  await expect(page.getByTestId("goal-share-note")).toContainText("This cycle's share of Laptop");
  await expect(page.getByRole("group", { name: "Kind" })).toHaveCount(0);
  await expect(page.getByText("Every cycle")).toHaveCount(0);
  await page.getByRole("link", { name: "Move", exact: true }).click();
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Laptop moved · finished");
  await page.getByRole("link", { name: "← Back" }).click();

  // Savings › the goal: Rs 25,000 of Rs 300,000, the share moved, no Delete any more.
  await tabs.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: /^Savings/ }).click();
  await expect(page.getByTestId("savings-total")).toHaveText("Rs 25,000");
  await page.getByTestId("goal").click();
  await expect(page.getByTestId("goal-progress")).toHaveText("Rs 25,000 of Rs 300,000");
  await expect(page.getByTestId("goal-share")).toContainText("Moved");
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);

  // SAB-69: take Rs 5,000 out of savings from the goal: at most what is saved toward it.
  await page.getByRole("link", { name: "← Back" }).click();
  await page.getByRole("link", { name: "Take out" }).click();
  await page.getByLabel("Amount (LKR)").fill("30000");
  await page.getByRole("group", { name: "From a goal?" }).getByRole("button", { name: "Laptop" }).click();
  await expect(page.getByTestId("goal-take-out-note")).toContainText(
    "More than is saved toward it (Rs 25,000)",
  );
  await expect(page.getByRole("button", { name: "Take out", exact: true })).toBeDisabled();
  await page.getByLabel("Amount (LKR)").fill("5000");
  await expect(page.getByTestId("goal-take-out-note")).toContainText("The next salary day's share grows");
  await page.getByRole("button", { name: "Take out", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Rs 5,000 taken out of savings");
  await expect(page.getByText("From Laptop")).toBeVisible();
  await page.getByTestId("goal").click();
  await expect(page.getByTestId("goal-progress")).toHaveText("Rs 20,000 of Rs 300,000");
  await expect(page.getByTestId("goal-taken-out")).toHaveText("Rs 5,000 taken out of it");

  // Undo of the take-out puts it back toward the goal.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("goal-progress")).toHaveText("Rs 25,000 of Rs 300,000");
  await expect(page.getByTestId("goal-taken-out")).toHaveCount(0);
});
