import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import * as z from "zod";
import {
  checkFirstUse,
  cycleSpeeds,
  DUE_SOON_DAYS_MAX,
  isRate,
  isReminderTime,
  isTimeZone,
  type ReminderSettings,
  todayIn,
  usualDayOf,
} from "../money";
import { cardLinesOf } from "./cards";
import {
  commitment,
  countingRate,
  cycle,
  income,
  pot,
  potAllocation,
  recurringCommitment,
  settings,
} from "./db/schema";
import { json } from "./json";
import { personDebtLinesOf } from "./people";
import { planLinesOf } from "./plans";
import { prepaymentLinesOf } from "./prepayments";
import { savingsLinesOf } from "./savings";
import { bool, readToday } from "./today-read";
import type { SignedIn } from "./user-check";

const firstUseBody = z.object({
  settingsId: z.uuid(),
  cycleId: z.uuid(),
  incomeId: z.uuid(),
  /** Two currencies (spec 2, 8): the opening income in the salary currency and the counting rate. */
  salaryIncomeId: z.uuid().optional(),
  heldSalaryMinor: z.number().int().optional(),
  countingRateId: z.uuid().optional(),
  countingRate: z.string().nullish(),
  salaryCurrency: z.string(),
  spendingCurrency: z.string(),
  homeTimeZone: z.string(),
  /** The phone's zone at first use (item 22): a different home picked here is not asked about again. */
  askedTimeZone: z.string().refine(isTimeZone).optional(),
  usualPayDay: z.number().int(),
  heldMinor: z.number().int(),
  expectedSalaryOn: z.string(),
  /** Step 4 (ticket 37): the bills still unpaid before the expected salary day. */
  commitments: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string().transform((n) => n.trim()),
        /** Either currency (spec 8); none: the spending currency. */
        currency: z.string().optional(),
        plannedMinor: z.number().int(),
        dueOn: z.string(),
        /** With "Every cycle" on: the id of the template made from it. */
        recurringId: z.uuid().nullish(),
      }),
    )
    .max(100)
    .default([]),
  /** Step 4: new pots, each with this cycle's amount (also its usual amount). */
  pots: z
    .array(
      z.object({
        id: z.uuid(),
        allocationId: z.uuid(),
        name: z.string().transform((n) => n.trim()),
        /** Either currency (spec 8); none: the spending currency. */
        currency: z.string().optional(),
        amountMinor: z.number().int(),
      }),
    )
    .max(50)
    .default([]),
});

const countingRateBody = z.object({ id: z.uuid(), rate: z.string() });

const settingsBody = z
  .object({
    usualPayDay: z.number().int().min(1).max(31),
    homeTimeZone: z.string().refine(isTimeZone),
    /** The phone's zone the switch question was answered for (item 22). */
    askedTimeZone: z.string().refine(isTimeZone),
    /** Settings → Reminders (spec 12, item 25): any of the switches, times and days ahead. */
    reminders: z
      .object({
        dueSoon: z.boolean(),
        dueToday: z.boolean(),
        runningOut: z.boolean(),
        salaryLate: z.boolean(),
        questions: z.boolean(),
        spendNudge: z.boolean(),
        dueSoonDays: z.number().int().min(1).max(DUE_SOON_DAYS_MAX),
        morningAt: z.string().refine(isReminderTime),
        nudgeAt: z.string().refine(isReminderTime),
      })
      .partial()
      .refine((r) => Object.keys(r).length > 0),
    /** The turn-on banner above Today's reminders was dismissed. */
    reminderBannerDismissed: z.boolean(),
  })
  .partial();

/** The reminder columns of a `settings` row, as the phone and the rules use them (spec 12). */
function remindersOf(
  s: Pick<
    typeof settings.$inferSelect,
    | "remindDueSoon"
    | "remindDueToday"
    | "remindRunningOut"
    | "remindSalaryLate"
    | "remindQuestions"
    | "remindSpendNudge"
    | "dueSoonDays"
    | "morningAt"
    | "nudgeAt"
  >,
): ReminderSettings {
  return {
    dueSoon: s.remindDueSoon,
    dueToday: s.remindDueToday,
    runningOut: s.remindRunningOut,
    salaryLate: s.remindSalaryLate,
    questions: s.remindQuestions,
    spendNudge: s.remindSpendNudge,
    dueSoonDays: s.dueSoonDays,
    morningAt: s.morningAt,
    nudgeAt: s.nudgeAt,
  };
}

/**
 * Settings, the current cycle and its entries: everything Today needs (GET /api/current).
 * The reminder cron (item 26) reads the same for each user it sends to.
 * All of it is one D1 batch (`readToday`, ticket SAB-41): a read Today needs later goes there.
 */
