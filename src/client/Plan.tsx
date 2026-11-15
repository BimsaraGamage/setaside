import { useState } from "react";
import {
  checkCommitment,
  formatMoney,
  inThisCycle,
  NAME_MAX,
  paidMinor,
  parseAmount,
  stillToPayMinor,
  todayView,
} from "../money";
import type { CommitmentActions } from "./commitment-actions";
import { type Commitment, dayLabel, entriesOf, type Ready, useToday } from "./data";
import { newId } from "./id";
import { plannedGap } from "./Pay";
import { toText } from "./SpendSheet";

/** "Paid Rs 10,000 of Rs 36,000" for a part-paid open commitment; nothing when unpaid. */
export function paidNote(c: Commitment): string | undefined {
  if (c.payments.length === 0) return undefined;
  return `Paid ${formatMoney(paidMinor(c, c.currency), c.currency)} of ${formatMoney(c.plannedMinor, c.currency)}`;
}

/** Plan (spec 10): this cycle's commitments and + Add. Pots, Every cycle and Salary arrived come later. */
export function Plan({ data }: { data: Ready }) {
  const cur = data.settings.spendingCurrency;
  const open = data.commitments.filter((c) => c.state === "open");
  const now = open.filter((c) => inThisCycle(c.dueOn, data.cycle.expectedSalaryOn));
  const later = open.filter((c) => !inThisCycle(c.dueOn, data.cycle.expectedSalaryOn));
  const finished = data.commitments.filter((c) => c.state === "finished");
  const row = (c: Commitment) => {
    const done = c.state === "finished";
    const note = done ? "Paid · finished" : paidNote(c);
    return (
      <a key={c.id} className={`li tap link${done ? " done" : ""}`} href={`#Commitment/${c.id}`}>
        <span className="date">
          <b>{dayLabel(c.dueOn)}</b>
        </span>
        <span className="grow">
          {c.name}
          {note && <span className="tiny mute block">{note}</span>}
        </span>
        <b className="small">
          {formatMoney(
            done ? paidMinor(c, cur) : c.payments.length ? stillToPayMinor(c) : c.plannedMinor,
            cur,
          )}
        </b>
      </a>
    );
  };
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
      {finished.length > 0 && (
        <section className="card" aria-labelledby="finished-h">
          <h3 id="finished-h">Finished</h3>
          {finished.map(row)}
        </section>
      )}
    </>
  );
}

/** The commitment page's payments (spec 10): list, paid and still to pay, Pay, Mark finished or Reopen. */
function Payments({ c, actions }: { c: Commitment; actions: CommitmentActions }) {
  const cur = c.currency;
  const paid = paidMinor(c, cur);
  const open = c.state === "open";
  const [busy, setBusy] = useState(false);
  const run = async (job: () => Promise<boolean>) => {
    setBusy(true);
    await job();
    setBusy(false);
  };
  return (
    <section className="card" aria-labelledby="payments-h">
      <div className="row">
        <h3 id="payments-h" className="grow">
          Payments
        </h3>
        {!open && <span className="tiny mute">Finished</span>}
      </div>
      {c.payments.length === 0 && <p className="tiny mute">Nothing paid yet.</p>}
      {c.payments.map((p) => (
        <a key={p.id} className="li tap link" href={`#Payment/${p.id}`}>
          <span className="grow">{dayLabel(p.paidOn)}</span>
          <b className="small">{formatMoney(p.amountMinor, cur)}</b>
        </a>
      ))}
      <p className="small" data-testid="still-to-pay">
        {open ? (
          <>
            Paid {formatMoney(paid, cur)} · still to pay <b>{formatMoney(stillToPayMinor(c), cur)}</b>
          </>
        ) : (
          <>
            Paid {formatMoney(paid, cur)} · {plannedGap(paid, c.plannedMinor, cur)}
          </>
        )}
      </p>
      <div className="row">
        {open ? (
          <>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => run(() => actions.finish(c))}
            >
              Mark finished
            </button>
            <a className="btn pri grow link" href={`#Pay/${c.id}`}>
              Pay
            </a>
          </>
        ) : (
          <button type="button" className="btn" disabled={busy} onClick={() => run(() => actions.reopen(c))}>
            Reopen
          </button>
        )}
      </div>
    </section>
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
  const mine = {
    ...draft,
    currency: cur,
    state: editing?.state ?? ("open" as const),
    payments: editing?.payments ?? [],
  };
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

      {editing && <Payments c={editing} actions={actions} />}

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
