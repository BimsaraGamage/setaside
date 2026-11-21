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
  /** The phone's time zone last asked about switching to, whatever the answer (item 22); null: never asked. */
  askedTimeZone: text("asked_time_zone"),
  // Reminders (spec 12, item 25): six switches, all on at first; two times in the home zone; days ahead.
  remindDueSoon: integer("remind_due_soon", { mode: "boolean" }).notNull().default(true),
  remindDueToday: integer("remind_due_today", { mode: "boolean" }).notNull().default(true),
  remindRunningOut: integer("remind_running_out", { mode: "boolean" }).notNull().default(true),
  remindSalaryLate: integer("remind_salary_late", { mode: "boolean" }).notNull().default(true),
  remindQuestions: integer("remind_questions", { mode: "boolean" }).notNull().default(true),
  remindSpendNudge: integer("remind_spend_nudge", { mode: "boolean" }).notNull().default(true),
  /** HH:MM, 15-minute steps. */
  morningAt: text("morning_at").notNull().default("08:00"),
  nudgeAt: text("nudge_at").notNull().default("21:00"),
  dueSoonDays: integer("due_soon_days").notNull().default(3),
  /** The turn-on banner above Today's reminders was dismissed. */
  bannerDismissed: integer("banner_dismissed", { mode: "boolean" }).notNull().default(false),
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
    kind: text("kind", {
      enum: ["salary", "extra", "opening", "leftover", "loan", "borrowed", "paid_back"],
    }).notNull(),
    currency: text("currency").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    receivedOn: text("received_on").notNull(),
    toSavingsMinor: integer("to_savings_minor").notNull().default(0),
    /** Links borrowed money and money paid back to a person debt (item 20). */
    personDebtId: text("person_debt_id"),
    /** The place the money landed in (SAB-52); none moves no place. Never set on a leftover. */
    placeId: text("place_id"),
    ...appTimestamps,
  },
  (t) => [
    index("income_user_id_idx").on(t.userId),
    index("income_cycle_id_idx").on(t.cycleId),
    index("income_place_id_idx").on(t.placeId, t.createdAt),
  ],
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
    /** The place the money came out of (SAB-51); none moves no place. Never set on a card spend. */
    placeId: text("place_id"),
    ...appTimestamps,
  },
  (t) => [
    index("spend_user_id_idx").on(t.userId),
    index("spend_cycle_id_idx").on(t.cycleId, t.spentOn),
    index("spend_place_id_idx").on(t.placeId, t.createdAt),
  ],
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
    /**
     * Paid in the other currency (item 17): how much of the commitment it covers, in
     * the commitment's currency, at the counting rate when saved. Null in its own currency.
     */
    coversMinor: integer("covers_minor"),
    paidOn: text("paid_on").notNull(),
    /** The place the money came out of (SAB-51), in the currency paid in; none moves no place. */
    placeId: text("place_id"),
    ...appTimestamps,
  },
  (t) => [
    index("commitment_payment_user_id_idx").on(t.userId),
    index("commitment_payment_commitment_id_idx").on(t.commitmentId, t.paidOn),
    index("commitment_payment_place_id_idx").on(t.placeId, t.createdAt),
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
 * (commitment payments, `income.to_savings_minor`). A prepayment's money out
 * is kind `prepayment`, linked to its `prepayment` row (item 14). Pay extra on a
 * plan from savings is kind `plan_extra`, with its `plan_extra_payment`'s id (item 19).
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
    /** A prepayment's money out of savings (item 14). */
    prepaymentId: text("prepayment_id"),
    /**
     * The place the money went into (Put in) or came out of (a prepayment) (SAB-52); none moves no
     * place. Never set on a Take out into free money or a plan extra: that money stays where it is,
     * or leaves with its `plan_extra_payment`.
     */
    placeId: text("place_id"),
    ...appTimestamps,
  },
  (t) => [
    index("savings_movement_user_id_idx").on(t.userId, t.movedOn),
    index("savings_movement_cycle_id_idx").on(t.cycleId),
    index("savings_movement_place_id_idx").on(t.placeId, t.createdAt),
  ],
);

