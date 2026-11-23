import { useEffect, useState } from "react";
import {
  type CloseEntry,
  type CommitmentState,
  type Ending,
  endedOn,
  formatMoney,
  howItEnded,
  type IncomeKind,
  type Money,
  pastCycleView,
  totalsByCurrency,
} from "../money";
import { api } from "./api";
import { dayLabel, type Ready } from "./data";

/** `GET /api/past`: ended cycles, newest first, with sums per currency. */
interface PastList {
  cycles: {
    id: string;
    startedOn: string;
    nextStartedOn: string;
    incomes: { kind: IncomeKind; currency: string; amountMinor: number }[];
    spends: { currency: string; amountMinor: number }[];
    closes: CloseEntry[];
  }[];
}

/** `GET /api/past/:id`: one ended cycle's rows. */
interface PastCycle {
  cycle: { id: string; startedOn: string; expectedSalaryOn: string; nextStartedOn: string };
  incomes: {
    kind: IncomeKind;
    currency: string;
    amountMinor: number;
    toSavingsMinor: number;
    receivedOn: string;
  }[];
  spends: {
    id: string;
    spentOn: string;
    currency: string;
    amountMinor: number;
    note: string | null;
    potId: string | null;
    cardId: string | null;
    oneOff: boolean;
  }[];
  pots: { id: string; name: string; currency: string; amountMinor: number; archived: boolean }[];
  commitments: {
    id: string;
    name: string;
    kind: string;
    currency: string;
    plannedMinor: number;
    dueOn: string;
    state: CommitmentState;
    payments: { amountMinor: number; currency: string; coversMinor: number | null; paidOn: string }[];
  }[];
  closes: CloseEntry[];
}

type Load<T> = { kind: "loading" } | { kind: "error" } | { kind: "gone" } | { kind: "ok"; data: T };

/** Loads once per key; ended cycles never change, so there is nothing to reload. */
function useLoad<T>(key: string, get: () => Promise<Response>): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ kind: "loading" });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    get()
      .then(async (res) => {
        if (!live) return;
        if (res.status === 404) return setState({ kind: "gone" });
        if (!res.ok) throw new Error(String(res.status));
        setState({ kind: "ok", data: (await res.json()) as T });
      })
      .catch(() => live && setState({ kind: "error" }));
    return () => {
      live = false;
    };
  }, [key, tries]);
  return [state, () => setTries((n) => n + 1)];
}

function Loading<T>({
  state,
  retry,
  children,
}: {
  state: Load<T>;
  retry: () => void;
  children: (d: T) => React.ReactNode;
}) {
  if (state.kind === "ok") return <>{children(state.data)}</>;
  if (state.kind === "gone") return <p className="mute">This cycle is not here.</p>;
  if (state.kind === "error") {
    return (
      <p className="mute">
        Couldn't load.{" "}
        <button type="button" className="btn ghost" onClick={retry}>
          Try again
        </button>
      </p>
    );
  }
  return <p className="mute">Loading…</p>;
}

const moneyList = (list: Money[]) => list.map((m) => formatMoney(m.minor, m.currency)).join(" + ");

/** "1 Nov → 30 Nov": from its first day to the day before the next cycle started. */
function datesLabel(startedOn: string, nextStartedOn: string): string {
  const last = endedOn(startedOn, nextStartedOn);
  return last === startedOn
    ? dayLabel(startedOn, false)
    : `${dayLabel(startedOn, false)} → ${dayLabel(last, false)}`;
}

/** One currency's ending in a line: "Left over Rs 62,000" or "Overspent by Rs 10,000". */
function endingShort(e: Ending): string {
  if (e.kind === "overspend") {
    return e.overMinor === null ? "Overspent" : `Overspent by ${formatMoney(e.overMinor, e.currency)}`;
  }
  return e.leftoverMinor === null ? "Left over" : `Left over ${formatMoney(e.leftoverMinor, e.currency)}`;
}

