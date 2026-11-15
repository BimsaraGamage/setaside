import { useState } from "react";
import { checkIncome, checkSavingsMove, formatMoney, parseAmount, savingsTotal, todayView } from "../money";
import { api } from "./api";
import { dayLabel, entriesOf, type Ready, type SavingsLine, useToday } from "./data";
import { newId } from "./id";
import type { Toaster } from "./toast";

const ok = async (res: Promise<Response | { ok: boolean }>) => (await res.catch(() => null))?.ok ?? false;

const addMove = (id: string, kind: "put_in" | "take_out", amountMinor: number) =>
  ok(api.api["savings-movements"].$post({ json: { id, kind, amountMinor } }));
const removeMove = (id: string) => ok(api.api["savings-movements"][":id"].$delete({ param: { id } }));
const addIncome = (id: string, amountMinor: number, toSavingsMinor: number) =>
  ok(api.api.incomes.$post({ json: { id, kind: "extra", amountMinor, toSavingsMinor } }));
const removeIncome = (id: string) => ok(api.api.incomes[":id"].$delete({ param: { id } }));

/** Put in, Take out and Add income; each success shows a toast with Undo (spec 5). */
export function savingsActions({ done }: Toaster) {
  return {
    move: (kind: "put_in" | "take_out", amountMinor: number, currency: string) => {
      const id = newId();
      return addMove(id, kind, amountMinor).then((ok) =>
        done(ok, {
          text:
            kind === "take_out"
              ? `${formatMoney(amountMinor, currency)} taken out of savings`
              : `${formatMoney(amountMinor, currency)} put in savings`,
          undo: () => removeMove(id),
        }),
      );
    },
    addIncome: (amountMinor: number, toSavingsMinor: number) => {
      const id = newId();
      return addIncome(id, amountMinor, toSavingsMinor).then((ok) =>
        done(ok, { text: "Income added", undo: () => removeIncome(id) }),
      );
    },
  };
}

export type SavingsActions = ReturnType<typeof savingsActions>;

const lineName: Record<SavingsLine["kind"], string> = {
  put_in: "Put in",
  take_out: "Taken out",
  income: "From extra income",
  set_aside: "Set aside",
};

/** One amount field: digits only, in the spending currency. */
function AmountField({
  label,
  text,
  currency,
  onChange,
}: {
  label: string;
  text: string;
  currency: string;
  onChange: (t: string) => void;
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
    </label>
  );
}

function Back({ to }: { to: string }) {
  return (
    <div className="row">
      <a className="btn ghost link" href={`#${to}`}>
        ← Back
      </a>
    </div>
  );
}

/** Savings (spec 5, 10): the total, Take out, Put in, and every movement, newest first. */
export function SavingsPage({ data }: { data: Ready }) {
  const cur = data.settings.spendingCurrency;
  const total = savingsTotal(data.savings, cur);
  return (
    <>
      <Back to="Money" />
      <h1>Savings</h1>
      <section className="card stack">
        <p className="amount" data-testid="savings-total">
          {formatMoney(total, cur)}
        </p>
        <div className="row">
          {total > 0 ? (
            <a className="btn grow link" href="#SavingsMove/take_out">
              Take out
            </a>
          ) : (
            <button type="button" className="btn grow" disabled>
              Take out
            </button>
          )}
          <a className="btn grow link" href="#SavingsMove/put_in">
            Put in
          </a>
        </div>
      </section>
      <section className="card" aria-labelledby="moves-h">
        <h3 id="moves-h">Movements</h3>
        {data.savings.length === 0 && (
          <p className="tiny mute">
            Nothing yet. Savings grow from savings set-asides, extra income and Put in.
          </p>
        )}
        {data.savings.map((l) => (
          <div key={l.id} className="li">
            <span className="date">
              <b>{dayLabel(l.on)}</b>
            </span>
            <span className="grow">
              {lineName[l.kind]}
              {l.name && <span className="tiny mute block">{l.name}</span>}
            </span>
            <b className={`small${l.amountMinor < 0 ? " bad" : ""}`}>
              {l.amountMinor < 0 ? "−" : "+"}
              {formatMoney(Math.abs(l.amountMinor), l.currency)}
            </b>
          </div>
        ))}
      </section>
    </>
  );
}

/**
 * Take out of savings or Put in (spec 5, 10): amount, and for Take out the new
 * allowance before saving. Put in is money from outside: free money stays the same.
 * "For a prepayment? Yes, pay back" comes with item 14.
 */
