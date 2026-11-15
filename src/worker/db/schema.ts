import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Tables from docs/data-model.md arrive with the backlog items that need them.
// Migrations are additive only (spec 18).

/** Small key/value table; first migration, proves the migration pipeline. */
export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// ---------------------------------------------------------------------------
// Login tables, owned by Better Auth (spec 13, ADR 0004). Field names are the
// ones Better Auth expects; columns are snake_case like the rest of the schema.
// Note: Better Auth's `account` is "a linked sign-in method", not the glossary's
// Account. In code the glossary Account is the `user` row.

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
};

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
  image: text("image"),
  ...timestamps,
});

/** Every app table's owner column: references the user, removed with the user (delete account). */
export const ownerColumn = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: ownerColumn(),
    ...timestamps,
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: ownerColumn(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    ...timestamps,
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const passkey = sqliteTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: ownerColumn(),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
    transports: text("transports"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    aaguid: text("aaguid"),
  },
  (t) => [index("passkey_user_id_idx").on(t.userId), index("passkey_credential_id_idx").on(t.credentialID)],
);

// ---------------------------------------------------------------------------
// App tables (docs/data-model.md). Ids are UUIDv7 made on the phone; every row
// has `user_id`; money is `*_minor` + `currency`; `*_on` days are YYYY-MM-DD in
// the home time zone.

const appTimestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
};

/** One per user (item 3). Reminder columns arrive with item 25. */
export const settings = sqliteTable("settings", {
  id: text("id").primaryKey(),
  userId: ownerColumn().unique(),
  salaryCurrency: text("salary_currency").notNull(),
  spendingCurrency: text("spending_currency").notNull(),
  homeTimeZone: text("home_time_zone").notNull(),
  usualPayDay: integer("usual_pay_day").notNull(),
  ...appTimestamps,
});

/** One pay cycle; the newest is the current one. */
export const cycle = sqliteTable(
  "cycle",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    startedOn: text("started_on").notNull(),
    expectedSalaryOn: text("expected_salary_on").notNull(),
    /** Counting rate when salary day was confirmed (two currencies, item 15). */
    reserveRate: text("reserve_rate"),
    ...appTimestamps,
  },
  (t) => [index("cycle_user_id_idx").on(t.userId, t.startedOn)],
);

/** Salary, extra income, opening money, loan cash, borrowed money, money paid back. */
export const income = sqliteTable(
  "income",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycle.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["salary", "extra", "opening", "loan", "borrowed", "paid_back"] }).notNull(),
    currency: text("currency").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    receivedOn: text("received_on").notNull(),
    toSavingsMinor: integer("to_savings_minor").notNull().default(0),
    /** Links borrowed money and money paid back to a person debt (item 20). */
    personDebtId: text("person_debt_id"),
    ...appTimestamps,
  },
  (t) => [index("income_user_id_idx").on(t.userId), index("income_cycle_id_idx").on(t.cycleId)],
);

/** One purchase (item 4). Pots, cards and one-off join with items 7, 18 and 8. */
export const spend = sqliteTable(
  "spend",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycle.id, { onDelete: "cascade" }),
    spentOn: text("spent_on").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    note: text("note"),
    /** Pot the spend came from (item 7); none means free money. */
    potId: text("pot_id"),
    /** Card it was paid with (item 18). */
    cardId: text("card_id"),
    /** Left out of the spending speed (item 8). */
    oneOff: integer("one_off", { mode: "boolean" }).notNull().default(false),
    ...appTimestamps,
  },
  (t) => [index("spend_user_id_idx").on(t.userId), index("spend_cycle_id_idx").on(t.cycleId, t.spentOn)],
);

/**
 * One commitment in one cycle (item 5); its payments are `commitment_payment` (item 6).
 * Recurring, carried, card, plan, person and prepayment links come with later items.
 */
