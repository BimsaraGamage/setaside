import { useMemo, useState } from "react";
import {
  addDays,
  checkSpend,
  formatMoney,
  minorDigits,
  NOTE_MAX,
  parseAmount,
  potView,
  todayView,
} from "../money";
import { currencyContext } from "./CurrencyChoice";
import { dayLabel, entriesOf, potEntry, type Ready, type Spend } from "./data";
import { newId } from "./id";
import type { SpendActions } from "./spend-actions";

/** Days a spend can be dated: today back to the cycle's first day (spec 2). */
function cycleDays(today: string, startedOn: string): string[] {
  const out: string[] = [];
  for (let d = today; d >= startedOn && out.length < 62; d = addDays(d, -1)) out.push(d);
  return out;
}

function dayName(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return dayLabel(day);
}

const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"] as const;

/** Minor units back to the text the number pad shows ("1850.5"). */
export function toText(minor: number, currency: string): string {
  const digits = minorDigits(currency);
  const whole = Math.floor(minor / 10 ** digits);
  const frac = String(minor % 10 ** digits)
    .padStart(digits, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

/**
 * The spend sheet (spec 10): date chip, amount on a number pad, the live
 * "left today" (or "from <pot> pot") line, note, Free money or a pot, One-off, Save.
 * Opened with a spend, it edits it and can delete it.
 */
export function SpendSheet({
  data,
  today,
  editing,
  actions,
  onClose,
}: {
  data: Ready;
  today: string;
  editing?: Spend;
  actions: SpendActions;
  onClose: () => void;
}) {
  const spendCur = data.settings.spendingCurrency;
  const [text, setText] = useState(editing ? toText(editing.amountMinor, editing.currency) : "");
  const [spentOn, setSpentOn] = useState(editing?.spentOn ?? today);
  const [note, setNote] = useState(editing?.note ?? "");
  // Spends default to free money; one tap switches to a pot (spec 4).
  const [potId, setPotId] = useState<string | null>(editing?.potId ?? null);
  // One-off: still uses free money, left out of the spending speed (spec 7).
  const [oneOff, setOneOff] = useState(editing?.oneOff ?? false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const days = useMemo(() => cycleDays(today, data.cycle.startedOn), [today, data.cycle.startedOn]);

  // Pots to choose from: those in use, and a stopped one this spend is already in.
  const choices = data.pots.filter((p) => !p.archived || p.id === editing?.potId);
  const pot = data.pots.find((p) => p.id === potId);
  // A spend is in its pot's currency (a salary-currency pot's, spec 8), else the spending currency.
  const cur = pot?.currency ?? spendCur;
  const amountMinor = parseAmount(text, cur) ?? 0;
  const draft = { spentOn, amountMinor, note: note.trim() || null, currency: cur, potId, oneOff };
  const problems = checkSpend(draft, {
    today,
    cycleStartedOn: data.cycle.startedOn,
    ...currencyContext(data),
    pots: data.pots,
    keepPotId: editing?.potId,
  });

  // The live line: today's numbers as they will be after this spend is saved.
  const others = data.spends.filter((s) => s.id !== editing?.id);
  const spendsAfter = amountMinor > 0 ? [...others, { ...draft, id: "draft" }] : others;
  const after = todayView({ ...entriesOf(data), spends: spendsAfter }, today);
  const potAfter = pot ? potView(potEntry(pot), spendsAfter) : null;
  const money = (m: number) => formatMoney(m, spendCur);
  const todayLine =
    after.leftTodayMinor < 0
      ? `Over today by ${money(-after.leftTodayMinor)}`
      : `${money(after.leftTodayMinor)} left today after this`;
  const liveLine = !pot
    ? todayLine
    : potAfter && potAfter.overMinor === 0
      ? `From ${pot.name} pot · ${formatMoney(potAfter.leftMinor, cur)} left in it`
      : `${pot.name} used up · ${todayLine}`;

  function press(k: (typeof keys)[number]) {
    setFailed(false);
    if (k === "⌫") return setText((t) => t.slice(0, -1));
    const next = text === "0" && k !== "." ? k : text + k;
    if (k === "." && (text.includes(".") || minorDigits(cur) === 0)) return;
    if (parseAmount(next === "." ? "0." : next.replace(/\.$/, ""), cur) === null) return;
    setText(next);
  }

  async function run(job: () => Promise<boolean>) {
    setBusy(true);
    setFailed(false);
    const ok = await job();
    setBusy(false);
    if (ok) onClose();
    else setFailed(true);
  }

  const save = () =>
    run(() =>
      editing
        ? actions.change(editing, { spentOn, amountMinor, note: draft.note, potId, oneOff })
        : actions.add(newId(), { spentOn, amountMinor, note: draft.note, potId, oneOff }),
    );

  return (
    <div className="sheet-back" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-h"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="row">
          <h2 id="sheet-h" className="grow">
            {editing ? "Change spend" : "Add a spend"}
          </h2>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <label className="chip">
          <span className="sr">Date</span>
          <select value={spentOn} onChange={(e) => setSpentOn(e.target.value)} aria-label="Date">
            {days.map((d) => (
              <option key={d} value={d}>
                {dayName(d, today)}
              </option>
            ))}
          </select>
        </label>

        <p className="amount" data-testid="sheet-amount">
          {text ? money(amountMinor) : <span className="mute">{money(0)}</span>}
        </p>

        <p
          className={`small ${after.leftTodayMinor < 0 && (!pot || potAfter?.overMinor) ? "bad" : "mute"}`}
          data-testid="sheet-left"
        >
          {liveLine}
        </p>

        {choices.length > 0 && (
          <fieldset className="chips" aria-label="Spend from">
            <button
              type="button"
              className="btn"
              aria-pressed={potId === null}
              onClick={() => setPotId(null)}
            >
              Free money
            </button>
            {choices.map((p) => (
              <button
                key={p.id}
                type="button"
                className="btn"
                aria-pressed={potId === p.id}
                onClick={() => setPotId(p.id)}
              >
                {p.name}
              </button>
            ))}
          </fieldset>
        )}

        <label className="field">
          <span className="sr">Note</span>
          <input
            placeholder="Note (optional)"
            aria-label="Note"
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <label className="row check">
          <input type="checkbox" checked={oneOff} onChange={(e) => setOneOff(e.target.checked)} />
          <span className="grow">
            One-off
            <span className="tiny mute block">Left out of your spending speed</span>
          </span>
        </label>

        <div className="pad">
          {keys.map((k) => (
            <button
              key={k}
              type="button"
              className="btn"
              aria-label={k === "⌫" ? "Delete digit" : k === "." ? "Point" : k}
              disabled={k === "." && minorDigits(cur) === 0}
              onClick={() => press(k)}
            >
              {k}
            </button>
          ))}
        </div>

        {failed && <p className="error">Not saved. Check the connection and try again.</p>}

        <div className="row">
          {editing && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => run(() => actions.remove(editing))}
            >
              Delete
            </button>
          )}
          <button
            type="button"
            className="btn pri grow"
            disabled={busy || problems.length > 0}
            onClick={save}
          >
            Save
          </button>
        </div>
      </section>
    </div>
  );
}
