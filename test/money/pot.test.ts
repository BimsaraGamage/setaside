import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type CycleEntries,
  checkPot,
  checkSpend,
  freeMoney,
  type PotEntry,
  potOutMinor,
  potView,
  type SpendEntry,
  STARTER_POTS,
  todayView,
} from "../../src/money";

// Item 7 · Pots. Each case names the rule it checks (spec 4, 7, 16).

const TODAY = "2026-11-12";
const SALARY = "2026-11-30";

const pot = (id: string, amountMinor: number, archived = false): PotEntry => ({
  id,
  currency: "LKR",
  amountMinor,
  archived,
});

const spend = (amountMinor: number, potId: string | null = null, spentOn = "2026-11-11"): SpendEntry => ({
  spentOn,
  currency: "LKR",
  amountMinor,
  potId,
});

/** Rs 90,000 held, salary expected 30 Nov: on 12 Nov that is 18 days of Rs 5,000 before pots. */
function cycle(pots: PotEntry[], spends: SpendEntry[] = []): CycleEntries {
  return {
    spendingCurrency: "LKR",
    expectedSalaryOn: SALARY,
    incomes: [{ kind: "opening", currency: "LKR", amountMinor: 9_000_000, toSavingsMinor: 0 }],
    spends,
    commitments: [],
    pots,
  };
}

describe("a pot's money is set aside (spec 4)", () => {
  it("the pot amount this cycle comes out of free money at once", () => {
    const e = cycle([pot("g", 1_800_000)]);
    expect(freeMoney(e)).toBe(7_200_000);
    // Also in the start-of-day free money: a pot is not a spend (spec 7).
    expect(todayView(e, TODAY).allowanceMinor).toBe(400_000);
  });

  it("a spend in a pot with room left does not touch free money or today's allowance", () => {
    const e = cycle([pot("g", 1_800_000)], [spend(250_000, "g", TODAY)]);
    const v = todayView(e, TODAY);
    expect(v.freeMinor).toBe(7_200_000);
    expect(v.spentTodayMinor).toBe(0);
    expect(v.leftTodayMinor).toBe(400_000);
  });

  it("spends default to free money: a spend with no pot lowers free money", () => {
    const e = cycle([pot("g", 1_800_000)], [spend(250_000)]);
    expect(freeMoney(e)).toBe(7_200_000 - 250_000);
  });

  it("pot used up: further spends in it come from free money", () => {
    const e = cycle([pot("f", 1_000_000)], [spend(800_000, "f"), spend(500_000, "f")]);
    expect(freeMoney(e)).toBe(9_000_000 - 1_300_000);
    expect(potView(e.pots?.[0] as PotEntry, e.spends)).toEqual({
      spentMinor: 1_300_000,
      leftMinor: 0,
      overMinor: 300_000,
      usedUp: true,
    });
  });

  it("a pot spend today past an empty pot shows against today's allowance, only the part over", () => {
    // Fuel Rs 10,000: Rs 8,000 spent yesterday, Rs 5,000 today → Rs 3,000 over, all today.
    const e = cycle([pot("f", 1_000_000)], [spend(800_000, "f"), spend(500_000, "f", TODAY)]);
    const v = todayView(e, TODAY);
    expect(v.allowanceMinor).toBe(Math.floor(8_000_000 / 18 / 100) * 100);
    expect(v.spentTodayMinor).toBe(300_000);
    expect(v.freeMinor).toBe(9_000_000 - 1_300_000);
  });

  it("a pot spent exactly to zero is used up with nothing over", () => {
    const e = cycle([pot("m", 300_000)], [spend(300_000, "m")]);
    expect(potView(e.pots?.[0] as PotEntry, e.spends)).toMatchObject({
      leftMinor: 0,
      overMinor: 0,
      usedUp: true,
    });
  });

  it("a pot with room shows what is left and is not used up", () => {
    expect(potView(pot("g", 1_800_000), [spend(600_000, "g"), spend(100_000)])).toEqual({
      spentMinor: 600_000,
      leftMinor: 1_200_000,
      overMinor: 0,
      usedUp: false,
    });
  });

  it("Stop using this pot: what is left in it goes back to free money at once", () => {
    const using = cycle([pot("t", 500_000)], [spend(200_000, "t")]);
    const stopped = cycle([pot("t", 500_000, true)], [spend(200_000, "t")]);
    expect(freeMoney(using)).toBe(8_500_000);
    expect(freeMoney(stopped)).toBe(8_800_000);
  });

  it("Stop using a pot keeps today's spends in it off today's allowance", () => {
    const e = cycle([pot("t", 500_000, true)], [spend(200_000, "t", TODAY)]);
    expect(todayView(e, TODAY).spentTodayMinor).toBe(0);
  });

  it("a spend whose pot is gone counts as free money", () => {
    const e = cycle([], [spend(200_000, "gone")]);
    expect(freeMoney(e)).toBe(8_800_000);
  });

  it("pots in another currency stay out of the spending currency's free money", () => {
    const usd: PotEntry = { id: "u", currency: "USD", amountMinor: 5_000, archived: false };
    expect(potOutMinor([usd], [], "LKR")).toBe(0);
  });
});

