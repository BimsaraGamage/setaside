import { expect, test } from "@playwright/test";

// Journey: a phone notification arrives (item 26, spec 12). The service worker shows every push as a
// visible notification. Chromium only: the push is handed to the service worker through the browser's
// developer tools (headless browsers have no push service of their own).

test.use({ serviceWorkers: "allow" });

test("a push shows as a notification with the reminders", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "push delivery through the developer tools is Chromium only");
  await context.grantPermissions(["notifications"]);
  await page.goto("/");
  type Reg = { scope: string };
  type Sw = { serviceWorker: { ready: Promise<Reg> } };
  await page.evaluate(async () => (await (navigator as unknown as Sw).serviceWorker.ready).scope);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  // What the worker asks the browser to show (headless browsers keep no notification list of their own).
  await worker.evaluate(() => {
    type Shown = { title: string; options: { body: string; data: { url: string } } };
    const g = globalThis as unknown as {
      shown: Shown[];
      registration: { showNotification: (t: string, o: Shown["options"]) => Promise<void> };
    };
    g.shown = [];
    const real = g.registration.showNotification.bind(g.registration);
    g.registration.showNotification = (title, options) => {
      g.shown.push({ title, options });
      return real(title, options).catch(() => undefined);
    };
  });

  const cdp = await context.newCDPSession(page);
  const registrations = new Promise<{ registrationId: string }[]>((resolve) =>
    cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => resolve(e.registrations)),
  );
  await cdp.send("ServiceWorker.enable");
  const [reg] = await registrations;
  await cdp.send("ServiceWorker.deliverPushMessage", {
    origin: new URL(page.url()).origin,
    registrationId: reg?.registrationId ?? "",
    data: JSON.stringify({ title: "Setaside", body: "Rent due today · Rs 5,000", url: "/" }),
  });

  await expect
    .poll(() =>
      worker.evaluate(() =>
        (
          globalThis as unknown as {
            shown: { title: string; options: { body: string; data: { url: string } } }[];
          }
        ).shown.map((n) => ({ title: n.title, body: n.options.body, url: n.options.data.url })),
      ),
    )
    .toEqual([{ title: "Setaside", body: "Rent due today · Rs 5,000", url: "/" }]);
});
