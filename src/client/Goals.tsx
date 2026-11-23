import { useState } from "react";
import {
  addDays,
  checkGoalSpend,
  checkSavingsGoal,
  coveredMinor,
  fairShareMinor,
  formatMoney,
  GOAL_SPEND_NOTE_MAX,
  type GoalStatus,
  goalSavedMinor,
  goalStatus,
  goalUnspentMinor,
  NAME_MAX,
  parseAmount,
  type SavingsGoalEntry,
  savingsTotal,
  todayView,
} from "../money";
import { api } from "./api";
import { CurrencyChoice, currenciesOf, currencyContext } from "./CurrencyChoice";
import { type Commitment, dayLabel, entriesOf, type Goal, type Ready, useToday } from "./data";
import { newId } from "./id";
import { PlaceChoice, usePlaceChoice } from "./PlaceChoice";
import { toText } from "./SpendSheet";
import type { Toaster } from "./toast";

const ok = async (res: Promise<Response | { ok: boolean }>) => (await res.catch(() => null))?.ok ?? false;

interface GoalFields {
  name: string;
  targetMinor: number;
  byOn: string;
  startMinor: number;
}

const add = (id: string, d: GoalFields & { currency: string }, share: number) =>
  ok(
    api.api["savings-goals"].$post({
      json: { id, ...d, ...(share > 0 ? { share: { id: newId(), plannedMinor: share } } : {}) },
    }),
  );
const change = (id: string, d: Partial<GoalFields & { stopped: boolean }>) =>
  ok(api.api["savings-goals"][":id"].$patch({ param: { id }, json: d }));
const remove = (id: string) => ok(api.api["savings-goals"][":id"].$delete({ param: { id } }));
const addSpend = (id: string, goalId: string, amountMinor: number, note: string, placeId: string | null) =>
  ok(
    api.api["savings-movements"].$post({
      json: { id, kind: "goal_spend", goalId, amountMinor, note, placeId },
    }),
  );
const removeSpend = (id: string) => ok(api.api["savings-movements"][":id"].$delete({ param: { id } }));

/** Add, change, stop, start again and delete savings goals (SAB-68); each success shows a toast. */
export function goalActions({ done }: Toaster) {
  return {
    /** A new goal and its first share, set aside at once (0: it starts on the next salary day). */
    add: (d: GoalFields & { currency: string }, share: number) => {
      const id = newId();
      return add(id, d, share).then((ok) =>
        done(ok, { text: `${d.name} goal saved`, undo: () => remove(id) }),
      );
    },
    change: (g: Goal, d: GoalFields) =>
      change(g.id, d).then((ok) =>
        done(ok, {
          text: "Goal changed",
          undo: () =>
            change(g.id, {
              name: g.name,
              targetMinor: g.targetMinor,
              byOn: g.byOn,
              startMinor: g.startMinor,
            }),
        }),
      ),
    /** Stop this goal: no more shares; this cycle's share stays a savings set-aside. */
    stop: (g: Goal) =>
      change(g.id, { stopped: true }).then((ok) =>
        done(ok, { text: `${g.name} stopped`, undo: () => change(g.id, { stopped: false }) }),
      ),
    startAgain: (g: Goal) =>
      change(g.id, { stopped: false }).then((ok) =>
        done(ok, { text: `${g.name} started again`, undo: () => change(g.id, { stopped: true }) }),
      ),
    /** Delete, only while nothing was moved toward it, taken out of it or spent from it: its share this cycle goes too. */
    remove: (g: Goal) => remove(g.id).then((ok) => done(ok, { text: `${g.name} deleted` })),
    /** Spend from this goal (SAB-75): straight out of savings, not via free money; Undo deletes it. */
    spend: (g: Goal, amountMinor: number, note: string, placeId: string | null) => {
      const id = newId();
      return addSpend(id, g.id, amountMinor, note, placeId).then((ok) =>
        done(ok, {
          text: `${formatMoney(amountMinor, g.currency)} spent from ${g.name}`,
          undo: () => removeSpend(id),
        }),
      );
    },
  };
}

