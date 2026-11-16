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
  await signInFresh(page);
  await firstUseToToday(page);
}

/** Signs in as a new demo user of its own and stops at first use's welcome. */
export async function signInFresh(page: Page) {
  await page.goto("/");
  const fresh = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await page.request.post("/api/auth/demo/sign-in", { data: { fresh } });
  expect(res.ok()).toBe(true);
  await page.reload();
}

/** Finishes first use (Rs 90,000 held, pay day 25) when the user is new, then waits for Today. */
async function firstUseToToday(page: Page) {
  const welcome = page.getByRole("heading", { name: "Welcome to Setaside" });
  const allowance = page.getByTestId("allowance");
  await expect(welcome.or(allowance)).toBeVisible();
  if (await welcome.isVisible()) {
    await page.getByLabel("Spending currency").selectOption("LKR");
    await page.getByLabel("Usual pay day").selectOption("25");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Amount (LKR)").fill("90,000");
    // Next salary day, then no bills and no pots.
    for (const heading of ["Next salary day", "Bills still to pay", "Pots"]) {
      await page.getByRole("button", { name: "Next" }).click();
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Start" }).click();
  }
  await expect(allowance).toBeVisible();
}

/**
 * Waits until the service worker is active, then loads the page once more: that load runs through it, so its
 * files are kept. (Waiting for this page to be taken over is not enough: a worker that turns active while the
 * page is reloading never takes that page over.)
 */
export async function keepForOffline(page: Page) {
  // e2e is type-checked without the DOM types: the little of navigator.serviceWorker used here.
  type Sw = { serviceWorker: { ready: Promise<unknown>; controller: unknown } };
  await page.evaluate(async () => {
    await (navigator as unknown as Sw).serviceWorker.ready;
  });
  await page.reload();
  await expect(
    page.getByTestId("allowance").or(page.getByRole("button", { name: /sign in/i })),
  ).toBeVisible();
  expect(await page.evaluate(() => Boolean((navigator as unknown as Sw).serviceWorker.controller))).toBe(
    true,
  );
}
