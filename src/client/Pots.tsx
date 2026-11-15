import { useState } from "react";
import { checkPot, formatMoney, NAME_MAX, parseAmount, potView, STARTER_POTS, todayView } from "../money";
import { entriesOf, type Pot, potEntry, type Ready, type Spend, useToday } from "./data";
import { newId } from "./id";
import type { PotActions } from "./pot-actions";
import { toText } from "./SpendSheet";
import { SpendRow } from "./Spends";

/** "Rs 12,000 left of Rs 18,000", or "Used up · over by Rs 3,000". */
function leftLine(p: Pot, spends: Spend[]): { text: string; over: boolean; used: number } {
  const v = potView(potEntry(p), spends);
  const amount = p.amountMinor ?? 0;
  const money = (m: number) => formatMoney(m, p.currency);
  if (v.usedUp) {
    return {
      text: v.overMinor > 0 ? `Used up · over by ${money(v.overMinor)}` : "Used up",
      over: true,
      used: 1,
    };
  }
  return {
    text: `${money(v.leftMinor)} left of ${money(amount)}`,
    over: false,
    used: amount > 0 ? v.spentMinor / amount : 0,
  };
}

/** One pot: name, amount left and a bar (spec 4, 10). A link to its page when `href` is given. */
export function PotRow({ pot, spends, href }: { pot: Pot; spends: Spend[]; href?: string }) {
  const line = leftLine(pot, spends);
  const body = (
    <>
      <span className="row">
        <span className="grow">{pot.name}</span>
        <span className={`small${line.over ? " bad" : " mute"}`}>{line.text}</span>
      </span>
      <span
        className={`bar${line.over ? " over" : ""}`}
        role="meter"
        aria-label={`${pot.name} spent`}
        aria-valuemin={0}
        aria-valuemax={pot.amountMinor ?? 0}
        aria-valuenow={potView(potEntry(pot), spends).spentMinor}
      >
        <span style={{ width: `${Math.min(1, line.used) * 100}%` }} />
      </span>
    </>
  );
  return href ? (
    <a className="li tap link pot" href={href} data-testid="pot">
      {body}
    </a>
  ) : (
    <div className="li pot" data-testid="pot">
      {body}
    </div>
  );
}

/** Plan's pots (spec 10): pots in use, + New pot, starter names while there are none, pots not in use. */
export function PlanPots({ data }: { data: Ready }) {
  const using = data.pots.filter((p) => !p.archived);
  const stopped = data.pots.filter((p) => p.archived);
  return (
    <>
      <section className="card" aria-labelledby="pots-h">
        <h3 id="pots-h">Pots</h3>
        {using.length === 0 && (
          <>
            <p className="tiny mute">Money for things bought bit by bit. Start with one of these:</p>
            <div className="chips">
              {STARTER_POTS.map((n) => (
                <a key={n} className="btn link" href={`#Pot/new/${encodeURIComponent(n)}`}>
                  {n}
                </a>
              ))}
            </div>
          </>
        )}
        {using.map((p) => (
          <PotRow key={p.id} pot={p} spends={data.spends} href={`#Pot/${p.id}`} />
        ))}
        <a className="btn link add" href="#Pot">
          + New pot
        </a>
      </section>
      {stopped.length > 0 && (
        <section className="card" aria-labelledby="stopped-h">
          <h3 id="stopped-h">Pots not in use</h3>
          {stopped.map((p) => (
            <a key={p.id} className="li tap link done" href={`#Pot/${p.id}`}>
              <span className="grow">{p.name}</span>
              <span className="tiny mute">Not in use</span>
            </a>
          ))}
        </section>
      )}
    </>
  );
}

/**
 * A pot page (spec 10), new or edit: name, amount this cycle, usual amount, the
 * new daily allowance before saving; its spends; Stop using this pot (or use it
 * again) and Delete while it has no spends. Covers the tab bar.
 */