export type GoalActions = ReturnType<typeof goalActions>;

/** This cycle's shares of a goal, as the phone has them (unsent moves included). */
const sharesNow = (data: Pick<Ready, "commitments">, g: Goal) =>
  data.commitments.filter((c) => c.goalId === g.id);

/** What take-outs from a goal took (SAB-69), all cycles, or only this cycle's. */
export function takenOutOf(data: Pick<Ready, "savings" | "cycle">, g: Pick<Goal, "id">, thisCycle = false) {
  let n = 0;
  for (const l of data.savings) {
    if (l.kind === "take_out" && l.goalId === g.id && (!thisCycle || l.cycleId === data.cycle.id)) {
      n -= l.amountMinor;
    }
  }
  return n;
}

/** What goal spends from a goal spent (SAB-75), all cycles. */
export function spentOf(data: Pick<Ready, "savings">, g: Pick<Goal, "id">) {
  let n = 0;
  for (const l of data.savings) if (l.kind === "goal_spend" && l.goalId === g.id) n -= l.amountMinor;
  return n;
}

type GoalData = Pick<Ready, "commitments" | "cycle" | "savings">;

/**
 * A goal as the money rules need it: moved toward it = earlier cycles' shares (from the server)
 * plus this cycle's, counted from this cycle's commitments and their payments; less take-outs
 * from it (SAB-69).
 */
export function goalEntry(data: GoalData, g: Goal): SavingsGoalEntry {
  const earlier = g.shares.filter((s) => s.cycleId !== data.cycle.id);
  const now = sharesNow(data, g);
  return {
    ...g,
    movedMinor:
      earlier.reduce((n, s) => n + s.coveredMinor, 0) + now.reduce((n, c) => n + coveredMinor(c), 0),
    takenOutMinor: takenOutOf(data, g),
    spentMinor: spentOf(data, g),
    shareCount: earlier.length + now.length,
  };
}

/** A goal's status now (spec 10). */
export function statusOf(data: Ready, g: Goal, today: string): GoalStatus {
  const now = sharesNow(data, g).map((c) => ({
    plannedMinor: c.plannedMinor,
    coveredMinor: coveredMinor(c),
    open: c.state === "open",
  }));
  return goalStatus(goalEntry(data, g), now, {
    startedOn: data.cycle.startedOn,
    usualPayDay: data.settings.usualPayDay,
    nextSalaryOn: data.cycle.expectedSalaryOn,
    today,
    // A take-out this cycle grows the next salary day's share, not this one (SAB-69).
    takenOutNowMinor: takenOutOf(data, g, true),
  });
}

/** The status line (SAB-67 pick 10): "Rs 40,000 a cycle · 5 cycles left", "Behind: …", "Reached". */
export function statusText(s: GoalStatus, currency: string): string {
  const m = (n: number) => formatMoney(n, currency);
  switch (s.kind) {
    case "on_plan":
      return `${m(s.shareMinor)} a cycle · ${s.cyclesLeft} cycle${s.cyclesLeft === 1 ? "" : "s"} left`;
    case "behind":
      return `Behind: ${m(s.shortMinor)} less than the fair share this cycle`;
    case "starts":
      return `Starts next salary day · ${m(s.shareMinor)} a cycle`;
    case "passed":
      return `By date passed · ${m(s.leftMinor)} left`;
    case "reached":
      return "Reached";
    case "stopped":
      return "Stopped";
  }
}

/** "Rs 120,000 of 600,000": saved toward it of the target. */
export function progressText(saved: number, g: Pick<Goal, "targetMinor" | "currency">): string {
  return `${formatMoney(saved, g.currency)} of ${formatMoney(g.targetMinor, g.currency)}`;
}

/** Next up's note on a goal share (spec 10): "120,000 of 600,000", like "7 of 12". */
export function goalShareNote(data: Pick<Ready, "goals"> & GoalData, c: Commitment) {
  const g = c.goalId ? data.goals.find((x) => x.id === c.goalId) : undefined;
  return g ? progressText(goalSavedMinor(goalEntry(data, g)), g) : undefined;
}

