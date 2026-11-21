import { useState } from "react";
import {
  checkPlan,
  checkPlanExtra,
  formatMoney,
  NAME_MAX,
  PLAN_COUNT_MAX,
  parseAmount,
  planDueOn,
  planLastPaymentOn,
  planNextDueOn,
  planPaymentDueMinor,
  planProgress,
  planSavingMinor,
  savingsTotal,
  stillToPayMinor,
  todayView,
} from "../money";
import { api } from "./api";
import { CurrencyChoice, currenciesOf, currencyContext } from "./CurrencyChoice";
import { type Commitment, dayLabel, entriesOf, type Plan, type Ready, useToday } from "./data";
import { newId } from "./id";
import { PlaceChoice, usePlaceChoice } from "./PlaceChoice";
import { toText } from "./SpendSheet";
import type { Toaster } from "./toast";

const ok = async (res: Promise<Response | { ok: boolean }>) => (await res.catch(() => null))?.ok ?? false;

/** What New loan or instalments sends (spec 9). */
export interface PlanDraft {
  name: string;
  currency: string;
  priceMinor: number;
  paymentCount: number;
  paymentMinor: number;
  firstPaymentOn: string;
  cardId: string | null;
  normalMonthlyMinor: number | null;
}

const add = (id: string, d: PlanDraft) =>
  ok(api.api.plans.$post({ json: { id, commitmentId: newId(), ...d } }));
const remove = (id: string) => ok(api.api.plans[":id"].$delete({ param: { id } }));
const addExtra = (
  planId: string,
  id: string,
  d: { amountMinor: number; from: "free" | "savings"; paysOff: boolean; placeId?: string | null },
) => ok(api.api.plans[":id"].extra.$post({ param: { id: planId }, json: { id, ...d } }));
const removeExtra = (id: string) => ok(api.api.plans.extra[":id"].$delete({ param: { id } }));

const draftOf = (p: Plan): PlanDraft => ({
  name: p.name,
  currency: p.currency,
  priceMinor: p.priceMinor,
  paymentCount: p.paymentCount,
  paymentMinor: p.paymentMinor,
  firstPaymentOn: p.firstPaymentOn,
  cardId: p.cardId,
  normalMonthlyMinor: p.normalMonthlyMinor,
});

/** New plan, delete, Pay extra and Pay it all off; each success shows a toast with Undo. */
export function planActions({ done }: Toaster) {
  return {
    add: (id: string, d: PlanDraft) =>
      add(id, d).then((ok) => done(ok, { text: `${d.name} added`, undo: () => remove(id) })),
    /** Only while nothing is paid on it; Undo adds it back (with this cycle's payment). */
    remove: (p: Plan) =>
      remove(p.id).then((ok) => done(ok, { text: `${p.name} deleted`, undo: () => add(p.id, draftOf(p)) })),
    extra: (
      p: Plan,
      d: { amountMinor: number; from: "free" | "savings"; paysOff: boolean; placeId?: string | null },
    ) => {
      const id = newId();
      return addExtra(p.id, id, d).then((ok) =>
        done(ok, {
          text: d.paysOff ? `${p.name} paid off` : `Paid extra on ${p.name}`,
          undo: () => removeExtra(id),
        }),
      );
    },
  };
}

export type PlanActions = ReturnType<typeof planActions>;

/** A plan with its progress as the money rules work it out. */
function progressOf(data: Pick<Ready, "commitments" | "cycle">, p: Plan) {
  const g = planProgress(p);
  const open = data.commitments.filter((c) => c.planId === p.id && c.state === "open");
  const next = planNextDueOn(p, data.cycle, open[0]?.dueOn ?? null);
  return { g, open, last: planLastPaymentOn(p, next) };
}

/** "4 of 12": payments made of all of them (spec 9). */
const ofLabel = (g: ReturnType<typeof planProgress>) =>
  `${g.paymentsMade} of ${g.paymentsMade + g.paymentsLeft}`;

/** A plan payment's note on Plan and Next up (spec 10): "Payment 4 of 12". */
export function planPaymentNote(data: Pick<Ready, "plans">, c: Commitment): string | undefined {
  const p = c.planId ? data.plans.find((x) => x.id === c.planId) : undefined;
  if (!p) return undefined;
  const g = planProgress(p);
  return `Payment ${g.paymentsMade + 1} of ${g.paymentsMade + Math.max(1, g.paymentsLeft)}`;
}

