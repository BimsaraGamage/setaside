import { env, exports } from "cloudflare:workers";
import type { DemoUser } from "../../src/worker/auth/demo-sign-in";

export const ORIGIN = "https://setaside.test";

/** Calls the Worker like the phone would: same origin, with the given session cookie. */
export function call(path: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("origin", ORIGIN);
  if (cookie) headers.set("cookie", cookie);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }));
}

/** Signs in as a local demo user and returns the session cookie. */
export async function signIn(
  user: DemoUser = "demo",
): Promise<{ cookie: string; id: string; email: string }> {
  const res = await call("/api/auth/demo/sign-in", { method: "POST", body: JSON.stringify({ user }) });
  if (res.status !== 200) throw new Error(`demo sign-in failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const body = await res.json<{ user: { id: string; email: string } }>();
  return { cookie, ...body.user };
}

/**
 * Seeds one row in every app table for a user (the shared second-user test, delete account).
 * Later backlog items add their tables here. `endpoint` is the user's phone with alerts on.
 */
export async function seedEveryTable(ownerId: string, endpoint: string) {
  const s = crypto.randomUUID();
  const c = crypto.randomUUID();
  const i = crypto.randomUUID();
  const sp = crypto.randomUUID();
  const k = crypto.randomUUID();
  const p = crypto.randomUUID();
  const pt = crypto.randomUUID();
  const pa = crypto.randomUUID();
  const dc = crypto.randomUUID();
  const sm = crypto.randomUUID();
  const ex = crypto.randomUUID();
  const rc = crypto.randomUUID();
  const cc = crypto.randomUUID();
  const pp = crypto.randomUUID();
  const cv = crypto.randomUUID();
  const cd = crypto.randomUUID();
  const pl = crypto.randomUUID();
  const px = crypto.randomUUID();
  const pd = crypto.randomUUID();
  const plc = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "insert into settings (id, user_id, salary_currency, spending_currency, home_time_zone, usual_pay_day, created_at, updated_at) values (?, ?, 'LKR', 'LKR', 'Asia/Colombo', 25, ?, ?)",
    ).bind(s, ownerId, now, now),
    env.DB.prepare(
      "insert into cycle (id, user_id, started_on, expected_salary_on, created_at, updated_at) values (?, ?, '2026-11-12', '2026-11-25', ?, ?)",
    ).bind(c, ownerId, now, now),
    env.DB.prepare(
      "insert into income (id, user_id, cycle_id, kind, currency, amount_minor, received_on, created_at, updated_at) values (?, ?, ?, 'opening', 'LKR', 9000000, '2026-11-12', ?, ?)",
    ).bind(i, ownerId, c, now, now),
    env.DB.prepare(
      "insert into spend (id, user_id, cycle_id, spent_on, amount_minor, currency, note, created_at, updated_at) values (?, ?, ?, '2026-11-12', 185000, 'LKR', 'lunch', ?, ?)",
    ).bind(sp, ownerId, c, now, now),
    env.DB.prepare(
      "insert into commitment (id, user_id, cycle_id, name, kind, currency, planned_minor, due_on, state, created_at, updated_at) values (?, ?, ?, 'Rent', 'bill', 'LKR', 3600000, '2026-11-20', 'open', ?, ?)",
    ).bind(k, ownerId, c, now, now),
    env.DB.prepare(
      "insert into commitment_payment (id, user_id, commitment_id, currency, amount_minor, paid_on, created_at, updated_at) values (?, ?, ?, 'LKR', 1000000, '2026-11-12', ?, ?)",
    ).bind(p, ownerId, k, now, now),
    env.DB.prepare(
      "insert into pot (id, user_id, name, currency, usual_amount_minor, archived, created_at, updated_at) values (?, ?, 'Groceries', 'LKR', 1800000, 0, ?, ?)",
    ).bind(pt, ownerId, now, now),
    env.DB.prepare(
      "insert into pot_allocation (id, user_id, pot_id, cycle_id, amount_minor, created_at, updated_at) values (?, ?, ?, ?, 1800000, ?, ?)",
    ).bind(pa, ownerId, pt, c, now, now),
    env.DB.prepare(
      "insert into day_choice (id, user_id, cycle_id, day_on, choice, created_at, updated_at) values (?, ?, ?, '2026-11-13', 'spread', ?, ?)",
    ).bind(dc, ownerId, c, now, now),
    env.DB.prepare(
      "insert into savings_movement (id, user_id, cycle_id, currency, amount_minor, kind, moved_on, created_at, updated_at) values (?, ?, ?, 'LKR', 500000, 'put_in', '2026-11-12', ?, ?)",
    ).bind(sm, ownerId, c, now, now),
    env.DB.prepare(
      "insert into income (id, user_id, cycle_id, kind, currency, amount_minor, received_on, to_savings_minor, created_at, updated_at) values (?, ?, ?, 'extra', 'LKR', 2000000, '2026-11-12', 500000, ?, ?)",
    ).bind(ex, ownerId, c, now, now),
    env.DB.prepare(
      "insert into recurring_commitment (id, user_id, name, kind, currency, usual_amount_minor, usual_day, active, created_at, updated_at) values (?, ?, 'Rent', 'bill', 'LKR', 3600000, 20, 1, ?, ?)",
    ).bind(rc, ownerId, now, now),
    env.DB.prepare(
      "insert into cycle_close (id, user_id, cycle_id, next_cycle_id, currency, leftover_correction_minor, leftover_to_savings_minor, created_at, updated_at) values (?, ?, ?, ?, 'LKR', 0, 0, ?, ?)",
    ).bind(cc, ownerId, c, c, now, now),
    env.DB.prepare(
      "insert into prepayment (id, user_id, name, currency, total_minor, payback_minor, created_at, updated_at) values (?, ?, 'Gym', 'LKR', 6000000, 500000, ?, ?)",
    ).bind(pp, ownerId, now, now),
    env.DB.prepare(
      "insert into conversion (id, user_id, cycle_id, given_minor, received_minor, rate, covered_minor, gain_minor, done_on, created_at, updated_at) values (?, ?, ?, 10000, 3000000, '300', 0, 0, '2026-11-12', ?, ?)",
    ).bind(cv, ownerId, c, now, now),
    env.DB.prepare(
      "insert into counting_rate (id, user_id, rate, set_at, created_at, updated_at) values (?, ?, '300', ?, ?, ?)",
    ).bind(cv, ownerId, now, now, now),
    env.DB.prepare(
      "insert into card (id, user_id, name, currency, archived, created_at, updated_at) values (?, ?, 'Visa', 'LKR', 0, ?, ?)",
    ).bind(cd, ownerId, now, now),
    env.DB.prepare(
      "insert into instalment_plan (id, user_id, name, currency, price_minor, payment_count, payment_minor, first_payment_on, created_at, updated_at) values (?, ?, 'Phone', 'LKR', 10800000, 12, 1000000, '2026-11-20', ?, ?)",
    ).bind(pl, ownerId, now, now),
    env.DB.prepare(
      "insert into plan_extra_payment (id, user_id, cycle_id, plan_id, currency, amount_minor, paid_from, pays_off, paid_on, created_at, updated_at) values (?, ?, ?, ?, 'LKR', 100000, 'free', 0, '2026-11-12', ?, ?)",
    ).bind(px, ownerId, c, pl, now, now),
    env.DB.prepare(
      "insert into person_debt (id, user_id, cycle_id, person_name, direction, currency, amount_minor, made_on, created_at, updated_at) values (?, ?, ?, 'Nimal', 'lent', 'LKR', 500000, '2026-11-12', ?, ?)",
    ).bind(pd, ownerId, c, now, now),
    env.DB.prepare(
      "insert into place (id, user_id, name, currency, kind, sort_order, archived, created_at, updated_at) values (?, ?, 'In hand', 'LKR', 'spending', 0, 0, ?, ?)",
    ).bind(plc, ownerId, now, now),
    env.DB.prepare(
      "insert into place_check (id, user_id, place_id, amount_minor, checked_at, created_at, updated_at) values (?, ?, ?, 1200000, ?, ?, ?)",
    ).bind(crypto.randomUUID(), ownerId, plc, now, now, now),
    env.DB.prepare(
      "insert into place_move (id, user_id, from_place_id, to_place_id, amount_minor, created_at, updated_at) values (?, ?, ?, ?, 100000, ?, ?)",
    ).bind(crypto.randomUUID(), ownerId, plc, plc, now, now),
    env.DB.prepare(
      "insert into push_subscription (id, user_id, endpoint, p256dh, auth, created_at, updated_at) values (?, ?, ?, 'p', 'a', ?, ?)",
    ).bind(crypto.randomUUID(), ownerId, endpoint, now, now),
    env.DB.prepare(
      "insert into reminder_sent (id, user_id, kind, subject_id, sent_on, created_at, updated_at) values (?, ?, 'due_soon', ?, '2026-11-17', ?, ?)",
    ).bind(crypto.randomUUID(), ownerId, k, now, now),
    env.DB.prepare(
      "insert into feedback (id, user_id, kind, text, context, trail, screenshot, created_at, updated_at) values (?, ?, 'problem', 'Today is wrong', '{}', '[]', 'data:image/webp;base64,AAAA', ?, ?)",
    ).bind(crypto.randomUUID(), ownerId, now, now),
  ]);
}

/** Every table with a `user_id` column, read from D1 itself. */
export async function ownedTables(): Promise<string[]> {
  const tables = await env.DB.prepare(
    "select name from sqlite_master where type = 'table' and name not like '\\_%' escape '\\' and name not like 'sqlite%'",
  ).all<{ name: string }>();
  const out: string[] = [];
  for (const { name } of tables.results) {
    const cols = await env.DB.prepare(`select name from pragma_table_info('${name}')`).all<{
      name: string;
    }>();
    if (cols.results.some((c) => c.name === "user_id")) out.push(name);
  }
  return out;
}
