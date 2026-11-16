import { useState } from "react";
import {
  type ADD_INCOME_KINDS,
  checkIncome,
  checkPrepayment,
  checkSavingsMove,
  combinedSavingsMinor,
  formatMoney,
  MONTHS_MAX,
  NAME_MAX,
  parseAmount,
  paybackCycles,
  prepaymentProgress,
  prepaymentSavingMinor,
  savingsTotal,
  todayView,
} from "../money";
import { api } from "./api";
import { CurrencyChoice, currenciesOf, currencyContext } from "./CurrencyChoice";
import { dayLabel, entriesOf, type Ready, type SavingsLine, useToday } from "./data";
import { newId } from "./id";
import type { Toaster } from "./toast";

const ok = async (res: Promise<Response | { ok: boolean }>) => (await res.catch(() => null))?.ok ?? false;

const addMove = (id: string, kind: "put_in" | "take_out", amountMinor: number, currency: string) =>
  ok(api.api["savings-movements"].$post({ json: { id, kind, amountMinor, currency } }));
const removeMove = (id: string) => ok(api.api["savings-movements"][":id"].$delete({ param: { id } }));
const addIncome = (
  id: string,
  kind: IncomeKindAdded,
  amountMinor: number,
  toSavingsMinor: number,
  currency: string,
) => ok(api.api.incomes.$post({ json: { id, kind, amountMinor, toSavingsMinor, currency } }));

/** What Add income records (spec 5): extra income, or loan money received as cash (item 19). */
type IncomeKindAdded = (typeof ADD_INCOME_KINDS)[number];
const removeIncome = (id: string) => ok(api.api.incomes[":id"].$delete({ param: { id } }));
const addPrepayment = (json: {
  id: string;
  movementId: string;
  commitmentId: string;
  name: string;
  currency: string;
  totalMinor: number;
  paybackMinor: number;
  normalMonthlyMinor: number | null;
  months: number | null;
}) => ok(api.api.prepayments.$post({ json }));

/** What a prepayment saved against paying monthly: "Saved Rs 12,000 vs paying monthly". */
export function savingLabel(savingMinor: number, currency: string): string {
  return savingMinor >= 0
    ? `Saved ${formatMoney(savingMinor, currency)} vs paying monthly`
    : `Cost ${formatMoney(-savingMinor, currency)} more than paying monthly`;
}
const removePrepayment = (id: string) => ok(api.api.prepayments[":id"].$delete({ param: { id } }));

/** Put in, Take out and Add income; each success shows a toast with Undo (spec 5). */
export function savingsActions({ done }: Toaster) {
  return {
    move: (kind: "put_in" | "take_out", amountMinor: number, currency: string) => {
      const id = newId();
      return addMove(id, kind, amountMinor, currency).then((ok) =>
        done(ok, {
          text:
            kind === "take_out"
              ? `${formatMoney(amountMinor, currency)} taken out of savings`
              : `${formatMoney(amountMinor, currency)} put in savings`,
          undo: () => removeMove(id),
        }),
      );
    },
    /** Take out "for a prepayment" (item 14): out of savings, with this cycle's payback set aside. */
    prepay: (p: {
      name: string;
      currency: string;
      totalMinor: number;
      paybackMinor: number;
      normalMonthlyMinor: number | null;
      months: number | null;
    }) => {
      const id = newId();
      const { name } = p;
      return addPrepayment({ id, movementId: newId(), commitmentId: newId(), ...p }).then((ok) =>
        done(ok, { text: `${name} prepayment saved`, undo: () => removePrepayment(id) }),
      );
    },
    addIncome: (kind: IncomeKindAdded, amountMinor: number, toSavingsMinor: number, currency: string) => {
      const id = newId();
      return addIncome(id, kind, amountMinor, toSavingsMinor, currency).then((ok) =>
        done(ok, {
          text: kind === "loan" ? "Loan money added" : "Income added",
          undo: () => removeIncome(id),
        }),
      );
    },
  };
}

export type SavingsActions = ReturnType<typeof savingsActions>;

