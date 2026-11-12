import { expect, test } from "@playwright/test";

// Journey: demo sign-in (spec 16). Google and passkeys are not tested end to end.
test("sign in as the demo user, then sign out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Setaside" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with passkey" })).toBeVisible();

  await page.getByRole("button", { name: "Sign in as demo user" }).click();
  await expect(page.getByRole("heading", { name: "Hello, Demo user" })).toBeVisible();

  // Still signed in after a reload (session cookie).
  await page.reload();
  await expect(page.getByRole("heading", { name: "Hello, Demo user" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in as demo user" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in as demo user" })).toBeVisible();
});
