import { expect, type Page } from "@playwright/test";

/** Signs in as the demo user and finishes first use when the demo user is new. */
export async function signInToToday(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in as demo user" }).click();
  await firstUseToToday(page);
}

/**
 * Signs in as a demo user of its own (item 11), for journeys that change the
 * whole cycle, and finishes first use.
 */
export async function signInFreshToToday(page: Page) {
  await page.goto("/");
  const fresh = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await page.request.post("/api/auth/demo/sign-in", { data: { fresh } });
  expect(res.ok()).toBe(true);
  await page.reload();
  await firstUseToToday(page);
}

/** Finishes first use (Rs 90,000 held, pay day 25) when the user is new, then waits for Today. */
async function firstUseToToday(page: Page) {
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
