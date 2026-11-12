import { useMemo, useState } from "react";
import {
  addDays,
  checkFirstUse,
  dailyAllowance,
  daysLeft,
  formatMoney,
  parseAmount,
  suggestSalaryDay,
  todayIn,
} from "../money";
import { api } from "./api";
import { authClient } from "./auth";
import { dayLabel, phoneTimeZone, timeZones } from "./data";
import { newId } from "./id";

const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });
const currencies = Intl.supportedValuesOf("currency");

/**
 * First use (spec 2): the salary-day steps with "money you have now" in step 1
 * and the leftover steps skipped. One currency until item 15; bills and pots
 * join the steps with items 5 and 7.
 */
export function FirstUse({ onDone, onSignedOut }: { onDone: () => void; onSignedOut: () => void }) {
  const [step, setStep] = useState(1);
  const [currency, setCurrency] = useState("LKR");
  const [timeZone, setTimeZone] = useState(phoneTimeZone);
  const [payDay, setPayDay] = useState(25);
  const [held, setHeld] = useState("");
  const [salaryOn, setSalaryOn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => timeZones(timeZone), [timeZone]);

  const today = todayIn(timeZone, Date.now());
  const heldMinor = parseAmount(held, currency);
  const expected = salaryOn ?? suggestSalaryDay(today, payDay);
  const days = daysLeft(today, expected);
  const input = {
    salaryCurrency: currency,
    spendingCurrency: currency,
    homeTimeZone: timeZone,
    usualPayDay: payDay,
    heldMinor: heldMinor ?? -1,
    expectedSalaryOn: expected,
  };
  const problems = checkFirstUse(input, today);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.api["first-use"].$post({
        json: { ...input, settingsId: newId(), cycleId: newId(), incomeId: newId() },
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
      <p className="tiny mute">Step {step} of 4</p>
      {step === 1 && (
        <section className="stack" aria-labelledby="fu-h">
          <h1 id="fu-h">Welcome to Setaside</h1>
          <p className="mute">
            A few things first. You can change the pay day and time zone later in Settings.
          </p>
          <label className="field">
            Currency
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c} · {currencyNames.of(c)}
                </option>
              ))}
            </select>
            <span className="tiny mute">Salary and spending in one currency for now.</span>
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
          <button type="button" className="btn pri" onClick={() => setStep(2)}>
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
          <div className="row">
            <button type="button" className="btn" onClick={() => setStep(1)}>
              Back
            </button>
            <button
              type="button"
              className="btn pri grow"
              disabled={heldMinor === null}
              onClick={() => setStep(3)}
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
            <button type="button" className="btn" onClick={() => setStep(2)}>
              Back
            </button>
            <button
              type="button"
              className="btn pri grow"
              disabled={problems.includes("expected_salary_on")}
              onClick={() => setStep(4)}
            >
              Next
            </button>
          </div>
        </section>
      )}

      {step === 4 && heldMinor !== null && (
        <section className="stack" aria-labelledby="fu-h">
          <h1 id="fu-h">Summary</h1>
          <div className="card">
            <div className="li">
              <span className="grow">Free money</span>
              <b>{formatMoney(heldMinor, currency)}</b>
            </div>
            <div className="li">
              <span className="grow">Days to salary</span>
              <b>{days}</b>
            </div>
            <div className="li">
              <span className="grow">Daily allowance</span>
              <b>{formatMoney(dailyAllowance(heldMinor, days, currency), currency)}</b>
            </div>
          </div>
          <p className="tiny mute">
            This first cycle runs from today to {dayLabel(expected)}. Bills and pots come in later build
            steps.
          </p>
          <div className="row">
            <button type="button" className="btn" onClick={() => setStep(3)} disabled={busy}>
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
