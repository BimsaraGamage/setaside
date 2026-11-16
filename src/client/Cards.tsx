import { useState } from "react";
import {
  CARD_NAME_MAX,
  cardBillFillMinor,
  checkCard,
  formatMoney,
  parseAmount,
  stillToPayMinor,
} from "../money";
import { api } from "./api";
import { CurrencyChoice, currenciesOf, currencyContext } from "./CurrencyChoice";
import type { CommitmentActions } from "./commitment-actions";
import { type Card, cardBalance, dayLabel, type Ready, type Spend, useToday } from "./data";
import { newId } from "./id";
import { toText } from "./SpendSheet";
import { SpendRow } from "./Spends";
import type { Toaster } from "./toast";

const ok = async (res: Promise<Response | { ok: boolean }>) => (await res.catch(() => null))?.ok ?? false;

const add = (id: string, d: { name: string; currency: string }) =>
  ok(api.api.cards.$post({ json: { id, ...d } }));
const change = (id: string, d: { name?: string; archived?: boolean }) =>
  ok(api.api.cards[":id"].$patch({ param: { id }, json: d }));
const remove = (id: string) => ok(api.api.cards[":id"].$delete({ param: { id } }));

/** Add, rename, stop using, use again and delete cards; each success shows a toast with Undo. */
export function cardActions({ done }: Toaster) {
  return {
    add: (id: string, d: { name: string; currency: string }) =>
      add(id, d).then((ok) => done(ok, { text: `${d.name} added`, undo: () => remove(id) })),
    rename: (k: Card, name: string) =>
      change(k.id, { name }).then((ok) =>
        done(ok, { text: "Card changed", undo: () => change(k.id, { name: k.name }) }),
      ),
    /** "Stop using this card": no longer offered on the spend sheet; its balance stays. */
    stop: (k: Card) =>
      change(k.id, { archived: true }).then((ok) =>
        done(ok, { text: `Stopped using ${k.name}`, undo: () => change(k.id, { archived: false }) }),
      ),
    useAgain: (k: Card) =>
      change(k.id, { archived: false }).then((ok) =>
        done(ok, { text: `Using ${k.name} again`, undo: () => change(k.id, { archived: true }) }),
      ),
    /** Only a card nothing uses yet; Undo adds it back. */
    remove: (k: Card) =>
      remove(k.id).then((ok) =>
        done(ok, {
          text: `${k.name} deleted`,
          undo: () =>
            add(k.id, { name: k.name, currency: k.currency }).then(
              (added) => added && (!k.archived || change(k.id, { archived: true })),
            ),
        }),
      ),
  };
}

export type CardActions = ReturnType<typeof cardActions>;

/** Money's card rows (spec 10): each card with its balance, and + Add a card. */
export function MoneyCards({ data }: { data: Ready }) {
  return (
    <section className="card" aria-labelledby="cards-h">
      <h3 id="cards-h">Cards</h3>
      {data.cards.length === 0 && (
        <p className="tiny mute">
          Card spends are held for the card bill, so paying the bill takes nothing more.
        </p>
      )}
      {data.cards.map((k) => (
        <a key={k.id} className="li tap link" href={`#Card/${k.id}`}>
          <span className="grow">
            {k.name}
            {k.archived && <span className="tiny mute block">Not in use</span>}
          </span>
          <span className="small mute" data-testid={`card-balance-${k.name}`}>
            {formatMoney(cardBalance(data, k), k.currency)} ›
          </span>
        </a>
      ))}
      <a className="btn link add" href="#Card">
        {data.cards.length ? "+ Add another card" : "+ Add a card"}
      </a>
    </section>
  );
}

/**
 * A card page (spec 10), new or open: name (and currency when new); balance,
 * the bill (Pay the bill opens it, or add one filled from the balance), this
 * cycle's card spends and bill payments; Stop using, Delete while unused.
 */
