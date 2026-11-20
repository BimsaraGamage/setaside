import { useState } from "react";
import {
  checkPlace,
  formatMoney,
  PLACE_NAME_MAX,
  PLACES_MAX,
  type PlaceKind,
  type PlaceLine,
  type PlaceTotal,
  parseAmount,
  placesView,
  todayIn,
} from "../money";
import { api } from "./api";
import { CurrencyChoice, currenciesOf, currencyContext } from "./CurrencyChoice";
import { dayLabel, entriesOf, type Place, type Ready } from "./data";
import { newId } from "./id";
import { toText } from "./SpendSheet";
import type { Toaster } from "./toast";

const ok = async (res: Promise<Response | { ok: boolean }>) => (await res.catch(() => null))?.ok ?? false;

interface NewPlace {
  name: string;
  currency: string;
  kind: PlaceKind;
  /** The balance typed with it; null: none yet. */
  balanceMinor: number | null;
}

const add = (id: string, d: NewPlace) =>
  ok(
    api.api.places.$post({
      json: {
        id,
        name: d.name,
        currency: d.currency,
        kind: d.kind,
        ...(d.balanceMinor === null ? {} : { balance: { id: newId(), amountMinor: d.balanceMinor } }),
      },
    }),
  );
const change = (id: string, d: { name?: string; kind?: PlaceKind; archived?: boolean }) =>
  ok(api.api.places[":id"].$patch({ param: { id }, json: d }));
const remove = (id: string, withBalances: boolean) =>
  ok(
    api.api.places[":id"].$delete({
      param: { id },
      query: { balances: withBalances ? "delete" : undefined },
    }),
  );
const order = (ids: string[]) => ok(api.api.places.order.$put({ json: { ids } }));
const check = (id: string, checkId: string, amountMinor: number) =>
  ok(api.api.places[":id"].checks.$post({ param: { id }, json: { id: checkId, amountMinor } }));
const uncheck = (id: string, checkId: string) =>
  ok(api.api.places[":id"].checks[":checkId"].$delete({ param: { id, checkId } }));

/** Add, change, reorder, stop using and delete places, and Set balance; each success shows a toast with Undo. */
export function placeActions({ done }: Toaster) {
  return {
    add: (id: string, d: NewPlace) =>
      add(id, d).then((ok) => done(ok, { text: `${d.name} added`, undo: () => remove(id, true) })),
    change: (p: Place, d: { name: string; kind: PlaceKind }) =>
      change(p.id, d).then((ok) =>
        done(ok, { text: "Place changed", undo: () => change(p.id, { name: p.name, kind: p.kind }) }),
      ),
    /** Set balance: what the place holds now. Undo puts the balance before it back. */
    setBalance: (p: Place, amountMinor: number) => {
      const checkId = newId();
      return check(p.id, checkId, amountMinor).then((ok) =>
        done(ok, {
          text: `${p.name} set to ${formatMoney(amountMinor, p.currency)}`,
          undo: () => uncheck(p.id, checkId),
        }),
      );
    },
    /** The whole list in its new order; Undo puts the old order back. */
    reorder: (ids: string[], before: string[]) =>
      order(ids).then((ok) => done(ok, { text: "Order changed", undo: () => order(before) })),
    /** "Stop using this place": left out of the totals and of Can spend; its balance stays. */
    stop: (p: Place) =>
      change(p.id, { archived: true }).then((ok) =>
        done(ok, { text: `Stopped using ${p.name}`, undo: () => change(p.id, { archived: false }) }),
      ),
    useAgain: (p: Place) =>
      change(p.id, { archived: false }).then((ok) =>
        done(ok, { text: `Using ${p.name} again`, undo: () => change(p.id, { archived: true }) }),
      ),
    /** Delete, with its balances once the user said so (no Undo: the balances typed are gone). */
    remove: (p: Place, withBalances: boolean) =>
      remove(p.id, withBalances).then((ok) => done(ok, { text: `${p.name} deleted` })),
  };
}

export type PlaceActions = ReturnType<typeof placeActions>;

/** Where my money is, worked out on the phone (spec 6): each place's balance, Can spend, totals, difference. */
export function placesOf(data: Ready) {
  return placesView(data.places, { entries: entriesOf(data), savings: data.savings, cards: data.cards });
}

const KIND_LABEL: Record<PlaceKind, string> = { spending: "For spending", kept: "Kept aside" };