const lineName: Record<SavingsLine["kind"], string> = {
  put_in: "Put in",
  take_out: "Taken out",
  income: "From extra income",
  leftover: "Saved leftover",
  set_aside: "Set aside",
  prepayment: "Prepayment",
  payback: "Paid back",
  rate_gain: "Rate gain",
  plan_extra: "Paid off a plan",
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
  const list = currenciesOf(data.settings);
  const total = combinedSavingsMinor(data.savings, {
    ...currencyContext(data),
    countingRate: data.settings.countingRate,
  });
  const anySaved = list.some((c) => savingsTotal(data.savings, c) > 0);
  return (
    <>
      <Back to="Money" />
      <h1>Savings</h1>
      <section className="card stack">
        <p className="amount" data-testid="savings-total">
          {formatMoney(total, cur)}
        </p>
        {list.length > 1 && (
          <>
            {list.map((c) => (
              <div key={c} className="li" data-testid={`savings-total-${c}`}>
                <span className="grow">{c}</span>
                <b className="small">{formatMoney(savingsTotal(data.savings, c), c)}</b>
              </div>
            ))}
            <p className="tiny mute">Combined in {cur} at the counting rate.</p>
          </>
        )}
        <div className="row">
          {anySaved ? (
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
      {data.prepayments.length > 0 && (
        <section className="card" aria-labelledby="prepay-h">
          <h3 id="prepay-h">Prepayments</h3>
          {data.prepayments.map((p) => {
            const g = prepaymentProgress(p);
            const saving = prepaymentSavingMinor(p);
            return (
              <div key={p.id} className="stack" data-testid="prepayment">
                <div className="li">
                  <span className="grow">
                    {p.name}
                    <span className="tiny mute block">
                      {g.done
                        ? "Paid back"
                        : `${formatMoney(p.paybackMinor, p.currency)} a cycle · ${g.cyclesLeft} more cycle${g.cyclesLeft === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <b className="small">
                    {formatMoney(g.paidBackMinor, p.currency)} of {formatMoney(p.totalMinor, p.currency)}
                  </b>
                </div>
                <span
                  className="bar"
                  role="meter"
                  aria-label={`${p.name} paid back`}
                  aria-valuemin={0}
                  aria-valuemax={p.totalMinor}
                  aria-valuenow={Math.min(p.totalMinor, g.paidBackMinor)}
                >
                  <span style={{ width: `${Math.min(1, g.paidBackMinor / p.totalMinor) * 100}%` }} />
                </span>
                {saving !== null && (
                  <p className="tiny mute" data-testid="prepayment-saving">
                    {savingLabel(saving, p.currency)}
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}
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
 * Take out asks "For a prepayment?" (item 14): Yes, pay back takes the money out
 * of savings for something paid up front (free money stays the same) and sets
 * aside a payback each cycle, this one at once.
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
  const spendCur = data.settings.spendingCurrency;
  const [cur, setCur] = useState(spendCur);
  const today = useToday(data.settings.homeTimeZone);
  const [text, setText] = useState("");
  const [prepay, setPrepay] = useState(false);
  const [name, setName] = useState("");
  const [paybackText, setPaybackText] = useState("");
  const [monthlyText, setMonthlyText] = useState("");
  /** Null until changed: the months shown are the number of paybacks. */
  const [monthsText, setMonthsText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const total = savingsTotal(data.savings, cur);
  const amountMinor = parseAmount(text, cur) ?? 0;
  const paybackMinor = parseAmount(paybackText, cur) ?? 0;
  const takeOut = kind === "take_out";
  const forPrepayment = takeOut && prepay;
  const cycles =
    paybackMinor > 0 && paybackMinor <= amountMinor ? paybackCycles(amountMinor, paybackMinor) : 0;
  const monthsShown = monthsText ?? (cycles > 0 ? String(cycles) : "");
  const withMonthly = monthlyText !== "";
  const normalMonthlyMinor = withMonthly ? (parseAmount(monthlyText, cur) ?? -1) : null;
  const months = withMonthly ? (/^\d+$/.test(monthsShown) ? Number(monthsShown) : -1) : null;
  const saving =
    normalMonthlyMinor !== null && normalMonthlyMinor > 0 && months !== null && months > 0 && amountMinor > 0
      ? prepaymentSavingMinor({ totalMinor: amountMinor, normalMonthlyMinor, months })
      : null;
  const problems: string[] = forPrepayment
    ? checkPrepayment(
        { name, currency: cur, totalMinor: amountMinor, paybackMinor, normalMonthlyMinor, months },
        { ...currencyContext(data), savingsMinor: total },
      )
    : checkSavingsMove({ kind, currency: cur, amountMinor, totalMinor: total }, currencyContext(data));
  const entries = entriesOf(data);
  // A prepayment does not come to free money; its first payback is set aside today.
  const payback = {
    dueOn: today,
    currency: cur,
    plannedMinor: Math.min(paybackMinor, amountMinor),
    state: "open" as const,
    payments: [],
  };
  const after = todayView(
    forPrepayment
      ? paybackMinor > 0
        ? { ...entries, commitments: [...entries.commitments, payback] }
        : entries
      : takeOut && amountMinor > 0
        ? { ...entries, takenOut: [...entries.takenOut, { currency: cur, amountMinor, movedOn: today }] }
        : entries,
    today,
  );

  async function save() {
    setBusy(true);
    setFailed(false);
    const ok = forPrepayment
      ? await actions.prepay({
          name: name.trim(),
          currency: cur,
          totalMinor: amountMinor,
          paybackMinor,
          normalMonthlyMinor,
          months,
        })
      : await actions.move(kind, amountMinor, cur);
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
        <CurrencyChoice
          currencies={currenciesOf(data.settings)}
          value={cur}
          onChange={(c) => {
            setCur(c);
            setText("");
            setPaybackText("");
            setMonthlyText("");
          }}
        />
        <AmountField label="Amount" text={text} currency={cur} onChange={setText} />
        {problems.includes("too_much") && (
          <p className="small bad">More than is saved ({formatMoney(total, cur)}).</p>
        )}
        {takeOut && (
          <fieldset className="stack" aria-label="For a prepayment?">
            <span className="small">For a prepayment?</span>
            <div className="chips">
              <button type="button" className="btn" aria-pressed={!prepay} onClick={() => setPrepay(false)}>
                No
              </button>
              <button type="button" className="btn" aria-pressed={prepay} onClick={() => setPrepay(true)}>
                Yes, pay back
              </button>
            </div>
          </fieldset>
        )}
        {forPrepayment && (
          <>
            <p className="tiny mute">
              Something paid up front, like a year of gym. Each cycle a payback goes back into savings, so
              your free money feels the same as paying monthly.
            </p>
            <label className="field">
              What for
              <input
                value={name}
                maxLength={NAME_MAX}
                placeholder="Gym"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <AmountField
              label="Pay back each cycle"
              text={paybackText}
              currency={cur}
              onChange={setPaybackText}
            />
            {problems.includes("payback") && paybackMinor > 0 && (
              <p className="small bad">At most the whole amount.</p>
            )}
            {amountMinor > 0 && paybackMinor > 0 && paybackMinor <= amountMinor && (
              <p className="small" data-testid="payback-cycles">
                Paid back in <b>{paybackCycles(amountMinor, paybackMinor)} cycles</b>, the first set aside
                now.
              </p>
            )}
            <AmountField
              label="Normal monthly price, optional"
              text={monthlyText}
              currency={cur}
              onChange={setMonthlyText}
            />
            {withMonthly && (
              <label className="field">
                How many months it covers
                <input
                  value={monthsShown}
                  inputMode="numeric"
                  placeholder="12"
                  onChange={(e) => /^\d{0,3}$/.test(e.target.value) && setMonthsText(e.target.value)}
                />
                {monthsText === null && cycles > 0 && (
                  <span className="tiny mute">
                    One per payback. Change it if it covers more or fewer months.
                  </span>
                )}
              </label>
            )}
            {problems.includes("months") && withMonthly && (
              <p className="small bad">Type the months it covers (1 to {MONTHS_MAX}).</p>
            )}
            {saving !== null && (
              <p className="small" data-testid="prepayment-saving-new">
                {savingLabel(saving, cur)}
              </p>
            )}
          </>
        )}
        {forPrepayment ? (
          <p className="small" data-testid="savings-after">
            Free money stays the same, less this cycle's payback. You can spend today after this:{" "}
            <b>{formatMoney(after.allowanceMinor, spendCur)}</b>
          </p>
        ) : takeOut ? (
          <p className="small" data-testid="savings-after">
            It goes to free money. You can spend today after this:{" "}
            <b>{formatMoney(after.allowanceMinor, spendCur)}</b>
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
 * money, and the new allowance before saving. Kinds: extra income and loan
 * money received as cash (item 19); borrowed and paid back to me come with item 20.
 */
export function AddIncomePage({ data, actions }: { data: Ready; actions: SavingsActions }) {
  const spendCur = data.settings.spendingCurrency;
  const [cur, setCur] = useState(spendCur);
  const [kind, setKind] = useState<IncomeKindAdded>("extra");
  const today = useToday(data.settings.homeTimeZone);
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const amountMinor = parseAmount(text, cur) ?? 0;
  const toSavingsMinor = parseAmount(savedText, cur) ?? 0;
  const problems = checkIncome({ kind, currency: cur, amountMinor, toSavingsMinor }, currencyContext(data));
  const entries = entriesOf(data);
  const after = todayView(
    problems.length === 0
      ? {
          ...entries,
          incomes: [
            ...entries.incomes,
            { kind, currency: cur, amountMinor, toSavingsMinor, receivedOn: today },
          ],
        }
      : entries,
    today,
  );

  async function save() {
    setBusy(true);
    setFailed(false);
    const ok = await actions.addIncome(kind, amountMinor, toSavingsMinor, cur);
    setBusy(false);
    if (ok) window.location.hash = "Money";
    else setFailed(true);
  }

  return (
    <>
      <Back to="Money" />
      <h1>Add income</h1>
      <section className="card stack">
        <fieldset className="stack" aria-label="Kind">
          <div className="row">
            {(
              [
                ["extra", "Extra income"],
                ["loan", "Loan money"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="row check grow">
                <input type="radio" name="income-kind" checked={kind === k} onChange={() => setKind(k)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <span className="tiny mute">
            {kind === "loan"
              ? "A loan paid to you as cash. Add the loan itself under Money › New loan or instalments."
              : "A bonus, a refund. Dated today."}
          </span>
        </fieldset>
        <CurrencyChoice
          currencies={currenciesOf(data.settings)}
          value={cur}
          onChange={(c) => {
            setCur(c);
            setText("");
            setSavedText("");
          }}
        />
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
          You can spend today after this: <b>{formatMoney(after.allowanceMinor, spendCur)}</b>
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
