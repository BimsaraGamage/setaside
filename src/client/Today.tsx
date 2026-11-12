import { formatMoney, todayView } from "../money";
import { type Current, dayLabel, useToday } from "./data";

type Ready = Current & { settings: NonNullable<Current["settings"]>; cycle: NonNullable<Current["cycle"]> };

/** Today (spec 10): header, main card with the daily allowance, Next up. */
export function Today({ data }: { data: Ready }) {
  const { settings, cycle } = data;
  const today = useToday(settings.homeTimeZone);
  const view = todayView(
    {
      spendingCurrency: settings.spendingCurrency,
      expectedSalaryOn: cycle.expectedSalaryOn,
      incomes: data.incomes,
    },
    today,
  );
  const money = (m: number) => formatMoney(m, view.currency);
  const salaryIn = view.daysLeft;

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
        <div className="li">
          <span className="grow mute">Free money</span>
          <b data-testid="free-money">{money(view.freeMinor)}</b>
        </div>
        <div className="li">
          <span className="grow mute">Days to salary</span>
          <b data-testid="days-left">{view.daysLeft}</b>
        </div>
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
    </>
  );
}
