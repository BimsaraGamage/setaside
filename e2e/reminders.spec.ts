import { expect, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Journey: reminders in the app (backlog item 25, spec 12). Needs a salary day, so
// it runs as a fresh demo user of its own.

test("reminders: none before the first salary, a bill due today listed, switched off in Settings, banner dismissed", async ({
  page,
}) => {
  await signInFreshToToday(page);
  const tabs = page.getByRole("navigation", { name: "Main" });
  const reminders = page.getByRole("region", { name: "Reminders" });

  // A bill due today (the form's default day).
  const addRent = async () => {
    await tabs.getByRole("link", { name: "Plan" }).click();
    await page.getByRole("link", { name: "+ Add" }).click();
    await page.getByLabel("Name").fill("Rent");
    await page.getByLabel("Amount (LKR)").fill("5000");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toContainText("Commitment saved");
    await tabs.getByRole("link", { name: "Today" }).click();
  };

  // First cycle: started with money held, no salary yet, so no reminders.
  await addRent();
  await expect(page.getByTestId("allowance")).toBeVisible();
  await expect(reminders).toHaveCount(0);

  // Salary day: Rent was paid; nothing else.
  await page.getByRole("link", { name: "Salary arrived" }).click();
  await page.getByLabel("Salary (LKR)").fill("250000");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("region", { name: "Rent" }).getByRole("radio", { name: "Paid it" }).click();
  while (!(await page.getByRole("button", { name: "Start new cycle" }).isVisible())) {
    await page.getByRole("button", { name: "Next" }).click();
  }
  await page.getByRole("button", { name: "Start new cycle" }).click();
  await expect(page.getByRole("status")).toContainText("New cycle started");

  // A new bill due today shows at the top of Today, with the turn-on banner.
  await addRent();
  await expect(reminders.getByText("Rent due today · Rs 5,000")).toBeVisible();
  await expect(page.getByTestId("reminders-banner")).toBeVisible();

  // Settings → Reminders: switch "Bill due today or late" off; the line goes.
  await tabs.getByRole("link", { name: "Settings" }).click();
  const dueToday = page.getByRole("checkbox", { name: "Bill due today or late" });
  await expect(dueToday).toBeChecked();
  await dueToday.click();
  await expect(dueToday).not.toBeChecked();
  await expect(page.getByLabel("Days ahead")).toHaveValue("3");
  await expect(page.getByLabel("Spend nudge at")).toHaveValue("21:00");
  await tabs.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("allowance")).toBeVisible();
  await expect(page.getByText("Rent due today · Rs 5,000")).toHaveCount(0);

  // On again; the banner is dismissed and stays dismissed after a reload.
  await tabs.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("checkbox", { name: "Bill due today or late" }).click();
  await expect(page.getByRole("checkbox", { name: "Bill due today or late" })).toBeChecked();
  await tabs.getByRole("link", { name: "Today" }).click();
  await expect(reminders.getByText("Rent due today · Rs 5,000")).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByTestId("reminders-banner")).toHaveCount(0);
  await page.reload();
  await expect(reminders.getByText("Rent due today · Rs 5,000")).toBeVisible();
  await expect(page.getByTestId("reminders-banner")).toHaveCount(0);
});