/**
 * A long period paid up front from savings (item 14, spec 5): its money out of
 * savings is a `savings_movement` of kind `prepayment`; each cycle a commitment
 * of kind `savings_payback` (linked by `prepayment_id`) moves it back.
 */
export const prepayment = sqliteTable(
  "prepayment",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    totalMinor: integer("total_minor").notNull(),
    /** The usual payback each cycle; the last one is only what is left. */
    paybackMinor: integer("payback_minor").notNull(),
    /** The normal monthly price, for the prepayment saving (optional). */
    normalMonthlyMinor: integer("normal_monthly_minor"),
    /** Months the prepayment covers; set with the monthly price. */
    months: integer("months"),
    ...appTimestamps,
  },
  (t) => [index("prepayment_user_id_idx").on(t.userId)],
);

/**
 * A counting rate the user typed (item 15, spec 8): spending-currency units for
 * one salary-currency unit, as typed. The newest one counts. A conversion
 * (item 16) writes one too, with the conversion's id and rate, so the last
 * conversion's rate counts until another is typed; deleting the conversion
 * deletes it.
 */
export const countingRate = sqliteTable(
  "counting_rate",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    rate: text("rate").notNull(),
    setAt: integer("set_at", { mode: "timestamp_ms" }).notNull(),
    ...appTimestamps,
  },
  (t) => [index("counting_rate_user_id_idx").on(t.userId, t.setAt)],
);

/**
 * Dollars changed into rupees ("Change dollars", item 16, spec 8): given in the
 * salary currency, received in the spending currency, on a day of the cycle.
 * `rate` is the one actually got (rounded down to 6 decimals). What its rupees
 * did is worked out when saved and kept: `covered_minor` covered rupee
 * set-asides not yet covered (bills first), `gain_minor` the rate gain (to
 * rupee savings) or, below zero, the loss (out of free money).
 */
export const conversion = sqliteTable(
  "conversion",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycle.id, { onDelete: "cascade" }),
    givenMinor: integer("given_minor").notNull(),
    receivedMinor: integer("received_minor").notNull(),
    rate: text("rate").notNull(),
    coveredMinor: integer("covered_minor").notNull().default(0),
    gainMinor: integer("gain_minor").notNull().default(0),
    doneOn: text("done_on").notNull(),
    /** The place the dollars came out of and the one the rupees went into (SAB-52); none moves no place. */
    fromPlaceId: text("from_place_id"),
    toPlaceId: text("to_place_id"),
    ...appTimestamps,
  },
  (t) => [
    index("conversion_user_id_idx").on(t.userId, t.doneOn),
    index("conversion_cycle_id_idx").on(t.cycleId),
    index("conversion_from_place_idx").on(t.fromPlaceId, t.createdAt),
    index("conversion_to_place_idx").on(t.toPlaceId, t.createdAt),
  ],
);

/**
 * A credit card (item 18, spec 9). Its balance is only ever worked out: its card
 * spends (`spend.card_id`) less payments on its card bills (`commitment.card_id`).
 * "Stop using this card": `archived`, not offered on the spend sheet.
 */
export const card = sqliteTable(
  "card",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    ...appTimestamps,
  },
  (t) => [index("card_user_id_idx").on(t.userId)],
);

/**
 * An instalment plan (item 19, spec 9): a bank loan or card instalments, paid
 * in fixed payments. Each cycle a commitment of kind `plan_payment` (linked by
 * `commitment.plan_id`) sets aside the next payment. Paid so far, interest and
 * the last payment date are only ever worked out. `paid_off_on`: Pay it all off.
 */
