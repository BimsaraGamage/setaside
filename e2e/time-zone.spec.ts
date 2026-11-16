import { expect, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Journey: Home time zone switch (item 22, spec 10). Set up with the phone in
// Colombo, then the phone is in London: Today asks once. Fresh demo users, as
// the answer changes the user's settings.

test.use({ timezoneId: "Asia/Colombo" });

async function inLondon(browser: import("@playwright/test").Browser, page: import("@playwright/test").Page) {
  const { defaultBrowserType: _, ...use } = test.info().project.use;
  const there = await browser.newContext({
    ...use,
    timezoneId: "Europe/London",
    storageState: await page.context().storageState(),
  });
  const p = await there.newPage();
  await p.goto("/");
  await expect(p.getByTestId("allowance")).toBeVisible();
  return p;
}

test("no question while the phone is in the home time zone", async ({ page }) => {
  await signInFreshToToday(page);
  await expect(page.getByTestId("zone-switch")).toHaveCount(0);
});

test("Keep: home stays, and the same zone is not asked about again", async ({ page, browser }) => {
  await signInFreshToToday(page);
  const london = await inLondon(browser, page);
  const card = london.getByTestId("zone-switch");
  await expect(card.getByRole("heading")).toHaveText("Your phone is on London time");
  await card.getByRole("button", { name: "Keep Colombo" }).click();
  await expect(london.getByRole("status")).toContainText("Kept your home time zone");
  await expect(card).toHaveCount(0);
  await london.reload();
  await expect(london.getByTestId("allowance")).toBeVisible();
  await expect(card).toHaveCount(0);
  await london.goto("/#Settings");
  await expect(london.getByLabel("Home time zone")).toHaveValue("Asia/Colombo");
  await london.context().close();
});

test("Switch: London becomes home, then coming back to Colombo asks again", async ({ page, browser }) => {
  await signInFreshToToday(page);
  const london = await inLondon(browser, page);
  await london.getByTestId("zone-switch").getByRole("button", { name: "Switch to London" }).click();
  await expect(london.getByRole("status")).toContainText("Home time zone is now London");
  await expect(london.getByTestId("zone-switch")).toHaveCount(0);
  await london.goto("/#Settings");
  await expect(london.getByLabel("Home time zone")).toHaveValue("Europe/London");
  await london.context().close();

  // Back in Colombo: the phone differs from home (London) again.
  await page.reload();
  const card = page.getByTestId("zone-switch");
  await expect(card.getByRole("heading")).toHaveText("Your phone is on Colombo time");
  await expect(card.getByRole("button", { name: "Keep London" })).toBeVisible();
});
