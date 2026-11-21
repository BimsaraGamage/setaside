import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Journey: send an idea, the keeper answers it with `npm run feedback -- --set` on the local database, and the
// sender sees where it is under Settings → Feedback → Your feedback (ticket SAB-60, spec 14 "Feedback").

test("feedback answered with the script shows under Your feedback", async ({ page }, info) => {
  await signInFreshToToday(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();
  const region = page.getByRole("region", { name: "Feedback" });
  await region.getByRole("button", { name: /Send feedback/ }).click();
  const sheet = page.getByRole("dialog", { name: "Send feedback" });
  const words = `Show next month too ${info.project.name} ${Date.now()}`;
  await sheet.getByRole("button", { name: "Idea" }).click();
  await sheet.getByLabel("Feedback").fill(`${words}\nsecond line stays out of the list`);
  await sheet.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("status")).toContainText("Thanks, saved");

  // Shows at once, as sent.
  const item = region.getByTestId("your-feedback").filter({ hasText: words });
  await expect(item).toBeVisible();
  await expect(item.getByTestId("your-feedback-status")).toHaveText("Sent");
  await expect(item).not.toContainText("second line");

  // The keeper answers it.
  const listed = execFileSync(
    "node",
    ["scripts/feedback.mjs", "--local", "--out", info.outputPath("inbox")],
    {
      encoding: "utf8",
    },
  );
  const id =
    listed
      .split("\n")
      .find((l) => l.includes(words))
      ?.split(/\s+/)[0] ?? "";
  const reply = "Planned: Next cycle preview, it's on the list";
  execFileSync(
    "node",
    [
      "scripts/feedback.mjs",
      "--local",
      "--set",
      id,
      "--status",
      "planned",
      "--reply",
      reply,
      "--ticket",
      "SAB-46",
    ],
    { encoding: "utf8" },
  );

  await page.reload();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();
  await expect(item.getByTestId("your-feedback-status")).toHaveText("Planned");
  await expect(item).toContainText(reply);
});
