import { useState } from "react";
import {
  checkPayment,
  coveredMinor,
  formatMoney,
  otherCurrency,
  parseAmount,
  paymentCovers,
  stillToPayMinor,
  todayView,
} from "../money";
import { CurrencyChoice } from "./CurrencyChoice";
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
 * Pay (spec 3, 10): amount, currency, date, a note when paid more, less or in the
 * other currency, and the new daily allowance before saving. "This finishes it"
 * follows the amount (on when it covers what is still to pay) until the user flips it.
 * Paid in the other currency (spec 8): it covers the commitment at the counting rate.
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
  const cur = c.currency;
  const spendCur = data.settings.spendingCurrency;
  const countingRate = data.settings.countingRate;
  const today = useToday(data.settings.homeTimeZone);
  const still = stillToPayMinor(c);
  // A savings set-aside is moved to savings, not paid (item 10), and only in its own currency.
  const saving = c.kind === "savings" || c.kind === "savings_payback";
  const paidWord = saving ? "moved" : "paid";
  const two = otherCurrency(data.settings);
  // A card bill pays its card in the card's currency (item 18): its money is held from card spends.
  const cardBill = c.kind === "card_bill";
  const other = two === null || saving || cardBill ? null : cur === spendCur ? two : spendCur;
  const [payCur, setPayCur] = useState(editing?.currency ?? cur);
  const [text, setText] = useState(() => {
    if (editing) return toText(editing.amountMinor, editing.currency);
    return still > 0 ? toText(still, cur) : "";
  });
  const [paidOn, setPaidOn] = useState(editing?.paidOn ?? today);
  const [finishChoice, setFinishChoice] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const amountMinor = parseAmount(text, payCur) ?? 0;
  const draft = { amountMinor, paidOn, currency: payCur };
  const problems = checkPayment(draft, {
    today,
    cycleStartedOn: data.cycle.startedOn,
    currency: cur,
    otherCurrency: editing && editing.currency !== cur ? editing.currency : other,
  });
  const inOther = payCur !== cur;
  const covers = paymentCovers(amountMinor, payCur, cur, { spendingCurrency: spendCur, countingRate });
  const others = c.payments.filter((p) => p.id !== editing?.id);
  const finish = editing ? c.state === "finished" : (finishChoice ?? covers >= still);
  const payments = amountMinor > 0 ? [...others, { ...draft, coversMinor: inOther ? covers : null }] : others;
  const after = { ...c, payments, state: finish ? ("finished" as const) : c.state };
  const totalPaid = coveredMinor(after);
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
            · {paidWord} so far {formatMoney(coveredMinor(c), cur)}
          </>
        )}
      </p>
      <section className="card stack">
        {other && (
          <CurrencyChoice
            label="Paid in"
            currencies={[cur, other]}
            value={payCur}
            onChange={(next) => {
              const minor = parseAmount(text, payCur);
              setPayCur(next);
              if (minor !== null) setText(toText(minor, next));
            }}
          />
        )}
        <label className="field">
          Amount {paidWord} ({payCur})
          <input
            value={text}
            inputMode="decimal"
            placeholder="0"
            onChange={(e) => {
              const t = e.target.value;
              if (t === "" || parseAmount(t.replace(/\.$/, ""), payCur) !== null) setText(t);
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
        {inOther && amountMinor > 0 && (
          <p className="small" data-testid="pay-other">
            {countingRate
              ? `Paid in ${payCur}: counts as ${formatMoney(covers, cur)} at ${countingRate} ${spendCur} per ${two}. The ${formatMoney(amountMinor, payCur)} comes out of your ${payCur}.`
              : `No counting rate yet: set one to count this against the ${cur} amount.`}
          </p>
        )}
        <p className="small" data-testid="pay-note">
          {finish
            ? plannedGap(totalPaid, c.plannedMinor, cur)
            : `Still to ${saving ? "move" : "pay"} after this: ${formatMoney(Math.max(0, c.plannedMinor - totalPaid), cur)}`}
        </p>
        {cardBill && (
          <p className="tiny mute" data-testid="pay-held">
            Paid from the money held for the card: free money stays the same. The rest stays owed on the card.
          </p>
        )}
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
