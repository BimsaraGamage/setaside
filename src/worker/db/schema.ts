import { sqliteTable, text } from "drizzle-orm/sqlite-core";

// Tables from docs/data-model.md arrive with the backlog items that need them.
// Migrations are additive only (spec 18).

/** Small key/value table; first migration, proves the migration pipeline. */
export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
