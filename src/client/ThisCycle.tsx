import { useState } from "react";
import {
  addDays,
  checkExpectedSalaryDay,
  checkSalaryAmount,
  formatMoney,
  lateSalaryDays,
  parseAmount,
} from "../money";
import { api } from "./api";
import { dayLabel, type Ready } from "./data";
import { toText } from "./SpendSheet";
import type { Toaster } from "./toast";

const ok = async (res: Promise<Response | { ok: boolean }>) => (await res.catch(() => null))?.ok ?? false;

const undo = (cycleId: string) => ok(api.api["salary-day"].undo.$post({ json: { cycleId } }));
const setSalary = (salaryMinor: number) => ok(api.api.salary.$patch({ json: { salaryMinor } }));
const setExpected = (expectedSalaryOn: string) => ok(api.api.cycle.$patch({ json: { expectedSalaryOn } }));

/**
 * Undo salary day, the salary amount and the expected salary day (item 13, spec 2).
 * Changes get the toast with Undo; Undo salary day itself has none (salary day can be done again).
 */
export function cycleActions({ done }: Toaster) {
  return {
    /** Undo salary day: the old cycle is current again. */
    undo: (cycleId: string) => undo(cycleId).then((ok) => done(ok, { text: "Salary day undone" })),
    salary: (oldMinor: number, newMinor: number) =>
      setSalary(newMinor).then((ok) => done(ok, { text: "Salary changed", undo: () => setSalary(oldMinor) })),
    expected: (oldDay: string, newDay: string, today: string) =>
      setExpected(newDay).then((ok) =>
        done(ok, {
          text: `Salary expected ${dayLabel(newDay)}`,
          // A late salary's old day is past: there is nothing to go back to.
          undo: oldDay > today ? () => setExpected(oldDay) : undefined,
        }),
      ),
  };
}

export type CycleActions = ReturnType<typeof cycleActions>;

