import { and, asc, eq, getTableColumns, getTableName, is } from "drizzle-orm";
import { type SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { spendsCsv, todayIn } from "../money";
import * as schema from "./db/schema";
import { account, card, cycle, passkey, pot, settings, spend, user } from "./db/schema";
import type { SignedIn } from "./user-check";

type Ctx = { var: SignedIn["Variables"] };
type OwnedTable = SQLiteTable & { userId: SQLiteColumn };

/** Login tables (Better Auth): summed up on their own, without tokens or keys. */
const LOGIN_TABLES = new Set(["user", "session", "account", "passkey", "verification"]);

/** Columns left out of the file besides `userId`: secrets. The push endpoint is a secret URL. */
const SECRET_COLUMNS: Record<string, string[]> = { push_subscription: ["endpoint", "p256dh", "auth"] };

/**
 * Every app table with an owner column, found from the schema, so a table added
 * later is in the download without anyone remembering (the server test checks it).
 */
const OWNED_TABLES = (Object.values(schema) as unknown[]).filter(
  (t): t is OwnedTable => is(t, SQLiteTable) && "userId" in t && !LOGIN_TABLES.has(getTableName(t)),
);

/** One table's rows of the signed-in user, oldest first (ids are UUIDv7), without owner or secrets. */
async function rowsOf(c: Ctx, table: OwnedTable) {
  const { userId: _, ...columns } = getTableColumns(table);
  const name = getTableName(table);
  for (const secret of SECRET_COLUMNS[name] ?? []) delete columns[secret];
  const rows = await c.var.db
    .select(columns)
    .from(table)
    .where(c.var.mine(table))
    .orderBy(...(columns.id ? [asc(columns.id)] : []));
  return [name, rows] as const;
}

/** Today in the user's home time zone (UTC before first use), for the file name. */
async function todayOf(c: Ctx) {
  const s = await c.var.db.query.settings.findFirst({
    where: c.var.mine(settings),
    columns: { homeTimeZone: true },
  });
  return todayIn(s?.homeTimeZone ?? "UTC", Date.now());
}

const attachment = (filename: string, contentType: string) => ({
  "content-type": contentType,
  "content-disposition": `attachment; filename="${filename}"`,
  "cache-control": "no-store",
});

/**
 * Download my data (item 27, spec 14): one JSON file with every record of the
 * account, and a CSV of spends. Read only.
 */
export const dataExport = new Hono<SignedIn>()
  .get("/export", async (c) => {
    const { db, mine, userId } = c.var;
    const [me, methods, passkeys, today, ...tables] = await Promise.all([
      db
        .select({ id: user.id, name: user.name, email: user.email, createdAt: user.createdAt })
        .from(user)
        .where(eq(user.id, userId))
        .get(),
      db
        .select({ provider: account.providerId, createdAt: account.createdAt })
        .from(account)
        .where(mine(account)),
      db
        .select({
          name: passkey.name,
          deviceType: passkey.deviceType,
          backedUp: passkey.backedUp,
          createdAt: passkey.createdAt,
        })
        .from(passkey)
        .where(mine(passkey)),
      todayOf(c),
      ...OWNED_TABLES.map((t) => rowsOf(c, t)),
    ]);
    const body = {
      app: "setaside",
      format: 1,
      exportedAt: new Date().toISOString(),
      account: me,
      signInMethods: methods,
      passkeys,
      records: Object.fromEntries(tables),
    };
    return c.body(
      JSON.stringify(body, null, 2),
      200,
      attachment(`setaside-data-${today}.json`, "application/json; charset=utf-8"),
    );
  })
  .get("/export/spends.csv", async (c) => {
    const { db, mine, userId } = c.var;
    const rows = await db
      .select({
        spentOn: spend.spentOn,
        amountMinor: spend.amountMinor,
        currency: spend.currency,
        note: spend.note,
        pot: pot.name,
        card: card.name,
        oneOff: spend.oneOff,
        cycleStartedOn: cycle.startedOn,
      })
      .from(spend)
      .innerJoin(cycle, and(eq(cycle.id, spend.cycleId), eq(cycle.userId, userId)))
      .leftJoin(pot, and(eq(pot.id, spend.potId), eq(pot.userId, userId)))
      .leftJoin(card, and(eq(card.id, spend.cardId), eq(card.userId, userId)))
      .where(mine(spend))
      .orderBy(asc(spend.spentOn), asc(spend.createdAt), asc(spend.id));
    return c.body(
      spendsCsv(rows),
      200,
      attachment(`setaside-spends-${await todayOf(c)}.csv`, "text/csv; charset=utf-8"),
    );
  });
