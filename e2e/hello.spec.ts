import { expect, test } from "@playwright/test";

// Placeholder journey until backlog item 2 adds "demo sign-in".
test("the app opens and reaches the server", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hello, Setaside" })).toBeVisible();
  await expect(page.getByText("All set")).toBeVisible();
});
