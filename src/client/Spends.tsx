import { combinedSavingsMinor, formatMoney } from "../money";
import { MoneyCards } from "./Cards";
import { currencyContext } from "./CurrencyChoice";
import { dayLabel, type Ready, type Spend, useToday } from "./data";
import { MoneyPlans } from "./Plans";

/** The pot a spend came from, by name; none for free money. */
export function potName(data: Pick<Ready, "pots">, s: Spend): string | undefined {
  return s.potId ? data.pots.find((p) => p.id === s.potId)?.name : undefined;
}

/** The card a spend was paid with, by name; none for cash (item 18). */
export function cardName(data: Pick<Ready, "cards">, s: Spend): string | undefined {
  return s.cardId ? (data.cards.find((k) => k.id === s.cardId)?.name ?? "Card") : undefined;
}

/** One spend row; tapping it opens the spend sheet to change or delete it. */
export function SpendRow({
  spend,
  pot,
  card,
  onOpen,
}: {
  spend: Spend;
  pot?: string;
  card?: string;
  onOpen: () => void;
}) {
  const tags = [pot && `${pot} pot`, card, spend.oneOff && "One-off"].filter(Boolean);
  return (
    <button type="button" className="li tap" onClick={onOpen}>
      <span className="grow">
        {spend.note || "Spend"}
        {tags.length > 0 && <span className="tiny mute block">{tags.join(" · ")}</span>}
      </span>
      <b>{formatMoney(spend.amountMinor, spend.currency)}</b>
    </button>
  );
}

/** Money (spec 10): Spends, Savings, Change dollars (two currencies), Add income, cards (item 18), plans (item 19). People come later. */
export function Money({ data }: { data: Ready }) {
  const n = data.spends.length;
  const cur = data.settings.spendingCurrency;
  return (
    <>
      <h1>Money</h1>
      <section className="card">
        <a className="li tap link" href="#Spends">
          <span className="grow">Spends</span>
          <span className="small mute">{n} this cycle ›</span>
        </a>
        <a className="li tap link" href="#Savings">
          <span className="grow">Savings</span>
          <span className="small mute" data-testid="money-savings">
            {formatMoney(
              combinedSavingsMinor(data.savings, {
                ...currencyContext(data),
                countingRate: data.settings.countingRate,
              }),
              cur,
            )}{" "}
            ›
          </span>
        </a>
        {data.settings.salaryCurrency !== cur && (
          <a className="li tap link" href="#ChangeDollars">
            <span className="grow">Change {data.settings.salaryCurrency}</span>
            <span className="small mute">
              {data.conversions.length ? `${data.conversions.length} this cycle ` : ""}›
            </span>
          </a>
        )}
        <a className="li tap link" href="#AddIncome">
          <span className="grow">Add income</span>
          <span className="small mute">›</span>
        </a>
      </section>
      <MoneyCards data={data} />
      <MoneyPlans data={data} />
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
                list.reduce(
                  (n, s) => n + (s.currency === data.settings.spendingCurrency ? s.amountMinor : 0),
                  0,
                ),
                data.settings.spendingCurrency,
              )}
            </span>
          </div>
          {list.map((s) => (
            <SpendRow
              key={s.id}
              spend={s}
              pot={potName(data, s)}
              card={cardName(data, s)}
              onOpen={() => onOpen(s, today)}
            />
          ))}
        </section>
      ))}
    </>
  );
}
