import { useState } from "react";
import { NAME_MAX, parseAmount, STARTER_POTS } from "../money";
import { CurrencyChoice } from "./CurrencyChoice";
import { newId } from "./id";

/**
 * The two steps salary day (spec 6 steps 4 and 5) and first use (spec 2 step 4)
 * share: the cycle's commitments and its pots.
 */

/** One commitment row while it is being changed. */
export interface Row {
  id: string;
  /** The template it was filled from (salary day); none for a new one. */
  recurringId: string | null;
  /** Last cycle's coming-up commitment it carries on (salary day only). */
  carriedFromId: string | null;
  name: string;
  /**
   * A payback to savings is filled by its prepayment (salary day, item 14); a card
   * bill by its card (item 18); a plan payment by its instalment plan (item 19).
   */
  kind: "bill" | "savings" | "savings_payback" | "card_bill" | "plan_payment";
  /** The prepayment a payback pays back. */
  prepaymentId?: string;
  /** A card bill's card. */
  cardId?: string;
  /** A plan payment's plan. */
  planId?: string;
  /** Either of the user's currencies (spec 8); chosen on a new row only. */
  currency: string;
  text: string;
  dueOn: string;
  everyCycle: boolean;
}

/** One pot: a pot in use, or a new one. */
export interface PotRow {
  id: string;
  allocationId: string;
  name: string;
  /** Either of the user's currencies (spec 8); a pot in use keeps its own. */
  currency: string;
  text: string;
  isNew: boolean;
}

/** Whether a half-typed amount can stay in the box. */
export const typedOk = (t: string, cur: string) =>
  t === "" || parseAmount(t.replace(/\.$/, ""), cur) !== null;

/** A new, empty commitment row due on `dueOn`, in `currency`. */
export const emptyRow = (dueOn: string, currency: string): Row => ({
  id: newId(),
  recurringId: null,
  carriedFromId: null,
  name: "",
  kind: "bill",
  currency,
  text: "",
  dueOn,
  everyCycle: false,
});

