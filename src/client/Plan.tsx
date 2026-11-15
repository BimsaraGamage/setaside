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
import type { CommitmentActions, CommitmentKind } from "./commitment-actions";
import { type Commitment, dayLabel, entriesOf, type Ready, useToday } from "./data";
import { newId } from "./id";
import { plannedGap } from "./Pay";
import { PlanPots } from "./Pots";
import { toText } from "./SpendSheet";

/** A savings set-aside (item 10): its money is moved to savings, not paid. */
export const isSavings = (c: Pick<Commitment, "kind">) => c.kind === "savings";

/**
 * "Paid Rs 10,000 of Rs 36,000" for a part-paid open commitment ("Moved … · savings"
 * for a savings set-aside); "Savings" when nothing is moved yet; nothing for an unpaid bill.
 */
export function paidNote(c: Commitment): string | undefined {
  const of = `${formatMoney(paidMinor(c, c.currency), c.currency)} of ${formatMoney(c.plannedMinor, c.currency)}`;
  if (isSavings(c)) return c.payments.length ? `Moved ${of} · savings` : "Savings";
  if (c.payments.length === 0) return undefined;
  return `Paid ${of}`;
}

/** Plan (spec 10): this cycle's commitments and + Add, pots and + New pot. Every cycle and Salary arrived come later. */
export function Plan({ data }: { data: Ready }) {
  const cur = data.settings.spendingCurrency;
  const open = data.commitments.filter((c) => c.state === "open");
  const now = open.filter((c) => inThisCycle(c.dueOn, data.cycle.expectedSalaryOn));
  const later = open.filter((c) => !inThisCycle(c.dueOn, data.cycle.expectedSalaryOn));
  const finished = data.commitments.filter((c) => c.state === "finished");
  const row = (c: Commitment) => {
    const done = c.state === "finished";
    const note = done ? (isSavings(c) ? "Moved to savings · finished" : "Paid · finished") : paidNote(c);
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
      <PlanPots data={data} />
    </>
  );
}

/** The commitment page's payments (spec 10): list, paid and still to pay, Pay, Mark finished or Reopen. */
function Payments({ c, actions }: { c: Commitment; actions: CommitmentActions }) {
  const cur = c.currency;
  const paid = paidMinor(c, cur);
  const open = c.state === "open";
  const saving = isSavings(c);
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
          {saving ? "Moved to savings" : "Payments"}
        </h3>
        {!open && <span className="tiny mute">Finished</span>}
      </div>
      {c.payments.length === 0 && (
        <p className="tiny mute">{saving ? "Nothing moved yet." : "Nothing paid yet."}</p>
      )}
      {c.payments.map((p) => (
        <a key={p.id} className="li tap link" href={`#Payment/${p.id}`}>
          <span className="grow">{dayLabel(p.paidOn)}</span>
          <b className="small">{formatMoney(p.amountMinor, cur)}</b>
        </a>
      ))}
      <p className="small" data-testid="still-to-pay">
        {open ? (
          <>
            {saving ? "Moved" : "Paid"} {formatMoney(paid, cur)} · still to {saving ? "move" : "pay"}{" "}
            <b>{formatMoney(stillToPayMinor(c), cur)}</b>
          </>
        ) : (
          <>
            {saving ? "Moved" : "Paid"} {formatMoney(paid, cur)} · {plannedGap(paid, c.plannedMinor, cur)}
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
              {saving ? "Move" : "Pay"}
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
  const [kind, setKind] = useState<CommitmentKind>(editing?.kind === "savings" ? "savings" : "bill");
  const [name, setName] = useState(editing?.name ?? "");
  const [text, setText] = useState(editing ? toText(editing.plannedMinor, cur) : "");
  const [dueOn, setDueOn] = useState(editing?.dueOn ?? today);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const plannedMinor = parseAmount(text, cur) ?? 0;
  const draft = { kind, name: name.trim(), plannedMinor, dueOn };
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
        <fieldset className="chips" aria-label="Kind">
          <button
            type="button"
            className="btn"
            aria-pressed={kind === "bill"}
            onClick={() => setKind("bill")}
          >
            Bill
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={kind === "savings"}
            onClick={() => setKind("savings")}
          >
            Savings
          </button>
        </fieldset>
        {kind === "savings" && (
          <p className="tiny mute">
            Set aside like a bill. When you move it to savings, mark it moved: it joins your savings.
          </p>
        )}
        <label className="field">
          Name
          <input
            value={name}
            maxLength={NAME_MAX}
            placeholder={kind === "savings" ? "Savings" : "Rent, electricity…"}
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