export function PotPage({
  data,
  editing,
  starter,
  actions,
  onOpenSpend,
}: {
  data: Ready;
  editing?: Pot;
  /** A starter name to fill in for a new pot. */
  starter?: string;
  actions: PotActions;
  onOpenSpend: (s: Spend, today: string) => void;
}) {
  const cur = data.settings.spendingCurrency;
  const today = useToday(data.settings.homeTimeZone);
  const [name, setName] = useState(editing?.name ?? starter ?? "");
  const [text, setText] = useState(editing?.amountMinor != null ? toText(editing.amountMinor, cur) : "");
  const [usualText, setUsualText] = useState(editing ? toText(editing.usualAmountMinor, cur) : "");
  // The usual amount follows this cycle's amount on a new pot until it is typed in.
  const [usualTouched, setUsualTouched] = useState(Boolean(editing));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const amountMinor = parseAmount(text, cur) ?? (text === "" ? 0 : -1);
  const usualAmountMinor = usualTouched
    ? (parseAmount(usualText, cur) ?? (usualText === "" ? 0 : -1))
    : amountMinor;
  const draft = { name: name.trim(), usualAmountMinor, amountMinor };
  const problems = checkPot({ ...draft, currency: cur }, { spendingCurrency: cur });
  const spends = editing ? data.spends.filter((s) => s.potId === editing.id) : [];
  const stopped = editing?.archived ?? false;

  const mine = {
    id: editing?.id ?? "new",
    currency: cur,
    amountMinor: Math.max(0, amountMinor),
    archived: stopped,
  };
  const after = todayView(
    { ...entriesOf(data), pots: [...data.pots.filter((p) => p.id !== editing?.id).map(potEntry), mine] },
    today,
  );
  const back = () => {
    window.location.hash = "Plan";
  };

  async function run(job: () => Promise<boolean>, error = "Not saved. Check the connection and try again.") {
    setBusy(true);
    setFailed(null);
    const ok = await job();
    setBusy(false);
    if (ok) back();
    else setFailed(error);
  }

  const amountField = (label: string, value: string, set: (t: string) => void, hint?: string) => (
    <label className="field">
      {label} ({cur})
      <input
        value={value}
        inputMode="decimal"
        placeholder="0"
        onChange={(e) => {
          const t = e.target.value;
          if (t === "" || parseAmount(t.replace(/\.$/, ""), cur) !== null) set(t);
        }}
      />
      {hint && <span className="tiny mute">{hint}</span>}
    </label>
  );

  return (
    <>
      <div className="row">
        <a className="btn ghost link" href="#Plan">
          ← Back
        </a>
      </div>
      <h1>{editing ? editing.name : "New pot"}</h1>
      {stopped && <p className="small mute">Not in use. What was left in it went back to free money.</p>}
      <section className="card stack">
        <label className="field">
          Name
          <input
            value={name}
            maxLength={NAME_MAX}
            placeholder="Groceries, fuel…"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {amountField("Amount this cycle", text, setText, "Set aside now, until the salary.")}
        {amountField(
          "Usual amount",
          usualTouched ? usualText : text,
          (t) => {
            setUsualTouched(true);
            setUsualText(t);
          },
          "Set aside again each cycle.",
        )}
        {!stopped && (
          <p className="small" data-testid="pot-after">
            You can spend today after this: <b>{formatMoney(after.allowanceMinor, cur)}</b>
          </p>
        )}
      </section>

      {editing && (
        <section className="card" aria-labelledby="pot-spends-h">
          <h3 id="pot-spends-h">Spends from this pot</h3>
          {!stopped && <PotRow pot={editing} spends={data.spends} />}
          {spends.length === 0 && <p className="tiny mute">None yet. Pick this pot on the + sheet.</p>}
          {spends.map((s) => (
            <SpendRow key={s.id} spend={s} onOpen={() => onOpenSpend(s, today)} />
          ))}
        </section>
      )}

      {failed && <p className="error">{failed}</p>}

      <div className="row">
        {editing && spends.length === 0 && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => run(() => actions.remove(editing), "Not deleted. Stop using it instead.")}
          >
            Delete
          </button>
        )}
        {editing && !stopped && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => run(() => actions.stop(editing))}
          >
            Stop using this pot
          </button>
        )}
        {editing && stopped ? (
          <button
            type="button"
            className="btn pri grow"
            disabled={busy || problems.length > 0}
            onClick={() => run(() => actions.useAgain(editing, draft))}
          >
            Use this pot again
          </button>
        ) : (
          <button
            type="button"
            className="btn pri grow"
            disabled={busy || problems.length > 0}
            onClick={() =>
              run(() => (editing ? actions.change(editing, draft) : actions.add(newId(), draft)))
            }
          >
            Save
          </button>
        )}
      </div>
    </>
  );
}
