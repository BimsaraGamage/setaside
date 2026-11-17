import { describe, expect, it } from "vitest";
import {
  type CycleEntries,
  DEFAULT_REMINDERS,
  isReminderTime,
  type Reminder,
  type ReminderInput,
  reminders,
  timeIn,
} from "../../src/money";

// Item 25 · Reminders in the app. Each case names the rule it checks (spec 12).

const salary = { kind: "salary" as const, currency: "LKR", amountMinor: 3_000_000, toSavingsMinor: 0 };

/**
 * A cycle that started 1 Nov on a Rs 30,000 salary and expects the next on 25 Nov.
 * Today's underspend question is answered unless a case gives its own answers.
 */
function input(more: Partial<CycleEntries> = {}, rest: Partial<ReminderInput> = {}): ReminderInput {
  return {
    entries: {
      dayChoices: [{ dayOn: rest.today ?? "2026-11-10", choice: "spread" }],
      spendingCurrency: "LKR",
      startedOn: "2026-11-01",
      expectedSalaryOn: "2026-11-25",
      incomes: [{ ...salary, receivedOn: "2026-11-01" }],
      spends: [],
      ...more,
    },
    commitments: [],
    pots: [],
    today: "2026-11-10",
    time: "08:00",
    settings: DEFAULT_REMINDERS,
    ...rest,
  };
}

const bill = (id: string, name: string, dueOn: string, more: object = {}) => ({
  id,
  name,
  dueOn,
  currency: "LKR",
  plannedMinor: 500_000,
  state: "open" as const,
  payments: [],
  ...more,
});

const kinds = (list: Reminder[]) => list.map((r) => r.kind);

describe("when reminders start (spec 12: no reminders before the first salary is entered)", () => {
  it("gives none in the first cycle, which started with money held, not a salary", () => {
    const i = input({ incomes: [{ ...salary, kind: "opening", receivedOn: "2026-11-01" }] });
    i.commitments = [bill("c1", "Rent", "2026-11-10")];
    expect(reminders(i)).toEqual([]);
  });

  it("gives them once a salary is in", () => {
    const i = input();
    i.commitments = [bill("c1", "Rent", "2026-11-10")];
    expect(kinds(reminders(i))).toEqual(["due_today"]);
  });
});

describe("bill due today or overdue (spec 12, reminder 2)", () => {
  it("lists open bills due today and late ones, late first, with what is still to pay", () => {
    const i = input();
    i.commitments = [
      bill("c1", "Rent", "2026-11-10"),
      bill("c2", "Water", "2026-11-08", {
        payments: [{ amountMinor: 200_000, currency: "LKR", paidOn: "2026-11-08" }],
      }),
    ];
    expect(reminders(i)).toEqual([
      {
        kind: "due_today",
        id: "c2",
        name: "Water",
        dueOn: "2026-11-08",
        lateDays: 2,
        stillMinor: 300_000,
        currency: "LKR",
      },
      {
        kind: "due_today",
        id: "c1",
        name: "Rent",
        dueOn: "2026-11-10",
        lateDays: 0,
        stillMinor: 500_000,
        currency: "LKR",
      },
    ]);
  });

  it("stops once paid in full or finished", () => {
    const i = input();
    i.commitments = [
      bill("c1", "Rent", "2026-11-09", {
        payments: [{ amountMinor: 500_000, currency: "LKR", paidOn: "2026-11-09" }],
      }),
      bill("c2", "Water", "2026-11-09", { state: "finished" }),
    ];
    expect(reminders(i)).toEqual([]);
  });

  it("counts card bills and plan payments like any bill", () => {
    const i = input();
    i.commitments = [
      bill("c1", "Visa bill", "2026-11-10", { kind: "card_bill" }),
      bill("c2", "Phone 3 of 12", "2026-11-10", { kind: "plan_payment" }),
    ];
    expect(kinds(reminders(i))).toEqual(["due_today", "due_today"]);
  });
});

