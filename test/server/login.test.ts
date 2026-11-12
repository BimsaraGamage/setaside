import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { allowedEmailCheck, parseAllowedEmails } from "../../src/worker/auth";
import { call, signIn } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("demo sign-in (local only)", () => {
  it("signs in and the user check lets the user through", async () => {
    const { cookie, email } = await signIn();
    const res = await call("/api/me", {}, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { email, name: "Demo user" } });
  });

  it("reuses the same demo account each time", async () => {
    const a = await signIn();
    const b = await signIn();
    expect(a.id).toBe(b.id);
  });

  it("is offered on the sign-in screen in local development", async () => {
    const res = await call("/api/sign-in-options");
    expect(await res.json()).toEqual({ google: false, demo: true });
  });
});

describe("sessions", () => {
  it("last 30 days", async () => {
    const { id } = await signIn();
    const row = await env.DB.prepare("select max(expires_at) as e from session where user_id = ?")
      .bind(id)
      .first<{ e: number }>();
    expect((row?.e ?? 0) - Date.now()).toBeGreaterThan(29.9 * DAY_MS);
    expect((row?.e ?? 0) - Date.now()).toBeLessThanOrEqual(30 * DAY_MS);
  });

  it("are renewed on use once a day has passed", async () => {
    const { cookie, id } = await signIn();
    // Pretend the session was made 2 days ago and runs out in 28.
    await env.DB.prepare("update session set updated_at = ?, expires_at = ? where user_id = ?")
      .bind(Date.now() - 2 * DAY_MS, Date.now() + 28 * DAY_MS, id)
      .run();
    expect((await call("/api/me", {}, cookie)).status).toBe(200);
    const row = await env.DB.prepare("select max(expires_at) as e from session where user_id = ?")
      .bind(id)
      .first<{ e: number }>();
    expect((row?.e ?? 0) - Date.now()).toBeGreaterThan(29.9 * DAY_MS);
  });

  it("Sign out ends this session only", async () => {
    const phone = await signIn();
    const laptop = await signIn();
    const out = await call("/api/auth/sign-out", { method: "POST", body: "{}" }, phone.cookie);
    expect(out.status).toBe(200);
    expect((await call("/api/me", {}, phone.cookie)).status).toBe(401);
    expect((await call("/api/me", {}, laptop.cookie)).status).toBe(200);
  });

  it("Sign out everywhere ends every session of the user", async () => {
    const phone = await signIn();
    const laptop = await signIn();
    const other = await signIn("second");
    const out = await call("/api/auth/revoke-sessions", { method: "POST", body: "{}" }, phone.cookie);
    expect(out.status).toBe(200);
    expect((await call("/api/me", {}, phone.cookie)).status).toBe(401);
    expect((await call("/api/me", {}, laptop.cookie)).status).toBe(401);
    expect((await call("/api/me", {}, other.cookie)).status).toBe(200);
  });

  it("a made-up cookie is refused", async () => {
    const res = await call("/api/me", {}, "better-auth.session_token=made-up.value");
    expect(res.status).toBe(401);
  });
});

describe("allowed-email list", () => {
  const check = allowedEmailCheck(
    parseAllowedEmails(" Me@Example.com,  other@example.com\nthird@example.com "),
  );
  const google = (action: "create-user" | "link-account" | "sign-in") => ({
    action,
    method: "oauth",
    oauth: { providerId: "google", profile: {} },
  });
  const ctx = {} as never;

  it("reads a comma, space or line separated list, any case", () => {
    expect([...parseAllowedEmails(" Me@Example.com,  other@example.com\nthird@example.com ")]).toEqual([
      "me@example.com",
      "other@example.com",
      "third@example.com",
    ]);
    expect(parseAllowedEmails(undefined).size).toBe(0);
  });

  it("lets a listed Google account make an account", () => {
    expect(check({ user: { email: "ME@example.com" }, source: google("create-user") }, ctx)).toBeUndefined();
  });

  it("refuses an unlisted Google account", () => {
    expect(check({ user: { email: "stranger@example.com" }, source: google("create-user") }, ctx)).toEqual(
      expect.objectContaining({ error: "not_allowed" }),
    );
    expect(check({ user: { email: "stranger@example.com" }, source: google("link-account") }, ctx)).toEqual(
      expect.objectContaining({ error: "not_allowed" }),
    );
  });

  it("an empty list lets nobody in", () => {
    const none = allowedEmailCheck(parseAllowedEmails(""));
    expect(none({ user: { email: "me@example.com" }, source: google("create-user") }, ctx)).toEqual(
      expect.objectContaining({ error: "not_allowed" }),
    );
  });
});