/** "$420 · Rs 126,000" for a dollar place, "Rs 48,000" otherwise. */
function withCounted(minor: number, counted: number | null, place: Place, spendingCurrency: string): string {
  const own = formatMoney(minor, place.currency);
  return counted === null ? own : `${own} · ${formatMoney(counted, spendingCurrency)}`;
}

/** "set Fri 20 Nov": the day the balance was typed, in the home time zone. */
function setOn(place: Place, timeZone: string): string | null {
  return place.checkedAt === null ? null : `set ${dayLabel(todayIn(timeZone, place.checkedAt))}`;
}

/** Money's row (spec 10): "Where my money is" with the places' total, or the way to add the first place. */
export function MoneyPlacesRow({ data }: { data: Ready }) {
  const view = placesOf(data);
  return (
    <a className="li tap link" href="#Places">
      <span className="grow">Where my money is</span>
      <span className="small mute" data-testid="money-places">
        {view.lines.length
          ? `${formatMoney(view.totalCountedMinor, data.settings.spendingCurrency)} `
          : "Add a place "}
        ›
      </span>
    </a>
  );
}

/**
 * Today's line under free money (spec 10), once a place is in use: what can be
 * spent from each place ("In hand Rs 12,000 · Pan Asia Rs 48,000").
 */
export function TodayPlacesLine({ data }: { data: Ready }) {
  const view = placesOf(data);
  if (view.lines.length === 0) return null;
  const parts = view.lines
    .filter((l) => l.canSpendMinor > 0)
    .map((l) => `${l.place.name} ${formatMoney(l.canSpendMinor, l.place.currency)}`);
  return (
    <a className="tiny mute link block" href="#Places" data-testid="places-line">
      {parts.length ? parts.join(" · ") : "Where my money is ›"}
    </a>
  );
}

/** One currency's difference line (spec 6): the places against what the app counts. */
function differenceLine(t: PlaceTotal): { text: string; bad: boolean } {
  const money = (m: number) => formatMoney(m, t.currency);
  if (t.differenceMinor === null) {
    return { text: `Set every ${t.currency} place's balance to compare with the app.`, bad: false };
  }
  if (t.differenceMinor === 0)
    return { text: `Matches what the app counts (${money(t.appMinor)}).`, bad: false };
  return t.differenceMinor < 0
    ? { text: `${money(-t.differenceMinor)} less than the app counts: spends not entered?`, bad: true }
    : {
        text: `${money(t.differenceMinor)} more than the app counts: balances out of date, or income not entered?`,
        bad: true,
      };
}

/**
 * Where my money is (spec 6, 10; opened from Money): each place with its
 * balance and Can spend, the totals, the difference against what the app counts.
 */
export function PlacesPage({ data }: { data: Ready }) {
  const view = placesOf(data);
  const cur = data.settings.spendingCurrency;
  const tz = data.settings.homeTimeZone;
  const two = data.settings.salaryCurrency !== cur;
  return (
    <>
      <div className="row">
        <a className="btn ghost link" href="#Money">
          ← Back
        </a>
      </div>
      <h1>Where my money is</h1>
      {data.places.length === 0 && (
        <p className="small mute">
          Add each place your money sits in (a bank account, cash in hand) and type what it holds. You see how
          much of each is free money to spend.
        </p>
      )}
      {view.lines.length > 0 && (
        <section className="card" aria-labelledby="places-h">
          <h3 id="places-h">Places</h3>
          {view.lines.map((l) => (
            <PlaceRow key={l.place.id} line={l} spendingCurrency={cur} timeZone={tz} />
          ))}
        </section>
      )}
      {view.totals.length > 0 && (
        <section className="card" aria-labelledby="places-total-h">
          <h3 id="places-total-h">Total</h3>
          {view.totals.map((t) => (
            <div key={t.currency} className="li">
              <span className="grow mute">{two ? `In ${t.currency}` : "In all places"}</span>
              <b data-testid={`places-total-${t.currency}`}>{formatMoney(t.totalMinor, t.currency)}</b>
            </div>
          ))}
          {two && (
            <div className="li">
              <span className="grow mute">All of it in {cur}</span>
              <b data-testid="places-total">{formatMoney(view.totalCountedMinor, cur)}</b>
            </div>
          )}
          {view.totals.map((t) => {
            const d = differenceLine(t);
            return (
              <p
                key={t.currency}
                className={`tiny${d.bad ? " bad" : " mute"}`}
                data-testid={`places-difference-${t.currency}`}
              >
                {d.text}
              </p>
            );
          })}
          <p className="tiny mute">
            The app counts free money, money set aside, pots, savings and money held for cards.
          </p>
        </section>
      )}
      {view.notInUse.length > 0 && (
        <section className="card" aria-labelledby="places-off-h">
          <h3 id="places-off-h">Not in use</h3>
          {view.notInUse.map((p) => (
            <a key={p.id} className="li tap link" href={`#Place/${p.id}`}>
              <span className="grow">{p.name}</span>
              <span className="small mute">›</span>
            </a>
          ))}
        </section>
      )}
      {data.places.length < PLACES_MAX && (
        <a className="btn link add" href="#Place">
          {data.places.length ? "+ Add another place" : "+ Add a place"}
        </a>
      )}
    </>
  );
}