/** What happened to it: corrected, saved, brought into the new cycle; or taken or ignored. */
function endingMore(e: Ending): string {
  if (e.kind === "overspend") return e.choice === "take" ? "Taken from the next cycle" : "Ignored";
  const parts: string[] = [];
  if (e.inHandMinor !== null && e.inHandMinor !== e.leftoverMinor) {
    parts.push(`Had ${formatMoney(e.inHandMinor, e.currency)} in hand`);
  }
  if (e.toSavingsMinor) parts.push(`${formatMoney(e.toSavingsMinor, e.currency)} to savings`);
  if (e.toNewCycleMinor) parts.push(`${formatMoney(e.toNewCycleMinor, e.currency)} to the next cycle`);
  return parts.join(" · ");
}

/** Past tab (spec 10): ended cycles, newest first, each with dates, salary, spent, how it ended. */
export function PastList({ data }: { data: Ready }) {
  const cur = data.settings.spendingCurrency;
  const [state, retry] = useLoad<PastList>(`past/${data.cycle.id}`, () => api.api.past.$get());
  return (
    <>
      <h1>Past</h1>
      <Loading state={state} retry={retry}>
        {({ cycles }) =>
          cycles.length === 0 ? (
            <p className="mute">No cycle has ended yet. Each one shows here after its salary day.</p>
          ) : (
            <section className="card" aria-label="Past cycles">
              {cycles.map((k) => {
                const salary = totalsByCurrency(
                  k.incomes.filter((i) => i.kind === "salary"),
                  cur,
                );
                const opening = totalsByCurrency(
                  k.incomes.filter((i) => i.kind === "opening"),
                  cur,
                );
                const spent = totalsByCurrency(k.spends, cur);
                const ending = howItEnded(k.closes, cur);
                return (
                  <a key={k.id} className="li tap link" href={`#PastCycle/${k.id}`} data-testid="past-cycle">
                    <span className="grow">
                      {datesLabel(k.startedOn, k.nextStartedOn)}
                      <span className="tiny mute block">
                        {salary.length ? `Salary ${moneyList(salary)}` : `Started with ${moneyList(opening)}`}{" "}
                        · Spent {spent.length ? moneyList(spent) : formatMoney(0, cur)}
                      </span>
                      {ending.length > 0 && (
                        <span className="tiny mute block">{ending.map(endingShort).join(" · ")}</span>
                      )}
                    </span>
                    <span className="small mute">›</span>
                  </a>
                );
              })}
            </section>
          )
        }
      </Loading>
    </>
  );
}

const commitmentLabels = {
  paid: () => "Paid",
  finished: (rest: string) => `Finished · ${rest} not paid`,
  carried: (rest: string) => `Carried · ${rest} to the next cycle`,
  dropped: () => "Dropped",
  unpaid: () => "Not paid",
} as const;

/** One ended cycle (spec 10): locked badge, salary, spent, how it ended, average a day, commitments, pots, spends. */
export function PastCyclePage({ data, id }: { data: Ready; id: string }) {
  const [state, retry] = useLoad<PastCycle>(`past/${id}`, () => api.api.past[":id"].$get({ param: { id } }));
  return (
    <>
      <div className="row">
        <a className="btn ghost link" href="#Past">
          ← Back
        </a>
      </div>
      <Loading state={state} retry={retry}>
        {(p) => <PastCycleView data={data} past={p} />}
      </Loading>
    </>
  );
}

