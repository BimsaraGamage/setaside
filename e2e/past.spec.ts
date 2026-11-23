import { expect, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Journey: Past cycles (item 21, spec 10). Salary day ends the cycle, so this
// runs as a fresh demo user of its own.

test("an ended cycle shows on Past with how it ended, read only", async ({ page }) => {
  await signInFreshToToday(page);
  const tabs = page.getByRole("navigation", { name: "Main" });

  // Nothing has ended yet.
  await tabs.getByRole("link", { name: "Past" }).click();
  await expect(page.getByText("No cycle has ended yet.")).toBeVisible();

  // A spend: Rs 1,000 lunch.
  await tabs.getByRole("link", { name: "Today" }).click();
  await page.getByRole("button", { name: "Add a spend" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a spend" });
  for (const d of "1000") await sheet.getByRole("button", { name: d, exact: true }).click();
  await sheet.getByLabel("Note").fill("Lunch");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Spend saved");

  // Salary day: leftover Rs 89,000, Rs 88,000 in hand, Rs 8,000 to savings.
  await page.getByRole("link", { name: "Salary arrived" }).click();
  await page.getByLabel("Salary (LKR)").fill("250000");
  const leftover = page.getByRole("heading", { name: "Last cycle's leftover" });
  while (!(await leftover.isVisible())) await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByTestId("leftover")).toHaveText("Rs 89,000");
  await page.getByLabel("Actually have in hand (LKR)").fill("88000");
  await page.getByLabel("To savings (LKR)").fill("8000");
  while (!(await page.getByRole("button", { name: "Start new cycle" }).isVisible())) {
    await page.getByRole("button", { name: "Next" }).click();
  }
  await page.getByRole("button", { name: "Start new cycle" }).click();
  await expect(page.getByRole("status")).toContainText("New cycle started");

  // Past: the cycle that ended, with what it started with, spent and how it ended.
  await tabs.getByRole("link", { name: "Past" }).click();
  const row = page.getByTestId("past-cycle");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Started with Rs 90,000 · Spent Rs 1,000");
  await expect(row).toContainText("Left over Rs 89,000");

  // One ended cycle: locked, read only.
  await row.click();
  await expect(tabs).toBeHidden();
  await expect(page.getByTestId("locked")).toHaveText("Locked · read only");
  // At phone width the chip stays a small one-line pill beside the dates.
  await page.setViewportSize({ width: 411, height: 860 });
  // One line of the chip's small text plus padding is under 40 px; stretched to
  // a two-line heading it would be far taller.
  const chip = await page.getByTestId("locked").boundingBox();
  expect(chip?.height ?? 0).toBeGreaterThan(0);
  expect(chip?.height ?? 0).toBeLessThan(40);
  await expect(page.getByTestId("past-spent")).toHaveText("Rs 1,000");
  await expect(page.getByTestId("past-ending")).toContainText(
    "Had Rs 88,000 in hand · Rs 8,000 to savings · Rs 80,000 to the next cycle",
  );
  const spend = page.getByTestId("past-spend");
  await expect(spend).toContainText("Lunch");
  await expect(spend).toContainText("Rs 1,000");
  // Nothing in it can be opened or changed.
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
  await page.getByRole("link", { name: "← Back" }).click();
  await expect(page.getByRole("heading", { name: "Past" })).toBeVisible();
});
