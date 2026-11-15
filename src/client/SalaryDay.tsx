import { useState } from "react";
import {
  addDays,
  broughtIn,
  type CloseInput,
  type ComingUpEntry,
  checkCycleClose,
  checkSalaryDay,
  cycleSpeeds,
  formatMoney,
  isComingUp,
  leftoverOf,
  type OverspendChoice,
  parseAmount,
  type SalaryDayInput,
  salaryDayDrafts,
  salaryDayView,
  stillToPayMinor,
  suggestSalaryDay,
  type UnpaidChoice,
  unpaidAtEnd,
} from "../money";
import { api } from "./api";
import { CommitmentsStep, type PotRow, PotsStep, type Row, typedOk } from "./CycleSteps";
import { dayLabel, entriesOf, potEntry, type Ready, useToday } from "./data";
import { newId } from "./id";
import { toText } from "./SpendSheet";
import type { Toaster } from "./toast";
import { VerdictChip } from "./Verdict";

const ok = async (res: Promise<Response | { ok: boolean }>) => (await res.catch(() => null))?.ok ?? false;

type Body = Parameters<(typeof api.api)["salary-day"]["$post"]>[0]["json"];

/** Start new cycle; on success a toast with Undo salary day (item 13; also on Plan while allowed). */
export function salaryDayActions({ done }: Toaster) {
  return {
    start: (body: Body) =>
      ok(api.api["salary-day"].$post({ json: body })).then((started) =>
        done(started, {
          text: "New cycle started",
          undo: () => ok(api.api["salary-day"].undo.$post({ json: { cycleId: body.cycleId } })),
        }),
      ),
  };
}

export type SalaryDayActions = ReturnType<typeof salaryDayActions>;

const STEPS = [1, 2, 3, 4, 5, 6, 7] as const;
type Step = (typeof STEPS)[number];
const TITLES: Record<Step, string> = {
  1: "Salary",
  2: "Last cycle's unpaid commitments",
  3: "Last cycle's leftover",
  4: "This cycle's commitments",
  5: "Pots",
  6: "Next salary day",
  7: "Summary",
};

const CHOICES: { choice: UnpaidChoice; label: string }[] = [
  { choice: "paid", label: "Paid it" },
  { choice: "carry", label: "Carry to new cycle" },
  { choice: "drop", label: "Drop" },
];

const OVERSPEND: { choice: OverspendChoice; label: string }[] = [
  { choice: "take", label: "Take it from the new cycle" },
  { choice: "ignore", label: "Ignore it" },
];

/**
 * Salary day (spec 6): Salary → last cycle's unpaid commitments (Paid it ·
 * Carry · Drop) → its leftover, dropped ones' money included (correct and
 * split, or the overspend choice) → this cycle's commitments (filled from the recurring ones and last cycle's
 * coming-up ones) → pots → expected next salary day → summary with the gap
 * warning → Start new cycle. One step per screen.
 */
