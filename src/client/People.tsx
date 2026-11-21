import { useState } from "react";
import {
  checkPayback,
  checkPersonDebt,
  debtProgress,
  formatMoney,
  PERSON_NAME_MAX,
  parseAmount,
  paybackFillMinor,
  stillToPayMinor,
  todayView,
} from "../money";
import { api } from "./api";
import { CurrencyChoice, currenciesOf, currencyContext } from "./CurrencyChoice";
import { type Commitment, dayLabel, entriesOf, type Person, type Ready, useToday } from "./data";
import { newId } from "./id";
import { PlaceChoice, usePlaceChoice } from "./PlaceChoice";
import { toText } from "./SpendSheet";
import type { Toaster } from "./toast";

const ok = async (res: Promise<Response | { ok: boolean }>) => (await res.catch(() => null))?.ok ?? false;

/** What I lent money and I borrowed send (spec 9). */
export interface PersonDraft {
  direction: "lent" | "borrowed";
  personName: string;
  currency: string;
  amountMinor: number;
  /** Borrowed: the part sent to savings. */
  toSavingsMinor: number;
  /** Borrowed: the payback, when a date is given. */
  payback: { plannedMinor: number; dueOn: string } | null;
  /** Lent: the place the money came out of. Borrowed: the place it landed in (spec 6). */
  placeId?: string | null;
}

const add = (id: string, d: PersonDraft) =>
  ok(
    api.api.people.$post({
      json: {
        id,
        ...d,
        incomeId: d.direction === "borrowed" ? newId() : undefined,
        payback: d.payback ? { id: newId(), ...d.payback } : null,
      },
    }),
  );
const remove = (id: string) => ok(api.api.people[":id"].$delete({ param: { id } }));
const addBack = (
  personId: string,
  id: string,
  amountMinor: number,
  toSavingsMinor: number,
  placeId: string | null,
) =>
  ok(
    api.api.people[":id"].back.$post({
      param: { id: personId },
      json: { id, amountMinor, toSavingsMinor, placeId },
    }),
  );
const removeIncome = (id: string) => ok(api.api.incomes[":id"].$delete({ param: { id } }));
const addPayback = (personId: string, id: string, plannedMinor: number, dueOn: string) =>
  ok(api.api.people[":id"].payback.$post({ param: { id: personId }, json: { id, plannedMinor, dueOn } }));
const removeCommitment = (id: string) => ok(api.api.commitments[":id"].$delete({ param: { id } }));
const settle = (id: string, settled: boolean) =>
  ok(api.api.people[":id"].$patch({ param: { id }, json: { settled } }));

/** Lend, borrow, Got it back, add a payback, Settled and delete; each success shows a toast with Undo. */
export function peopleActions({ done }: Toaster) {
  return {
    add: (d: PersonDraft) => {
      const id = newId();
      return add(id, d).then((ok) =>
        done(ok, {
          text:
            d.direction === "lent"
              ? `Lent ${formatMoney(d.amountMinor, d.currency)} to ${d.personName}`
              : `Borrowed ${formatMoney(d.amountMinor, d.currency)} from ${d.personName}`,
          undo: () => remove(id),
        }),
      );
    },
    /** Only in the cycle it was made, while nothing is back. */
    remove: (p: Person) => remove(p.id).then((ok) => done(ok, { text: `${p.personName} deleted` })),
    gotBack: (p: Person, amountMinor: number, toSavingsMinor: number, placeId: string | null = null) => {
      const id = newId();
      return addBack(p.id, id, amountMinor, toSavingsMinor, placeId).then((ok) =>
        done(ok, {
          text: `Got ${formatMoney(amountMinor, p.currency)} back from ${p.personName}`,
          undo: () => removeIncome(id),
        }),
      );
    },
    payback: (p: Person, plannedMinor: number, dueOn: string) => {
      const id = newId();
      return addPayback(p.id, id, plannedMinor, dueOn).then((ok) =>
        done(ok, { text: `Payback to ${p.personName} set aside`, undo: () => removeCommitment(id) }),
      );
    },
    settle: (p: Person) =>
      settle(p.id, true).then((ok) =>
        done(ok, { text: `${p.personName} settled`, undo: () => settle(p.id, false) }),
      ),
  };
}