export async function currentData(c: { var: Pick<SignedIn["Variables"], "db" | "userId"> }) {
  const r = await readToday(c);
  const s = r.settings[0];
  const [current, last] = r.cycles;
  // Entries of the user's other cycles only count once there is a current cycle.
  const now = <T>(rows: T[]) => (current ? rows : []);
  // Last cycle's spending speeds, free money's and each pot's, over its whole length
  // (spec 7): worked out here so the phone gets two numbers per speed, not last cycle's rows.
  const lastCycle =
    current && last && s
      ? cycleSpeeds(
          {
            spendingCurrency: s.spendingCurrency,
            spends: r.lastSpends.map((x) => ({ ...x, oneOff: bool(x.oneOff) })),
            pots: r.lastPots.map((p) => ({ ...p, archived: false })),
          },
          last.startedOn,
          current.startedOn,
        )
      : null;
  return {
    settings: s
      ? {
          salaryCurrency: s.salaryCurrency,
          spendingCurrency: s.spendingCurrency,
          homeTimeZone: s.homeTimeZone,
          usualPayDay: s.usualPayDay,
          askedTimeZone: s.askedTimeZone,
          // Two currencies (spec 8): the newest counting rate; null with one currency.
          countingRate: s.salaryCurrency !== s.spendingCurrency ? (r.countingRate[0]?.rate ?? null) : null,
          reminders: remindersOf({
            remindDueSoon: bool(s.remindDueSoon),
            remindDueToday: bool(s.remindDueToday),
            remindRunningOut: bool(s.remindRunningOut),
            remindSalaryLate: bool(s.remindSalaryLate),
            remindQuestions: bool(s.remindQuestions),
            remindSpendNudge: bool(s.remindSpendNudge),
            dueSoonDays: s.dueSoonDays,
            morningAt: s.morningAt,
            nudgeAt: s.nudgeAt,
          }),
          reminderBannerDismissed: bool(s.bannerDismissed),
        }
      : null,
    cycle: current
      ? {
          id: current.id,
          startedOn: current.startedOn,
          expectedSalaryOn: current.expectedSalaryOn,
          reserveRate: current.reserveRate,
        }
      : null,
    incomes: r.incomes,
    spends: r.spends.map((x) => ({ ...x, oneOff: bool(x.oneOff) })),
    // Every pot (they last across cycles) with this cycle's amount, if it has one.
    pots: r.pots.map((p) => ({ ...p, archived: bool(p.archived) })),
    // Cards with what they owed before this cycle (item 18); the phone adds this cycle's rows.
    cards: cardLinesOf(
      now(r.cards).map((k) => ({ ...k, archived: bool(k.archived) })),
      r.cardsSpent,
      r.cardsPaid,
    ),
    // Instalment plans with what is paid so far and their extra payments (item 19).
    plans: planLinesOf({
      plans: now(r.plans),
      paid: r.plansPaid,
      extras: r.planExtras.map((x) => ({ ...x, paysOff: bool(x.paysOff) })),
    }),
    // People: lent and borrowed, with what is back so far (item 20).
    people: personDebtLinesOf({ debts: now(r.debts), incomes: r.debtIncomes, paid: r.debtsPaid }),
    // This cycle's conversions (item 16): free money and Change dollars' list.
    conversions: r.conversions,
    lastCycle,
    // Undo salary day is offered while nothing new is entered (item 13).
    undoSalaryDay: current ? bool(r.undo[0]?.offered ?? 0) : false,
    dayChoices: r.dayChoices,
    // Savings movements of every cycle (spec 5); this cycle's take-outs are free money.
    savings: current
      ? savingsLinesOf(
          {
            moves: r.savingsMoves,
            incomes: r.savingsIncomes,
            setAsides: r.savingsSetAsides,
            gains: r.savingsGains,
          },
          s?.spendingCurrency,
        )
      : [],
    // Prepayments from savings with their payback so far (item 14).
    prepayments: prepaymentLinesOf(now(r.prepayments), r.prepaymentsPaid),
    // The "Every cycle" templates, paused ones too (item 11).
    recurring: r.recurring.map((t) => ({ ...t, active: bool(t.active) })),
    commitments: r.commitments.map((k) => ({
      ...k,
      payments: r.payments
        .filter((p) => p.commitmentId === k.id)
        .map((p) => ({
          id: p.id,
          amountMinor: p.amountMinor,
          currency: p.currency,
          coversMinor: p.coversMinor,
          paidOn: p.paidOn,
        })),
    })),
  };
}

/**
 * First use and the Today numbers' entries (backlog item 3, spec 2 and 10).
 * The phone works out every number with the money rules; this only reads and saves.
 */
