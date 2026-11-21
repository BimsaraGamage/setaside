import { formatMoney, type NextCycleGroup, nextCyclePreview } from "../money";
import { dayLabel, type Ready } from "./data";
import { goalEntry } from "./Goals";

const LABELS: [NextCycleGroup, string][] = [
  ["bills", "Bills"],
  ["pots", "Pots"],
  ["savings", "Savings"],
  ["people", "People"],
  ["plans", "Plans"],
];

/**
 * Plan's Next cycle card (spec 6, Next cycle preview): what the next cycle will set
 * aside, by group with its items, the free money left from this cycle's salary, and
 * Within budget or Over by.
 */
export function NextCycleCard({ data }: { data: Ready }) {
  const cur = data.settings.spendingCurrency;
  const salary = data.incomes.find((i) => i.kind === "salary");
  const p = nextCyclePreview({
    spendingCurrency: cur,
    salaryCurrency: data.settings.salaryCurrency,
    countingRate: data.settings.countingRate,
    expectedSalaryOn: data.cycle.expectedSalaryOn,
    usualPayDay: data.settings.usualPayDay,
    salaryMinor: salary ? salary.amountMinor : null,
    commitments: data.commitments,
    recurring: data.recurring,
    pots: data.pots,
    prepayments: data.prepayments,
    plans: data.plans,
    goals: data.goals.map((g) => goalEntry(data, g)),
  });
  const money = (m: number) => formatMoney(m, cur);
  return (
    <section className="card" aria-labelledby="next-cycle-h" data-testid="next-cycle">
      <div className="row">
        <h3 id="next-cycle-h" className="grow">
          Next cycle
        </h3>
        <span className="tiny mute">from {dayLabel(p.startsOn)}</span>
      </div>
      {p.items.length === 0 && <p className="tiny mute">Nothing to set aside yet.</p>}
      {LABELS.filter(([g]) => p.items.some((i) => i.group === g)).map(([g, label]) => (
        <details key={g} className="li group" data-testid={`next-cycle-${g}`}>
          <summary className="row tap">
            <span className="grow">{label}</span>
            <b className="small">{money(p.groups[g])}</b>
          </summary>
          {p.items
            .filter((i) => i.group === g)
            .map((i, n) => (
              <div key={`${i.name}-${n}`} className="row tiny mute item">
                <span className="grow">{i.name}</span>
                <span>{formatMoney(i.minor, i.currency)}</span>
              </div>
            ))}
        </details>
      ))}
      <div className="li row">
        <b className="grow">To set aside</b>
        <b data-testid="next-cycle-total">{money(p.totalMinor)}</b>
      </div>
      {p.salaryMinor !== null && p.freeMinor !== null && (
        <>
          <div className="li row">
            <span className="grow">Salary (this cycle's)</span>
            <span className="small">{money(p.salaryMinor)}</span>
          </div>
          <div className="li row">
            <b className="grow">Free money left</b>
            <b className={p.freeMinor < 0 ? "bad" : ""} data-testid="next-cycle-free">
              {money(p.freeMinor)}
            </b>
          </div>
          <p>
            <span className={`verdict ${p.freeMinor < 0 ? "bad" : "ok"}`} data-testid="next-cycle-verdict">
              {p.freeMinor < 0 ? `Over by ${money(-p.freeMinor)}` : "Within budget"}
            </span>
          </p>
        </>
      )}
      <p className="tiny mute">
        {p.salaryMinor === null ? "No salary yet to compare with. " : ""}
        Leaves out what is left of this cycle and card bills. Salary day sets the real amounts.
      </p>
    </section>
  );
}
