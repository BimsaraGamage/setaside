import { useState } from "react";
import {
  checkCommitment,
  coveredMinor,
  formatMoney,
  inThisCycle,
  NAME_MAX,
  parseAmount,
  stillToPayMinor,
  todayView,
} from "../money";
import { CurrencyChoice, currenciesOf, currencyContext } from "./CurrencyChoice";
import type { CommitmentActions, CommitmentKind } from "./commitment-actions";
import { type Commitment, cardBalance, dayLabel, entriesOf, type Ready, useToday } from "./data";
import { newId } from "./id";
import { plannedGap } from "./Pay";
import { planPaymentNote } from "./Plans";
import { PlanPots } from "./Pots";
import { toText } from "./SpendSheet";
import { type CycleActions, ThisCycleCard } from "./ThisCycle";

/**
 * A savings set-aside (item 10) or a payback to savings for a prepayment (item 14):
 * its money is moved to savings, not paid.
 */
export const isSavings = (c: Pick<Commitment, "kind">) =>
  c.kind === "savings" || c.kind === "savings_payback";

/** A payback to savings (item 14): made by its prepayment, not on the commitment page. */
export const isPayback = (c: Pick<Commitment, "kind">) => c.kind === "savings_payback";

/**
 * "Paid Rs 10,000 of Rs 36,000" for a part-paid open commitment ("Moved … · savings"
 * for a savings set-aside); "Savings" when nothing is moved yet; nothing for an unpaid bill.
 */
export function paidNote(c: Commitment): string | undefined {
  const of = `${formatMoney(coveredMinor(c), c.currency)} of ${formatMoney(c.plannedMinor, c.currency)}`;
  if (isPayback(c)) return c.payments.length ? `Paid back ${of} · savings` : "Pays back savings";
  if (isSavings(c)) return c.payments.length ? `Moved ${of} · savings` : "Savings";
  if (c.payments.length === 0) return undefined;
  return `Paid ${of}`;
}

/** A plan payment (item 19): made by its instalment plan, never Every cycle, not deleted. */
export const isPlanPayment = (c: Pick<Commitment, "kind">) => c.kind === "plan_payment";

/** A card bill (item 18): its money is held from card spends, not set aside. */
export const isCardBill = (c: Pick<Commitment, "kind">) => c.kind === "card_bill";

/**
 * A commitment's note on Plan and Next up: a card bill's card balance (spec 10)
 * before what is paid; otherwise `paidNote`.
 */
export function commitmentNote(
  data: Pick<Ready, "cards" | "spends" | "commitments" | "plans">,
  c: Commitment,
) {
  if (isPlanPayment(c)) {
    const of = planPaymentNote(data, c);
    const paid = paidNote(c);
    return [of, paid].filter(Boolean).join(" · ") || undefined;
  }
  const card = isCardBill(c) ? data.cards.find((k) => k.id === c.cardId) : undefined;
  if (!card) return paidNote(c);
  const balance = `${card.name} balance ${formatMoney(cardBalance(data, card), card.currency)}`;
  const paid = paidNote(c);
  return paid ? `${balance} · ${paid}` : balance;
}

/**
 * Plan (spec 10): this cycle's commitments and + Add, pots and + New pot, the Every
 * cycle link, Salary arrived; the salary, expected day and Undo salary day (item 13).
 */
export function Plan({ data, actions }: { data: Ready; actions: CycleActions }) {
  const today = useToday(data.settings.homeTimeZone);
  const cur = data.settings.spendingCurrency;
  const open = data.commitments.filter((c) => c.state === "open");
  const now = open.filter((c) => inThisCycle(c.dueOn, data.cycle.expectedSalaryOn));
  const later = open.filter((c) => !inThisCycle(c.dueOn, data.cycle.expectedSalaryOn));
  const finished = data.commitments.filter((c) => c.state === "finished");
  const row = (c: Commitment) => {
    const done = c.state === "finished";
    const note = done
      ? isSavings(c)
        ? "Moved to savings · finished"
        : "Paid · finished"
      : commitmentNote(data, c);
    return (
      <a key={c.id} className={`li tap link${done ? " done" : ""}`} href={`#Commitment/${c.id}`}>
        <span className="date">
          <b>{dayLabel(c.dueOn)}</b>
        </span>
        <span className="grow">
          {c.name}
          {note && <span className="tiny mute block">{note}</span>}
        </span>
        <b className="small">
          {formatMoney(
            done ? coveredMinor(c) : c.payments.length ? stillToPayMinor(c) : c.plannedMinor,
            c.currency,
          )}
        </b>
      </a>
    );
  };
  return (
    <>
      <h1>Plan</h1>
      <section className="card" aria-labelledby="commitments-h">
        <div className="row">
          <h3 id="commitments-h" className="grow">
            This cycle's commitments
          </h3>
          <span className="tiny mute">to {dayLabel(data.cycle.expectedSalaryOn)}</span>
        </div>
        {now.length === 0 && <p className="tiny mute">None yet. Bills you add are set aside at once.</p>}
        {now.map(row)}
        <a className="btn link add" href="#Commitment">
          + Add
        </a>
      </section>
      {later.length > 0 && (
        <section className="card" aria-labelledby="later-h">
          <h3 id="later-h">Due after salary · coming up only</h3>
          <p className="tiny mute">They belong to the next cycle and are not set aside now.</p>
          {later.map(row)}
        </section>
      )}
      {finished.length > 0 && (
        <section className="card" aria-labelledby="finished-h">
          <h3 id="finished-h">Finished</h3>
          {finished.map(row)}
        </section>
      )}
      <PlanPots data={data} />
      <ThisCycleCard data={data} today={today} actions={actions} />
      <div className="row">
        <a className="btn link grow" href="#EveryCycle">
          Every cycle
        </a>
        <a className="btn pri link grow" href="#SalaryDay">
          Salary arrived
        </a>
      </div>
    </>
  );
}