export const instalmentPlan = sqliteTable(
  "instalment_plan",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    priceMinor: integer("price_minor").notNull(),
    paymentCount: integer("payment_count").notNull(),
    /** The usual payment; the last one is only what is left. */
    paymentMinor: integer("payment_minor").notNull(),
    firstPaymentOn: text("first_payment_on").notNull(),
    /** The card it is on (shown only). */
    cardId: text("card_id"),
    /** The normal monthly price, for the prepayment saving (optional). */
    normalMonthlyMinor: integer("normal_monthly_minor"),
    paidOffOn: text("paid_off_on"),
    ...appTimestamps,
  },
  (t) => [index("instalment_plan_user_id_idx").on(t.userId)],
);

/**
 * Pay extra or Pay it all off on a plan (item 19, spec 9), in the current cycle.
 * From free money it comes out of that cycle's free money at once; from savings
 * a `savings_movement` of kind `plan_extra` with the same id takes it out of
 * savings. `pays_off`: it was Pay it all off (Undo reopens the plan).
 */
export const planExtraPayment = sqliteTable(
  "plan_extra_payment",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycle.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => instalmentPlan.id, { onDelete: "cascade" }),
    currency: text("currency").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    paidFrom: text("paid_from", { enum: ["free", "savings"] }).notNull(),
    paysOff: integer("pays_off", { mode: "boolean" }).notNull().default(false),
    paidOn: text("paid_on").notNull(),
    /** The place the money came out of (SAB-52), from free money or savings alike; none moves no place. */
    placeId: text("place_id"),
    ...appTimestamps,
  },
  (t) => [
    index("plan_extra_payment_user_id_idx").on(t.userId),
    index("plan_extra_payment_plan_id_idx").on(t.planId),
    index("plan_extra_payment_place_id_idx").on(t.placeId, t.createdAt),
  ],
);

/**
 * Money lent to or borrowed from a person (item 20, spec 9), in its own currency,
 * made in a cycle. Lent: comes out of that cycle's free money at once; Got it back
 * is an `income` of kind `paid_back` (linked by `income.person_debt_id`).
 * Borrowed: an `income` of kind `borrowed` brings it in; `person_payback`
 * commitments (linked by `commitment.person_debt_id`) pay it back. `settled_on`:
 * Settled, closed whatever is still owed; the one field changed after its cycle.
 */
export const personDebt = sqliteTable(
  "person_debt",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycle.id, { onDelete: "cascade" }),
    personName: text("person_name").notNull(),
    direction: text("direction", { enum: ["lent", "borrowed"] }).notNull(),
    currency: text("currency").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    madeOn: text("made_on").notNull(),
    settledOn: text("settled_on"),
    /** Lent: the place the money came out of (SAB-52); none moves no place. Borrowed: its income has the place. */
    placeId: text("place_id"),
    ...appTimestamps,
  },
  (t) => [
    index("person_debt_user_id_idx").on(t.userId),
    index("person_debt_cycle_id_idx").on(t.cycleId),
    index("person_debt_place_id_idx").on(t.placeId, t.createdAt),
  ],
);

/**
 * The "Every cycle" template (item 11, spec 3): on salary day each active one
 * fills a `commitment` in the new cycle with its last amount and day. Kept up to
 * date from the commitment it is switched on for. Paused: `active` off.
 */
export const recurringCommitment = sqliteTable(
  "recurring_commitment",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["bill", "savings", "card_bill"] })
      .notNull()
      .default("bill"),
    currency: text("currency").notNull(),
    usualAmountMinor: integer("usual_amount_minor").notNull(),
    /** Day of the month, 1–31; past the month's end means its last day. */
    usualDay: integer("usual_day").notNull(),
    /** A card bill's card (item 18). */
    cardId: text("card_id"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    ...appTimestamps,
  },
  (t) => [index("recurring_commitment_user_id_idx").on(t.userId)],
);

/** A `recurring_commitment` row as it was before salary day changed or deleted it. */
export type RecurringBefore = typeof recurringCommitment.$inferSelect;

/**
 * Undo salary day's record (item 13, spec 2). Everything salary day made inside
 * the new cycle goes with it (rows cascade from `cycle`); this keeps the rest.
 */