/** The commitments step: change any, remove any, + Add. */
export function CommitmentsStep({
  rows,
  setRows,
  currencies,
  startedOn,
  expected,
  has,
  noun = "commitment",
}: {
  rows: Row[];
  setRows: (f: (rows: Row[]) => Row[]) => void;
  /** The user's currencies, the spending currency first (spec 8). */
  currencies: string[];
  /** The cycle's first day: nothing can be due before it. */
  startedOn: string;
  expected: string;
  has: (prefix: string) => boolean;
  /** What a row is called ("bill" in first use). */
  noun?: string;
}) {
  const change = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const label = noun.charAt(0).toUpperCase() + noun.slice(1);
  return (
    <>
      {rows.map((r, i) => (
        <fieldset key={r.id} className="card stack" aria-label={`${label} ${i + 1}`}>
          {r.carriedFromId && <p className="tiny mute">From last cycle: due after its salary day.</p>}
          {r.kind === "savings_payback" && (
            <p className="tiny mute">Pays your savings back for a prepayment. It goes back into savings.</p>
          )}
          {r.kind === "plan_payment" && (
            <p className="tiny mute">
              This cycle's payment on an instalment plan; the last one is only what is left.
            </p>
          )}
          {r.kind === "card_bill" && (
            <p className="tiny mute">
              Card bill, filled from the card balance. Its money is already held from your card spends.
            </p>
          )}
          <label className="field">
            Name
            <input
              value={r.name}
              maxLength={NAME_MAX}
              onChange={(e) => change(i, { name: e.target.value })}
            />
          </label>
          {!r.recurringId && !r.carriedFromId && (r.kind === "bill" || r.kind === "savings") && (
            <CurrencyChoice
              currencies={currencies}
              value={r.currency}
              label={`${label} ${i + 1} currency`}
              onChange={(currency) => change(i, { currency, text: "" })}
            />
          )}
          <label className="field">
            Amount ({r.currency})
            <input
              value={r.text}
              inputMode="decimal"
              placeholder="0"
              onChange={(e) => typedOk(e.target.value, r.currency) && change(i, { text: e.target.value })}
            />
          </label>
          <label className="field">
            Due date
            <input
              type="date"
              value={r.dueOn}
              min={startedOn}
              onChange={(e) => change(i, { dueOn: e.target.value })}
            />
            {r.dueOn > expected && (
              <span className="tiny mute">After the next salary day: coming up only, not set aside.</span>
            )}
          </label>
          {r.kind !== "savings_payback" && r.kind !== "plan_payment" && (
            <label className="row check">
              <input
                type="checkbox"
                checked={r.everyCycle}
                onChange={(e) => change(i, { everyCycle: e.target.checked })}
              />
              <span className="grow">
                Every cycle
                {r.recurringId && !r.everyCycle && (
                  <span className="tiny mute block">Off: it stops repeating after this cycle.</span>
                )}
              </span>
            </label>
          )}
          {has(`commitment.${i}.`) && <p className="tiny bad">Check the name, amount and due date.</p>}
          <button type="button" className="btn" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
            Remove from this cycle
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="btn add"
        onClick={() => setRows((rs) => [...rs, emptyRow(startedOn, currencies[0] as string)])}
      >
        + Add
      </button>
    </>
  );
}

/** The pots step: each pot's amount this cycle, + New pot (starter names offered while there are none). */
export function PotsStep({
  pots,
  setPots,
  currencies,
  has,
}: {
  pots: PotRow[];
  setPots: (f: (pots: PotRow[]) => PotRow[]) => void;
  /** The user's currencies, the spending currency first (spec 8). */
  currencies: string[];
  has: (prefix: string) => boolean;
}) {
  const [newPotName, setNewPotName] = useState("");
  const [newPotText, setNewPotText] = useState("");
  const [newPotCur, setNewPotCur] = useState(currencies[0] as string);
  const cur = newPotCur;
  const changePot = (i: number, text: string) =>
    setPots((ps) => ps.map((p, j) => (j === i ? { ...p, text } : p)));
  return (
    <section className="card stack" aria-label="Pots this cycle">
      {pots.length === 0 && <p className="tiny mute">No pots yet.</p>}
      {pots.map((p, i) => (
        <div key={p.id} className="stack">
          <label className="field">
            {p.name} ({p.currency})
            <input
              value={p.text}
              inputMode="decimal"
              placeholder="0"
              onChange={(e) => typedOk(e.target.value, p.currency) && changePot(i, e.target.value)}
            />
            {has(`pot.${i}.`) && <span className="tiny bad">Type a plain amount.</span>}
          </label>
          {p.isNew && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => setPots((ps) => ps.filter((_, j) => j !== i))}
            >
              Remove {p.name}
            </button>
          )}
        </div>
      ))}
      <h3>+ New pot</h3>
      {pots.length === 0 && (
        <>
          <p className="tiny mute">Money for things bought bit by bit. Start with one of these:</p>
          <div className="chips">
            {STARTER_POTS.map((n) => (
              <button key={n} type="button" className="btn" onClick={() => setNewPotName(n)}>
                {n}
              </button>
            ))}
          </div>
        </>
      )}
      <label className="field">
        New pot name
        <input value={newPotName} maxLength={NAME_MAX} onChange={(e) => setNewPotName(e.target.value)} />
      </label>
      <CurrencyChoice
        currencies={currencies}
        value={newPotCur}
        label="New pot currency"
        onChange={(c) => {
          setNewPotCur(c);
          setNewPotText("");
        }}
      />
      <label className="field">
        New pot amount ({cur})
        <input
          value={newPotText}
          inputMode="decimal"
          placeholder="0"
          onChange={(e) => typedOk(e.target.value, cur) && setNewPotText(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn"
        disabled={!newPotName.trim() || parseAmount(newPotText, cur) === null}
        onClick={() => {
          setPots((ps) => [
            ...ps,
            {
              id: newId(),
              allocationId: newId(),
              name: newPotName.trim(),
              currency: cur,
              text: newPotText,
              isNew: true,
            },
          ]);
          setNewPotName("");
          setNewPotText("");
        }}
      >
        Add pot
      </button>
    </section>
  );
}