function PastCycleView({ data, past }: { data: Ready; past: PastCycle }) {
  const cur = data.settings.spendingCurrency;
  const v = pastCycleView({
    spendingCurrency: cur,
    startedOn: past.cycle.startedOn,
    nextStartedOn: past.cycle.nextStartedOn,
    incomes: past.incomes,
    spends: past.spends,
    pots: past.pots,
    commitments: past.commitments,
    closes: past.closes,
  });
  const potName = (id: string | null) => (id ? past.pots.find((p) => p.id === id)?.name : undefined);
  const cardName = (id: string | null) =>
    id ? (data.cards.find((k) => k.id === id)?.name ?? "Card") : undefined;
  return (
    <>
      <div className="row">
        <h1 className="grow">{datesLabel(past.cycle.startedOn, past.cycle.nextStartedOn)}</h1>
        <span className="verdict locked" data-testid="locked">
          Locked · read only
        </span>
      </div>
      <section className="card" aria-label="Summary">
        <div className="li">
          <span className="grow">{v.salary.length ? "Salary" : "Started with"}</span>
          <b>{moneyList(v.salary.length ? v.salary : v.opening) || formatMoney(0, cur)}</b>
        </div>
        <div className="li">
          <span className="grow">Spent</span>
          <b data-testid="past-spent">{v.spent.length ? moneyList(v.spent) : formatMoney(0, cur)}</b>
        </div>
        <div className="li">
          <span className="grow">
            Average a day
            <span className="tiny mute block">
              {v.days === 0
                ? "Ended the day it started"
                : `Over ${v.days} day${v.days === 1 ? "" : "s"}; one-offs left out`}
            </span>
          </span>
          <b data-testid="past-average">{v.days === 0 ? "–" : formatMoney(v.perDayMinor, cur)}</b>
        </div>
        {v.ending.map((e) => (
          <div key={e.currency} className="li" data-testid="past-ending">
            <span className="grow">
              {endingShort(e)}
              {endingMore(e) && <span className="tiny mute block">{endingMore(e)}</span>}
            </span>
          </div>
        ))}
      </section>
      {v.commitments.length > 0 && (
        <section className="card" aria-labelledby="past-commitments-h">
          <h3 id="past-commitments-h">Commitments</h3>
          {v.commitments.map((k) => (
            <div key={k.id} className="li" data-testid="past-commitment">
              <span className="grow">
                {k.name}
                <span className={`tiny block ${k.ending.kind === "paid" ? "mute" : ""}`}>
                  {dayLabel(k.dueOn)} ·{" "}
                  {commitmentLabels[k.ending.kind](formatMoney(k.ending.restMinor, k.currency))}
                </span>
              </span>
              <b className="small">
                {formatMoney(k.ending.paidMinor, k.currency)} of {formatMoney(k.plannedMinor, k.currency)}
              </b>
            </div>
          ))}
        </section>
      )}
      {v.pots.length > 0 && (
        <section className="card" aria-labelledby="past-pots-h">
          <h3 id="past-pots-h">Pots</h3>
          {v.pots.map((p) => (
            <div key={p.id} className="li pot" data-testid="past-pot">
              <span className="row">
                <span className="grow">{p.name}</span>
                <span className={`small${p.overMinor ? " bad" : " mute"}`}>
                  {p.overMinor
                    ? `Used up · over by ${formatMoney(p.overMinor, p.currency)}`
                    : `${formatMoney(p.leftMinor, p.currency)} left`}
                </span>
              </span>
              <span
                className={`bar${p.overMinor ? " over" : ""}`}
                role="meter"
                aria-label={`${p.name} spent`}
                aria-valuemin={0}
                aria-valuemax={p.amountMinor}
                aria-valuenow={p.spentMinor}
              >
                <span
                  style={{
                    width: `${p.amountMinor ? Math.min(1, p.spentMinor / p.amountMinor) * 100 : 100}%`,
                  }}
                />
              </span>
              <span className="tiny mute">
                Spent {formatMoney(p.spentMinor, p.currency)} of {formatMoney(p.amountMinor, p.currency)}
              </span>
            </div>
          ))}
        </section>
      )}
      {v.spendDays.length === 0 && <p className="mute">No spends in this cycle.</p>}
      {v.spendDays.map((d) => (
        <section key={d.day} className="card" aria-label={dayLabel(d.day)}>
          <div className="row">
            <h3 className="grow">{dayLabel(d.day)}</h3>
            <span className="tiny mute">{formatMoney(d.totalMinor, cur)}</span>
          </div>
          {d.spends.map((s) => {
            const pot = potName(s.potId);
            const tags = [pot && `${pot} pot`, cardName(s.cardId), s.oneOff && "One-off"].filter(Boolean);
            return (
              <div key={s.id} className="li" data-testid="past-spend">
                <span className="grow">
                  {s.note || "Spend"}
                  {tags.length > 0 && <span className="tiny mute block">{tags.join(" · ")}</span>}
                </span>
                <b>{formatMoney(s.amountMinor, s.currency)}</b>
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}