function PlaceRow({
  line,
  spendingCurrency,
  timeZone,
}: {
  line: PlaceLine<Place>;
  spendingCurrency: string;
  timeZone: string;
}) {
  const p = line.place;
  return (
    <a className="li tap link" href={`#Place/${p.id}`}>
      <span className="grow">
        {p.name}
        <span className="tiny mute block">
          {[KIND_LABEL[p.kind], setOn(p, timeZone)].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="small" style={{ textAlign: "right" }}>
        <b data-testid={`place-balance-${p.name}`}>
          {line.balanceMinor === null
            ? "No balance yet"
            : withCounted(line.balanceMinor, line.countedMinor, p, spendingCurrency)}
        </b>
        {line.balanceMinor !== null && (
          <span className="tiny mute block" data-testid={`place-can-spend-${p.name}`}>
            Can spend {withCounted(line.canSpendMinor, line.canSpendCountedMinor, p, spendingCurrency)}
          </span>
        )}
      </span>
    </a>
  );
}

function KindChoice({ value, onChange }: { value: PlaceKind; onChange: (k: PlaceKind) => void }) {
  return (
    <div className="stack">
      <div className="row" role="radiogroup" aria-label="What it is for">
        {(Object.keys(KIND_LABEL) as PlaceKind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={k === value}
            className={k === value ? "btn pri grow" : "btn grow"}
            onClick={() => onChange(k)}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <p className="tiny mute">
        {value === "spending"
          ? "Money you spend from day to day. Free money is counted here first."
          : "Money you leave alone. Free money is counted here only after the For spending places."}
      </p>
    </div>
  );
}

/** A balance field: only what reads as an amount in the currency can be typed. */
function BalanceField({
  label,
  currency,
  text,
  onChange,
  hint,
}: {
  label: string;
  currency: string;
  text: string;
  onChange: (t: string) => void;
  hint?: string;
}) {
  return (
    <label className="field">
      {label} ({currency})
      <input
        value={text}
        inputMode="decimal"
        onChange={(e) => {
          const t = e.target.value;
          if (t === "" || parseAmount(t.replace(/\.$/, ""), currency) !== null) onChange(t);
        }}
      />
      {hint && <span className="tiny mute">{hint}</span>}
    </label>
  );
}

/**
 * A place page (spec 10), new or open: name, currency and kind when new, with
 * the balance it holds; open: the balance, Can spend, Set balance, name and
 * kind, its spot in the list, Stop using, Delete.
 */
export function PlacePage({
  data,
  editing,
  actions,
}: {
  data: Ready;
  editing?: Place;
  actions: PlaceActions;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [cur, setCur] = useState(editing?.currency ?? data.settings.spendingCurrency);
  const [kind, setKind] = useState<PlaceKind>(editing?.kind ?? "spending");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const problems = checkPlace({ name, currency: cur, kind }, currencyContext(data));
  const typed = text === "" ? null : parseAmount(text.replace(/\.$/, ""), cur);

  async function run(job: () => Promise<boolean>, leave = false) {
    setBusy(true);
    setFailed(false);
    const done = await job();
    setBusy(false);
    if (!done) setFailed(true);
    else if (leave) window.location.hash = "Places";
    return done;
  }

  const back = (
    <div className="row">
      <a className="btn ghost link" href="#Places">
        ← Back
      </a>
    </div>
  );
  const nameField = (
    <label className="field">
      Name
      <input
        value={name}
        maxLength={PLACE_NAME_MAX}
        placeholder="Pan Asia Bank, In hand…"
        onChange={(e) => setName(e.target.value)}
      />
    </label>
  );

  if (!editing) {
    return (
      <>
        {back}
        <h1>New place</h1>
        <section className="card stack">
          {nameField}
          <CurrencyChoice currencies={currenciesOf(data.settings)} value={cur} onChange={setCur} />
          <KindChoice value={kind} onChange={setKind} />
          <BalanceField
            label="It holds now"
            currency={cur}
            text={text}
            onChange={setText}
            hint="What the bank app or your wallet says. You can type it later."
          />
        </section>
        {failed && <p className="error">Not saved. Check the connection and try again.</p>}
        <button
          type="button"
          className="btn pri"
          disabled={busy || problems.length > 0 || (text !== "" && typed === null)}
          onClick={() =>
            run(
              () => actions.add(newId(), { name: name.trim(), currency: cur, kind, balanceMinor: typed }),
              true,
            )
          }
        >
          Save
        </button>
      </>
    );
  }

  const p = editing;
  const view = placesOf(data);
  const line = view.lines.find((l) => l.place.id === p.id);
  const spending = data.settings.spendingCurrency;
  const changed = name.trim() !== p.name || kind !== p.kind;
  const inUse = view.lines.map((l) => l.place.id);
  const at = inUse.indexOf(p.id);
  /** The list with this place one spot up (-1) or down (+1); places not in use keep the end. */
  const moved = (by: -1 | 1) => {
    const ids = [...inUse];
    const other = ids[at + by];
    if (other === undefined) return null;
    ids[at + by] = p.id;
    ids[at] = other;
    return [...ids, ...view.notInUse.map((x) => x.id)];
  };
  const before = data.places.map((x) => x.id);

  return (
    <>
      {back}
      <h1>{p.name}</h1>
      <section className="card stack">
        <div>
          <h3>Balance</h3>
          <p className="big" data-testid="place-balance">
            {p.balanceMinor === null
              ? "No balance yet"
              : withCounted(p.balanceMinor, line?.countedMinor ?? null, p, spending)}
          </p>
          <p className="tiny mute">
            {[
              KIND_LABEL[p.kind],
              setOn(p, data.settings.homeTimeZone),
              p.archived ? "Not in use: counted nowhere" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {line && p.balanceMinor !== null && (
          <div className="li">
            <span className="grow mute">Can spend</span>
            <b data-testid="place-can-spend">
              {withCounted(line.canSpendMinor, line.canSpendCountedMinor, p, spending)}
            </b>
          </div>
        )}
        <BalanceField
          label="It holds now"
          currency={p.currency}
          text={text}
          onChange={setText}
          hint="Type what the bank app or your wallet says now."
        />
        <button
          type="button"
          className="btn pri"
          disabled={busy || typed === null}
          onClick={async () => {
            if (typed !== null && (await run(() => actions.setBalance(p, typed)))) setText("");
          }}
        >
          Set balance
        </button>
      </section>

      <section className="card stack">
        {nameField}
        <KindChoice value={kind} onChange={setKind} />
        {changed && (
          <button
            type="button"
            className="btn"
            disabled={busy || problems.length > 0}
            onClick={() => run(() => actions.change(p, { name: name.trim(), kind }))}
          >
            Save changes
          </button>
        )}
      </section>

      {at >= 0 && inUse.length > 1 && (
        <div className="row">
          {([-1, 1] as const).map((by) => {
            const ids = moved(by);
            return (
              <button
                key={by}
                type="button"
                className="btn grow"
                disabled={busy || !ids}
                onClick={() => ids && run(() => actions.reorder(ids, before))}
              >
                {by < 0 ? "Move up" : "Move down"}
              </button>
            );
          })}
        </div>
      )}

      {failed && <p className="error">Not done. Check the connection and try again.</p>}

      <div className="row">
        <button
          type="button"
          className="btn grow"
          disabled={busy}
          onClick={() => run(() => (p.archived ? actions.useAgain(p) : actions.stop(p)))}
        >
          {p.archived ? "Use this place again" : "Stop using this place"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            // A place with a balance typed asks once more before it goes.
            if (p.balanceMinor !== null && !confirming) setConfirming(true);
            else run(() => actions.remove(p, p.balanceMinor !== null), true);
          }}
        >
          {confirming ? "Yes, delete it" : "Delete"}
        </button>
      </div>
      {confirming && (
        <p className="tiny mute" role="alert">
          Its balance goes with it and can't be brought back. Nothing else changes.
        </p>
      )}
    </>
  );
}
