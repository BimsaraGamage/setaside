import type { ReactNode } from "react";
import {
  countedMinor,
  formatMoney,
  isSalaryLate,
  nextUp,
  otherCurrency,
  potVerdict,
  setAsideMinor,
  stillToPayMinor,
  todayView,
} from "../money";
import { dayLabel, entriesOf, inDaysLabel, potEntry, type Ready, type Spend, useToday } from "./data";
import { agoLabel } from "./offline-copy";
import { commitmentNote } from "./Plan";
import { PotRow } from "./Pots";
import { type ReminderActions, RemindersCard } from "./Reminders";
import { cardName, potName, SpendRow } from "./Spends";
import { type CycleActions, LateSalaryCard } from "./ThisCycle";
import { type DayChoiceActions, UnderspendCard } from "./Underspend";
import { VerdictChip } from "./Verdict";
import { type ZoneActions, ZoneSwitchCard } from "./ZoneSwitch";

/** "Speed Rs 2,300 a day · Tomorrow Rs 4,800" (spec 10); the speed is left out while it is too early to tell. */
function speedLine(view: ReturnType<typeof todayView>): string {
  const money = (m: number) => formatMoney(m, view.currency);
  const parts: string[] = [];
  if (view.speedPerDayMinor !== null) {
    parts.push(
      `Speed ${money(view.speedPerDayMinor)} a day${view.speedFromLastCycle ? " (last cycle)" : ""}`,
    );
  }
  if (view.tomorrowMinor !== null) parts.push(`Tomorrow ${money(view.tomorrowMinor)}`);
  return parts.join(" · ");
}

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

/**
 * Today (spec 10): header, the reminders list (item 25), the salary-late card (item 13), the underspend card, main card with the daily
 * allowance, verdict, today's spends and the speed line, Next up, pots with
 * their verdicts, the + button.
 */
export function Today({
  data,
  onAdd,
  onEdit,
  dayChoices,
  cycle: cycleActions,
  zone,
  reminders,
  offlineSince = null,
  children,
}: {
  data: Ready;
  /** The saved copy is shown: when it was saved (spec 11). */
  offlineSince?: number | null;
  /** Cards about unsent items (item 24): needs a look, spends moved. */
  children?: ReactNode;
  onAdd: (today: string) => void;
  onEdit: (spend: Spend, today: string) => void;
  dayChoices: DayChoiceActions;
  cycle: CycleActions;
  zone: ZoneActions;
  reminders: ReminderActions;
}) {
  const { settings, cycle } = data;
  const today = useToday(settings.homeTimeZone);
  const view = todayView(entriesOf(data), today);
  const up = nextUp(data.commitments, today, cycle.expectedSalaryOn, settings.spendingCurrency);
  // Two currencies (spec 8): the salary currency's set-asides count at the counting rate.
  const other = otherCurrency(entriesOf(data));
  const nextUpTotal =
    up.totalMinor +
    (other
      ? countedMinor(entriesOf(data), setAsideMinor(data.commitments, cycle.expectedSalaryOn, other))
      : 0);
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
        <a className="btn link" href="#SalaryDay">
          Salary arrived
        </a>
      </header>

      <ZoneSwitchCard home={settings.homeTimeZone} asked={settings.askedTimeZone} actions={zone} />

      {children}

      <RemindersCard data={data} today={today} actions={reminders} />

      {isSalaryLate(today, cycle.expectedSalaryOn) && (
        <LateSalaryCard data={data} today={today} actions={cycleActions} />
      )}

      {view.underspend && (
        <UnderspendCard
          question={view.underspend}
          currency={view.currency}
          today={today}
          actions={dayChoices}
        />
      )}

      <section className="card main" aria-labelledby="today-h">
        <h3 id="today-h">You can spend today</h3>
        <p className="big" data-testid="allowance">
          {money(view.allowanceMinor)}
        </p>
        {offlineSince !== null && (
          <p className="tiny mute" data-testid="last-updated">
            Last updated {agoLabel(offlineSince)}
          </p>
        )}
        <VerdictChip verdict={view.verdict} currency={view.currency} />
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
            <SpendRow
              key={s.id}
              spend={s}
              pot={potName(data, s)}
              card={cardName(data, s)}
              onOpen={() => onEdit(s, today)}
            />
          ))}
        <div className="li">
          <span className="grow mute">Free money</span>
          <b data-testid="free-money">{money(view.freeMinor)}</b>
        </div>
        <div className="li">
          <span className="grow mute">Days to salary</span>
          <b data-testid="days-left">{view.daysLeft}</b>
        </div>
        {speedLine(view) && (
          <p className="tiny mute" data-testid="speed-line">
            {speedLine(view)}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="next-h">
        <div className="row">
          <h3 id="next-h" className="grow">
            Next up · already set aside
          </h3>
          <b className="small" data-testid="next-up-total">
            {money(nextUpTotal)}
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
            amount={formatMoney(stillToPayMinor(c), c.currency)}
            note={commitmentNote(data, c)}
          />
        ))}
        <NextUpRow name="Salary expected" day={cycle.expectedSalaryOn} inDays={up.salaryInDays} />
        {up.comingUp.map(({ commitment: c, inDays }) => (
          <NextUpRow
            key={c.id}
            name={c.name}
            day={c.dueOn}
            inDays={inDays}
            amount={formatMoney(c.plannedMinor, c.currency)}
            note="Coming up · next cycle"
            coming
          />
        ))}
      </section>

      {pots.length > 0 && (
        <section className="card" aria-labelledby="pots-today-h">
          <h3 id="pots-today-h">Pots</h3>
          {pots.map((p) => (
            <PotRow
              key={p.id}
              pot={p}
              spends={data.spends}
              verdict={potVerdict(potEntry(p), data.spends, {
                startedOn: cycle.startedOn,
                today,
                daysLeft: view.daysLeft,
                lastSpeed: data.lastCycle?.pots[p.id] ?? null,
              })}
            />
          ))}
        </section>
      )}

      <button type="button" className="fab" aria-label="Add a spend" onClick={() => onAdd(today)}>
        +
      </button>
    </>
  );
}
