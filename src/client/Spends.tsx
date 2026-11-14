import { formatMoney } from "../money";
import { dayLabel, type Ready, type Spend, useToday } from "./data";

/** One spend row; tapping it opens the spend sheet to change or delete it. */
export function SpendRow({ spend, onOpen }: { spend: Spend; onOpen: () => void }) {
  return (
    <button type="button" className="li tap" onClick={onOpen}>
      <span className="grow">{spend.note || "Spend"}</span>
      <b>{formatMoney(spend.amountMinor, spend.currency)}</b>
    </button>
  );
}

/** Money (spec 10). Only the Spends row so far; Savings, cards and the rest come with later items. */
export function Money({ data }: { data: Ready }) {
  const n = data.spends.length;
  return (
    <>
      <h1>Money</h1>
      <section className="card">
        <a className="li tap link" href="#Spends">
          <span className="grow">Spends</span>
          <span className="small mute">{n} this cycle ›</span>
        </a>
      </section>
    </>
  );
}

/** This cycle's spends, by day, newest first (opened from Money; covers the tab bar). */
export function SpendsPage({ data, onOpen }: { data: Ready; onOpen: (s: Spend, today: string) => void }) {
  const today = useToday(data.settings.homeTimeZone);
  const days = new Map<string, Spend[]>();
  for (const s of data.spends) days.set(s.spentOn, [...(days.get(s.spentOn) ?? []), s]);
  const sorted = [...days.entries()].sort(([a], [b]) => (a < b ? 1 : -1));
  return (
    <>
      <div className="row">
        <a className="btn ghost link" href="#Money">
          ← Back
        </a>
      </div>
      <h1>Spends</h1>
      <p className="small mute">
        This cycle, from {dayLabel(data.cycle.startedOn)}. Tap one to change or delete it.
      </p>
      {sorted.length === 0 && <p className="mute">No spends yet.</p>}
      {sorted.map(([day, list]) => (
        <section key={day} className="card" aria-label={dayLabel(day)}>
          <div className="row">
            <h3 className="grow">{day === today ? "Today" : dayLabel(day)}</h3>
            <span className="tiny mute">
              {formatMoney(
                list.reduce((n, s) => n + s.amountMinor, 0),
                data.settings.spendingCurrency,
              )}
            </span>
          </div>
          {list.map((s) => (
            <SpendRow key={s.id} spend={s} onOpen={() => onOpen(s, today)} />
          ))}
        </section>
      ))}
    </>
  );
}
