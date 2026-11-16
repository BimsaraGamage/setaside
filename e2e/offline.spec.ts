import { expect, type Page, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Journey: Installable app (item 23, spec 11). The manifest makes it installable, the service worker keeps
// the app's files and the phone keeps a copy of the current cycle, so the app opens with no connection.
// Fresh demo users: sign out is part of it.

test.use({ serviceWorkers: "allow" });

/**
 * Waits until the service worker is active, then loads the page once more: that load runs through it, so its
 * files are kept. (Waiting for this page to be taken over is not enough: a worker that turns active while the
 * page is reloading never takes that page over.)
 */
async function keepForOffline(page: Page) {
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

test("installable: manifest with standalone display and icons", async ({ page }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBe("/manifest.webmanifest");
  const manifest = await (await page.request.get(href as string)).json();
  expect(manifest).toMatchObject({ name: "Setaside", display: "standalone", start_url: "/", scope: "/" });
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  for (const icon of manifest.icons) {
    const res = await page.request.get(icon.src);
    expect(res.ok()).toBe(true);
    expect(res.headers()["content-type"]).toContain("image/png");
  }
  const sw = await page.request.get("/sw.js");
  expect(sw.ok()).toBe(true);
  expect(sw.headers()["content-type"]).toContain("javascript");
});

test("opens offline with the saved copy, and the bar goes when the connection is back", async ({
  page,
  context,
}) => {
  await signInFreshToToday(page);
  await keepForOffline(page);
  const allowance = await page.getByTestId("allowance").textContent();
  await expect(page.getByTestId("offline")).toHaveCount(0);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("allowance")).toHaveText(allowance as string);
  await expect(page.getByTestId("offline")).toHaveText("Offline · last updated just now");
  // The other tabs open from the copy too.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByTestId("offline")).toHaveCount(0);
});

test("sign out removes the copy: offline it asks to sign in", async ({ page, context }) => {
  await signInFreshToToday(page);
  await keepForOffline(page);
  await page.goto("/#Settings");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Setaside" })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Setaside" })).toBeVisible();
  await expect(page.getByTestId("allowance")).toHaveCount(0);
  await expect(page.getByTestId("offline")).toHaveCount(0);
});