export const commitment = sqliteTable(
  "commitment",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycle.id, { onDelete: "cascade" }),
    /** The "every cycle" template it was filled from (item 11). */
    recurringId: text("recurring_id"),
    name: text("name").notNull(),
    kind: text("kind", {
      enum: ["bill", "savings", "card_bill", "plan_payment", "person_payback", "savings_payback"],
    })
      .notNull()
      .default("bill"),
    currency: text("currency").notNull(),
    plannedMinor: integer("planned_minor").notNull(),
    dueOn: text("due_on").notNull(),
    state: text("state", { enum: ["open", "finished", "carried", "dropped"] })
      .notNull()
      .default("open"),
    /** The old cycle's commitment this one was carried from (item 12). */
    carriedFromId: text("carried_from_id"),
    cardId: text("card_id"),
    planId: text("plan_id"),
    personDebtId: text("person_debt_id"),
    prepaymentId: text("prepayment_id"),
    ...appTimestamps,
  },
  (t) => [
    index("commitment_user_id_idx").on(t.userId),
    index("commitment_cycle_id_idx").on(t.cycleId, t.dueOn),
  ],
);

/**
 * One payment on a commitment (item 6); parts allowed, paid more or less than planned.
 * Removed with its commitment. `currency` may differ from the commitment's (item 17).
 */
export const commitmentPayment = sqliteTable(
  "commitment_payment",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    commitmentId: text("commitment_id")
      .notNull()
      .references(() => commitment.id, { onDelete: "cascade" }),
    currency: text("currency").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    paidOn: text("paid_on").notNull(),
    ...appTimestamps,
  },
  (t) => [
    index("commitment_payment_user_id_idx").on(t.userId),
    index("commitment_payment_commitment_id_idx").on(t.commitmentId, t.paidOn),
  ],
);

/** A user-made pot (item 7); lasts across cycles. Each cycle's amount is a `pot_allocation`. */
export const pot = sqliteTable(
  "pot",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    usualAmountMinor: integer("usual_amount_minor").notNull(),
    /** "Stop using this pot": not offered for spends, not set aside again. */
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    ...appTimestamps,
  },
  (t) => [index("pot_user_id_idx").on(t.userId)],
);

/** Money set aside for a pot in one cycle (item 7); salary day makes the next one (item 11). */
export const potAllocation = sqliteTable(
  "pot_allocation",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    potId: text("pot_id")
      .notNull()
      .references(() => pot.id, { onDelete: "cascade" }),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycle.id, { onDelete: "cascade" }),
    amountMinor: integer("amount_minor").notNull(),
    ...appTimestamps,
  },
  (t) => [
    index("pot_allocation_user_id_idx").on(t.userId),
    uniqueIndex("pot_allocation_pot_cycle_idx").on(t.potId, t.cycleId),
  ],
);

/**
 * The morning underspend answer (item 9, spec 7): one per user and day. Stored
 * because today's allowance depends on it; in the cycle it was given in.
 */
export const dayChoice = sqliteTable(
  "day_choice",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycle.id, { onDelete: "cascade" }),
    dayOn: text("day_on").notNull(),
    choice: text("choice", { enum: ["spread", "today"] }).notNull(),
    ...appTimestamps,
  },
  (t) => [
    uniqueIndex("day_choice_user_day_idx").on(t.userId, t.dayOn),
    index("day_choice_cycle_id_idx").on(t.cycleId),
  ],
);

/**
 * Money moved straight into or out of savings (item 10, spec 5): Put in (+) and
 * Take out (−). In the cycle it was made in: a take-out raises that cycle's free
 * money. Set-asides moved and extra income to savings are their own rows
 * (commitment payments, `income.to_savings_minor`). Prepayments come with item 14.
 */
export const savingsMovement = sqliteTable(
  "savings_movement",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycle.id, { onDelete: "cascade" }),
    currency: text("currency").notNull(),
    /** Above zero: into savings; below zero: out of savings. */
    amountMinor: integer("amount_minor").notNull(),
    kind: text("kind", { enum: ["put_in", "take_out", "opening", "prepayment", "plan_extra"] }).notNull(),
    movedOn: text("moved_on").notNull(),
    ...appTimestamps,
  },
  (t) => [
    index("savings_movement_user_id_idx").on(t.userId, t.movedOn),
    index("savings_movement_cycle_id_idx").on(t.cycleId),
  ],
);
