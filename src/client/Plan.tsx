import { useState } from "react";
import { checkCommitment, formatMoney, inThisCycle, NAME_MAX, parseAmount, todayView } from "../money";
import type { CommitmentActions } from "./commitment-actions";
import { type Commitment, dayLabel, entriesOf, type Ready, useToday } from "./data";
import { newId } from "./id";
import { toText } from "./SpendSheet";

/** Plan (spec 10): this cycle's commitments and + Add. Pots, Every cycle and Salary arrived come later. */
export function Plan({ data }: { data: Ready }) {
  const cur = data.settings.spendingCurrency;
  const open = data.commitments.filter((c) => c.state === "open");
  const now = open.filter((c) => inThisCycle(c.dueOn, data.cycle.expectedSalaryOn));
  const later = open.filter((c) => !inThisCycle(c.dueOn, data.cycle.expectedSalaryOn));
  const row = (c: Commitment) => (
    <a key={c.id} className="li tap link" href={`#Commitment/${c.id}`}>
      <span className="date">
        <b>{dayLabel(c.dueOn)}</b>
      </span>
      <span className="grow">{c.name}</span>
      <b className="small">{formatMoney(c.plannedMinor, cur)}</b>
    </a>
  );
  return (
    <>
      <h1>Plan</h1>
      <section className="card" aria-labelledby="commitments-h">
        <div className="row">
          <h3 id="commitments-h" className="grow">
            This cycle's commitments
          </h3>
          <span className="tiny mute">to {dayLabel(data.cycle.expectedSalaryOn)}</span>
        </div>
        {now.length === 0 && <p className="tiny mute">None yet. Bills you add are set aside at once.</p>}
        {now.map(row)}
        <a className="btn link add" href="#Commitment">
          + Add
        </a>
      </section>
      {later.length > 0 && (
        <section className="card" aria-labelledby="later-h">
          <h3 id="later-h">Due after salary · coming up only</h3>
          <p className="tiny mute">They belong to the next cycle and are not set aside now.</p>
          {later.map(row)}
        </section>
      )}
    </>
  );
}

/**
 * A commitment page (spec 10), new or edit: name, amount, due date, and the
 * new daily allowance before saving. Covers the tab bar; Save and Delete go back to Plan.
 */
export function CommitmentPage({
  data,
  editing,
  actions,
}: {
  data: Ready;
  editing?: Commitment;
  actions: CommitmentActions;
}) {
  const cur = data.settings.spendingCurrency;
  const today = useToday(data.settings.homeTimeZone);
  const [name, setName] = useState(editing?.name ?? "");
  const [text, setText] = useState(editing ? toText(editing.plannedMinor, cur) : "");
  const [dueOn, setDueOn] = useState(editing?.dueOn ?? today);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const plannedMinor = parseAmount(text, cur) ?? 0;
  const draft = { name: name.trim(), plannedMinor, dueOn };
  const problems = checkCommitment(
    { ...draft, currency: cur },
    { cycleStartedOn: data.cycle.startedOn, spendingCurrency: cur },
  );
  const others = data.commitments.filter((c) => c.id !== editing?.id);
  const mine = { ...draft, currency: cur, state: "open" as const };
  const after = todayView(
    { ...entriesOf(data), commitments: plannedMinor > 0 ? [...others, mine] : others },
    today,
  );
  const comingUp = problems.length === 0 && !inThisCycle(dueOn, data.cycle.expectedSalaryOn);
  const back = () => {
    window.location.hash = "Plan";
  };

  async function run(job: () => Promise<boolean>) {
    setBusy(true);
    setFailed(false);
    const ok = await job();
    setBusy(false);
    if (ok) back();
    else setFailed(true);
  }

  return (
    <>
      <div className="row">
        <a className="btn ghost link" href="#Plan">
          ← Back
        </a>
      </div>
      <h1>{editing ? "Change commitment" : "New commitment"}</h1>
      <section className="card stack">
        <label className="field">
          Name
          <input
            value={name}
            maxLength={NAME_MAX}
            placeholder="Rent, electricity…"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          Amount ({cur})
          <input
            value={text}
            inputMode="decimal"
            placeholder="0"
            onChange={(e) => {
              const t = e.target.value;
              if (t === "" || parseAmount(t.replace(/\.$/, ""), cur) !== null) setText(t);
            }}
          />
        </label>
        <label className="field">
          Due date
          <input
            type="date"
            value={dueOn}
            min={data.cycle.startedOn}
            required
            onChange={(e) => setDueOn(e.target.value)}
          />
          <span className="tiny mute">
            {comingUp
              ? `After the expected salary day (${dayLabel(data.cycle.expectedSalaryOn)}): coming up only, not set aside now.`
              : `From ${dayLabel(data.cycle.startedOn)}. Due after ${dayLabel(data.cycle.expectedSalaryOn)} means next cycle.`}
          </span>
        </label>
        <p className="small" data-testid="commitment-after">
          You can spend today after this: <b>{formatMoney(after.allowanceMinor, cur)}</b>
        </p>
      </section>

      {failed && <p className="error">Not saved. Check the connection and try again.</p>}

      <div className="row">
        {editing && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => run(() => actions.remove(editing))}
          >
            Delete
          </button>
        )}
        <button
          type="button"
          className="btn pri grow"
          disabled={busy || problems.length > 0}
          onClick={() => run(() => (editing ? actions.change(editing, draft) : actions.add(newId(), draft)))}
        >
          Save
        </button>
      </div>
    </>
  );
}
