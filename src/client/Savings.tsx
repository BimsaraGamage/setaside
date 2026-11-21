import { useState } from "react";
import {
  ADD_INCOME_KINDS,
  checkGotBack,
  checkIncome,
  checkPersonDebt,
  checkPrepayment,
  checkSavingsMove,
  combinedSavingsMinor,
  debtProgress,
  formatMoney,
  MONTHS_MAX,
  NAME_MAX,
  PERSON_NAME_MAX,
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
import type { PeopleActions } from "./People";
import { PlaceChoice, usePlaceChoice } from "./PlaceChoice";
import { toText } from "./SpendSheet";
import type { Toaster } from "./toast";

const ok = async (res: Promise<Response | { ok: boolean }>) => (await res.catch(() => null))?.ok ?? false;

const addMove = (
  id: string,
  kind: "put_in" | "take_out",
  amountMinor: number,
  currency: string,
  placeId: string | null,
) => ok(api.api["savings-movements"].$post({ json: { id, kind, amountMinor, currency, placeId } }));
const removeMove = (id: string) => ok(api.api["savings-movements"][":id"].$delete({ param: { id } }));
const addIncome = (
  id: string,
  kind: IncomeKindAdded,
  amountMinor: number,
  toSavingsMinor: number,
  currency: string,
  placeId: string | null,
) => ok(api.api.incomes.$post({ json: { id, kind, amountMinor, toSavingsMinor, currency, placeId } }));

/** What Add income records (spec 5): extra income, loan money received as cash (item 19), borrowed and paid back to me (item 20). */
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
  placeId: string | null;
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
    /** Put in names the place the money went into (spec 6); a take-out stays where it is. */
    move: (
      kind: "put_in" | "take_out",
      amountMinor: number,
      currency: string,
      placeId: string | null = null,
    ) => {
      const id = newId();
      return addMove(id, kind, amountMinor, currency, placeId).then((ok) =>
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
      /** The place it was paid out of (spec 6). */
      placeId: string | null;
    }) => {
      const id = newId();
      const { name } = p;
      return addPrepayment({ id, movementId: newId(), commitmentId: newId(), ...p }).then((ok) =>
        done(ok, { text: `${name} prepayment saved`, undo: () => removePrepayment(id) }),
      );
    },
    addIncome: (
      kind: IncomeKindAdded,
      amountMinor: number,
      toSavingsMinor: number,
      currency: string,
      placeId: string | null = null,
    ) => {
      const id = newId();
      return addIncome(id, kind, amountMinor, toSavingsMinor, currency, placeId).then((ok) =>
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
 * Put in names the place the money went into, a prepayment the place it was paid
 * from (spec 6); money taken out into free money stays where it is.
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
  const place = usePlaceChoice(data.places, cur, takeOut ? "out" : "in", takeOut && !prepay);
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
    place.remember();
    const ok = forPrepayment
      ? await actions.prepay({
          name: name.trim(),
          currency: cur,
          totalMinor: amountMinor,
          paybackMinor,
          normalMonthlyMinor,
          months,
          placeId: place.placeId,
        })
      : await actions.move(kind, amountMinor, cur, place.placeId);
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
        <PlaceChoice label={forPrepayment ? "Paid from" : "Received in"} choice={place} />
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
 * money received as cash (item 19); borrowed from a person (with when it is paid
 * back) and paid back to me (on money lent), saved with their person (item 20).
 * Each names the place the money landed in (spec 6), starting on the one used last.
 */
export function AddIncomePage({
  data,
  actions,
  people,
  kind: startKind,
  personId,
}: {
  data: Ready;
  actions: SavingsActions;
  people: PeopleActions;
  kind?: string;
  personId?: string;
}) {
  const spendCur = data.settings.spendingCurrency;
  const lentOpen = data.people.filter((p) => p.direction === "lent" && !debtProgress(p).closed);
  const firstKind = (ADD_INCOME_KINDS as readonly string[]).includes(startKind ?? "")
    ? (startKind as IncomeKindAdded)
    : "extra";
  const [kind, setKind] = useState<IncomeKindAdded>(firstKind);
  const [whoId, setWhoId] = useState(lentOpen.find((p) => p.id === personId)?.id ?? lentOpen[0]?.id ?? "");
  const who = kind === "paid_back" ? lentOpen.find((p) => p.id === whoId) : undefined;
  const [cur, setCur] = useState(who?.currency ?? spendCur);
  const today = useToday(data.settings.homeTimeZone);
  const [text, setText] = useState(who ? toText(debtProgress(who).owedMinor, who.currency) : "");
  const [savedText, setSavedText] = useState("");
  const [name, setName] = useState("");
  const [paybackOn, setPaybackOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const amountMinor = parseAmount(text, cur) ?? 0;
  const toSavingsMinor = parseAmount(savedText, cur) ?? 0;
  const place = usePlaceChoice(data.places, cur, "in");
  const problems: string[] = checkIncome(
    { kind, currency: cur, amountMinor, toSavingsMinor },
    currencyContext(data),
  );
  const payback = kind === "borrowed" && paybackOn ? { plannedMinor: amountMinor, dueOn: paybackOn } : null;
  if (kind === "borrowed") {
    problems.push(
      ...checkPersonDebt(
        { direction: "borrowed", personName: name, currency: cur, amountMinor, toSavingsMinor, payback },
        { ...currencyContext(data), cycleStartedOn: data.cycle.startedOn },
      ),
    );
  }
  if (kind === "paid_back") {
    if (!who) problems.push("entry");
    else problems.push(...checkGotBack({ amountMinor, toSavingsMinor }, who));
  }
  const entries = entriesOf(data);
  const after = todayView(
    amountMinor > 0 && toSavingsMinor <= amountMinor
      ? {
          ...entries,
          incomes: [
            ...entries.incomes,
            { kind, currency: cur, amountMinor, toSavingsMinor, receivedOn: today },
          ],
          // A payback due by the salary day is set aside at once.
          commitments: payback
            ? [...entries.commitments, { ...payback, currency: cur, state: "open" as const }]
            : entries.commitments,
        }
      : entries,
    today,
  );

  function pickKind(k: IncomeKindAdded) {
    setKind(k);
    if (k === "paid_back") pickWho(whoId);
  }

  function pickWho(id: string) {
    setWhoId(id);
    const p = lentOpen.find((x) => x.id === id);
    if (!p) return;
    setCur(p.currency);
    setText(toText(debtProgress(p).owedMinor, p.currency));
    setSavedText("");
  }

  async function save() {
    setBusy(true);
    setFailed(false);
    place.remember();
    const ok =
      kind === "borrowed"
        ? await people.add({
            direction: "borrowed",
            personName: name.trim(),
            currency: cur,
            amountMinor,
            toSavingsMinor,
            payback,
            placeId: place.placeId,
          })
        : kind === "paid_back" && who
          ? await people.gotBack(who, amountMinor, toSavingsMinor, place.placeId)
          : await actions.addIncome(kind, amountMinor, toSavingsMinor, cur, place.placeId);
    setBusy(false);
    if (ok) window.location.hash = kind === "borrowed" || kind === "paid_back" ? "People" : "Money";
    else setFailed(true);
  }

  return (
    <>
      <Back to="Money" />
      <h1>Add income</h1>
      <section className="card stack">
        <fieldset className="stack" aria-label="Kind">
          <div className="row wrap">
            {(
              [
                ["extra", "Extra income"],
                ["loan", "Loan money"],
                ["borrowed", "Borrowed"],
                ["paid_back", "Paid back to me"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="row check grow">
                <input type="radio" name="income-kind" checked={kind === k} onChange={() => pickKind(k)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <span className="tiny mute">
            {kind === "loan"
              ? "A loan paid to you as cash. Add the loan itself under Money › New loan or instalments."
              : kind === "borrowed"
                ? "Money a person lent you. It is listed under People until you pay it back."
                : kind === "paid_back"
                  ? "Money you lent coming back. Dated today."
                  : "A bonus, a refund. Dated today."}
          </span>
        </fieldset>
        {kind === "borrowed" && (
          <label className="field">
            From whom
            <input
              value={name}
              maxLength={PERSON_NAME_MAX}
              placeholder="Name"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        {kind === "paid_back" &&
          (lentOpen.length === 0 ? (
            <p className="small mute">Nobody owes you money. Add it under People › I lent money first.</p>
          ) : (
            <label className="field">
              Who paid you back
              <select value={whoId} onChange={(e) => pickWho(e.target.value)}>
                {lentOpen.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.personName} · owes {formatMoney(debtProgress(p).owedMinor, p.currency)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        {kind !== "paid_back" && (
          <CurrencyChoice
            currencies={currenciesOf(data.settings)}
            value={cur}
            onChange={(c) => {
              setCur(c);
              setText("");
              setSavedText("");
            }}
          />
        )}
        <AmountField label="Amount" text={text} currency={cur} onChange={setText} />
        {problems.includes("too_much") && <p className="small bad">More than they owe you.</p>}
        <AmountField label="To savings" text={savedText} currency={cur} onChange={setSavedText} />
        {problems.includes("to_savings") ? (
          <p className="small bad">To savings can't be more than the amount.</p>
        ) : (
          <p className="small" data-testid="income-split">
            To free money: <b>{formatMoney(Math.max(0, amountMinor - toSavingsMinor), cur)}</b>
          </p>
        )}
        <PlaceChoice label="Received in" choice={place} />
        {kind === "borrowed" && (
          <label className="field">
            Pay back on
            <input
              type="date"
              value={paybackOn}
              min={data.cycle.startedOn}
              onChange={(e) => setPaybackOn(e.target.value)}
            />
            <span className="tiny mute">
              Optional. The whole amount is set aside as a payback on that day; change it later on its page.
            </span>
          </label>
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