describe("free money with pots adds up (spec 4, random checks)", () => {
  const entries = fc
    .tuple(
      fc.array(fc.record({ amountMinor: fc.integer({ min: 0, max: 5_000_000 }), archived: fc.boolean() }), {
        maxLength: 4,
      }),
      fc.array(
        fc.record({
          amountMinor: fc.integer({ min: 1, max: 3_000_000 }),
          pot: fc.integer({ min: -1, max: 3 }),
          today: fc.boolean(),
        }),
        { maxLength: 12 },
      ),
    )
    .map(([ps, ss]) => {
      const pots = ps.map((p, i) => pot(`p${i}`, p.amountMinor, p.archived));
      const spends = ss.map((s) =>
        spend(
          s.amountMinor,
          s.pot >= 0 && s.pot < pots.length ? `p${s.pot}` : null,
          s.today ? TODAY : "2026-11-10",
        ),
      );
      return cycle(pots, spends);
    });

  it("income = free money + money still in pots in use + every spend", () => {
    fc.assert(
      fc.property(entries, (e) => {
        const pots = e.pots ?? [];
        const stillInPots = pots
          .filter((p) => !p.archived)
          .reduce((n, p) => n + potView(p, e.spends).leftMinor, 0);
        const spent = e.spends.reduce((n, s) => n + s.amountMinor, 0);
        expect(freeMoney(e) + stillInPots + spent).toBe(9_000_000);
      }),
      { seed: 20261115, numRuns: 2_000 },
    );
  });

  it("spent today against the allowance is never more than today's spends", () => {
    fc.assert(
      fc.property(entries, (e) => {
        const v = todayView(e, TODAY);
        const all = e.spends.filter((s) => s.spentOn === TODAY).reduce((n, s) => n + s.amountMinor, 0);
        expect(v.spentTodayMinor).toBeGreaterThanOrEqual(0);
        expect(v.spentTodayMinor).toBeLessThanOrEqual(all);
      }),
      { seed: 20261115, numRuns: 2_000 },
    );
  });

  it("stopping a pot never lowers free money", () => {
    fc.assert(
      fc.property(entries, (e) => {
        for (const p of e.pots ?? []) {
          const stopped = { ...e, pots: e.pots?.map((q) => (q.id === p.id ? { ...q, archived: true } : q)) };
          expect(freeMoney(stopped)).toBeGreaterThanOrEqual(freeMoney(e));
        }
      }),
      { seed: 20261115, numRuns: 2_000 },
    );
  });
});

describe("checking a pot (spec 4)", () => {
  const ctx = { spendingCurrency: "LKR" };
  const ok = { name: "Groceries", currency: "LKR", usualAmountMinor: 1_800_000, amountMinor: 1_800_000 };

  it("a named pot with amounts of zero or more is fine", () => {
    expect(checkPot(ok, ctx)).toEqual([]);
    expect(checkPot({ ...ok, usualAmountMinor: 0, amountMinor: 0 }, ctx)).toEqual([]);
  });

  it("needs a name of 1 to 80 characters", () => {
    expect(checkPot({ ...ok, name: "  " }, ctx)).toEqual(["name"]);
    expect(checkPot({ ...ok, name: "x".repeat(81) }, ctx)).toEqual(["name"]);
  });

  it("amounts are whole minor units, not below zero", () => {
    expect(checkPot({ ...ok, usualAmountMinor: -1 }, ctx)).toEqual(["usual_amount"]);
    expect(checkPot({ ...ok, amountMinor: 1.5 }, ctx)).toEqual(["amount"]);
  });

  it("one currency until item 15", () => {
    expect(checkPot({ ...ok, currency: "USD" }, ctx)).toEqual(["currency"]);
  });

  it("starter pots are Groceries, Fuel, Transport, Medicine", () => {
    expect(STARTER_POTS).toEqual(["Groceries", "Fuel", "Transport", "Medicine"]);
  });
});

describe("a spend's pot (spec 4)", () => {
  const ctx = {
    today: TODAY,
    cycleStartedOn: "2026-11-01",
    spendingCurrency: "LKR",
    pots: [pot("g", 1_800_000), pot("old", 0, true)],
  };
  const base = { amountMinor: 1_000, spentOn: TODAY, currency: "LKR" };

  it("free money or a pot in use is fine", () => {
    expect(checkSpend({ ...base, potId: null }, ctx)).toEqual([]);
    expect(checkSpend({ ...base, potId: "g" }, ctx)).toEqual([]);
  });

  it("a pot that is not there or no longer used is refused", () => {
    expect(checkSpend({ ...base, potId: "nope" }, ctx)).toEqual(["pot"]);
    expect(checkSpend({ ...base, potId: "old" }, ctx)).toEqual(["pot"]);
  });

  it("a spend already in a stopped pot can keep it", () => {
    expect(checkSpend({ ...base, potId: "old" }, { ...ctx, keepPotId: "old" })).toEqual([]);
  });
});
