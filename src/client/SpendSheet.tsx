import { useMemo, useState } from "react";
import { addDays, checkSpend, formatMoney, minorDigits, NOTE_MAX, parseAmount, todayView } from "../money";
import { dayLabel, entriesOf, type Ready, type Spend } from "./data";
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
 * "left today" line, note, Save. Opened with a spend, it edits it and can delete it.
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
  const cur = data.settings.spendingCurrency;
  const [text, setText] = useState(editing ? toText(editing.amountMinor, cur) : "");
  const [spentOn, setSpentOn] = useState(editing?.spentOn ?? today);
  const [note, setNote] = useState(editing?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const days = useMemo(() => cycleDays(today, data.cycle.startedOn), [today, data.cycle.startedOn]);

  const amountMinor = parseAmount(text, cur) ?? 0;
  const draft = { spentOn, amountMinor, note: note.trim() || null, currency: cur };
  const problems = checkSpend(draft, { today, cycleStartedOn: data.cycle.startedOn, spendingCurrency: cur });

  // The live line: today's numbers as they will be after this spend is saved.
  const others = data.spends.filter((s) => s.id !== editing?.id);
  const after = todayView(
    { ...entriesOf(data), spends: amountMinor > 0 ? [...others, draft] : others },
    today,
  );
  const money = (m: number) => formatMoney(m, cur);

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
        ? actions.change(editing, { spentOn, amountMinor, note: draft.note })
        : actions.add(newId(), { spentOn, amountMinor, note: draft.note }),
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

        <p className={`small ${after.leftTodayMinor < 0 ? "bad" : "mute"}`} data-testid="sheet-left">
          {after.leftTodayMinor < 0
            ? `Over today by ${money(-after.leftTodayMinor)}`
            : `${money(after.leftTodayMinor)} left today after this`}
        </p>

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