const yearDay = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
/** "5 Nov 2027". */
const longDate = (day: string) => yearDay.format(new Date(`${day}T00:00:00Z`));

/** "Saved Rs 8,400 vs paying monthly, after Rs 1,200 interest" (spec 9). */
function savingLabel(saving: number, interest: number, currency: string): string {
  const after = interest > 0 ? `, after ${formatMoney(interest, currency)} interest` : "";
  return saving >= 0
    ? `Saved ${formatMoney(saving, currency)} vs paying monthly${after}`
    : `Cost ${formatMoney(-saving, currency)} more than paying monthly${after}`;
}

/** Money's plan rows (spec 10): each plan with "N of M" and what is still to pay; + New loan or instalments. */
export function MoneyPlans({ data }: { data: Ready }) {
  return (
    <section className="card" aria-labelledby="plans-h">
      <h3 id="plans-h">Loans and instalments</h3>
      {data.plans.length === 0 && (
        <p className="tiny mute">
          Each cycle sets aside the next payment, so free money only feels the payment.
        </p>
      )}
      {data.plans.map((p) => {
        const g = planProgress(p);
        return (
          <a key={p.id} className="li tap link" href={`#Instalments/${p.id}`}>
            <span className="grow">
              {p.name}
              <span className="tiny mute block">{g.done ? "Paid off" : ofLabel(g)}</span>
            </span>
            <span className="small mute" data-testid={`plan-left-${p.name}`}>
              {g.done ? "" : `${formatMoney(g.stillToPayMinor, p.currency)} left `}›
            </span>
          </a>
        );
      })}
      <a className="btn link add" href="#Instalments">
        + New loan or instalments
      </a>
    </section>
  );
}

function AmountField({
  label,
  text,
  currency,
  hint,
  onChange,
}: {
  label: string;
  text: string;
  currency: string;
  hint?: string;
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
      {hint && <span className="tiny mute">{hint}</span>}
    </label>
  );
}

const back = (
  <div className="row">
    <a className="btn ghost link" href="#Money">
      ← Back
    </a>
  </div>
);

/** An instalment plan page (spec 10): new, or its progress with Pay extra and Pay it all off. */
export function PlanPage({ data, editing, actions }: { data: Ready; editing?: Plan; actions: PlanActions }) {
  return editing ? (
    <PlanProgressPage data={data} plan={editing} actions={actions} />
  ) : (
    <NewPlan data={data} actions={actions} />
  );
}

/**
 * New loan or instalments (spec 9): name, currency, total price, number of
 * payments, payment amount, first payment date; optionally the card and the
 * normal monthly price. Shows the interest and the new allowance before saving.
 */