export function SalaryDayPage({ data, actions }: { data: Ready; actions: SalaryDayActions }) {
  const cur = data.settings.spendingCurrency;
  const today = useToday(data.settings.homeTimeZone);
  const [step, setStep] = useState<Step>(1);
  const [salaryText, setSalaryText] = useState("");
  const [receivedOn, setReceivedOn] = useState(today);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pots, setPots] = useState<PotRow[]>(() =>
    data.pots
      .filter((p) => !p.archived)
      .map((p) => ({
        id: p.id,
        allocationId: newId(),
        name: p.name,
        text: toText(p.usualAmountMinor, cur),
        isNew: false,
      })),
  );
  const [expected, setExpected] = useState(() => suggestSalaryDay(today, data.settings.usualPayDay));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Steps 2 and 3.
  const [closeIds] = useState(() => ({ closeId: newId(), leftoverIncomeId: newId() }));
  const [choices, setChoices] = useState<Record<string, { choice: UnpaidChoice; newId: string }>>({});
  const [inHandText, setInHandText] = useState("");
  const [toSavingsText, setToSavingsText] = useState("");
  const [overspend, setOverspend] = useState<OverspendChoice | null>(null);

  const money = (m: number) => formatMoney(m, cur);
  const amount = (t: string) => parseAmount(t, cur) ?? -1;
  const input: SalaryDayInput = {
    salaryMinor: parseAmount(salaryText, cur) ?? 0,
    receivedOn,
    expectedSalaryOn: expected,
    commitments: (rows ?? []).map((r) => ({ name: r.name, plannedMinor: amount(r.text), dueOn: r.dueOn })),
    pots: pots.map((p) => ({ name: p.name, usualAmountMinor: amount(p.text), amountMinor: amount(p.text) })),
  };
  const problems = checkSalaryDay(input, {
    today,
    cycleStartedOn: data.cycle.startedOn,
    spendingCurrency: cur,
  });

  // Steps 2 and 3: the cycle that ends is still the current one.
  const unpaid = unpaidAtEnd(data.commitments, data.cycle.expectedSalaryOn);
  const chosen = unpaid.flatMap((k) => {
    const c = choices[k.id];
    return c ? [{ id: k.id, choice: c.choice, newId: c.newId }] : [];
  });
  const leftover = leftoverOf(entriesOf(data), chosen);
  const overspent = leftover.leftoverMinor < 0;
  const closeInput: CloseInput = {
    unpaid: chosen.map(({ id, choice }) => ({ id, choice })),
    inHandMinor: overspent || inHandText === "" ? null : (parseAmount(inHandText, cur) ?? -1),
    toSavingsMinor: overspent || toSavingsText === "" ? 0 : (parseAmount(toSavingsText, cur) ?? -1),
    overspend: overspent ? overspend : null,
  };
  for (const p of checkCycleClose(closeInput, { unpaidIds: unpaid.map((k) => k.id), leftover })) {
    problems.push(`close.${p}`);
  }
  const brought = broughtIn(closeInput, leftover);
  const kept = closeInput.inHandMinor ?? leftover.leftoverMinor;
  const carried = unpaid
    .filter((k) => choices[k.id]?.choice === "carry")
    .map((k) => ({ ...k, plannedMinor: stillToPayMinor(k), payments: [] }));
  const has = (prefix: string) => problems.some((p) => p.startsWith(prefix));

  /** Step 4's rows, filled once the day received is known. */
  function fill(): Row[] {
    const comingUp: ComingUpEntry[] = data.commitments
      .filter(
        (c) => isComingUp(c, data.cycle.expectedSalaryOn) && (c.kind === "bill" || c.kind === "savings"),
      )
      .map((c) => ({ ...c, kind: c.kind as "bill" | "savings" }));
    return salaryDayDrafts({ recurring: data.recurring, comingUp, startedOn: receivedOn }).map((d) => ({
      ...d,
      id: newId(),
      text: toText(d.plannedMinor, cur),
    }));
  }

  const go = (to: Step) => {
    if (to === 4 && rows === null) setRows(fill());
    setStep(to);
    window.scrollTo(0, 0);
  };
  const at = STEPS.indexOf(step);
  const next = () => go(STEPS[at + 1] as Step);
  const back = () => go(STEPS[at - 1] as Step);
  const typed = (t: string) => typedOk(t, cur);

  // The cycle that ends: its speed is the new cycle's in its first days (spec 7).
  const ended = cycleSpeeds(
    { spendingCurrency: cur, spends: data.spends, pots: data.pots.map(potEntry) },
    data.cycle.startedOn,
    receivedOn,
  ).speed;
  const view = salaryDayView({
    input,
    spendingCurrency: cur,
    today,
    lastSpeed: ended.days > 0 ? ended : null,
    broughtIn: brought,
    carried,
  });

  async function start() {
    setBusy(true);
    setFailed(false);
    const done = await actions.start({
      cycleId: newId(),
      incomeId: newId(),
      salaryMinor: input.salaryMinor,
      receivedOn,
      expectedSalaryOn: expected,
      commitments: (rows ?? []).map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        plannedMinor: amount(r.text),
        dueOn: r.dueOn,
        recurringId: r.everyCycle ? (r.recurringId ?? newId()) : r.recurringId,
        everyCycle: r.everyCycle,
        carriedFromId: r.carriedFromId,
      })),
      pots: pots.map((p) => ({
        id: p.id,
        allocationId: p.allocationId,
        amountMinor: amount(p.text),
        ...(p.isNew ? { name: p.name, usualAmountMinor: amount(p.text) } : {}),
      })),
      close: { ...closeIds, ...closeInput, unpaid: chosen },
    });
    setBusy(false);
    if (done) window.location.hash = "Today";
    else setFailed(true);
  }

  const setAside = [...input.commitments, ...carried]
    .filter((c) => c.dueOn <= expected)
    .reduce((t, c) => t + Math.max(0, c.plannedMinor), 0);
  const fromLast = brought.amountMinor - brought.toSavingsMinor;
  const potsTotal = input.pots.reduce((t, p) => t + Math.max(0, p.amountMinor), 0);

  return (
    <>
      <div className="row">
        <a className="btn ghost link" href="#Plan">
          ← Back
        </a>
      </div>
      <p className="tiny mute">
        Salary day · step {at + 1} of {STEPS.length}
      </p>
      <h1>{TITLES[step]}</h1>

      {step === 1 && (
        <section className="card stack">
          <label className="field">
            Salary ({data.settings.salaryCurrency})
            <input
              value={salaryText}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              onChange={(e) => typed(e.target.value) && setSalaryText(e.target.value)}
            />
          </label>
          <label className="field">
            Date received
            <input
              type="date"
              value={receivedOn}
              min={data.cycle.startedOn}
              max={today}
              onChange={(e) => setReceivedOn(e.target.value)}
            />
            <span className="tiny mute">
              {receivedOn === today ? "Today" : dayLabel(receivedOn)}. The new cycle starts on this day; the
              one from {dayLabel(data.cycle.startedOn, false)} ends and is locked.
            </span>
          </label>
          {has("received_on") && (
            <p className="tiny bad">Pick a day from {dayLabel(data.cycle.startedOn)} up to today.</p>
          )}
        </section>
      )}

      {step === 3 && !overspent && (
        <section className="card stack" aria-label="Leftover">
          <div className="li">
            <span className="grow">Free money left</span>
            <b>{money(leftover.freeMinor)}</b>
          </div>
          <div className="li">
            <span className="grow">Left in pots</span>
            <b>{money(leftover.potsMinor)}</b>
          </div>
          {leftover.droppedMinor > 0 && (
            <div className="li">
              <span className="grow">Bills dropped</span>
              <b>{money(leftover.droppedMinor)}</b>
            </div>
          )}
          <div className="li">
            <span className="grow">Leftover</span>
            <b data-testid="leftover">{money(leftover.leftoverMinor)}</b>
          </div>
          <label className="field">
            Actually have in hand ({cur})
            <input
              value={inHandText}
              inputMode="decimal"
              autoComplete="off"
              placeholder={toText(leftover.leftoverMinor, cur)}
              onChange={(e) => typed(e.target.value) && setInHandText(e.target.value)}
            />
            <span className="tiny mute">Change it if some spends were never entered.</span>
          </label>
          {has("close.in_hand") && <p className="tiny bad">Type a plain amount.</p>}
          <label className="field">
            To savings ({cur})
            <input
              value={toSavingsText}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              onChange={(e) => typed(e.target.value) && setToSavingsText(e.target.value)}
            />
          </label>
          {has("close.to_savings") && <p className="tiny bad">At most {money(Math.max(0, kept))}.</p>}
          <div className="li">
            <span className="grow">To the new cycle</span>
            <b data-testid="leftover-to-cycle">
              {money(Math.max(0, kept - Math.max(0, closeInput.toSavingsMinor)))}
            </b>
          </div>
        </section>
      )}

      {step === 3 && overspent && (
        <section className="card stack" aria-label="Overspend">
          <p>
            You spent <b data-testid="overspend">{money(-leftover.leftoverMinor)}</b> more than your free
            money last cycle.
          </p>
          <div className="row" role="radiogroup" aria-label="Overspend">
            {OVERSPEND.map((o) => (
              <button
                key={o.choice}
                type="button"
                role="radio"
                aria-checked={overspend === o.choice}
                className={overspend === o.choice ? "btn pri grow" : "btn grow"}
                onClick={() => setOverspend(o.choice)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <>
          <p className="mute">
            {unpaid.length === 0
              ? "Nothing left unpaid."
              : "For each one: paid it, carry it to the new cycle (shown as late), or drop it."}
          </p>
          {unpaid.map((k) => {
            const rest = stillToPayMinor(k);
            const pick = choices[k.id]?.choice;
            return (
              <section key={k.id} className="card stack" aria-label={k.name}>
                <div className="li">
                  <span className="grow">
                    {k.name}
                    <span className="tiny mute block">Due {dayLabel(k.dueOn)}</span>
                  </span>
                  <b>{money(rest)}</b>
                </div>
                <div className="row" role="radiogroup" aria-label={`What happened to ${k.name}`}>
                  {CHOICES.map((c) => (
                    <button
                      key={c.choice}
                      type="button"
                      role="radio"
                      aria-checked={pick === c.choice}
                      className={pick === c.choice ? "btn pri grow" : "btn grow"}
                      onClick={() =>
                        setChoices((cs) => ({
                          ...cs,
                          [k.id]: { choice: c.choice, newId: cs[k.id]?.newId ?? newId() },
                        }))
                      }
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                {pick === "drop" && rest > 0 && (
                  <p className="tiny mute">{money(rest)} joins the leftover (next step).</p>
                )}
              </section>
            );
          })}
        </>
      )}

      {step === 4 && rows && (
        <>
          <p className="mute">Filled from your Every cycle list. Change any, remove any, or add more.</p>
          {rows.length === 0 && <p className="tiny mute">Nothing to fill in yet.</p>}
          <CommitmentsStep
            rows={rows}
            setRows={(f) => setRows((rs) => f(rs ?? []))}
            cur={cur}
            startedOn={receivedOn}
            expected={expected}
            has={has}
          />
        </>
      )}

      {step === 5 && <PotsStep pots={pots} setPots={setPots} cur={cur} has={has} />}

      {step === 6 && (
        <section className="card stack">
          <label className="field">
            Expected next salary day
            <input
              type="date"
              value={expected}
              min={addDays(today, 1)}
              onChange={(e) => setExpected(e.target.value)}
            />
            <span className="tiny mute">{dayLabel(expected)} · suggested from your usual pay day.</span>
          </label>
          {has("expected_salary_on") && <p className="tiny bad">Pick a day after today.</p>}
        </section>
      )}

      {step === 7 && (
        <>
          <section className="card" aria-label="Summary">
            <div className="li">
              <span className="grow">Salary</span>
              <b>{money(input.salaryMinor)}</b>
            </div>
            {fromLast !== 0 && (
              <div className="li">
                <span className="grow">From last cycle</span>
                <b data-testid="salary-day-from-last">{money(fromLast)}</b>
              </div>
            )}
            <div className="li">
              <span className="grow">Commitments set aside</span>
              <b>{money(setAside)}</b>
            </div>
            <div className="li">
              <span className="grow">Pots</span>
              <b>{money(potsTotal)}</b>
            </div>
            <div className="li">
              <span className="grow">Free money</span>
              <b data-testid="salary-day-free">{money(view.today.freeMinor)}</b>
            </div>
            <div className="li">
              <span className="grow">Days to salary</span>
              <b>{view.today.daysLeft}</b>
            </div>
            <div className="li">
              <span className="grow">Daily allowance</span>
              <b data-testid="salary-day-allowance">{money(view.today.allowanceMinor)}</b>
            </div>
            <div className="li">
              <span className="grow">Verdict</span>
              <VerdictChip verdict={view.today.verdict} currency={cur} />
            </div>
          </section>
          {view.gapMinor > 0 && (
            <p className="error" role="alert" data-testid="salary-day-gap">
              Set-asides are {money(view.gapMinor)} more than the salary. Lower a commitment or a pot, or take
              money out of savings.
            </p>
          )}
          {problems.length > 0 && (
            <p className="tiny bad">Something earlier needs fixing; go back and check.</p>
          )}
          {failed && <p className="error">Not saved. Check the connection and try again.</p>}
        </>
      )}

      <div className="row">
        {at > 0 && (
          <button type="button" className="btn" onClick={back} disabled={busy}>
            Back
          </button>
        )}
        {step === 7 ? (
          <button
            type="button"
            className="btn pri grow"
            onClick={start}
            disabled={busy || problems.length > 0}
          >
            Start new cycle
          </button>
        ) : (
          <button
            type="button"
            className="btn pri grow"
            onClick={next}
            disabled={
              (step === 1 && (input.salaryMinor <= 0 || has("salary") || has("received_on"))) ||
              (step === 2 && has("close.unpaid")) ||
              (step === 3 && (has("close.in_hand") || has("close.to_savings") || has("close.overspend"))) ||
              (step === 4 && has("commitment.")) ||
              (step === 5 && has("pot.")) ||
              (step === 6 && has("expected_salary_on"))
            }
          >
            Next
          </button>
        )}
      </div>
    </>
  );
}