export function SavingsMovePage({
  data,
  kind,
  actions,
}: {
  data: Ready;
  kind: "put_in" | "take_out";
  actions: SavingsActions;
}) {
  const cur = data.settings.spendingCurrency;
  const today = useToday(data.settings.homeTimeZone);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const total = savingsTotal(data.savings, cur);
  const amountMinor = parseAmount(text, cur) ?? 0;
  const problems = checkSavingsMove(
    { kind, currency: cur, amountMinor, totalMinor: total },
    { spendingCurrency: cur },
  );
  const entries = entriesOf(data);
  const after = todayView(
    kind === "take_out" && amountMinor > 0
      ? { ...entries, takenOut: [...entries.takenOut, { currency: cur, amountMinor, movedOn: today }] }
      : entries,
    today,
  );
  const takeOut = kind === "take_out";

  async function save() {
    setBusy(true);
    setFailed(false);
    const ok = await actions.move(kind, amountMinor, cur);
    setBusy(false);
    if (ok) window.location.hash = "Savings";
    else setFailed(true);
  }

  return (
    <>
      <Back to="Savings" />
      <h1>{takeOut ? "Take out of savings" : "Put in savings"}</h1>
      <p className="small mute">Savings now {formatMoney(total, cur)}</p>
      <section className="card stack">
        <AmountField label="Amount" text={text} currency={cur} onChange={setText} />
        {problems.includes("too_much") && (
          <p className="small bad">More than is saved ({formatMoney(total, cur)}).</p>
        )}
        {takeOut ? (
          <p className="small" data-testid="savings-after">
            It goes to free money. You can spend today after this:{" "}
            <b>{formatMoney(after.allowanceMinor, cur)}</b>
          </p>
        ) : (
          <p className="small mute">Money from outside the app. Free money stays the same.</p>
        )}
      </section>
      {failed && <p className="error">Not saved. Check the connection and try again.</p>}
      <div className="row">
        <button type="button" className="btn pri grow" disabled={busy || problems.length > 0} onClick={save}>
          {takeOut ? "Take out" : "Put in"}
        </button>
      </div>
    </>
  );
}

/**
 * Add income (spec 5, 10): amount, how much of it to savings, the rest to free
 * money, and the new allowance before saving. Only extra income for now: loan
 * money, borrowed and paid back to me come with items 19 and 20.
 */
export function AddIncomePage({ data, actions }: { data: Ready; actions: SavingsActions }) {
  const cur = data.settings.spendingCurrency;
  const today = useToday(data.settings.homeTimeZone);
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const amountMinor = parseAmount(text, cur) ?? 0;
  const toSavingsMinor = parseAmount(savedText, cur) ?? 0;
  const problems = checkIncome(
    { kind: "extra", currency: cur, amountMinor, toSavingsMinor },
    { spendingCurrency: cur },
  );
  const entries = entriesOf(data);
  const after = todayView(
    problems.length === 0
      ? {
          ...entries,
          incomes: [
            ...entries.incomes,
            { kind: "extra" as const, currency: cur, amountMinor, toSavingsMinor, receivedOn: today },
          ],
        }
      : entries,
    today,
  );

  async function save() {
    setBusy(true);
    setFailed(false);
    const ok = await actions.addIncome(amountMinor, toSavingsMinor);
    setBusy(false);
    if (ok) window.location.hash = "Money";
    else setFailed(true);
  }

  return (
    <>
      <Back to="Money" />
      <h1>Add income</h1>
      <p className="small mute">Extra income: a bonus, a refund. Dated today.</p>
      <section className="card stack">
        <AmountField label="Amount" text={text} currency={cur} onChange={setText} />
        <AmountField label="To savings" text={savedText} currency={cur} onChange={setSavedText} />
        {problems.includes("to_savings") ? (
          <p className="small bad">To savings can't be more than the amount.</p>
        ) : (
          <p className="small" data-testid="income-split">
            To free money: <b>{formatMoney(Math.max(0, amountMinor - toSavingsMinor), cur)}</b>
          </p>
        )}
        <p className="small" data-testid="income-after">
          You can spend today after this: <b>{formatMoney(after.allowanceMinor, cur)}</b>
        </p>
      </section>
      {failed && <p className="error">Not saved. Check the connection and try again.</p>}
      <div className="row">
        <button type="button" className="btn pri grow" disabled={busy || problems.length > 0} onClick={save}>
          Add income
        </button>
      </div>
    </>
  );
}
