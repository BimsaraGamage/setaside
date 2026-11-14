import { expect, type Page } from "@playwright/test";

/** Signs in as the demo user and finishes first use when the demo user is new. */
export async function signInToToday(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in as demo user" }).click();
  const welcome = page.getByRole("heading", { name: "Welcome to Setaside" });
  const allowance = page.getByTestId("allowance");
  await expect(welcome.or(allowance)).toBeVisible();
  if (await welcome.isVisible()) {
    await page.getByLabel("Currency").selectOption("LKR");
    await page.getByLabel("Usual pay day").selectOption("25");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Amount (LKR)").fill("90,000");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Start" }).click();
  }
  await expect(allowance).toBeVisible();
}