export function CardPage({
  data,
  editing,
  actions,
  bills,
  onOpenSpend,
}: {
  data: Ready;
  editing?: Card;
  actions: CardActions;
  bills: CommitmentActions;
  onOpenSpend: (s: Spend, today: string) => void;
}) {
  const today = useToday(data.settings.homeTimeZone);
  const [name, setName] = useState(editing?.name ?? "");
  const [cur, setCur] = useState(editing?.currency ?? data.settings.spendingCurrency);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const problems = checkCard({ name, currency: cur }, currencyContext(data));

  async function run(job: () => Promise<boolean>, leave = false) {
    setBusy(true);
    setFailed(false);
    const done = await job();
    setBusy(false);
    if (!done) setFailed(true);
    else if (leave) window.location.hash = "Money";
  }

  const back = (
    <div className="row">
      <a className="btn ghost link" href="#Money">
        ← Back
      </a>
    </div>
  );
  const nameField = (
    <label className="field">
      Name
      <input
        value={name}
        maxLength={CARD_NAME_MAX}
        placeholder="Visa, Amex…"
        onChange={(e) => setName(e.target.value)}
      />
    </label>
  );
  if (!editing) {
    return (
      <>
        {back}
        <h1>New card</h1>
        <section className="card stack">
          {nameField}
          <CurrencyChoice currencies={currenciesOf(data.settings)} value={cur} onChange={setCur} />
          <p className="tiny mute">
            Turn on Card on the spend sheet when you pay with it. Each card spend lowers free money at once,
            like cash, and its money is held for the card bill.
          </p>
        </section>
        {failed && <p className="error">Not saved. Check the connection and try again.</p>}
        <button
          type="button"
          className="btn pri"
          disabled={busy || problems.length > 0}
          onClick={() => run(() => actions.add(newId(), { name: name.trim(), currency: cur }), true)}
        >
          Save
        </button>
      </>
    );
  }

  const k = editing;
  const money = (m: number) => formatMoney(m, k.currency);
  const balance = cardBalance(data, k);
  const ofCard = data.commitments.filter((c) => c.kind === "card_bill" && c.cardId === k.id);
  const open = ofCard.filter((c) => c.state === "open");
  const spends = data.spends.filter((s) => s.cardId === k.id);
  const payments = ofCard
    .flatMap((c) => c.payments.map((p) => ({ ...p, bill: c.name })))
    .sort((a, b) => (a.paidOn < b.paidOn ? 1 : -1));
  const renamed = name.trim() !== k.name;

  return (
    <>
      {back}
      <h1>{k.name}</h1>
      <section className="card">
        <h3>Balance</h3>
        <p className="big" data-testid="card-balance">
          {money(balance)}
        </p>
        <p className="tiny mute">
          {balance < 0
            ? "In credit: the card owes you this."
            : "Held for the card bill: already out of free money, and not part of the leftover."}
          {k.earlierMinor !== 0 && ` Includes ${money(k.earlierMinor)} from earlier cycles.`}
        </p>
      </section>

      <section className="card" aria-labelledby="bill-h">
        <h3 id="bill-h">Bill</h3>
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
              Pay the bill
            </a>
          </div>
        ))}
        {open.length === 0 && (
          <NewBill data={data} card={k} balance={balance} today={today} actions={bills} />
        )}
      </section>

      <section className="card" aria-labelledby="card-spends-h">
        <h3 id="card-spends-h">Card spends this cycle</h3>
        {spends.length === 0 && <p className="tiny mute">None yet.</p>}
        {spends.map((s) => (
          <SpendRow key={s.id} spend={s} onOpen={() => onOpenSpend(s, today)} />
        ))}
      </section>

      {payments.length > 0 && (
        <section className="card" aria-labelledby="card-payments-h">
          <h3 id="card-payments-h">Payments this cycle</h3>
          {payments.map((p) => (
            <a key={p.id} className="li tap link" href={`#Payment/${p.id}`}>
              <span className="grow">
                {dayLabel(p.paidOn)}
                <span className="tiny mute block">{p.bill}</span>
              </span>
              <b className="small">{formatMoney(p.amountMinor, p.currency)}</b>
            </a>
          ))}
        </section>
      )}

      <section className="card stack">
        {nameField}
        {renamed && (
          <button
            type="button"
            className="btn"
            disabled={busy || problems.length > 0}
            onClick={() => run(() => actions.rename(k, name.trim()))}
          >
            Save name
          </button>
        )}
      </section>

      {failed && (
        <p className="error">Not done. A card with spends or bills can't be deleted: stop using it.</p>
      )}

      <div className="row">
        <button
          type="button"
          className="btn grow"
          disabled={busy}
          onClick={() => run(() => (k.archived ? actions.useAgain(k) : actions.stop(k)))}
        >
          {k.archived ? "Use this card again" : "Stop using this card"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => run(() => actions.remove(k), true)}
        >
          Delete
        </button>
      </div>
    </>
  );
}

/** Adding the card bill (spec 9): the due date the user enters, the amount filled from the balance. */
function NewBill({
  data,
  card,
  balance,
  today,
  actions,
}: {
  data: Ready;
  card: Card;
  balance: number;
  today: string;
  actions: CommitmentActions;
}) {
  const fill = cardBillFillMinor(balance, []);
  const [text, setText] = useState(fill > 0 ? toText(fill, card.currency) : "");
  const [dueOn, setDueOn] = useState(today);
  const [everyCycle, setEveryCycle] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const plannedMinor = parseAmount(text, card.currency) ?? 0;
  const valid = plannedMinor > 0 && dueOn >= data.cycle.startedOn;

  async function save() {
    setBusy(true);
    setFailed(false);
    const done = await actions.add(newId(), {
      kind: "card_bill",
      cardId: card.id,
      name: `${card.name} bill`,
      plannedMinor,
      dueOn,
      everyCycle,
      currency: card.currency,
    });
    setBusy(false);
    if (!done) setFailed(true);
  }

  if (balance <= 0) return <p className="tiny mute">Nothing owed: no bill to pay.</p>;
  return (
    <div className="stack">
      <label className="field">
        Due date
        <input
          type="date"
          value={dueOn}
          min={data.cycle.startedOn}
          required
          onChange={(e) => setDueOn(e.target.value)}
        />
      </label>
      <label className="field">
        Amount ({card.currency})
        <input
          value={text}
          inputMode="decimal"
          onChange={(e) => {
            const t = e.target.value;
            if (t === "" || parseAmount(t.replace(/\.$/, ""), card.currency) !== null) setText(t);
          }}
        />
        <span className="tiny mute">Filled from the balance; change it to what the statement says.</span>
      </label>
      <label className="row check">
        <input type="checkbox" checked={everyCycle} onChange={(e) => setEveryCycle(e.target.checked)} />
        <span className="grow">
          Every cycle
          <span className="tiny mute block">Salary day adds the next bill, filled from the balance</span>
        </span>
      </label>
      {failed && <p className="error">Not saved. Check the connection and try again.</p>}
      <button type="button" className="btn pri" disabled={busy || !valid} onClick={save}>
        Add the bill
      </button>
    </div>
  );
}