/** A date field and Set, for a new expected salary day (after today). */
function ExpectedDayForm({
  today,
  current,
  label,
  onSet,
  onCancel,
}: {
  today: string;
  current: string;
  label: string;
  onSet: (day: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [day, setDay] = useState(current > today ? current : addDays(today, 1));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const bad = checkExpectedSalaryDay(day, today).length > 0;
  async function set() {
    setBusy(true);
    setFailed(false);
    const ok = await onSet(day);
    setBusy(false);
    if (!ok) setFailed(true);
  }
  return (
    <>
      <label className="field">
        {label}
        <input
          type="date"
          value={day}
          min={addDays(today, 1)}
          onChange={(e) => setDay(e.target.value)}
          aria-invalid={bad}
        />
        {bad && <span className="tiny bad">Pick a day after today.</span>}
      </label>
      <div className="row">
        {onCancel && (
          <button type="button" className="btn ghost grow" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="btn pri grow" disabled={busy || bad} onClick={set}>
          Set
        </button>
      </div>
      {failed && (
        <p className="tiny bad" role="alert">
          Not saved. Check the connection and try again.
        </p>
      )}
    </>
  );
}

/**
 * Salary late (spec 2, item 13): on Today from the expected salary day with no
 * salary entered. Asks for a new expected day; what is left is spread over the
 * extra days.
 */
export function LateSalaryCard({
  data,
  today,
  actions,
}: {
  data: Ready;
  today: string;
  actions: CycleActions;
}) {
  const expected = data.cycle.expectedSalaryOn;
  const late = lateSalaryDays(today, expected);
  return (
    <section className="card stack" aria-labelledby="late-h" data-testid="salary-late">
      <h3 id="late-h">Salary is late</h3>
      <p className="small">
        It was expected{" "}
        {late === 0 ? "today" : `${dayLabel(expected)}, ${late} ${late === 1 ? "day" : "days"} ago`}. When do
        you expect it now? What is left is spread up to that day.
      </p>
      <ExpectedDayForm
        today={today}
        current={expected}
        label="New expected salary day"
        onSet={(day) => actions.expected(expected, day, today)}
      />
      <a className="btn link" href="#SalaryDay">
        It arrived
      </a>
    </section>
  );
}

/**
 * Plan's "This cycle" card (spec 2, 6): the salary (editable during the cycle),
 * the expected salary day (changeable), and Undo salary day while it is allowed.
 */
export function ThisCycleCard({
  data,
  today,
  actions,
}: {
  data: Ready;
  today: string;
  actions: CycleActions;
}) {
  const salary = data.incomes.find((i) => i.kind === "salary");
  const [editing, setEditing] = useState<"salary" | "day" | null>(null);
  const [undoing, setUndoing] = useState<"ask" | "busy" | "failed" | null>(null);
  return (
    <section className="card stack" aria-labelledby="this-cycle-h">
      <h3 id="this-cycle-h">This cycle</h3>
      {salary &&
        (editing === "salary" ? (
          <SalaryForm
            oldMinor={salary.amountMinor}
            currency={salary.currency}
            onSet={(m) => actions.salary(salary.amountMinor, m).then((ok) => (ok && setEditing(null), ok))}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="li">
            <span className="grow">
              Salary
              <span className="tiny mute block">Received {dayLabel(salary.receivedOn)}</span>
            </span>
            <b className="small" data-testid="salary-amount">
              {formatMoney(salary.amountMinor, salary.currency)}
            </b>
            <button type="button" className="btn ghost" onClick={() => setEditing("salary")}>
              Change
            </button>
          </div>
        ))}
      {editing === "day" ? (
        <ExpectedDayForm
          today={today}
          current={data.cycle.expectedSalaryOn}
          label="Expected salary day"
          onSet={(day) =>
            actions
              .expected(data.cycle.expectedSalaryOn, day, today)
              .then((ok) => (ok && setEditing(null), ok))
          }
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div className="li">
          <span className="grow">Salary expected</span>
          <b className="small" data-testid="expected-salary-day">
            {dayLabel(data.cycle.expectedSalaryOn)}
          </b>
          <button type="button" className="btn ghost" onClick={() => setEditing("day")}>
            Change
          </button>
        </div>
      )}
      {data.undoSalaryDay &&
        (undoing === "ask" || undoing === "busy" ? (
          <>
            <p className="small">
              This removes this cycle and everything salary day made, and reopens last cycle as it was.
            </p>
            <div className="row">
              <button type="button" className="btn ghost grow" onClick={() => setUndoing(null)}>
                Keep it
              </button>
              <button
                type="button"
                className="btn pri grow"
                disabled={undoing === "busy"}
                onClick={async () => {
                  setUndoing("busy");
                  const ok = await actions.undo(data.cycle.id);
                  // On success the reload shows last cycle; this card goes with it.
                  setUndoing(ok ? null : "failed");
                }}
              >
                Undo salary day
              </button>
            </div>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => setUndoing("ask")}>
              Undo salary day
            </button>
            <p className="tiny mute">Possible until anything new is entered in this cycle.</p>
            {undoing === "failed" && (
              <p className="tiny bad" role="alert">
                Couldn't undo. Something new may have been entered, or check the connection.
              </p>
            )}
          </>
        ))}
    </section>
  );
}

/** The salary amount, changed during the cycle (spec 2). */
function SalaryForm({
  oldMinor,
  currency,
  onSet,
  onCancel,
}: {
  oldMinor: number;
  currency: string;
  onSet: (minor: number) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(toText(oldMinor, currency));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const minor = parseAmount(text, currency);
  const bad = minor === null || checkSalaryAmount(minor).length > 0;
  return (
    <>
      <label className="field">
        Salary ({currency})
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={bad}
        />
        {bad && <span className="tiny bad">Enter an amount above zero.</span>}
      </label>
      <div className="row">
        <button type="button" className="btn ghost grow" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn pri grow"
          disabled={busy || bad}
          onClick={async () => {
            if (minor === null) return;
            setBusy(true);
            setFailed(false);
            const ok = await onSet(minor);
            setBusy(false);
            if (!ok) setFailed(true);
          }}
        >
          Save
        </button>
      </div>
      {failed && (
        <p className="tiny bad" role="alert">
          Not saved. Check the connection and try again.
        </p>
      )}
    </>
  );
}