function Bar({ saved, g }: { saved: number; g: Goal }) {
  return (
    <span
      className="bar"
      role="meter"
      aria-label={`${g.name} saved`}
      aria-valuemin={0}
      aria-valuemax={g.targetMinor}
      aria-valuenow={Math.min(g.targetMinor, saved)}
    >
      <span style={{ width: `${Math.min(1, saved / g.targetMinor) * 100}%` }} />
    </span>
  );
}

/** Money › Savings: the Goals list (+ New goal), each with progress, a bar, the by date and its status. */
export function GoalsCard({ data }: { data: Ready }) {
  const today = useToday(data.settings.homeTimeZone);
  return (
    <section className="card" aria-labelledby="goals-h">
      <div className="row">
        <h3 id="goals-h" className="grow">
          Goals
        </h3>
        <a className="btn ghost link" href="#Goal">
          + New goal
        </a>
      </div>
      {data.goals.length === 0 && (
        <p className="tiny mute">Save up for something by a day: each salary day sets aside a fair share.</p>
      )}
      {data.goals.map((g) => {
        const entry = goalEntry(data, g);
        const saved = goalSavedMinor(entry);
        return (
          <a key={g.id} className="stack link tap" href={`#Goal/${g.id}`} data-testid="goal">
            <div className="li">
              <span className="grow">
                {g.name}
                <span className="tiny mute block">
                  By {dayLabel(g.byOn)} · {statusText(statusOf(data, g, today), g.currency)}
                  {(entry.spentMinor ?? 0) > 0 &&
                    ` · ${formatMoney(goalUnspentMinor(entry), g.currency)} left`}
                </span>
              </span>
              <b className="small">{progressText(saved, g)}</b>
            </div>
            <Bar saved={saved} g={g} />
          </a>
        );
      })}
    </section>
  );
}

const amountOf = (text: string, currency: string) =>
  text === "" ? 0 : (parseAmount(text.replace(/\.$/, ""), currency) ?? Number.NaN);

function AmountInput({
  label,
  text,
  currency,
  onChange,
  hint,
}: {
  label: string;
  text: string;
  currency: string;
  onChange: (t: string) => void;
  hint?: string;
}) {
  return (
    <label className="field">
      {label} ({currency})
      <input
        value={text}
        inputMode="decimal"
        placeholder="0"
        onChange={(e) => {
          const t = e.target.value;
          if (t === "" || parseAmount(t.replace(/\.$/, ""), currency) !== null) onChange(t);
        }}
      />
      {hint && <span className="tiny mute">{hint}</span>}
    </label>
  );
}

const PROBLEM: Record<string, string> = {
  name: "Give it a name.",
  target: "Type how much to save.",
  by_on: "Pick a day after today.",
  start: "Already saved can't be more than your savings or the target.",
};

/**
 * New goal and the goal page (spec 5, 10): name, currency, target, by date and
 * "Already saved for it"; a new one shows its first share (the fair share, set
 * aside at once, changeable; 0 starts on the next salary day) and the new
 * allowance. Open: progress, status, its shares by cycle, change, Stop this goal
 * (or Start again), Delete while nothing was moved toward it.
 */
