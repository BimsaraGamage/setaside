import { expect, type Page, test } from "@playwright/test";
import { keepForOffline, signInFreshToToday } from "./helpers";

// Journey: Offline spends and payments (item 24, spec 11). Spends and payments made offline wait in the unsent
// queue on the phone, are counted at once, survive a reload and are sent by themselves when the connection is
// back; saved ones wait for a connection; ones that no longer fit go to Needs a look. Fresh demo users.

test.use({ serviceWorkers: "allow" });

const main = (page: Page) => page.getByRole("navigation", { name: "Main" });

async function addSpend(page: Page, digits: string, note: string) {
  await page.getByRole("button", { name: "Add a spend" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a spend" });
  for (const d of digits) await sheet.getByRole("button", { name: d, exact: true }).click();
  await sheet.getByLabel("Note").fill(note);
  await sheet.getByRole("button", { name: "Save" }).click();
}

/** A bill due today, made online; returns its id. */
async function addBill(page: Page, name: string, amount: string): Promise<string> {
  await main(page).getByRole("link", { name: "Plan" }).click();
  await page.getByRole("link", { name: "+ Add" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Amount (LKR)").fill(amount);
  await page.getByRole("button", { name: "Save" }).click();
  // Saved and back on Plan with it listed (an earlier toast may still show "Commitment saved").
  await expect(page.getByRole("heading", { name: "Plan", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(` ${name} `) })).toBeVisible();
  const res = await page.request.get("/api/current");
  const cur = (await res.json()) as { commitments: { id: string; name: string }[] };
  return cur.commitments.find((c) => c.name === name)?.id as string;
}

test("a spend made offline is counted at once, kept through a reload, and sent when back online", async ({
  page,
  context,
}) => {
  await signInFreshToToday(page);
  await keepForOffline(page);
  const before = await page.getByTestId("free-money").textContent();

  await context.setOffline(true);
  await addSpend(page, "500", "Bus");
  await expect(page.getByRole("status")).toContainText("Spend saved on this phone");
  const card = page.getByRole("region", { name: "You can spend today" });
  const row = card.getByRole("button", { name: /Bus/ });
  await expect(row).toContainText("Not sent");
  await expect(page.getByTestId("offline")).toHaveText(/^Offline · 1 not sent · last updated /);
  await expect(page.getByTestId("last-updated")).toBeVisible();
  await expect(page.getByTestId("free-money")).not.toHaveText(before as string);

  // Closing and opening the app keeps it.
  await page.reload();
  await expect(row).toContainText("Not sent");
  await expect(page.getByTestId("offline")).toContainText("1 not sent");

  // An unsent spend can be changed offline.
  await row.click();
  const change = page.getByRole("dialog", { name: "Change spend" });
  await expect(change.getByTestId("waits")).toHaveCount(0);
  await change.getByRole("button", { name: "Delete digit" }).click();
  await change.getByRole("button", { name: "Delete digit" }).click();
  await change.getByRole("button", { name: "Delete digit" }).click();
  await change.getByRole("button", { name: "6", exact: true }).click();
  await change.getByRole("button", { name: "0", exact: true }).click();
  await change.getByRole("button", { name: "0", exact: true }).click();
  await change.getByRole("button", { name: "Save" }).click();
  await expect(card.getByRole("button", { name: /Bus.*Rs 600/ })).toBeVisible();

  // Back online: sent by itself, the marks and the bar go.
  await context.setOffline(false);
  await expect(page.getByTestId("offline")).toHaveCount(0);
  await expect(card.getByRole("button", { name: /Bus/ })).not.toContainText("Not sent");
  const cur = (await (await page.request.get("/api/current")).json()) as {
    spends: { note: string; amountMinor: number }[];
  };
  expect(cur.spends).toMatchObject([{ note: "Bus", amountMinor: 60_000 }]);

  // A saved spend waits for a connection.
  await context.setOffline(true);
  await page.reload();
  await card.getByRole("button", { name: /Bus/ }).click();
  await expect(change.getByTestId("waits")).toBeVisible();
  await expect(change.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(change.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
  await context.setOffline(false);
});

test("a spend made offline comes out of its place at once, and only once when it is sent", async ({
  page,
  context,
}) => {
  // Ticket SAB-51: the place's balance is worked out on the phone from the unsent spend, then by the server.
  await signInFreshToToday(page);
  const place = {
    id: crypto.randomUUID(),
    name: "In hand",
    balance: { id: crypto.randomUUID(), amountMinor: 2_000_000 },
  };
  expect((await page.request.post("/api/places", { data: place })).ok()).toBe(true);
  await keepForOffline(page);
  await expect(page.getByTestId("places-line")).toHaveText("In hand Rs 20,000");

  await context.setOffline(true);
  await addSpend(page, "500", "Bus");
  await expect(page.getByRole("status")).toContainText("Spend saved on this phone");
  await expect(page.getByTestId("places-line")).toHaveText("In hand Rs 19,500");
  await page.reload();
  await expect(page.getByTestId("places-line")).toHaveText("In hand Rs 19,500");

  await context.setOffline(false);
  await expect(page.getByTestId("offline")).toHaveCount(0);
  await expect(page.getByTestId("places-line")).toHaveText("In hand Rs 19,500");
  const cur = (await (await page.request.get("/api/current")).json()) as {
    spends: { placeId: string | null }[];
    places: { movedMinor: number }[];
  };
  expect(cur.spends).toMatchObject([{ placeId: place.id }]);
  expect(cur.places).toMatchObject([{ movedMinor: -50_000 }]);
});

test("a payment made offline is sent when back online", async ({ page, context }) => {
  await signInFreshToToday(page);
  const name = "Water";
  const id = await addBill(page, name, "300");
  await page.goto(`/#Pay/${id}`);
  await expect(page.getByRole("heading", { name: `Pay · ${name}` })).toBeVisible();

  await context.setOffline(true);
  await page.getByLabel("Amount paid (LKR)").fill("100");
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Payment saved on this phone");
  await expect(page.getByTestId("still-to-pay")).toContainText("Paid Rs 100 · still to pay Rs 200");
  await expect(page.locator(".unsent")).toHaveText("Not sent");

  await context.setOffline(false);
  await expect(page.locator(".unsent")).toHaveCount(0);
  const cur = (await (await page.request.get("/api/current")).json()) as {
    commitments: { id: string; payments: { amountMinor: number }[] }[];
  };
  expect(cur.commitments.find((c) => c.id === id)?.payments).toMatchObject([{ amountMinor: 10_000 }]);
});

test("a payment that no longer fits goes to Needs a look, where it is sent to another commitment", async ({
  page,
  context,
}) => {
  await signInFreshToToday(page);
  const id = await addBill(page, "Gas", "300");
  await addBill(page, "Power", "500");
  await page.goto(`/#Pay/${id}`);
  await expect(page.getByRole("heading", { name: "Pay · Gas" })).toBeVisible();

  await context.setOffline(true);
  await page.getByLabel("Amount paid (LKR)").fill("100");
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Payment saved on this phone");
  // Meanwhile, on another device, Gas is marked finished.
  const finished = await page.request.patch(`/api/commitments/${id}`, { data: { state: "finished" } });
  expect(finished.ok()).toBe(true);

  await context.setOffline(false);
  await page.goto("/#Today");
  const look = page.getByTestId("needs-a-look");
  await expect(look).toContainText("Payment Rs 100 to Gas");
  await expect(look).toContainText("Gas is finished.");
  await look.getByLabel("Pay instead").selectOption({ label: "Power" });
  await look.getByRole("button", { name: "Send to Power" }).click();
  await expect(page.getByRole("status")).toContainText("Payment saved to Power");
  await expect(look).toHaveCount(0);
  const cur = (await (await page.request.get("/api/current")).json()) as {
    commitments: { name: string; payments: { amountMinor: number }[] }[];
  };
  expect(cur.commitments.find((c) => c.name === "Power")?.payments).toMatchObject([{ amountMinor: 10_000 }]);
  expect(cur.commitments.find((c) => c.name === "Gas")?.payments).toEqual([]);
});

test("a spend from a cycle that has ended moves into this cycle, with a note", async ({ page }) => {
  await signInFreshToToday(page);
  const session = (await (await page.request.get("/api/auth/get-session")).json()) as {
    user: { id: string };
  };
  const cur = (await (await page.request.get("/api/current")).json()) as { cycle: { startedOn: string } };
  // Made offline the day before this cycle started (salary day was entered on another device meanwhile).
  const start = new Date(`${cur.cycle.startedOn}T00:00:00Z`);
  const dayBefore = new Date(start.getTime() - 86_400_000).toISOString().slice(0, 10);
  const item = {
    kind: "spend",
    currency: "LKR",
    draft: {
      spentOn: dayBefore,
      amountMinor: 25_000,
      note: "Late lunch",
      potId: null,
      cardId: null,
      oneOff: false,
    },
    queuedAt: Date.now(),
  };
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [`setaside.unsent.${session.user.id}`, JSON.stringify({ items: [{ ...item, id: crypto.randomUUID() }] })],
  );
  await page.reload();
  await expect(page.getByTestId("moved-note")).toContainText("A spend of Rs 250 from");
  const card = page.getByRole("region", { name: "You can spend today" });
  await expect(page.getByTestId("offline")).toHaveCount(0);
  await page.getByTestId("moved-note").getByRole("button", { name: "OK" }).click();
  await expect(page.getByTestId("moved-note")).toHaveCount(0);
  const after = (await (await page.request.get("/api/current")).json()) as {
    spends: { note: string; spentOn: string }[];
  };
  expect(after.spends).toMatchObject([{ note: "Late lunch", spentOn: cur.cycle.startedOn }]);
  await expect(card).toBeVisible();
});

test.describe("an answer lost on the way back", () => {
  // page.route sees the page's requests only without a service worker.
  test.use({ serviceWorkers: "block" });

  test("a spend the server got but the phone didn't hear back about: changed or removed on the phone, then on the server", async ({
    page,
    context,
  }) => {
    await signInFreshToToday(page);
    // Each new spend reaches the server, but its answer never comes back.
    const lose = async (route: import("@playwright/test").Route) => {
      await route.fetch();
      await route.abort();
    };
    await page.route("**/api/spends", lose);
    await addSpend(page, "500", "Tea");
    await expect(page.getByRole("status")).toContainText("Spend saved on this phone");
    await addSpend(page, "700", "Cake");
    await expect(page.getByRole("status")).toContainText("Spend saved on this phone");
    await page.unroute("**/api/spends", lose);
    const card = page.getByRole("region", { name: "You can spend today" });

    // Change Tea to Rs 600 and remove Cake on the phone, before they are sent again.
    await context.setOffline(true);
    await card.getByRole("button", { name: /Tea/ }).click();
    const change = page.getByRole("dialog", { name: "Change spend" });
    await change.getByRole("button", { name: "Delete digit" }).click();
    await change.getByRole("button", { name: "Delete digit" }).click();
    await change.getByRole("button", { name: "Delete digit" }).click();
    for (const d of "600") await change.getByRole("button", { name: d, exact: true }).click();
    await change.getByRole("button", { name: "Save" }).click();
    await card.getByRole("button", { name: /Cake/ }).click();
    await change.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(card.getByRole("button", { name: /Cake/ })).toHaveCount(0);

    // Back online: the server ends up as the phone shows it.
    await context.setOffline(false);
    await expect(page.getByTestId("offline")).toHaveCount(0);
    await expect
      .poll(async () => {
        const cur = (await (await page.request.get("/api/current")).json()) as {
          spends: { note: string; amountMinor: number }[];
        };
        return cur.spends.map((s) => `${s.note} ${s.amountMinor}`);
      })
      .toEqual(["Tea 60000"]);
  });
});