export type PeopleActions = ReturnType<typeof peopleActions>;

/** "Lent · 5 Nov" or "Borrowed · 5 Nov". */
const whatLabel = (p: Person) => `${p.direction === "lent" ? "Lent" : "Borrowed"} · ${dayLabel(p.madeOn)}`;

/** A borrowed entry's open paybacks in this cycle. */
const openPaybacks = (data: Pick<Ready, "commitments">, p: Person) =>
  data.commitments.filter((c) => c.personDebtId === p.id && c.state === "open");

/** A payback's note on Plan and Next up (spec 10): "Borrowed from Nimal". */
export function paybackNote(
  data: Pick<Ready, "people">,
  c: Pick<Commitment, "personDebtId">,
): string | undefined {
  const p = c.personDebtId ? data.people.find((x) => x.id === c.personDebtId) : undefined;
  return p ? `Borrowed from ${p.personName}` : undefined;
}

/** Money's People row (spec 10): how many owe or are owed. */
export function MoneyPeople({ data }: { data: Ready }) {
  const open = data.people.filter((p) => !debtProgress(p).closed);
  return (
    <section className="card">
      <a className="li tap link" href="#People">
        <span className="grow">People</span>
        <span className="small mute" data-testid="money-people">
          {open.length ? `${open.length} open ` : ""}›
        </span>
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

const back = (to: string) => (
  <div className="row">
    <a className="btn ghost link" href={`#${to}`}>
      ← Back
    </a>
  </div>
);

function PersonRow({ data, p }: { data: Ready; p: Person }) {
  const g = debtProgress(p);
  const due = openPaybacks(data, p)[0]?.dueOn;
  return (
    <a className="li tap link" href={`#Person/${p.id}`}>
      <span className="grow">
        {p.personName}
        <span className="tiny mute block">
          {whatLabel(p)}
          {due ? ` · pay back ${dayLabel(due)}` : ""}
        </span>
      </span>
      <span className="small mute" data-testid={`person-owed-${p.personName}`}>
        {g.closed
          ? p.settledOn
            ? "Settled ›"
            : "Paid back ›"
          : `${p.direction === "lent" ? "Owes you" : "You owe"} ${formatMoney(g.owedMinor, p.currency)} ›`}
      </span>
    </a>
  );
}

/** People (spec 9, 10): who owes what, each in its own currency; I lent money, I borrowed. */
export function PeoplePage({ data }: { data: Ready }) {
  const open = data.people.filter((p) => !debtProgress(p).closed);
  const closed = data.people.filter((p) => debtProgress(p).closed);
  return (
    <>
      {back("Money")}
      <h1>People</h1>
      <section className="card" aria-labelledby="people-open-h">
        <h3 id="people-open-h">Open</h3>
        {open.length === 0 && <p className="tiny mute">Nobody owes you and you owe nobody.</p>}
        {open.map((p) => (
          <PersonRow key={p.id} data={data} p={p} />
        ))}
        <div className="row">
          <a className="btn link grow" href="#Lend">
            I lent money
          </a>
          <a className="btn link grow" href="#AddIncome/borrowed">
            I borrowed
          </a>
        </div>
      </section>
      {closed.length > 0 && (
        <section className="card" aria-labelledby="people-closed-h">
          <h3 id="people-closed-h">Settled</h3>
          {[...closed].reverse().map((p) => (
            <PersonRow key={p.id} data={data} p={p} />
          ))}
        </section>
      )}
    </>
  );
}

/** I lent money (spec 9): name, currency, amount and the place it came out of; it comes out of free money now. */
export function LendPage({ data, actions }: { data: Ready; actions: PeopleActions }) {
  const spendCur = data.settings.spendingCurrency;
  const today = useToday(data.settings.homeTimeZone);
  const [name, setName] = useState("");
  const [cur, setCur] = useState(spendCur);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const amountMinor = parseAmount(text, cur) ?? 0;
  const place = usePlaceChoice(data.places, cur, "out");
  const draft: PersonDraft = {
    direction: "lent",
    personName: name.trim(),
    currency: cur,
    amountMinor,
    toSavingsMinor: 0,
    payback: null,
    placeId: place.placeId,
  };
  const problems = checkPersonDebt(draft, { ...currencyContext(data), cycleStartedOn: data.cycle.startedOn });
  const entries = entriesOf(data);
  const after = todayView(
    amountMinor > 0 ? { ...entries, lent: [...entries.lent, { currency: cur, amountMinor }] } : entries,
    today,
  );

  async function save() {
    setBusy(true);
    setFailed(false);
    place.remember();
    const done = await actions.add(draft);
    setBusy(false);
    if (done) window.location.hash = "People";
    else setFailed(true);
  }

  return (
    <>
      {back("People")}
      <h1>I lent money</h1>
      <section className="card stack">
        <label className="field">
          To whom
          <input
            value={name}
            maxLength={PERSON_NAME_MAX}
            placeholder="Name"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <CurrencyChoice
          currencies={currenciesOf(data.settings)}
          value={cur}
          onChange={(c) => {
            setCur(c);
            setText("");
          }}
        />
        <AmountField label="Amount" text={text} currency={cur} onChange={setText} />
        <PlaceChoice label="Paid from" choice={place} />
        <p className="small" data-testid="lend-after">
          It comes out of free money now. You can spend today after this:{" "}
          <b>{formatMoney(after.allowanceMinor, spendCur)}</b>
        </p>
      </section>
      {failed && <p className="error">Not saved. Check the connection and try again.</p>}
      <button type="button" className="btn pri" disabled={busy || problems.length > 0} onClick={save}>
        Lend
      </button>
    </>
  );
}

/**
 * One person entry (spec 9): what is owed; lent: Got it back (opens Add income)
 * and what came back; borrowed: this cycle's paybacks and Add a payback;
 * Settled; Delete while nothing is back, in the cycle it was made.
 */
export function PersonPage({
  data,
  person: p,
  actions,
}: {
  data: Ready;
  person: Person;
  actions: PeopleActions;
}) {
  const g = debtProgress(p);
  const money = (m: number) => formatMoney(m, p.currency);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const paybacks = data.commitments.filter((c) => c.personDebtId === p.id);
  const removable = p.cycleId === data.cycle.id && p.backMinor === 0 && p.gotBack.length === 0;

  async function run(f: () => Promise<boolean>, to?: string) {
    setBusy(true);
    setFailed(false);
    const done = await f();
    setBusy(false);
    if (!done) setFailed(true);
    else if (to) window.location.hash = to;
  }

  return (
    <>
      {back("People")}
      <h1>{p.personName}</h1>
      <section className="card stack">
        <b data-testid="person-owed">
          {g.closed
            ? p.settledOn
              ? `Settled ${dayLabel(p.settledOn)}`
              : "Paid back in full"
            : `${p.direction === "lent" ? "Owes you" : "You owe"} ${money(g.owedMinor)}`}
        </b>
        <p className="small mute">
          {whatLabel(p)}: {money(p.amountMinor)} · {p.direction === "lent" ? "got back" : "paid back"}{" "}
          {money(p.backMinor)}
        </p>
        {p.direction === "lent" && !g.closed && (
          <a className="btn pri link" href={`#AddIncome/paid_back/${p.id}`}>
            Got it back
          </a>
        )}
      </section>

      {p.gotBack.length > 0 && (
        <section className="card" aria-labelledby="person-back-h">
          <h3 id="person-back-h">Got back</h3>
          {p.gotBack.map((b) => (
            <div key={b.id} className="li">
              <span className="grow">
                {dayLabel(b.on)}
                {b.toSavingsMinor > 0 && (
                  <span className="tiny mute block">{money(b.toSavingsMinor)} to savings</span>
                )}
              </span>
              <b className="small">{money(b.amountMinor)}</b>
            </div>
          ))}
        </section>
      )}

      {p.direction === "borrowed" && (
        <section className="card" aria-labelledby="person-paybacks-h">
          <h3 id="person-paybacks-h">Paying back</h3>
          {paybacks.length === 0 && <p className="tiny mute">No payback this cycle.</p>}
          {paybacks.map((c) => (
            <a key={c.id} className="li tap link" href={`#Commitment/${c.id}`}>
              <span className="date">
                <b>{dayLabel(c.dueOn)}</b>
              </span>
              <span className="grow">
                {c.name}
                {c.state !== "open" && <span className="tiny mute block">{c.state}</span>}
              </span>
              <b className="small">{money(c.state === "open" ? stillToPayMinor(c) : c.plannedMinor)}</b>
            </a>
          ))}
          {!g.closed && <AddPayback data={data} person={p} actions={actions} />}
        </section>
      )}

      {failed && <p className="error">Not done. Check the connection and try again.</p>}
      <div className="row">
        {!g.closed && (
          <button
            type="button"
            className="btn grow"
            disabled={busy}
            onClick={() => run(() => actions.settle(p))}
          >
            Settled
          </button>
        )}
        {removable && (
          <button
            type="button"
            className="btn grow"
            disabled={busy}
            onClick={() => run(() => actions.remove(p), "People")}
          >
            Delete
          </button>
        )}
      </div>
      {!g.closed && (
        <p className="tiny mute">
          Settled closes it, whatever is still owed. This cycle's paybacks are finished.
        </p>
      )}
    </>
  );
}

/** Add a payback on money borrowed (spec 9): filled with what is owed past the open paybacks. */
function AddPayback({ data, person: p, actions }: { data: Ready; person: Person; actions: PeopleActions }) {
  const today = useToday(data.settings.homeTimeZone);
  const setAsideMinor = openPaybacks(data, p).reduce((t, c) => t + stillToPayMinor(c), 0);
  const fill = paybackFillMinor(debtProgress(p).owedMinor, setAsideMinor);
  const [text, setText] = useState(fill > 0 ? toText(fill, p.currency) : "");
  const [dueOn, setDueOn] = useState(
    data.cycle.expectedSalaryOn > today ? data.cycle.expectedSalaryOn : today,
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (fill <= 0) return null;
  const plannedMinor = parseAmount(text, p.currency) ?? 0;
  const problems = checkPayback({ plannedMinor, dueOn }, p, {
    cycleStartedOn: data.cycle.startedOn,
    setAsideMinor,
  });

  async function save() {
    setBusy(true);
    setFailed(false);
    const done = await actions.payback(p, plannedMinor, dueOn);
    setBusy(false);
    if (!done) setFailed(true);
  }

  return (
    <div className="stack">
      <AmountField
        label="Pay back"
        text={text}
        currency={p.currency}
        hint={`At most ${formatMoney(fill, p.currency)}.`}
        onChange={setText}
      />
      <label className="field">
        On
        <input
          type="date"
          value={dueOn}
          min={data.cycle.startedOn}
          onChange={(e) => setDueOn(e.target.value)}
        />
        <span className="tiny mute">
          {dueOn > data.cycle.expectedSalaryOn
            ? "After the next salary day: coming up only, set aside then."
            : "Set aside now."}
        </span>
      </label>
      {failed && <p className="error">Not saved. Check the connection and try again.</p>}
      <button type="button" className="btn" disabled={busy || problems.length > 0} onClick={save}>
        Add a payback
      </button>
    </div>
  );
}
