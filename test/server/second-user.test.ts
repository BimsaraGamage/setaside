import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import app, { PUBLIC_ROUTES } from "../../src/worker";
import { userCheck } from "../../src/worker/user-check";
import { call, signIn } from "./helpers";

/**
 * The one shared "second user is refused" test (spec 13, 16).
 *
 * It lists every route of the app. Each private route must have a probe below
 * (the test fails otherwise, so a new route cannot be missed). Each probe is
 * called twice:
 *   1. signed out: must answer 401;
 *   2. signed in as a second user, aimed at the first user's records: must not
 *      show any of the first user's ids or email, and must not change any of
 *      the first user's rows.
 */

interface Owner {
  id: string;
  email: string;
  /** Every row the first user owns, by table (filled from every table with a `user_id` column). */
  rows: Record<string, { id: string }[]>;
}

type Probe = (owner: Owner) => { path: string; init?: RequestInit };

const probes: Record<string, Probe> = {
  "GET /api/me": () => ({ path: "/api/me" }),
};

/** Seeds the first user's records. Later backlog items add their tables here. */
async function seedOwnerData(_ownerId: string) {}

async function ownedTables(): Promise<string[]> {
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

async function snapshot(ownerId: string): Promise<Record<string, unknown[]>> {
  const snap: Record<string, unknown[]> = {};
  for (const t of await ownedTables()) {
    // Session rows are left out: signing in and out legitimately changes them.
    if (t === "session") continue;
    snap[t] = (
      await env.DB.prepare(`select * from "${t}" where user_id = ? order by id`).bind(ownerId).all()
    ).results;
  }
  return snap;
}

function isPublic(path: string) {
  return PUBLIC_ROUTES.some((p) => (p.endsWith("*") ? path.startsWith(p.slice(0, -1)) : path === p));
}

/** Every handler route of the app ("METHOD /path"), without middleware. */
function appRoutes(): string[] {
  const keys = app.routes.filter((r) => r.handler !== userCheck).map((r) => `${r.method} ${r.path}`);
  return [...new Set(keys)];
}

describe("second user is refused", () => {
  const routes = appRoutes().filter((r) => !isPublic(r.split(" ")[1] ?? ""));
  let owner: Owner;
  let second: { cookie: string; id: string };

  beforeAll(async () => {
    const first = await signIn("demo");
    await seedOwnerData(first.id);
    const rows: Owner["rows"] = {};
    for (const t of await ownedTables()) {
      rows[t] = (
        await env.DB.prepare(`select id from "${t}" where user_id = ?`).bind(first.id).all<{ id: string }>()
      ).results;
    }
    owner = { id: first.id, email: first.email, rows };
    second = await signIn("second");
  });

  it("finds the private routes", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it("every private route has a probe", () => {
    expect(routes.filter((r) => !probes[r])).toEqual([]);
  });

  it.each(Object.keys(probes))("%s needs a signed-in user", async (key) => {
    const { path, init } = probes[key]!(owner);
    const res = await call(path, { method: key.split(" ")[0], ...init });
    expect(res.status).toBe(401);
  });

  it.each(Object.keys(probes))("%s shows and changes nothing of the first user", async (key) => {
    const before = await snapshot(owner.id);
    const { path, init } = probes[key]!(owner);
    const res = await call(path, { method: key.split(" ")[0], ...init }, second.cookie);
    const body = await res.text();
    const secrets = [owner.id, owner.email, ...Object.values(owner.rows).flatMap((r) => r.map((x) => x.id))];
    for (const s of secrets) expect(body).not.toContain(s);
    expect(await snapshot(owner.id)).toEqual(before);
  });
});