export interface SalaryDayUndo {
  /** Templates salary day made (`before` null), changed or deleted, as they were. */
  templates: { id: string; before: RecurringBefore | null }[];
  /** Pots made on salary day: deleted on undo (they have no other cycle). */
  potsMade: string[];
  /** Last cycle's commitments salary day closed or carried on, with their state before. */
  reopened: { id: string; state: "open" | "finished" | "carried" | "dropped" }[];
  /** Payments Paid it made on last cycle's commitments. */
  payments: string[];
  /** The counting rate typed in step 6 (spec 6), if any: deleted on undo. */
  countingRateId?: string;
}

/**
 * The salary-day choices about the cycle that ended (item 12, spec 6): one per
 * ended cycle and currency. The money itself goes into the new cycle as its
 * `leftover` income (to savings and free money); this keeps the correction and
 * the overspend choice for Past and Undo salary day.
 */
export const cycleClose = sqliteTable(
  "cycle_close",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    /** The cycle that ended. */
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycle.id, { onDelete: "cascade" }),
    /** The new cycle it was closed by (Undo salary day deletes this row with it). */
    nextCycleId: text("next_cycle_id")
      .notNull()
      .references(() => cycle.id, { onDelete: "cascade" }),
    currency: text("currency").notNull(),
    /**
     * The leftover worked out on salary day, below zero an overspend (item 21:
     * Past shows how the cycle ended). Null on cycles closed before item 21.
     */
    leftoverMinor: integer("leftover_minor"),
    /** "Actually have in hand" less the leftover worked out. */
    leftoverCorrectionMinor: integer("leftover_correction_minor").notNull().default(0),
    /** Part of the leftover sent to savings. */
    leftoverToSavingsMinor: integer("leftover_to_savings_minor").notNull().default(0),
    /** Only when there was an overspend. */
    overspendChoice: text("overspend_choice", { enum: ["take", "ignore"] }),
    /**
     * What Undo salary day puts back (item 13): rows salary day changed outside
     * the new cycle. Null on cycles started before item 13: those can't be undone.
     */
    undo: text("undo", { mode: "json" }).$type<SalaryDayUndo>(),
    ...appTimestamps,
  },
  (t) => [
    index("cycle_close_user_id_idx").on(t.userId),
    uniqueIndex("cycle_close_cycle_currency_idx").on(t.cycleId, t.currency),
  ],
);

/**
 * One device with phone alerts on (item 26, spec 12): its push subscription.
 * The endpoint is a secret URL; it is deleted when the push service answers 404 or 410.
 */
export const pushSubscription = sqliteTable(
  "push_subscription",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** The push service last took a push for it. */
    lastOkAt: integer("last_ok_at", { mode: "timestamp_ms" }),
    ...appTimestamps,
  },
  (t) => [index("push_subscription_user_id_idx").on(t.userId)],
);

/**
 * One reminder sent to the phone (item 26, spec 12): makes "sent once" and "once a
 * day" work. Kinds: `morning` and `spend_nudge` (once a day), `due_soon` (once per
 * commitment), `running_out` (which pot, or free money, it was about).
 */
export const reminderSent = sqliteTable(
  "reminder_sent",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    kind: text("kind", { enum: ["morning", "spend_nudge", "due_soon", "running_out"] }).notNull(),
    /** The commitment, the pot (or `free` for free money); null for a whole notification. */
    subjectId: text("subject_id"),
    /** The day in the home time zone it was sent on. */
    sentOn: text("sent_on").notNull(),
    ...appTimestamps,
  },
  (t) => [index("reminder_sent_user_kind_idx").on(t.userId, t.kind, t.sentOn)],
);

/**
 * A place money sits in (ticket SAB-50, spec 6): a bank account or cash, in one
 * of the user's currencies (fixed once made). `kind`: money for spending, or
 * kept aside (free money is shared out to it last). The list is ordered by
 * `sort_order`. "Stop using this place": `archived`, counted nowhere.
 * Places are not part of any cycle: salary day and its undo leave them alone.
 */