export function GoalPage({ data, editing, actions }: { data: Ready; editing?: Goal; actions: GoalActions }) {
  const today = useToday(data.settings.homeTimeZone);
  const [name, setName] = useState(editing?.name ?? "");
  const [cur, setCur] = useState(editing?.currency ?? data.settings.spendingCurrency);
  const [targetText, setTargetText] = useState(editing ? toText(editing.targetMinor, editing.currency) : "");
  const [byOn, setByOn] = useState(editing?.byOn ?? addDays(today, 180));
  const [startText, setStartText] = useState(
    editing && editing.startMinor > 0 ? toText(editing.startMinor, editing.currency) : "",
  );
  const [shareText, setShareText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const targetMinor = amountOf(targetText, cur);
  const startMinor = amountOf(startText, cur);
  const savingsMinor = savingsTotal(data.savings, cur);
  const fields = { name: name.trim(), targetMinor, byOn, startMinor };
  const problems = checkSavingsGoal(
    { ...fields, currency: cur },
    {
      ...currencyContext(data),
      today,
      savingsMinor: editing ? Math.max(savingsMinor, editing.startMinor) : savingsMinor,
      ...(editing ? { keepByOn: editing.byOn } : {}),
    },
  );

  async function run(job: () => Promise<boolean>, leave = false) {
    setBusy(true);
    setFailed(false);
    const done = await job();
    setBusy(false);
    if (!done) setFailed(true);
    else if (leave) window.location.hash = "Savings";
  }

  const back = (
    <div className="row">
      <a className="btn ghost link" href="#Savings">
        ← Back
      </a>
    </div>
  );
  const form = (
    <>
      <label className="field">
        What for
        <input
          value={name}
          maxLength={NAME_MAX}
          placeholder="Trip to Japan, a new laptop…"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {!editing && (
        <CurrencyChoice
          currencies={currenciesOf(data.settings)}
          value={cur}
          onChange={(c) => {
            setCur(c);
            setTargetText("");
            setStartText("");
            setShareText(null);
          }}
        />
      )}
      <AmountInput label="Target" text={targetText} currency={cur} onChange={setTargetText} />
      <label className="field">
        By
        <input type="date" value={byOn} min={addDays(today, 1)} onChange={(e) => setByOn(e.target.value)} />
      </label>
      <AmountInput
        label="Already saved for it"
        text={startText}
        currency={cur}
        onChange={setStartText}
        hint={`Part of your savings now (${formatMoney(savingsMinor, cur)}). It takes no money.`}
      />
      {problems
        .filter((p) => PROBLEM[p] && !(p === "target" && targetText === "") && !(p === "name" && name === ""))
        .map((p) => (
          <p key={p} className="small bad">
            {PROBLEM[p]}
          </p>
        ))}
    </>
  );

  if (!editing) {
    const draft = { currency: cur, targetMinor, byOn, startMinor, movedMinor: 0 };
    const fair =
      problems.length === 0
        ? fairShareMinor(draft, {
            startedOn: data.cycle.startedOn,
            usualPayDay: data.settings.usualPayDay,
            nextSalaryOn: data.cycle.expectedSalaryOn,
          })
        : 0;
    const share = shareText === null ? fair : amountOf(shareText, cur);
    const shareOk =
      Number.isSafeInteger(share) && share >= 0 && share <= Math.max(0, targetMinor - startMinor);
    const entries = entriesOf(data);
    const after = todayView(
      share > 0
        ? {
            ...entries,
            commitments: [
              ...entries.commitments,
              { dueOn: today, currency: cur, plannedMinor: share, state: "open" as const, payments: [] },
            ],
          }
        : entries,
      today,
    );
    return (
      <>
        {back}
        <h1>New goal</h1>
        <section className="card stack">{form}</section>
        {problems.length === 0 && (
          <section className="card stack">
            <h3>This cycle's share</h3>
            <AmountInput
              label="Set aside now"
              text={shareText ?? toText(fair, cur)}
              currency={cur}
              onChange={setShareText}
              hint="The fair share: what is left over the salary days before the date. 0 starts on the next salary day."
            />
            <p className="small" data-testid="goal-after">
              You can spend today after this:{" "}
              <b>{formatMoney(after.allowanceMinor, data.settings.spendingCurrency)}</b>
            </p>
          </section>
        )}
        {failed && <p className="error">Not saved. Check the connection and try again.</p>}
        <button
          type="button"
          className="btn pri"
          disabled={busy || problems.length > 0 || !shareOk}
          onClick={() => run(() => actions.add({ ...fields, currency: cur }, share), true)}
        >
          Save
        </button>
      </>
    );
  }

  const g = editing;
  const entry = goalEntry(data, g);
  const saved = goalSavedMinor(entry);
  const takenOut = entry.takenOutMinor ?? 0;
  const spent = entry.spentMinor ?? 0;
  const left = goalUnspentMinor(entry);
  // Its spends and take-outs, newest first (`data.savings` is newest first).
  const outs = data.savings.filter(
    (l) => l.goalId === g.id && (l.kind === "goal_spend" || l.kind === "take_out"),
  );
  const status = statusOf(data, g, today);
  const changed =
    fields.name !== g.name || targetMinor !== g.targetMinor || byOn !== g.byOn || startMinor !== g.startMinor;
  const shares = [
    ...sharesNow(data, g).map((c) => ({
      id: c.id,
      startedOn: data.cycle.startedOn,
      plannedMinor: c.plannedMinor,
      coveredMinor: coveredMinor(c),
      state: c.state,
    })),
    ...g.shares.filter((s) => s.cycleId !== data.cycle.id),
  ];
  return (
    <>
      {back}
      <h1>{g.name}</h1>
      <section className="card stack">
        <p className="big" data-testid="goal-progress">
          {progressText(saved, g)}
        </p>
        <Bar saved={saved} g={g} />
        <p className="small" data-testid="goal-status">
          By {dayLabel(g.byOn)} · {statusText(status, g.currency)}
        </p>
        {g.startMinor > 0 && (
          <p className="tiny mute">{formatMoney(g.startMinor, g.currency)} already saved when made</p>
        )}
        {(entry.takenOutMinor ?? 0) > 0 && (
          <p className="tiny mute" data-testid="goal-taken-out">
            {formatMoney(entry.takenOutMinor ?? 0, g.currency)} taken out of it
          </p>
        )}
        {left > 0 && (
          <a className="btn link" href={`#GoalSpend/${g.id}`}>
            Spend from this goal
          </a>
        )}
      </section>
      <section className="card" aria-labelledby="goal-money-h">
        <h3 id="goal-money-h">Saved · Spent · Left</h3>
        <div className="li" data-testid="goal-saved">
          <span className="grow">Saved</span>
          <b className="small">{formatMoney(g.startMinor + entry.movedMinor, g.currency)}</b>
        </div>
        {takenOut > 0 && (
          <div className="li" data-testid="goal-total-taken-out">
            <span className="grow">Taken out</span>
            <b className="small">{formatMoney(takenOut, g.currency)}</b>
          </div>
        )}
        <div className="li" data-testid="goal-spent">
          <span className="grow">Spent</span>
          <b className="small">{formatMoney(spent, g.currency)}</b>
        </div>
        <div className="li" data-testid="goal-left">
          <span className="grow">Left</span>
          <b className="small">{formatMoney(left, g.currency)}</b>
        </div>
        {outs.map((l) => (
          <div key={l.id} className="li" data-testid="goal-out">
            <span className="date">
              <b>{dayLabel(l.on)}</b>
            </span>
            <span className="grow">{l.kind === "goal_spend" ? (l.note ?? "Spent") : "Taken out"}</span>
            <b className="small bad">−{formatMoney(-l.amountMinor, g.currency)}</b>
          </div>
        ))}
      </section>
      <section className="card" aria-labelledby="shares-h">
        <h3 id="shares-h">Shares</h3>
        {shares.length === 0 && <p className="tiny mute">None yet.</p>}
        {shares.map((s) => (
          <div key={s.id} className="li" data-testid="goal-share">
            <span className="date">
              <b>{dayLabel(s.startedOn)}</b>
            </span>
            <span className="grow">
              {s.state === "open"
                ? "Set aside"
                : s.state === "finished"
                  ? "Moved"
                  : s.state === "carried"
                    ? "Carried"
                    : "Dropped"}
              <span className="tiny mute block">of {formatMoney(s.plannedMinor, g.currency)}</span>
            </span>
            <b className="small">{formatMoney(s.coveredMinor, g.currency)}</b>
          </div>
        ))}
      </section>
      <section className="card stack">{form}</section>
      {failed && <p className="error">Not saved. Check the connection and try again.</p>}
      <div className="row">
        <button
          type="button"
          className="btn pri grow"
          disabled={busy || !changed || problems.length > 0}
          onClick={() => run(() => actions.change(g, fields))}
        >
          Save changes
        </button>
      </div>
      <div className="row">
        {g.stopped ? (
          <button
            type="button"
            className="btn grow"
            disabled={busy}
            onClick={() => run(() => actions.startAgain(g))}
          >
            Start this goal again
          </button>
        ) : (
          <button
            type="button"
            className="btn grow"
            disabled={busy}
            onClick={() => run(() => actions.stop(g))}
          >
            Stop this goal
          </button>
        )}
        {entry.movedMinor === 0 && !takenOut && !spent && (
          <button
            type="button"
            className="btn grow"
            disabled={busy}
            onClick={() => run(() => actions.remove(g), true)}
          >
            Delete
          </button>
        )}
      </div>
      {g.stopped && <p className="tiny mute">Stopped: salary day sets nothing aside for it.</p>}
    </>
  );
}

const SPEND_PROBLEM: Record<string, string> = {
  note: "Say what it was for.",
  too_much: "More than your savings in this currency.",
};

/**
 * Spend from this goal (spec 5, 10, SAB-75): amount, note (what it bought), the
 * place it was paid from; dated today. The money goes straight out of savings to
 * the thing bought, not through free money, so the allowance stays as it is.
 * At most what is left in the goal: past that it is a normal spend.
 */
export function GoalSpendPage({ data, goal, actions }: { data: Ready; goal: Goal; actions: GoalActions }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const cur = goal.currency;
  const entry = goalEntry(data, goal);
  const left = goalUnspentMinor(entry);
  const amountMinor = amountOf(text, cur);
  const place = usePlaceChoice(data.places, cur, "out");
  const problems = checkGoalSpend(
    { currency: cur, amountMinor, note },
    entry,
    savingsTotal(data.savings, cur),
  );
  const shown = problems.filter(
    (p) =>
      !(p === "note" && note === "") &&
      p !== "amount" &&
      p !== "goal" &&
      // One "too much" line: the goal's, when both are over.
      !(p === "too_much" && problems.includes("goal_too_much")),
  );

  async function save() {
    setBusy(true);
    setFailed(false);
    place.remember();
    const done = await actions.spend(goal, amountMinor, note.trim(), place.placeId);
    setBusy(false);
    if (done) window.location.hash = `Goal/${goal.id}`;
    else setFailed(true);
  }

  return (
    <>
      <div className="row">
        <a className="btn ghost link" href={`#Goal/${goal.id}`}>
          ← Back
        </a>
      </div>
      <h1>Spend from {goal.name}</h1>
      <section className="card stack">
        <p className="small" data-testid="goal-spend-left">
          {formatMoney(left, cur)} left in this goal
        </p>
        <AmountInput label="Amount" text={text} currency={cur} onChange={setText} />
        <label className="field">
          What for
          <input
            value={note}
            maxLength={GOAL_SPEND_NOTE_MAX}
            placeholder="Flights, the hotel…"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <PlaceChoice label="Paid from" choice={place} />
        {problems.includes("goal_too_much") && (
          <p className="small bad" data-testid="goal-spend-too-much">
            Only {formatMoney(left, cur)} left in this goal. Spend the rest as a normal spend.
          </p>
        )}
        {shown
          .filter((p) => SPEND_PROBLEM[p])
          .map((p) => (
            <p key={p} className="small bad">
              {SPEND_PROBLEM[p]}
            </p>
          ))}
        <p className="tiny mute">
          Straight out of savings: what you can spend today stays the same. It still counts as saved toward
          the goal.
        </p>
      </section>
      {failed && <p className="error">Not saved. Check the connection and try again.</p>}
      <button type="button" className="btn pri" disabled={busy || problems.length > 0} onClick={save}>
        Spend from this goal
      </button>
    </>
  );
}
