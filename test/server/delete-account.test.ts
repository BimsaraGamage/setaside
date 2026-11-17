import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call, ownedTables, seedEveryTable, signIn } from "./helpers";

// Item 28 · Delete account (spec 14): typing DELETE removes every row with the
// user's id and signs out every device.

/** A user of its own (demo `fresh` sign-in), so deleting it upsets no other test. */
async function signInFresh(name: string) {
  const res = await call("/api/auth/demo/sign-in", {
    method: "POST",
    body: JSON.stringify({ user: "demo", fresh: name }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const { user } = await res.json<{ user: { id: string; email: string } }>();
  return { cookie, ...user };
}

/** Rows with this user's id, per table (every table with `user_id`, login tables too), plus the user row. */
async function rowsOf(userId: string) {
  const out: Record<string, number> = {};
  for (const t of await ownedTables()) {
    const r = await env.DB.prepare(`select count(*) as n from "${t}" where user_id = ?`)
      .bind(userId)
      .first<{ n: number }>();
    out[t] = r?.n ?? 0;
  }
  const u = await env.DB.prepare(`select count(*) as n from "user" where id = ?`)
    .bind(userId)
    .first<{ n: number }>();
  out.user = u?.n ?? 0;
  return out;
}

/** A passkey and a Google sign-in method for the user, so the login tables have rows too. */
async function addLoginRows(userId: string) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "insert into passkey (id, name, public_key, user_id, credential_id, counter, device_type, backed_up, created_at) values (?, 'iPhone', 'pk', ?, ?, 0, 'multiDevice', 1, ?)",
    ).bind(crypto.randomUUID(), userId, crypto.randomUUID(), now),
    env.DB.prepare(
      "insert into account (id, account_id, provider_id, user_id, created_at, updated_at) values (?, ?, 'google', ?, ?, ?)",
    ).bind(crypto.randomUUID(), crypto.randomUUID(), userId, now, now),
  ]);
}

const remove = (cookie: string, body: unknown) =>
  call("/api/account/delete", { method: "POST", body: JSON.stringify(body) }, cookie);

describe("delete account", () => {
  it("is refused without DELETE typed exactly, and nothing is removed", async () => {
    const u = await signInFresh("delete-refused");
    await seedEveryTable(u.id, "https://fcm.googleapis.com/fcm/send/delete-refused");
    const before = await rowsOf(u.id);
    for (const body of [{}, { confirm: "delete" }, { confirm: "DELETE " }, { confirm: "yes" }]) {
      expect((await remove(u.cookie, body)).status).toBe(400);
    }
    expect(await rowsOf(u.id)).toEqual(before);
    expect((await call("/api/me", {}, u.cookie)).status).toBe(200);
  });

  it("removes every row with the user's id and signs out every device", async () => {
    const other = await signInFresh("delete-bystander");
    await seedEveryTable(other.id, "https://fcm.googleapis.com/fcm/send/delete-bystander");
    const otherBefore = await rowsOf(other.id);

    const phone = await signInFresh("delete-me");
    const laptop = await signInFresh("delete-me");
    expect(laptop.id).toBe(phone.id);
    await seedEveryTable(phone.id, "https://fcm.googleapis.com/fcm/send/delete-me");
    await addLoginRows(phone.id);
    const before = await rowsOf(phone.id);
    // Every app table and the login tables really had rows, so "none left" means something.
    for (const [t, n] of Object.entries(before)) expect(n, t).toBeGreaterThan(0);

    const res = await remove(phone.cookie, { confirm: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // This device's sign-in cookie is cleared.
    const cleared = res.headers.getSetCookie().join("\n");
    expect(cleared).toMatch(/session_token=;/);
    expect(cleared).toMatch(/Max-Age=0/);

    // Nothing with the user's id is left, in any table.
    const after = await rowsOf(phone.id);
    expect(
      Object.values(after).every((n) => n === 0),
      JSON.stringify(after),
    ).toBe(true);
    // Every device is signed out.
    expect((await call("/api/me", {}, phone.cookie)).status).toBe(401);
    expect((await call("/api/me", {}, laptop.cookie)).status).toBe(401);
    // Another user's rows stay as they were.
    expect(await rowsOf(other.id)).toEqual(otherBefore);

    // Signing in again with the same address starts a new, empty account.
    const again = await signInFresh("delete-me");
    expect(again.id).not.toBe(phone.id);
    const current = await call("/api/current", {}, again.cookie);
    expect(current.status).toBe(200);
    expect((await current.json<{ settings: unknown }>()).settings).toBeNull();
  });
});
