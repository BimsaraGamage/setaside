import { useState } from "react";
import { checkPayment, formatMoney, paidMinor, parseAmount, stillToPayMinor, todayView } from "../money";
import type { CommitmentActions } from "./commitment-actions";
import { type Commitment, dayLabel, entriesOf, type Payment, type Ready, useToday } from "./data";
import { newId } from "./id";
import { toText } from "./SpendSheet";

/** "Paid Rs 700 more than planned", "Rs 500 less than planned", or "As planned". */
export function plannedGap(paid: number, planned: number, currency: string): string {
  if (paid > planned) return `${formatMoney(paid - planned, currency)} more than planned`;
  if (paid < planned) return `${formatMoney(planned - paid, currency)} less than planned`;
  return "As planned";
}

/**
 * Pay (spec 3, 10): amount, date, a note when paid more or less than planned, and
 * the new daily allowance before saving. "This finishes it" follows the amount
 * (on when it covers what is still to pay) until the user flips it.
 * Opened with a payment, it changes or deletes that payment instead.
 */
export function PayPage({
  data,
  commitment: c,
  editing,
  actions,
}: {
  data: Ready;
  commitment: Commitment;
  editing?: Payment;
  actions: CommitmentActions;
}) {
  // Paid in the commitment's own currency (the other currency comes with item 17).
  const cur = c.currency;
  const spendCur = data.settings.spendingCurrency;
  const today = useToday(data.settings.homeTimeZone);
  const still = stillToPayMinor(c);
  // A savings set-aside is moved to savings, not paid (item 10).
  const saving = c.kind === "savings" || c.kind === "savings_payback";
  const paidWord = saving ? "moved" : "paid";
  const [text, setText] = useState(() => {
    if (editing) return toText(editing.amountMinor, cur);
    return still > 0 ? toText(still, cur) : "";
  });
  const [paidOn, setPaidOn] = useState(editing?.paidOn ?? today);
  const [finishChoice, setFinishChoice] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const amountMinor = parseAmount(text, cur) ?? 0;
  const draft = { amountMinor, paidOn };
  const problems = checkPayment(
    { ...draft, currency: cur },
    { today, cycleStartedOn: data.cycle.startedOn, currency: cur },
  );
  const finish = editing ? c.state === "finished" : (finishChoice ?? amountMinor >= still);
  const others = c.payments.filter((p) => p.id !== editing?.id);
  const payments = amountMinor > 0 ? [...others, { ...draft, currency: cur }] : others;
  const after = { ...c, payments, state: finish ? ("finished" as const) : c.state };
  const totalPaid = paidMinor(after, cur);
  const view = todayView(
    { ...entriesOf(data), commitments: data.commitments.map((k) => (k.id === c.id ? after : k)) },
    today,
  );
  const back = () => {
    window.location.hash = `Commitment/${c.id}`;
  };

  async function run(job: () => Promise<boolean>) {
    setBusy(true);
    setFailed(false);
    const ok = await job();
    setBusy(false);
    if (ok) back();
    else setFailed(true);
  }

  return (
    <>
      <div className="row">
        <a className="btn ghost link" href={`#Commitment/${c.id}`}>
          ← Back
        </a>
      </div>
      <h1>
        {editing ? (saving ? "Change move" : "Change payment") : saving ? "Move to savings" : "Pay"} ·{" "}
        {c.name}
      </h1>
      <p className="small mute">
        Planned {formatMoney(c.plannedMinor, cur)} · due {dayLabel(c.dueOn)}
        {c.payments.length > 0 && (
          <>
            {" "}
            · {paidWord} so far {formatMoney(paidMinor(c, cur), cur)}
          </>
        )}
      </p>
      <section className="card stack">
        <label className="field">
          Amount {paidWord} ({cur})
          <input
            value={text}
            inputMode="decimal"
            placeholder="0"
            onChange={(e) => {
              const t = e.target.value;
              if (t === "" || parseAmount(t.replace(/\.$/, ""), cur) !== null) setText(t);
            }}
          />
        </label>
        <label className="field">
          {saving ? "Moved on" : "Paid on"}
          <input
            type="date"
            value={paidOn}
            min={data.cycle.startedOn}
            max={today}
            required
            onChange={(e) => setPaidOn(e.target.value)}
          />
        </label>
        {!editing && (
          <label className="row check">
            <input type="checkbox" checked={finish} onChange={(e) => setFinishChoice(e.target.checked)} />
            <span className="grow">This finishes it</span>
          </label>
        )}
        <p className="small" data-testid="pay-note">
          {finish
            ? plannedGap(totalPaid, c.plannedMinor, cur)
            : `Still to ${saving ? "move" : "pay"} after this: ${formatMoney(Math.max(0, c.plannedMinor - totalPaid), cur)}`}
        </p>
        <p className="small" data-testid="pay-after">
          You can spend today after this: <b>{formatMoney(view.allowanceMinor, spendCur)}</b>
        </p>
      </section>

      {failed && <p className="error">Not saved. Check the connection and try again.</p>}

      <div className="row">
        {editing && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => run(() => actions.removePayment(c, editing))}
          >
            Delete
          </button>
        )}
        <button
          type="button"
          className="btn pri grow"
          disabled={busy || problems.length > 0}
          onClick={() =>
            run(() =>
              editing ? actions.changePayment(editing, draft) : actions.pay(c, newId(), draft, finish),
            )
          }
        >
          {editing ? "Save" : saving ? "Move" : "Pay"}
        </button>
      </div>
    </>
  );
}
