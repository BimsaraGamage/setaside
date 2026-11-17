import { expect, type Page, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Journey: reminders in the app (backlog item 25, spec 12). Goes through a salary day,
// so it runs as a fresh demo user of its own.

test("reminders: listed in the first cycle and after salary day, switched off in Settings, banner dismissed, phone alerts on hide the list", async ({
  page,
}) => {
  await fakePush(page);
  await signInFreshToToday(page);
  const tabs = page.getByRole("navigation", { name: "Main" });
  const reminders = page.getByRole("region", { name: "Reminders" });

  // A bill due today (the form's default day).
  const addRent = async () => {
    await tabs.getByRole("link", { name: "Plan" }).click();
    await page.getByRole("link", { name: "+ Add" }).click();
    await page.getByLabel("Name").fill("Rent");
    await page.getByLabel("Amount (LKR)").fill("5000");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toContainText("Commitment saved");
    await tabs.getByRole("link", { name: "Today" }).click();
  };

  // First cycle: started with money held, no salary yet; reminders already work.
  await addRent();
  await expect(reminders.getByText("Rent due today · Rs 5,000")).toBeVisible();

  // Salary day: Rent was paid; nothing else.
  await page.getByRole("link", { name: "Salary arrived" }).click();
  await page.getByLabel("Salary (LKR)").fill("250000");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("region", { name: "Rent" }).getByRole("radio", { name: "Paid it" }).click();
  while (!(await page.getByRole("button", { name: "Start new cycle" }).isVisible())) {
    await page.getByRole("button", { name: "Next" }).click();
  }
  await page.getByRole("button", { name: "Start new cycle" }).click();
  await expect(page.getByRole("status")).toContainText("New cycle started");

  // A new bill due today shows at the top of Today, with the turn-on banner.
  await addRent();
  await expect(reminders.getByText("Rent due today · Rs 5,000")).toBeVisible();
  await expect(page.getByTestId("reminders-banner")).toContainText("tap Turn on reminders in Settings");

  // Settings → Reminders: switch "Bill due today or late" off; the line goes.
  await tabs.getByRole("link", { name: "Settings" }).click();
  const dueToday = page.getByRole("checkbox", { name: "Bill due today or late" });
  await expect(dueToday).toBeChecked();
  await dueToday.click();
  await expect(dueToday).not.toBeChecked();
  await expect(page.getByLabel("Days ahead")).toHaveValue("3");
  await expect(page.getByLabel("Spend nudge at")).toHaveValue("21:00");
  // This device's phone alerts (item 26): off here (or not possible in this browser).
  await expect(page.getByTestId("this-device")).toHaveAttribute("data-state", "off");
  await tabs.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("allowance")).toBeVisible();
  await expect(page.getByText("Rent due today · Rs 5,000")).toHaveCount(0);

  // On again; the banner is dismissed and stays dismissed after a reload.
  await tabs.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("checkbox", { name: "Bill due today or late" }).click();
  await expect(page.getByRole("checkbox", { name: "Bill due today or late" })).toBeChecked();
  await tabs.getByRole("link", { name: "Today" }).click();
  await expect(reminders.getByText("Rent due today · Rs 5,000")).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByTestId("reminders-banner")).toHaveCount(0);
  await page.reload();
  await expect(reminders.getByText("Rent due today · Rs 5,000")).toBeVisible();
  await expect(page.getByTestId("reminders-banner")).toHaveCount(0);

  // Phone alerts on this device (item 26): turned on in Settings, Today's list goes; off again, it is back.
  await tabs.getByRole("link", { name: "Settings" }).click();
  const device = page.getByTestId("this-device");
  await expect(device).toHaveAttribute("data-state", "off");
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/push-subscriptions"));
  await page.getByRole("button", { name: "Turn on reminders" }).click();
  expect((await saved).status()).toBe(201);
  await expect(device).toHaveAttribute("data-state", "on");
  await tabs.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("allowance")).toBeVisible();
  await expect(reminders).toHaveCount(0);
  await tabs.getByRole("link", { name: "Settings" }).click();
  const removed = page.waitForResponse((r) => r.url().endsWith("/api/push-subscriptions/remove"));
  await page.getByRole("button", { name: "Turn off on this device" }).click();
  expect((await removed).status()).toBe(200);
  await expect(device).toHaveAttribute("data-state", "off");
  await tabs.getByRole("link", { name: "Today" }).click();
  await expect(reminders.getByText("Rent due today · Rs 5,000")).toBeVisible();
});

/**
 * The browser's push pieces, faked: headless browsers have no push service, and the
 * dev server has no VAPID keys. The real server still saves and removes the device.
 */
async function fakePush(page: Page) {
  await page.route("**/api/push/key", (route) => route.fulfill({ json: { publicKey: PHONE_KEY } }));
  await page.addInitScript((p256dh) => {
    type Store = {
      getItem(k: string): string | null;
      setItem(k: string, v: string): void;
      removeItem(k: string): void;
    };
    const store = (globalThis as unknown as { sessionStorage: Store }).sessionStorage;
    const makeSub = (endpoint: string) => ({
      endpoint,
      toJSON: () => ({ endpoint, keys: { p256dh, auth: "BTBZMqHH6r4Tts7J_aSIgg" } }),
      unsubscribe: async () => {
        store.removeItem("fake-push");
        return true;
      },
    });
    const pushManager = {
      getSubscription: async () => {
        const endpoint = store.getItem("fake-push");
        return endpoint ? makeSub(endpoint) : null;
      },
      subscribe: async () => {
        const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${crypto.randomUUID()}`;
        store.setItem("fake-push", endpoint);
        return makeSub(endpoint);
      },
    };
    const reg = { pushManager };
    const w = globalThis as unknown as Record<string, unknown>;
    w.PushManager ??= () => {};
    w.Notification = {
      get permission() {
        return store.getItem("fake-permission") ?? "default";
      },
      requestPermission: async () => {
        store.setItem("fake-permission", "granted");
        return "granted";
      },
    };
    const sw = (navigator as unknown as { serviceWorker: Record<string, unknown> }).serviceWorker;
    Object.defineProperty(sw, "ready", { get: () => Promise.resolve(reg) });
    sw.getRegistration = async () => reg;
  }, PHONE_KEY);
}

/** A phone's public key (RFC 8291's example). */
const PHONE_KEY = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
