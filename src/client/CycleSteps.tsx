import { useState } from "react";
import { NAME_MAX, parseAmount, STARTER_POTS } from "../money";
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
  kind: "bill" | "savings";
  text: string;
  dueOn: string;
  everyCycle: boolean;
}

/** One pot: a pot in use, or a new one. */
export interface PotRow {
  id: string;
  allocationId: string;
  name: string;
  text: string;
  isNew: boolean;
}

/** Whether a half-typed amount can stay in the box. */
export const typedOk = (t: string, cur: string) =>
  t === "" || parseAmount(t.replace(/\.$/, ""), cur) !== null;

/** A new, empty commitment row due on `dueOn`. */
export const emptyRow = (dueOn: string): Row => ({
  id: newId(),
  recurringId: null,
  carriedFromId: null,
  name: "",
  kind: "bill",
  text: "",
  dueOn,
  everyCycle: false,
});

/** The commitments step: change any, remove any, + Add. */
export function CommitmentsStep({
  rows,
  setRows,
  cur,
  startedOn,
  expected,
  has,
  noun = "commitment",
}: {
  rows: Row[];
  setRows: (f: (rows: Row[]) => Row[]) => void;
  cur: string;
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
          <label className="field">
            Name
            <input
              value={r.name}
              maxLength={NAME_MAX}
              onChange={(e) => change(i, { name: e.target.value })}
            />
          </label>
          <label className="field">
            Amount ({cur})
            <input
              value={r.text}
              inputMode="decimal"
              placeholder="0"
              onChange={(e) => typedOk(e.target.value, cur) && change(i, { text: e.target.value })}
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
          {has(`commitment.${i}.`) && <p className="tiny bad">Check the name, amount and due date.</p>}
          <button type="button" className="btn" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
            Remove from this cycle
          </button>
        </fieldset>
      ))}
      <button type="button" className="btn add" onClick={() => setRows((rs) => [...rs, emptyRow(startedOn)])}>
        + Add
      </button>
    </>
  );
}

/** The pots step: each pot's amount this cycle, + New pot (starter names offered while there are none). */
export function PotsStep({
  pots,
  setPots,
  cur,
  has,
}: {
  pots: PotRow[];
  setPots: (f: (pots: PotRow[]) => PotRow[]) => void;
  cur: string;
  has: (prefix: string) => boolean;
}) {
  const [newPotName, setNewPotName] = useState("");
  const [newPotText, setNewPotText] = useState("");
  const changePot = (i: number, text: string) =>
    setPots((ps) => ps.map((p, j) => (j === i ? { ...p, text } : p)));
  return (
    <section className="card stack" aria-label="Pots this cycle">
      {pots.length === 0 && <p className="tiny mute">No pots yet.</p>}
      {pots.map((p, i) => (
        <div key={p.id} className="stack">
          <label className="field">
            {p.name} ({cur})
            <input
              value={p.text}
              inputMode="decimal"
              placeholder="0"
              onChange={(e) => typedOk(e.target.value, cur) && changePot(i, e.target.value)}
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
            { id: newId(), allocationId: newId(), name: newPotName.trim(), text: newPotText, isNew: true },
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
