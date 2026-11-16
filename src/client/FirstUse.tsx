import { useMemo, useState } from "react";
import {
  addDays,
  checkFirstUse,
  firstUseView,
  formatMoney,
  parseAmount,
  parseRate,
  suggestSalaryDay,
  todayIn,
} from "../money";
import { api } from "./api";
import { authClient } from "./auth";
import { CommitmentsStep, type PotRow, PotsStep, type Row } from "./CycleSteps";
import { dayLabel, phoneTimeZone, timeZones } from "./data";
import { newId } from "./id";

const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });
const currencies = Intl.supportedValuesOf("currency");

const STEPS = 6;

/**
 * First use (spec 2): settings → money you have now → next salary day → the
 * bills still unpaid before it → pots → summary. Bills and pots are salary
 * day's steps 4 and 5 (shared in CycleSteps). Two currencies (spec 8): money
 * held in each, and the counting rate.
 */
export function FirstUse({ onDone, onSignedOut }: { onDone: () => void; onSignedOut: () => void }) {
  const [step, setStep] = useState(1);
  const [currency, setCurrency] = useState("LKR");
  const [salaryCurrency, setSalaryCurrency] = useState("LKR");
  const [heldSalary, setHeldSalary] = useState("");
  const [rateText, setRateText] = useState("");
  const [timeZone, setTimeZone] = useState(phoneTimeZone);
  const [payDay, setPayDay] = useState(25);
  const [held, setHeld] = useState("");
  const [salaryOn, setSalaryOn] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [pots, setPots] = useState<PotRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => timeZones(timeZone), [timeZone]);

  const today = todayIn(timeZone, Date.now());
  const heldMinor = parseAmount(held, currency);
  const two = salaryCurrency !== currency;
  const heldSalaryMinor = two ? parseAmount(heldSalary || "0", salaryCurrency) : 0;
  const countingRate = two ? parseRate(rateText) : null;
  const currencyList = two ? [currency, salaryCurrency] : [currency];
  const expected = salaryOn ?? suggestSalaryDay(today, payDay);
  // Each row's currency must still be one of the user's (the currencies can change in step 1).
  const rowCur = (c: string) => (currencyList.includes(c) ? c : currency);
  const amount = (t: string, c: string) => parseAmount(t, rowCur(c)) ?? -1;
  const bills = rows.map((r) => ({
    name: r.name,
    currency: rowCur(r.currency),
    plannedMinor: amount(r.text, r.currency),
    dueOn: r.dueOn,
  }));
  const potAmounts = pots.map((p) => ({
    name: p.name,
    currency: rowCur(p.currency),
    amountMinor: amount(p.text, p.currency),
  }));
  const input = {
    salaryCurrency,
    spendingCurrency: currency,
    homeTimeZone: timeZone,
    usualPayDay: payDay,
    heldMinor: heldMinor ?? -1,
    ...(two ? { heldSalaryMinor: heldSalaryMinor ?? -1, countingRate } : {}),
    expectedSalaryOn: expected,
    commitments: bills,
    pots: potAmounts,
  };
  const problems = checkFirstUse(input, today);
  const has = (prefix: string) => problems.some((p) => p.startsWith(prefix));
  const view = firstUseView({
    heldMinor: heldMinor ?? 0,
    spendingCurrency: currency,
    salaryCurrency,
    heldSalaryMinor: heldSalaryMinor ?? 0,
    countingRate,
    today,
    expectedSalaryOn: expected,
    commitments: bills,
    pots: potAmounts,
  });
  const money = (m: number) => formatMoney(m, currency);
  const go = (to: number) => {
    setStep(to);
    window.scrollTo(0, 0);
  };

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.api["first-use"].$post({
        json: {
          ...input,
          settingsId: newId(),
          cycleId: newId(),
          incomeId: newId(),
          ...(two ? { salaryIncomeId: newId(), countingRateId: newId() } : {}),
          commitments: rows.map((r) => ({
            id: r.id,
            name: r.name,
            currency: rowCur(r.currency),
            plannedMinor: amount(r.text, r.currency),
            dueOn: r.dueOn,
            // "Every cycle" on: a template is made with the bill.
            recurringId: r.everyCycle ? newId() : null,
          })),
          pots: pots.map((p) => ({
            id: p.id,
            allocationId: p.allocationId,
            name: p.name,
            currency: rowCur(p.currency),
            amountMinor: amount(p.text, p.currency),
          })),
        },
      });
      // 409: already set up (another phone finished first use): just show Today.
      if (!res.ok && res.status !== 409) throw new Error();
      onDone();
    } catch {
      setError("Couldn't save. Check the connection and try again.");
      setBusy(false);
    }
  }

  async function signOut() {
    await authClient.signOut();
    onSignedOut();
  }

  return (
    <main className="first-use">
      <p className="tiny mute">
        Step {step} of {STEPS}
      </p>
      {step === 1 && (
        <section className="stack" aria-labelledby="fu-h">
          <h1 id="fu-h">Welcome to Setaside</h1>
          <p className="mute">
            A few things first. You can change the pay day and time zone later in Settings.
          </p>
          <label className="field">
            Spending currency
            <select
              value={currency}
              onChange={(e) => {
                // Same as before: keep salary and spending together until the user splits them.
                if (salaryCurrency === currency) setSalaryCurrency(e.target.value);
                setCurrency(e.target.value);
              }}
            >
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c} · {currencyNames.of(c)}
                </option>
              ))}
            </select>
            <span className="tiny mute">What you spend day to day in. Set once.</span>
          </label>
          <label className="field">
            Salary currency
            <select value={salaryCurrency} onChange={(e) => setSalaryCurrency(e.target.value)}>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c} · {currencyNames.of(c)}
                </option>
              ))}
            </select>
            <span className="tiny mute">What your salary is paid in. Often the same. Set once.</span>
          </label>
          <label className="field">
            Home time zone
            <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <span className="tiny mute">Decides when your day starts.</span>
          </label>
          <label className="field">
            Usual pay day
            <select
              value={payDay}
              onChange={(e) => {
                setPayDay(Number(e.target.value));
                setSalaryOn(null);
              }}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <span className="tiny mute">Day of the month the salary usually comes.</span>
          </label>
          <button type="button" className="btn pri" onClick={() => go(2)}>
            Next
          </button>
        </section>
      )}

      {step === 2 && (
        <section className="stack" aria-labelledby="fu-h">
          <h1 id="fu-h">Money you have now</h1>
          <p className="mute">Cash and bank money you can use until the next salary.</p>
          <label className="field">
            Amount ({currency})
            <input
              inputMode="decimal"
              autoComplete="off"
              value={held}
              onChange={(e) => setHeld(e.target.value)}
              placeholder="0"
            />
            {held !== "" && heldMinor === null && (
              <span className="tiny bad">Type a plain amount, like 85000.</span>
            )}
          </label>
          {two && (
            <>
              <label className="field">
                Amount ({salaryCurrency})
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  value={heldSalary}
                  onChange={(e) => setHeldSalary(e.target.value)}
                  placeholder="0"
                />
                {heldSalaryMinor === null && <span className="tiny bad">Type a plain amount.</span>}
              </label>
              <label className="field">
                Counting rate ({currency} for 1 {salaryCurrency})
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  value={rateText}
                  onChange={(e) => setRateText(e.target.value)}
                  placeholder="0"
                />
                <span className="tiny mute">
                  {salaryCurrency} you haven't changed yet count toward free money at this rate. Your bank's
                  rate today is fine; you can change it any time in Settings.
                </span>
                {rateText !== "" && countingRate === null && (
                  <span className="tiny bad">Type a plain rate above zero, like 302.50.</span>
                )}
              </label>
            </>
          )}
          <div className="row">
            <button type="button" className="btn" onClick={() => go(1)}>
              Back
            </button>
            <button
              type="button"
              className="btn pri grow"
              disabled={heldMinor === null || (two && (heldSalaryMinor === null || countingRate === null))}
              onClick={() => go(3)}
            >
              Next
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="stack" aria-labelledby="fu-h">
          <h1 id="fu-h">Next salary day</h1>
          <p className="mute">When do you expect the next salary? Suggested from your usual pay day.</p>
          <label className="field">
            Expected salary day
            <input
              type="date"
              value={expected}
              min={addDays(today, 1)}
              onChange={(e) => setSalaryOn(e.target.value || null)}
            />
            <span className="tiny mute">{dayLabel(expected)}</span>
          </label>
          {problems.includes("expected_salary_on") && <p className="tiny bad">Pick a day after today.</p>}
          <div className="row">
            <button type="button" className="btn" onClick={() => go(2)}>
              Back
            </button>
            <button
              type="button"
              className="btn pri grow"
              disabled={problems.includes("expected_salary_on")}
              onClick={() => go(4)}
            >
              Next
            </button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="stack" aria-labelledby="fu-h">
          <h1 id="fu-h">Bills still to pay</h1>
          <p className="mute">
            Only bills not yet paid that are due before {dayLabel(expected)}, like rent or the phone bill.
            Skip this if there are none.
          </p>
          {rows.length === 0 && <p className="tiny mute">No bills yet.</p>}
          <CommitmentsStep
            rows={rows}
            setRows={setRows}
            currencies={currencyList}
            startedOn={today}
            expected={expected}
            has={has}
            noun="bill"
          />
          <div className="row">
            <button type="button" className="btn" onClick={() => go(3)}>
              Back
            </button>
            <button
              type="button"
              className="btn pri grow"
              disabled={has("commitment.")}
              onClick={() => go(5)}
            >
              Next
            </button>
          </div>
        </section>
      )}

      {step === 5 && (
        <section className="stack" aria-labelledby="fu-h">
          <h1 id="fu-h">Pots</h1>
          <p className="mute">Money kept for things bought bit by bit until the salary, like groceries.</p>
          <PotsStep pots={pots} setPots={setPots} currencies={currencyList} has={has} />
          <div className="row">
            <button type="button" className="btn" onClick={() => go(4)}>
              Back
            </button>
            <button type="button" className="btn pri grow" disabled={has("pot.")} onClick={() => go(6)}>
              Next
            </button>
          </div>
        </section>
      )}

      {step === 6 && heldMinor !== null && (
        <section className="stack" aria-labelledby="fu-h">
          <h1 id="fu-h">Summary</h1>
          <div className="card">
            <div className="li">
              <span className="grow">Money you have</span>
              <b>{money(heldMinor)}</b>
            </div>
            {two && heldSalaryMinor !== null && (
              <div className="li">
                <span className="grow">and</span>
                <b>{formatMoney(heldSalaryMinor, salaryCurrency)}</b>
              </div>
            )}
            <div className="li">
              <span className="grow">Bills set aside</span>
              <b>{money(view.setAsideMinor)}</b>
            </div>
            <div className="li">
              <span className="grow">Pots</span>
              <b>{money(view.potsMinor)}</b>
            </div>
            <div className="li">
              <span className="grow">Free money</span>
              <b data-testid="first-use-free">{money(view.today.freeMinor)}</b>
            </div>
            <div className="li">
              <span className="grow">Days to salary</span>
              <b>{view.today.daysLeft}</b>
            </div>
            <div className="li">
              <span className="grow">Daily allowance</span>
              <b data-testid="first-use-allowance">{money(view.today.allowanceMinor)}</b>
            </div>
          </div>
          {view.gapMinor > 0 && (
            <p className="error" role="alert" data-testid="first-use-gap">
              Bills and pots are {money(view.gapMinor)} more than the money you have. Lower a bill or a pot,
              or start anyway.
            </p>
          )}
          <p className="tiny mute">This first cycle runs from today to {dayLabel(expected)}.</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => go(5)} disabled={busy}>
              Back
            </button>
            <button
              type="button"
              className="btn pri grow"
              onClick={start}
              disabled={busy || problems.length > 0}
            >
              Start
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}

      <button type="button" className="btn ghost sign-out-link" onClick={signOut}>
        Sign out
      </button>
    </main>
  );
}