describe("bill due soon (spec 12, reminder 1: due in N days, N = 3 and changeable)", () => {
  it("lists open bills due in 1 to N days", () => {
    const i = input();
    i.commitments = [
      bill("c1", "Phone", "2026-11-13"),
      bill("c2", "Rent", "2026-11-11"),
      bill("c3", "Water", "2026-11-14"),
    ];
    expect(reminders(i)).toEqual([
      {
        kind: "due_soon",
        id: "c2",
        name: "Rent",
        dueOn: "2026-11-11",
        inDays: 1,
        stillMinor: 500_000,
        currency: "LKR",
      },
      {
        kind: "due_soon",
        id: "c1",
        name: "Phone",
        dueOn: "2026-11-13",
        inDays: 3,
        stillMinor: 500_000,
        currency: "LKR",
      },
    ]);
  });

  it("follows the days-ahead number", () => {
    const i = input({}, { settings: { ...DEFAULT_REMINDERS, dueSoonDays: 5 } });
    i.commitments = [bill("c3", "Water", "2026-11-14"), bill("c4", "Gas", "2026-11-16")];
    expect(reminders(i).map((r) => (r.kind === "due_soon" ? r.name : r.kind))).toEqual(["Water"]);
  });
});

describe("running out (spec 12, reminder 3: Tight on the day it changes, Runs out every morning)", () => {
  // Rs 30,000 for 24 days, Rs 1,250 a day. Spends set the speed from finished days.
  const spendEach = (perDay: number, from: string, to: string) => {
    const list = [];
    for (
      let d = new Date(`${from}T00:00:00Z`);
      d <= new Date(`${to}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      list.push({ spentOn: d.toISOString().slice(0, 10), currency: "LKR", amountMinor: perDay });
    }
    return list;
  };

  it("says when free money runs out, every day it holds", () => {
    const i = input({ spends: spendEach(200_000, "2026-11-01", "2026-11-09") });
    const r = reminders(i).find((x) => x.kind === "running_out");
    expect(r).toEqual({
      kind: "running_out",
      potId: null,
      name: null,
      currency: "LKR",
      verdict: { kind: "runs_out", on: "2026-11-16" },
    });
  });

  it("says Tight only on the day it changes to Tight", () => {
    // Rs 1,200 a day: above 90% of the allowance, still lasts.
    const spends = spendEach(120_000, "2026-11-01", "2026-11-09");
    const firstTight = reminders(input({ spends }, { today: "2026-11-04" }));
    expect(firstTight.find((x) => x.kind === "running_out")).toMatchObject({ verdict: { kind: "tight" } });
    const again = reminders(input({ spends }, { today: "2026-11-10" }));
    expect(again.find((x) => x.kind === "running_out")).toBeUndefined();
  });

  it("says free money is over when it is at zero or below", () => {
    const i = input({ spends: [{ spentOn: "2026-11-05", currency: "LKR", amountMinor: 3_100_000 }] });
    expect(reminders(i).find((x) => x.kind === "running_out")).toMatchObject({
      verdict: { kind: "over", overMinor: 100_000 },
    });
  });

  it("gives each pot in use its own line", () => {
    const pots = [
      { id: "p1", name: "Groceries", currency: "LKR", amountMinor: 240_000, archived: false },
      { id: "p2", name: "Fuel", currency: "LKR", amountMinor: 240_000, archived: true },
    ];
    const spends = [
      ...spendEach(30_000, "2026-11-01", "2026-11-05").map((s) => ({ ...s, potId: "p1" })),
      ...spendEach(30_000, "2026-11-01", "2026-11-05").map((s) => ({ ...s, potId: "p2" })),
    ];
    const i = input({ spends, pots }, { pots, today: "2026-11-06" });
    expect(reminders(i).filter((x) => x.kind === "running_out")).toEqual([
      {
        kind: "running_out",
        potId: "p1",
        name: "Groceries",
        currency: "LKR",
        verdict: { kind: "runs_out", on: "2026-11-09" },
      },
    ]);
  });
});

describe("salary late (spec 12, reminder 4: from the morning after the expected salary day)", () => {
  it("is not given on the expected day itself, then every day after", () => {
    expect(kinds(reminders(input({}, { today: "2026-11-25" })))).not.toContain("salary_late");
    expect(reminders(input({}, { today: "2026-11-27" })).find((r) => r.kind === "salary_late")).toEqual({
      kind: "salary_late",
      expectedOn: "2026-11-25",
      lateDays: 2,
    });
  });
});

describe("questions waiting (spec 12, reminder 5)", () => {
  it("names an unanswered underspend question", () => {
    // Day 2: yesterday's Rs 1,250 not spent.
    const r = reminders(input({ dayChoices: [] }, { today: "2026-11-02" })).find(
      (x) => x.kind === "questions",
    );
    expect(r).toMatchObject({
      kind: "questions",
      unspentMinor: 125_000,
      unspentDays: 1,
      unpaid: 0,
      overMinor: 0,
    });
  });

  it("is quiet once the underspend question is answered", () => {
    const i = input({ dayChoices: [{ dayOn: "2026-11-02", choice: "spread" }] }, { today: "2026-11-02" });
    expect(kinds(reminders(i))).not.toContain("questions");
  });

  it("from the expected salary day, names what salary day will ask: unpaid bills and an overspend", () => {
    const i = input(
      { spends: [{ spentOn: "2026-11-20", currency: "LKR", amountMinor: 3_100_000 }] },
      { today: "2026-11-25" },
    );
    i.commitments = [bill("c1", "Rent", "2026-11-24"), bill("c2", "Next rent", "2026-11-30")];
    i.entries.commitments = i.commitments;
    expect(reminders(i).find((x) => x.kind === "questions")).toEqual({
      kind: "questions",
      unspentMinor: 0,
      unspentDays: 0,
      unpaid: 1,
      overMinor: 600_000,
      currency: "LKR",
    });
  });
});

describe("spend nudge (spec 12, reminder 6: in the evening, skipped on a day with a spend)", () => {
  it("is given from the nudge time on a day with no spend", () => {
    expect(kinds(reminders(input({}, { time: "20:59" })))).not.toContain("spend_nudge");
    expect(kinds(reminders(input({}, { time: "21:00" })))).toContain("spend_nudge");
  });

  it("is skipped once a spend is logged today, a pot or card one too", () => {
    const i = input(
      { spends: [{ spentOn: "2026-11-10", currency: "LKR", amountMinor: 100, potId: "p1" }] },
      { time: "22:00" },
    );
    expect(kinds(reminders(i))).not.toContain("spend_nudge");
  });
});

describe("switches and order (spec 12: six switches, all on at first)", () => {
  it("are all on at first: 08:00, 21:00, 3 days", () => {
    expect(DEFAULT_REMINDERS).toEqual({
      dueSoon: true,
      dueToday: true,
      runningOut: true,
      salaryLate: true,
      questions: true,
      spendNudge: true,
      dueSoonDays: 3,
      morningAt: "08:00",
      nudgeAt: "21:00",
    });
  });

  it("lists in the morning summary's order, then the nudge, and leaves out switched-off kinds", () => {
    const i = input(
      { spends: [{ spentOn: "2026-11-20", currency: "LKR", amountMinor: 3_100_000 }] },
      { today: "2026-11-26", time: "21:30" },
    );
    i.commitments = [bill("c1", "Rent", "2026-11-26"), bill("c2", "Phone", "2026-11-27")];
    expect(kinds(reminders(i))).toEqual([
      "due_today",
      "due_soon",
      "running_out",
      "salary_late",
      "questions",
      "spend_nudge",
    ]);
    const off = {
      ...i,
      settings: { ...DEFAULT_REMINDERS, dueToday: false, salaryLate: false, spendNudge: false },
    };
    expect(kinds(reminders(off))).toEqual(["due_soon", "running_out", "questions"]);
  });
});

describe("times (spec 12: home time zone, 15-minute steps)", () => {
  it("accepts HH:MM on a quarter hour only", () => {
    expect(isReminderTime("08:00")).toBe(true);
    expect(isReminderTime("21:45")).toBe(true);
    expect(isReminderTime("08:10")).toBe(false);
    expect(isReminderTime("24:00")).toBe(false);
    expect(isReminderTime("8:00")).toBe(false);
  });

  it("reads the time of day in the home time zone", () => {
    // 2026-11-10 15:40 UTC is 21:10 in Colombo (+05:30).
    expect(timeIn("Asia/Colombo", Date.UTC(2026, 10, 10, 15, 40))).toBe("21:10");
    expect(timeIn("UTC", Date.UTC(2026, 10, 10, 0, 5))).toBe("00:05");
  });
});
