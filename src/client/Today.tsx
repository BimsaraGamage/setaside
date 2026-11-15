import { formatMoney, nextUp, stillToPayMinor, todayView } from "../money";
import { dayLabel, entriesOf, inDaysLabel, type Ready, type Spend, useToday } from "./data";
import { paidNote } from "./Plan";
import { PotRow } from "./Pots";
import { potName, SpendRow } from "./Spends";

/** One Next up row: date, weekday and "in N days", the name, an optional note, the amount. */
function NextUpRow({
  name,
  day,
  inDays,
  amount,
  note,
  coming,
}: {
  name: string;
  day: string;
  inDays: number;
  amount?: string;
  note?: string;
  coming?: boolean;
}) {
  return (
    <div className={`li${coming ? " coming" : ""}`}>
      <span className="date">
        <b>{dayLabel(day)}</b>
        <span className={`tiny${inDays < 0 ? " bad" : " mute"}`}>{inDaysLabel(inDays)}</span>
      </span>
      <span className="grow">
        {name}
        {note && <span className="tiny mute block">{note}</span>}
      </span>
      {amount && <b className="small">{amount}</b>}
    </div>
  );
}

/** Today (spec 10): header, main card with the daily allowance and today's spends, Next up, pots, the + button. */
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
  const view = todayView(entriesOf(data), today);
  const up = nextUp(data.commitments, today, cycle.expectedSalaryOn, settings.spendingCurrency);
  const money = (m: number) => formatMoney(m, view.currency);
  const pots = data.pots.filter((p) => !p.archived);
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
            <SpendRow key={s.id} spend={s} pot={potName(data, s)} onOpen={() => onEdit(s, today)} />
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
        <div className="row">
          <h3 id="next-h" className="grow">
            Next up · already set aside
          </h3>
          <b className="small" data-testid="next-up-total">
            {money(up.totalMinor)}
          </b>
        </div>
        {up.items.length === 0 && (
          <p className="tiny mute">
            Nothing set aside yet. Add bills on <a href="#Plan">Plan</a>.
          </p>
        )}
        {up.items.map(({ commitment: c, inDays }) => (
          <NextUpRow
            key={c.id}
            name={c.name}
            day={c.dueOn}
            inDays={inDays}
            amount={money(stillToPayMinor(c))}
            note={paidNote(c)}
          />
        ))}
        <NextUpRow name="Salary expected" day={cycle.expectedSalaryOn} inDays={up.salaryInDays} />
        {up.comingUp.map(({ commitment: c, inDays }) => (
          <NextUpRow
            key={c.id}
            name={c.name}
            day={c.dueOn}
            inDays={inDays}
            amount={money(c.plannedMinor)}
            note="Coming up · next cycle"
            coming
          />
        ))}
      </section>

      {pots.length > 0 && (
        <section className="card" aria-labelledby="pots-today-h">
          <h3 id="pots-today-h">Pots</h3>
          {pots.map((p) => (
            <PotRow key={p.id} pot={p} spends={data.spends} />
          ))}
        </section>
      )}

      <button type="button" className="fab" aria-label="Add a spend" onClick={() => onAdd(today)}>
        +
      </button>
    </>
  );
}
