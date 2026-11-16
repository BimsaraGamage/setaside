import { expect, test } from "@playwright/test";

// Journey: demo sign-in (spec 16), through first use when the demo user is new
// (always in CI; a local D1 may already have it done). Google and passkeys are
// not tested end to end.
test("sign in as the demo user, first use, Today, then sign out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Setaside" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with passkey" })).toBeVisible();

  await page.getByRole("button", { name: "Sign in as demo user" }).click();

  const welcome = page.getByRole("heading", { name: "Welcome to Setaside" });
  const allowance = page.getByTestId("allowance");
  await expect(welcome.or(allowance)).toBeVisible();

  if (await welcome.isVisible()) {
    await page.getByLabel("Spending currency").selectOption("LKR");
    await page.getByLabel("Usual pay day").selectOption("25");
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByRole("heading", { name: "Money you have now" })).toBeVisible();
    await page.getByLabel("Amount (LKR)").fill("90,000");
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByRole("heading", { name: "Next salary day" })).toBeVisible();
    // No bills and no pots (steps 4 and 5, ticket 37).
    for (const heading of ["Bills still to pay", "Pots", "Summary"]) {
      await page.getByRole("button", { name: "Next" }).click();
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    await expect(page.getByTestId("first-use-free")).toHaveText("Rs 90,000");
    await page.getByRole("button", { name: "Start" }).click();
  }

  // Today: allowance, free money and days to salary; all five tabs.
  await expect(page.getByText("You can spend today")).toBeVisible();
  await expect(allowance).toHaveText(/^Rs [\d,]+$/);
  await expect(page.getByTestId("free-money")).toHaveText(/^Rs /);
  await expect(page.getByText("Salary expected")).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Main" });
  for (const t of ["Today", "Plan", "Money", "Past", "Settings"]) {
    await expect(tabs.getByRole("link", { name: t })).toBeVisible();
  }

  // Still signed in, and Today still there, after a reload.
  await page.reload();
  await expect(allowance).toBeVisible();

  await tabs.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in as demo user" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in as demo user" })).toBeVisible();
});
