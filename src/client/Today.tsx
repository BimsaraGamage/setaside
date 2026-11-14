import { formatMoney, todayView } from "../money";
import { dayLabel, type Ready, type Spend, useToday } from "./data";
import { SpendRow } from "./Spends";

/** Today (spec 10): header, main card with the daily allowance and today's spends, Next up, the + button. */
export function Today({
  data,
  onAdd,
  onEdit,
}: {
  data: Ready;
  onAdd: (today: string) => void;
  onEdit: (spend: Spend, today: string) => void;
}) {
  const { settings, cycle } = data;
  const today = useToday(settings.homeTimeZone);
  const view = todayView(
    {
      spendingCurrency: settings.spendingCurrency,
      expectedSalaryOn: cycle.expectedSalaryOn,
      incomes: data.incomes,
      spends: data.spends,
    },
    today,
  );
  const money = (m: number) => formatMoney(m, view.currency);
  const salaryIn = view.daysLeft;
  const over = view.leftTodayMinor < 0;
  const used = view.allowanceMinor > 0 ? Math.min(1, view.spentTodayMinor / view.allowanceMinor) : 1;

  return (
    <>
      <header className="top">
        <div>
          <h1>Setaside</h1>
          <p className="tiny mute">
            Cycle {dayLabel(cycle.startedOn, false)} → salary {dayLabel(cycle.expectedSalaryOn)}
          </p>
        </div>
      </header>

      <section className="card main" aria-labelledby="today-h">
        <h3 id="today-h">You can spend today</h3>
        <p className="big" data-testid="allowance">
          {money(view.allowanceMinor)}
        </p>
        <div
          className={`bar${over ? " over" : ""}`}
          role="meter"
          aria-label="Spent today"
          aria-valuemin={0}
          aria-valuemax={view.allowanceMinor}
          aria-valuenow={view.spentTodayMinor}
        >
          <span style={{ width: `${(view.spentTodayMinor > 0 ? used : 0) * 100}%` }} />
        </div>
        <p className={`small${over ? " bad" : ""}`} data-testid="spent-today">
          {over
            ? `Spent ${money(view.spentTodayMinor)} · Over by ${money(-view.leftTodayMinor)}`
            : `Spent ${money(view.spentTodayMinor)} · ${money(view.leftTodayMinor)} left today`}
        </p>
        {data.spends
          .filter((s) => s.spentOn === today)
          .map((s) => (
            <SpendRow key={s.id} spend={s} onOpen={() => onEdit(s, today)} />
          ))}
        <div className="li">
          <span className="grow mute">Free money</span>
          <b data-testid="free-money">{money(view.freeMinor)}</b>
        </div>
        <div className="li">
          <span className="grow mute">Days to salary</span>
          <b data-testid="days-left">{view.daysLeft}</b>
        </div>
        {view.tomorrowMinor !== null && (
          <p className="tiny mute" data-testid="tomorrow">
            Tomorrow {money(view.tomorrowMinor)}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="next-h">
        <h3 id="next-h">Next up · already set aside</h3>
        <p className="tiny mute">Nothing set aside yet.</p>
        <div className="li">
          <span className="date">
            <b>{dayLabel(cycle.expectedSalaryOn)}</b>
            <span className="tiny mute">
              {salaryIn === 0 ? "today" : `in ${salaryIn} day${salaryIn === 1 ? "" : "s"}`}
            </span>
          </span>
          <span className="grow">Salary expected</span>
        </div>
      </section>

      <button type="button" className="fab" aria-label="Add a spend" onClick={() => onAdd(today)}>
        +
      </button>
    </>
  );
}