/** The commitment page's payments (spec 10): list, paid and still to pay, Pay, Mark finished or Reopen. */
function Payments({ c, actions }: { c: Commitment; actions: CommitmentActions }) {
  const cur = c.currency;
  // What the payments cover in its own currency, those in the other currency too (item 17).
  const paid = coveredMinor(c);
  const open = c.state === "open";
  const saving = isSavings(c);
  const [busy, setBusy] = useState(false);
  const run = async (job: () => Promise<boolean>) => {
    setBusy(true);
    await job();
    setBusy(false);
  };
  return (
    <section className="card" aria-labelledby="payments-h">
      <div className="row">
        <h3 id="payments-h" className="grow">
          {saving ? "Moved to savings" : "Payments"}
        </h3>
        {!open && <span className="tiny mute">Finished</span>}
      </div>
      {c.payments.length === 0 && (
        <p className="tiny mute">{saving ? "Nothing moved yet." : "Nothing paid yet."}</p>
      )}
      {c.payments.map((p) => (
        <a key={p.id} className="li tap link" href={`#Payment/${p.id}`}>
          <span className="grow">{dayLabel(p.paidOn)}</span>
          <b className="small">
            {formatMoney(p.amountMinor, p.currency)}
            {p.currency !== cur && (
              <span className="tiny mute"> · counts as {formatMoney(p.coversMinor ?? 0, cur)}</span>
            )}
          </b>
        </a>
      ))}
      <p className="small" data-testid="still-to-pay">
        {open ? (
          <>
            {saving ? "Moved" : "Paid"} {formatMoney(paid, cur)} · still to {saving ? "move" : "pay"}{" "}
            <b>{formatMoney(stillToPayMinor(c), cur)}</b>
          </>
        ) : (
          <>
            {saving ? "Moved" : "Paid"} {formatMoney(paid, cur)} · {plannedGap(paid, c.plannedMinor, cur)}
          </>
        )}
      </p>
      <div className="row">
        {open ? (
          <>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => run(() => actions.finish(c))}
            >
              Mark finished
            </button>
            <a className="btn pri grow link" href={`#Pay/${c.id}`}>
              {saving ? "Move" : "Pay"}
            </a>
          </>
        ) : (
          <button type="button" className="btn" disabled={busy} onClick={() => run(() => actions.reopen(c))}>
            Reopen
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * A commitment page (spec 10), new or edit: name, amount, due date, and the
 * new daily allowance before saving. Covers the tab bar; Save and Delete go back to Plan.
 */
export function CommitmentPage({
  data,
  editing,
  actions,
}: {
  data: Ready;
  editing?: Commitment;
  actions: CommitmentActions;
}) {
  const spendCur = data.settings.spendingCurrency;
  // Either currency, chosen when it is made, fixed after (spec 8).
  const [cur, setCur] = useState(editing?.currency ?? spendCur);
  const today = useToday(data.settings.homeTimeZone);
  const [kind, setKind] = useState<CommitmentKind>(editing?.kind === "savings" ? "savings" : "bill");
  // A payback keeps its kind and never repeats: salary day makes the next one (item 14).
  // A plan payment the same way (item 19): its plan makes the next one.
  const planPayment = editing !== undefined && isPlanPayment(editing);
  const plan = planPayment ? data.plans.find((p) => p.id === editing?.planId) : undefined;
  const payback = (editing !== undefined && isPayback(editing)) || planPayment;
  // A card bill keeps its kind and card (item 18); its money is held, so the allowance stays.
  const card = editing && isCardBill(editing) ? data.cards.find((k) => k.id === editing.cardId) : undefined;
  const cardBill = editing !== undefined && isCardBill(editing);
  const [name, setName] = useState(editing?.name ?? "");
  const [text, setText] = useState(editing ? toText(editing.plannedMinor, cur) : "");
  const [dueOn, setDueOn] = useState(editing?.dueOn ?? today);
  const [everyCycle, setEveryCycle] = useState(editing ? editing.recurringId !== null : false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const plannedMinor = parseAmount(text, cur) ?? 0;
  const draft = { kind, name: name.trim(), plannedMinor, dueOn, everyCycle };
  const changed = payback
    ? { name: draft.name, plannedMinor, dueOn }
    : cardBill
      ? { name: draft.name, plannedMinor, dueOn, everyCycle }
      : draft;
  const problems = checkCommitment(
    { ...draft, currency: cur },
    { cycleStartedOn: data.cycle.startedOn, ...currencyContext(data) },
  );
  const others = data.commitments.filter((c) => c.id !== editing?.id);
  const mine = {
    ...draft,
    kind: editing?.kind ?? draft.kind,
    currency: cur,
    state: editing?.state ?? ("open" as const),
    payments: editing?.payments ?? [],
  };
  const after = todayView(
    { ...entriesOf(data), commitments: plannedMinor > 0 ? [...others, mine] : others },
    today,
  );
  const comingUp = problems.length === 0 && !inThisCycle(dueOn, data.cycle.expectedSalaryOn);
  const back = () => {
    window.location.hash = "Plan";
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
        <a className="btn ghost link" href="#Plan">
          ← Back
        </a>
      </div>
      <h1>{editing ? "Change commitment" : "New commitment"}</h1>
      <section className="card stack">
        {planPayment && (
          <p className="tiny mute" data-testid="plan-payment-note">
            {planPaymentNote(data, editing as Commitment) ?? "Payment"} on{" "}
            {plan?.name ?? "an instalment plan"}. Salary day sets aside the next one.{" "}
            {plan && <a href={`#Instalments/${plan.id}`}>Open the plan</a>}
          </p>
        )}
        {payback && !planPayment && (
          <p className="tiny mute">
            Pays your savings back for a prepayment. Move it to savings when you put the money back. Salary
            day sets aside the next one.
          </p>
        )}
        {cardBill && (
          <p className="tiny mute" data-testid="card-bill-note">
            Card bill{card ? ` for ${card.name}` : ""}
            {card ? ` · balance ${formatMoney(cardBalance(data, card), card.currency)}` : ""}. Its money is
            already held from your card spends: paying it takes nothing more from free money.{" "}
            {card && <a href={`#Card/${card.id}`}>Open the card</a>}
          </p>
        )}
        {!payback && !cardBill && (
          <fieldset className="chips" aria-label="Kind">
            <button
              type="button"
              className="btn"
              aria-pressed={kind === "bill"}
              onClick={() => setKind("bill")}
            >
              Bill
            </button>
            <button
              type="button"
              className="btn"
              aria-pressed={kind === "savings"}
              onClick={() => setKind("savings")}
            >
              Savings
            </button>
          </fieldset>
        )}
        {kind === "savings" && (
          <p className="tiny mute">
            Set aside like a bill. When you move it to savings, mark it moved: it joins your savings.
          </p>
        )}
        <label className="field">
          Name
          <input
            value={name}
            maxLength={NAME_MAX}
            placeholder={kind === "savings" ? "Savings" : "Rent, electricity…"}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {!editing && (
          <CurrencyChoice
            currencies={currenciesOf(data.settings)}
            value={cur}
            onChange={(c) => {
              setCur(c);
              setText("");
            }}
          />
        )}
        <label className="field">
          Amount ({cur})
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
          Due date
          <input
            type="date"
            value={dueOn}
            min={data.cycle.startedOn}
            required
            onChange={(e) => setDueOn(e.target.value)}
          />
          <span className="tiny mute">
            {comingUp
              ? `After the expected salary day (${dayLabel(data.cycle.expectedSalaryOn)}): coming up only, not set aside now.`
              : `From ${dayLabel(data.cycle.startedOn)}. Due after ${dayLabel(data.cycle.expectedSalaryOn)} means next cycle.`}
          </span>
        </label>
        {!payback && (
          <label className="row check">
            <input type="checkbox" checked={everyCycle} onChange={(e) => setEveryCycle(e.target.checked)} />
            <span className="grow">
              Every cycle
              <span className="tiny mute block">
                Filled in again on salary day with this amount, on day {Number(dueOn.slice(8, 10)) || "–"} of
                the month
              </span>
            </span>
          </label>
        )}
        <p className="small" data-testid="commitment-after">
          You can spend today after this: <b>{formatMoney(after.allowanceMinor, spendCur)}</b>
        </p>
      </section>

      {editing && <Payments c={editing} actions={actions} />}

      {failed && <p className="error">Not saved. Check the connection and try again.</p>}

      <div className="row">
        {editing && !payback && (
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
          onClick={() =>
            run(() =>
              editing ? actions.change(editing, changed) : actions.add(newId(), { ...draft, currency: cur }),
            )
          }
        >
          Save
        </button>
      </div>
    </>
  );
}