export const place = sqliteTable(
  "place",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    kind: text("kind", { enum: ["spending", "kept"] })
      .notNull()
      .default("spending"),
    sortOrder: integer("sort_order").notNull().default(0),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    ...appTimestamps,
  },
  (t) => [index("place_user_id_idx").on(t.userId, t.sortOrder)],
);

/**
 * A place's balance as the user typed it at one moment (Set balance). The
 * newest one is the balance; older ones stay, so Undo puts the one before back.
 */
export const placeCheck = sqliteTable(
  "place_check",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    placeId: text("place_id")
      .notNull()
      .references(() => place.id, { onDelete: "cascade" }),
    amountMinor: integer("amount_minor").notNull(),
    /** When it was typed (set by the server). */
    checkedAt: integer("checked_at", { mode: "timestamp_ms" }).notNull(),
    ...appTimestamps,
  },
  (t) => [
    index("place_check_user_id_idx").on(t.userId),
    index("place_check_place_id_idx").on(t.placeId, t.checkedAt),
  ],
);

/**
 * Move money (ticket SAB-51, spec 6): an amount moved from one place to another
 * of the same currency (cash from an ATM). It changes no free money and belongs
 * to no cycle. Removed with either place.
 */
export const placeMove = sqliteTable(
  "place_move",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    fromPlaceId: text("from_place_id")
      .notNull()
      .references(() => place.id, { onDelete: "cascade" }),
    toPlaceId: text("to_place_id")
      .notNull()
      .references(() => place.id, { onDelete: "cascade" }),
    amountMinor: integer("amount_minor").notNull(),
    ...appTimestamps,
  },
  (t) => [
    index("place_move_user_id_idx").on(t.userId),
    index("place_move_from_idx").on(t.fromPlaceId, t.createdAt),
    index("place_move_to_idx").on(t.toPlaceId, t.createdAt),
  ],
);

/** Where a feedback is (ticket SAB-60, spec 14 "Feedback"). */
export const FEEDBACK_STATUSES = [
  "new",
  "seen",
  "planned",
  "building",
  "ready",
  "done",
  "not doing",
] as const;

/**
 * Feedback (ticket SAB-55, spec 14 "Feedback"): what the user wrote, with what the phone
 * knew when they sent it, so an agent can fix from it (`npm run feedback`).
 * `context`, `trail` and `today` are JSON text; the pictures are data URLs
 * (WebP, or JPEG where the browser makes no WebP), at most 300 KB each.
 */
export const feedback = sqliteTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    userId: ownerColumn(),
    kind: text("kind", { enum: ["problem", "idea"] }).notNull(),
    text: text("text").notNull(),
    /** Version, browser, screen, time zone, online, unsent count, current screen. */
    context: text("context").notNull(),
    /** The last steps in the app (`src/client/trail.ts`). */
    trail: text("trail").notNull(),
    /** Today's data as the phone showed it. */
    today: text("today"),
    /** The screen behind the sheet. */
    screenshot: text("screenshot"),
    /** A picture the user added from the gallery. */
    picture: text("picture"),
    /** Where it is (ticket SAB-60): set by `npm run feedback -- --set`, shown under Your feedback. */
    status: text("status", { enum: FEEDBACK_STATUSES }).notNull().default("new"),
    /** A short answer for the person who sent it (≤ 280 characters). */
    reply: text("reply"),
    /** The ticket it became, e.g. `SAB-61`. */
    ticket: text("ticket"),
    /**
     * Why a new one still waits (ticket SAB-66), in plain words, e.g. "Waiting: paused while Claude is busy.":
     * set by the feedback job when a pass skips, cleared when a pass goes ahead or the status changes.
     */
    waiting: text("waiting"),
    /** When the feedback job last looked at it while it waited. */
    checkedAt: integer("checked_at", { mode: "timestamp_ms" }),
    ...appTimestamps,
  },
  (t) => [index("feedback_user_id_idx").on(t.userId), index("feedback_status_idx").on(t.status, t.createdAt)],
);