function NewPlan({ data, actions }: { data: Ready; actions: PlanActions }) {
  const today = useToday(data.settings.homeTimeZone);
  const [name, setName] = useState("");
  const [cur, setCur] = useState(data.settings.spendingCurrency);
  const [price, setPrice] = useState("");
  const [count, setCount] = useState("");
  const [payment, setPayment] = useState("");
  const [firstOn, setFirstOn] = useState(today);
  const [cardId, setCardId] = useState<string | null>(null);
  const [monthly, setMonthly] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const priceMinor = parseAmount(price, cur) ?? 0;
  const paymentCount = /^\d+$/.test(count) ? Number(count) : 0;
  const paymentMinor = parseAmount(payment, cur) ?? 0;
  const normalMonthlyMinor = monthly ? (parseAmount(monthly, cur) ?? 0) : null;
  const cards = data.cards.filter((k) => !k.archived && k.currency === cur);
  const draft: PlanDraft = {
    name: name.trim(),
    currency: cur,
    priceMinor,
    paymentCount,
    paymentMinor,
    firstPaymentOn: firstOn,
    cardId: cards.some((k) => k.id === cardId) ? cardId : null,
    normalMonthlyMinor,
  };
  const problems = checkPlan(draft, {
    ...currencyContext(data),
    cycleStartedOn: data.cycle.startedOn,
    cards: data.cards,
  });
  const fresh = { ...draft, id: "new", paidOffOn: null, paidMinor: 0, extraMinor: 0, paymentsMade: 0 };
  const dueOn = planDueOn(fresh, data.cycle.startedOn);
  const thisCycle = problems.length === 0 && dueOn <= data.cycle.expectedSalaryOn;
  const g = planProgress(fresh);
  const saving = problems.length === 0 ? planSavingMinor(fresh) : null;
  const entries = entriesOf(data);
  const after = todayView(
    thisCycle
      ? {
          ...entries,
          commitments: [
            ...entries.commitments,
            { dueOn, currency: cur, plannedMinor: planPaymentDueMinor(fresh), state: "open" as const },
          ],
        }
      : entries,
    today,
  );

  async function save() {
    setBusy(true);
    setFailed(false);
    const done = await actions.add(newId(), draft);
    setBusy(false);
    if (done) window.location.hash = "Money";
    else setFailed(true);
  }

  return (
    <>
      {back}
      <h1>New loan or instalments</h1>
      <section className="card stack">
        <label className="field">
          Name
          <input
            value={name}
            maxLength={NAME_MAX}
            placeholder="Phone, car loan…"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <CurrencyChoice
          currencies={currenciesOf(data.settings)}
          value={cur}
          onChange={(c) => {
            setCur(c);
            setPrice("");
            setPayment("");
            setMonthly("");
          }}
        />
        <AmountField
          label="Total price"
          text={price}
          currency={cur}
          hint="What it cost, or the loan amount."
          onChange={setPrice}
        />
        <label className="field">
          Number of payments
          <input
            value={count}
            inputMode="numeric"
            placeholder="12"
            onChange={(e) => /^\d{0,3}$/.test(e.target.value) && setCount(e.target.value)}
          />
        </label>
        <AmountField label="Each payment" text={payment} currency={cur} onChange={setPayment} />
        {priceMinor > 0 && paymentCount > 0 && paymentMinor > 0 && (
          <p className="small" data-testid="plan-interest">
            {problems.includes("total")
              ? "The payments add up to less than the price. Check them."
              : `All payments ${formatMoney(paymentCount * paymentMinor, cur)} · interest ${formatMoney(g.interestTotalMinor, cur)}`}
          </p>
        )}
        {problems.includes("count") && paymentCount > PLAN_COUNT_MAX && (
          <p className="small bad">At most {PLAN_COUNT_MAX} payments.</p>
        )}
        <label className="field">
          First payment
          <input
            type="date"
            value={firstOn}
            min={data.cycle.startedOn}
            required
            onChange={(e) => setFirstOn(e.target.value)}
          />
          <span className="tiny mute">
            {problems.includes("first_on")
              ? `From ${dayLabel(data.cycle.startedOn)}. A loan already running: enter what is left of it.`
              : "Each payment after it falls on the same day of the month."}
          </span>
        </label>
        {cards.length > 0 && (
          <label className="field">
            On a card
            <select value={draft.cardId ?? ""} onChange={(e) => setCardId(e.target.value || null)}>
              <option value="">No (a bank loan)</option>
              {cards.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <AmountField
          label="Normal monthly price"
          text={monthly}
          currency={cur}
          hint="Optional: what it costs a month without paying up front. Shows what you save."
          onChange={setMonthly}
        />
        {saving !== null && (
          <p className="small" data-testid="plan-saving-new">
            {savingLabel(saving, g.interestTotalMinor, cur)}
          </p>
        )}
        {problems.length === 0 && (
          <p className="small" data-testid="plan-after">
            {thisCycle
              ? `${formatMoney(planPaymentDueMinor(fresh), cur)} set aside now, due ${dayLabel(dueOn)}. You can spend today after this: `
              : `First payment ${dayLabel(dueOn)}: salary day sets it aside. You can spend today: `}
            <b>{formatMoney(after.allowanceMinor, data.settings.spendingCurrency)}</b>
          </p>
        )}
      </section>
      {failed && <p className="error">Not saved. Check the connection and try again.</p>}
      <button type="button" className="btn pri" disabled={busy || problems.length > 0} onClick={save}>
        Save
      </button>
    </>
  );
}

/**
 * A plan's progress (spec 9, 10): N of M with a bar and the last payment date,
 * paid and still to pay, interest so far and total, the prepayment saving, this
 * cycle's payment, Pay extra and Pay it all off (from free money or savings).
 */
function PlanProgressPage({ data, plan: p, actions }: { data: Ready; plan: Plan; actions: PlanActions }) {
  const { g, open, last } = progressOf(data, p);
  const money = (m: number) => formatMoney(m, p.currency);
  const card = p.cardId ? data.cards.find((k) => k.id === p.cardId) : undefined;
  const saving = planSavingMinor(p);
  const all = g.paymentsMade + g.paymentsLeft;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const unpaid = p.paidMinor === 0 && p.extras.length === 0;

  async function del() {
    setBusy(true);
    setFailed(false);
    const done = await actions.remove(p);
    setBusy(false);
    if (done) window.location.hash = "Money";
    else setFailed(true);
  }

  return (
    <>
      {back}
      <h1>{p.name}</h1>
      <section className="card stack">
        <div className="row">
          <b className="grow" data-testid="plan-of">
            {g.done ? "Paid off" : `${ofLabel(g)} payments`}
          </b>
          <span className="small mute" data-testid="plan-last">
            {p.paidOffOn ? `Paid off ${longDate(p.paidOffOn)}` : last ? `Last payment ${longDate(last)}` : ""}
          </span>
        </div>
        <span
          className="bar"
          role="meter"
          aria-label={`${p.name} paid`}
          aria-valuemin={0}
          aria-valuemax={g.paidMinor + g.stillToPayMinor}
          aria-valuenow={g.paidMinor}
        >
          <span
            style={{
              width: `${(g.done ? 1 : g.paidMinor / Math.max(1, g.paidMinor + g.stillToPayMinor)) * 100}%`,
            }}
          />
        </span>
        <p className="small" data-testid="plan-paid">
          Paid {money(g.paidMinor)} · still to pay <b>{money(g.stillToPayMinor)}</b>
        </p>
        <p className="small" data-testid="plan-interest">
          Interest so far {money(g.interestSoFarMinor)} of {money(Math.max(0, g.interestTotalMinor))}
        </p>
        <p className="tiny mute">
          Price {money(p.priceMinor)} · {all || p.paymentCount} payments of {money(p.paymentMinor)}
          {card ? ` · on ${card.name}` : ""}
        </p>
        {saving !== null && (
          <p className="small" data-testid="plan-saving">
            {savingLabel(saving, g.interestTotalMinor, p.currency)}
          </p>
        )}
      </section>

      {open.length > 0 && (
        <section className="card" aria-labelledby="plan-now-h">
          <h3 id="plan-now-h">This cycle's payment</h3>
          {open.map((c) => (
            <div key={c.id} className="stack">
              <a className="li tap link" href={`#Commitment/${c.id}`}>
                <span className="date">
                  <b>{dayLabel(c.dueOn)}</b>
                </span>
                <span className="grow">{c.name}</span>
                <b className="small">{money(stillToPayMinor(c))}</b>
              </a>
              <a className="btn pri link" href={`#Pay/${c.id}`}>
                Pay
              </a>
            </div>
          ))}
        </section>
      )}

      {!g.done && <PayExtra data={data} plan={p} open={open} actions={actions} />}

      {p.extras.length > 0 && (
        <section className="card" aria-labelledby="plan-extras-h">
          <h3 id="plan-extras-h">Paid extra</h3>
          {p.extras.map((x) => (
            <div key={x.id} className="li">
              <span className="grow">
                {dayLabel(x.paidOn)}
                <span className="tiny mute block">
                  {x.paysOff ? "Paid it all off" : "Pay extra"} · from{" "}
                  {x.paidFrom === "free" ? "free money" : "savings"}
                </span>
              </span>
              <b className="small">{money(x.amountMinor)}</b>
            </div>
          ))}
        </section>
      )}

      {failed && <p className="error">Not done. A plan with payments can't be deleted.</p>}
      {unpaid && (
        <button type="button" className="btn" disabled={busy} onClick={del}>
          Delete
        </button>
      )}
    </>
  );
}

/**
 * Pay extra and Pay it all off (spec 9): the money comes from free money or
 * savings (the user picks); the payments left drop. Pay it all off is filled
 * with everything still to pay (change it when the bank takes some off).
 * It names the place the money came out of (spec 6).
 */
function PayExtra({
  data,
  plan: p,
  open,
  actions,
}: {
  data: Ready;
  plan: Plan;
  open: Commitment[];
  actions: PlanActions;
}) {
  const today = useToday(data.settings.homeTimeZone);
  const g = planProgress(p);
  const setAsideMinor = open.reduce((t, c) => t + stillToPayMinor(c), 0);
  const [paysOff, setPaysOff] = useState(false);
  const [from, setFrom] = useState<"free" | "savings">("free");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const amountMinor = parseAmount(text, p.currency) ?? 0;
  const savingsMinor = savingsTotal(data.savings, p.currency);
  const place = usePlaceChoice(data.places, p.currency, "out");
  const problems = checkPlanExtra(
    { amountMinor, from, paysOff },
    { stillToPayMinor: g.stillToPayMinor, setAsideMinor, savingsMinor },
  );
  const entries = entriesOf(data);
  // Pay it all off finishes this cycle's payment: its money is no longer set aside.
  const commitments = paysOff
    ? entries.commitments.map((c) =>
        open.some((o) => o.id === c.id) ? { ...c, state: "finished" as const } : c,
      )
    : entries.commitments;
  const after = todayView(
    {
      ...entries,
      commitments,
      planExtras:
        from === "free" && amountMinor > 0
          ? [...entries.planExtras, { currency: p.currency, amountMinor }]
          : entries.planExtras,
    },
    today,
  );
  const leftAfter = Math.max(0, g.stillToPayMinor - amountMinor);

  function pick(off: boolean) {
    setPaysOff(off);
    setText(off ? toText(g.stillToPayMinor, p.currency) : "");
  }

  async function save() {
    setBusy(true);
    setFailed(false);
    place.remember();
    const done = await actions.extra(p, { amountMinor, from, paysOff, placeId: place.placeId });
    setBusy(false);
    if (done) setText("");
    else setFailed(true);
  }

  return (
    <section className="card stack" aria-labelledby="plan-extra-h">
      <h3 id="plan-extra-h">Pay more</h3>
      <fieldset className="chips" aria-label="Pay extra or all off">
        <button type="button" className="btn" aria-pressed={!paysOff} onClick={() => pick(false)}>
          Pay extra
        </button>
        <button type="button" className="btn" aria-pressed={paysOff} onClick={() => pick(true)}>
          Pay it all off
        </button>
      </fieldset>
      <AmountField
        label="Amount"
        text={text}
        currency={p.currency}
        hint={
          paysOff
            ? "Everything still to pay. Change it if the bank took some interest off."
            : `At most ${formatMoney(Math.max(0, g.stillToPayMinor - setAsideMinor), p.currency)}: this cycle's payment is already set aside.`
        }
        onChange={setText}
      />
      <fieldset className="chips" aria-label="From">
        <button type="button" className="btn" aria-pressed={from === "free"} onClick={() => setFrom("free")}>
          From free money
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={from === "savings"}
          onClick={() => setFrom("savings")}
        >
          From savings
        </button>
      </fieldset>
      <PlaceChoice label="Paid from" choice={place} />
      {amountMinor > 0 && problems.length === 0 && (
        <p className="small" data-testid="plan-extra-after">
          {paysOff
            ? "The plan ends: nothing more is set aside for it. "
            : `Still to pay after this: ${formatMoney(leftAfter, p.currency)}, ${Math.ceil(leftAfter / p.paymentMinor)} payments. `}
          {from === "free" ? (
            <>
              You can spend today after this:{" "}
              <b>{formatMoney(after.allowanceMinor, data.settings.spendingCurrency)}</b>
            </>
          ) : (
            <>
              Savings after this: <b>{formatMoney(savingsMinor - amountMinor, p.currency)}</b>
            </>
          )}
        </p>
      )}
      {problems.includes("too_much") && <p className="small bad">More than is left: use Pay it all off.</p>}
      {problems.includes("savings") && <p className="small bad">More than is in savings.</p>}
      {failed && <p className="error">Not saved. Check the connection and try again.</p>}
      <button type="button" className="btn pri" disabled={busy || problems.length > 0} onClick={save}>
        {paysOff ? "Pay it all off" : "Pay extra"}
      </button>
    </section>
  );
}
