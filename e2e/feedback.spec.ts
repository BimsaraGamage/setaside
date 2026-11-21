import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Journey: send feedback with a screenshot, then read it back with `npm run feedback` against the local
// database (ticket SAB-55, spec 14 "Feedback").

test("send feedback with a screenshot and read it back with the script", async ({ page, context }, info) => {
  await signInFreshToToday(page);
  const tabs = page.getByRole("navigation", { name: "Main" });

  await page.getByRole("button", { name: "Add a spend" }).click();
  const spendSheet = page.getByRole("dialog", { name: "Add a spend" });
  for (const d of "450") await spendSheet.getByRole("button", { name: d, exact: true }).click();
  await spendSheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Spend saved");

  await tabs.getByRole("link", { name: "Settings" }).click();
  await page
    .getByRole("region", { name: "Feedback" })
    .getByRole("button", { name: /Send feedback/ })
    .click();
  const sheet = page.getByRole("dialog", { name: "Send feedback" });
  await expect(sheet.getByRole("img", { name: "Screenshot of the screen behind" })).toBeVisible();
  await expect(sheet.getByText("Also sends: last steps in the app")).toBeVisible();

  // No connection: Send waits for one.
  await context.setOffline(true);
  await expect(sheet.getByTestId("feedback-offline")).toHaveText("Needs a connection, try again.");
  await context.setOffline(false);
  await expect(sheet.getByTestId("feedback-offline")).toBeHidden();

  const words = `Free money looks off ${info.project.name} ${Date.now()}`;
  await sheet.getByRole("button", { name: "Something's wrong" }).click();
  await sheet.getByLabel("Feedback").fill(words);
  await sheet.getByRole("button", { name: "Send" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("status")).toContainText("Thanks, saved");

  // An agent reads it: the script writes it to a folder.
  const out = info.outputPath("inbox");
  const listed = execFileSync("node", ["scripts/feedback.mjs", "--local", "--out", out], {
    encoding: "utf8",
  });
  const line = listed.split("\n").find((l) => l.includes(words));
  expect(line).toBeTruthy();
  const id = line?.split(/\s+/)[0] ?? "";
  const dir = join(out, id);
  const files = await readdir(dir);
  expect(files).toEqual(expect.arrayContaining(["note.md", "context.json", "trail.json", "today.json"]));
  expect(files.some((f) => /^screen\.(webp|jpg|png)$/.test(f))).toBe(true);

  const note = await readFile(join(dir, "note.md"), "utf8");
  expect(note).toContain(words);
  expect(note).toContain("screen Settings");
  const trail = JSON.parse(await readFile(join(dir, "trail.json"), "utf8")) as Record<string, unknown>[];
  expect(trail).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "api", method: "POST", path: "/api/spends", status: 201 }),
      expect.objectContaining({ kind: "tap", label: "Save" }),
      expect.objectContaining({ kind: "screen", name: "Settings" }),
      expect.objectContaining({ kind: "online", online: false }),
    ]),
  );
  const today = JSON.parse(await readFile(join(dir, "today.json"), "utf8"));
  expect(today.spends).toEqual([expect.objectContaining({ amountMinor: 45_000 })]);

  // Marked handled, it is no longer listed as new.
  execFileSync("node", ["scripts/feedback.mjs", "--local", "--done", id], { encoding: "utf8" });
  const after = execFileSync("node", ["scripts/feedback.mjs", "--local", "--out", out], { encoding: "utf8" });
  expect(after).not.toContain(id);
});