export const firstUse = new Hono<SignedIn>()
  /** Settings, the current cycle and its entries: everything Today needs. */
  .get("/current", async (c) => c.json(await currentData(c)))
  /**
   * First use: settings row, the first cycle, its opening income, bills (with
   * their Every cycle templates), pots and their amounts, in one write.
   */
  .post("/first-use", json(firstUseBody), async (c) => {
    const { db, mine, userId } = c.var;
    const b = c.req.valid("json");
    const today = isTimeZone(b.homeTimeZone) ? todayIn(b.homeTimeZone, Date.now()) : "";
    const problems = checkFirstUse(b, today);
    if (new Set(b.pots.map((p) => p.id)).size !== b.pots.length) problems.push("pot.twice");
    const two = b.salaryCurrency !== b.spendingCurrency;
    if (two && (!b.salaryIncomeId || !b.countingRateId)) problems.push("new_id");
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    if (await db.query.settings.findFirst({ where: mine(settings), columns: { id: true } })) {
      return c.json({ error: "already_set_up" as const }, 409);
    }
    const cur = b.spendingCurrency;
    const writes: BatchItem<"sqlite">[] = [
      db.insert(settings).values({
        id: b.settingsId,
        userId,
        salaryCurrency: b.salaryCurrency,
        spendingCurrency: cur,
        homeTimeZone: b.homeTimeZone,
        askedTimeZone: b.askedTimeZone ?? null,
        usualPayDay: b.usualPayDay,
      }),
      db.insert(cycle).values({
        id: b.cycleId,
        userId,
        startedOn: today,
        expectedSalaryOn: b.expectedSalaryOn,
        // Two currencies (spec 8): rupee set-asides past the rupees are reserved at the first counting rate.
        reserveRate: two && b.countingRate ? b.countingRate : null,
      }),
      db.insert(income).values({
        id: b.incomeId,
        userId,
        cycleId: b.cycleId,
        kind: "opening",
        currency: cur,
        amountMinor: b.heldMinor,
        receivedOn: today,
      }),
    ];
    // Two currencies: money held in the salary currency, and the counting rate (spec 8).
    if (two && b.salaryIncomeId && b.countingRateId && b.countingRate) {
      writes.push(
        db.insert(income).values({
          id: b.salaryIncomeId,
          userId,
          cycleId: b.cycleId,
          kind: "opening",
          currency: b.salaryCurrency,
          amountMinor: b.heldSalaryMinor ?? 0,
          receivedOn: today,
        }),
        db
          .insert(countingRate)
          .values({ id: b.countingRateId, userId, rate: b.countingRate, setAt: new Date() }),
      );
    }
    for (const k of b.commitments) {
      const recurringId = k.recurringId ?? null;
      if (recurringId) {
        writes.push(
          db.insert(recurringCommitment).values({
            id: recurringId,
            userId,
            name: k.name,
            kind: "bill",
            currency: k.currency ?? cur,
            usualAmountMinor: k.plannedMinor,
            usualDay: usualDayOf(k.dueOn),
          }),
        );
      }
      writes.push(
        db.insert(commitment).values({
          id: k.id,
          userId,
          cycleId: b.cycleId,
          recurringId,
          name: k.name,
          kind: "bill",
          currency: k.currency ?? cur,
          plannedMinor: k.plannedMinor,
          dueOn: k.dueOn,
        }),
      );
    }
    for (const p of b.pots) {
      writes.push(
        db.insert(pot).values({
          id: p.id,
          userId,
          name: p.name,
          currency: p.currency ?? cur,
          usualAmountMinor: p.amountMinor,
        }),
        db.insert(potAllocation).values({
          id: p.allocationId,
          userId,
          potId: p.id,
          cycleId: b.cycleId,
          amountMinor: p.amountMinor,
        }),
      );
    }
    try {
      await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    } catch {
      // An id already in use (or a second phone finishing first use at the same time).
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const, startedOn: today }, 201);
  })
  /** Counting rate set by hand (spec 8, item 15): any time, for a two-currency user. */
  .post("/counting-rates", json(countingRateBody), async (c) => {
    const { db, mine, userId } = c.var;
    const b = c.req.valid("json");
    const s = await db.query.settings.findFirst({ where: mine(settings) });
    if (!s) return c.json({ error: "not_set_up" as const }, 404);
    if (s.salaryCurrency === s.spendingCurrency) return c.json({ error: "one_currency" as const }, 409);
    if (!isRate(b.rate)) return c.json({ error: "invalid" as const, problems: ["rate"] }, 400);
    try {
      await db.insert(countingRate).values({ id: b.id, userId, rate: b.rate, setAt: new Date() });
    } catch {
      // The id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const }, 201);
  })
  /**
   * Settings: usual pay day, home time zone and reminders (spec 10, 12). Currencies are set once.
   * The switch question (item 22): Keep sends `askedTimeZone`; Switch sends it and `homeTimeZone`.
   */
  .patch("/settings", json(settingsBody), async (c) => {
    const { db, mine } = c.var;
    const b = c.req.valid("json");
    const r = b.reminders ?? {};
    const change = {
      usualPayDay: b.usualPayDay,
      homeTimeZone: b.homeTimeZone,
      askedTimeZone: b.askedTimeZone,
      remindDueSoon: r.dueSoon,
      remindDueToday: r.dueToday,
      remindRunningOut: r.runningOut,
      remindSalaryLate: r.salaryLate,
      remindQuestions: r.questions,
      remindSpendNudge: r.spendNudge,
      dueSoonDays: r.dueSoonDays,
      morningAt: r.morningAt,
      nudgeAt: r.nudgeAt,
      bannerDismissed: b.reminderBannerDismissed,
    };
    if (Object.values(change).every((v) => v === undefined)) {
      return c.json({ error: "bad_request" as const }, 400);
    }
    const done = await db.update(settings).set(change).where(mine(settings)).returning({ id: settings.id });
    if (!done.length) return c.json({ error: "not_set_up" as const }, 404);
    return c.json({ ok: true as const });
  });
