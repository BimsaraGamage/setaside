import { useState } from "react";
import { formatMoney } from "../money";
import type { CommitmentActions } from "./commitment-actions";
import { dayLabel, type Ready, type Spend } from "./data";
import type { LookItem, Outbox, UnsentState } from "./unsent";

/** Why the server refused it, in words (item 24). */
function reasonOf(item: LookItem): string {
  if (item.kind === "spend") {
    return item.reason === "invalid"
      ? "It no longer fits: its pot or card was stopped, or its day is outside this cycle."
      : "The server didn't take it.";
  }
  switch (item.reason) {
    case "locked":
      return `${item.commitmentName}'s cycle has ended.`;
    case "not_open":
      return `${item.commitmentName} is finished.`;
    case "not_found":
      return `${item.commitmentName} was removed.`;
    case "invalid":
      return "Its amount, currency or day doesn't fit this cycle.";
    default:
      return "The server didn't take it.";
  }
}

/** A needs-a-look spend as the spend sheet opens it: unsent, so it can be changed offline. */
export function spendOf(item: Extract<LookItem, { kind: "spend" }>): Spend {
  return { id: item.id, currency: item.currency, ...item.draft, unsent: true };
}

/** One payment that needs a look: send it to an open commitment instead, or remove it. */
function LookPayment({
  data,
  item,
  today,
  box,
  actions,
}: {
  data: Ready;
  item: Extract<LookItem, { kind: "payment" }>;
  today: string;
  box: Outbox;
  actions: CommitmentActions;
}) {
  const open = data.commitments.filter((c) => c.state === "open");
  // The one carried on from it (salary day on another device), else the first open one.
  const carried = open.find((c) => c.carriedFromId === item.commitmentId);
  const [to, setTo] = useState(carried?.id ?? open[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const target = open.find((c) => c.id === to);
  const paidOn =
    item.draft.paidOn < data.cycle.startedOn
      ? data.cycle.startedOn
      : item.draft.paidOn > today
        ? today
        : item.draft.paidOn;
  return (
    <div className="stack look">
      <p className="small">
        Payment {formatMoney(item.draft.amountMinor, item.draft.currency ?? item.commitmentCurrency)} to{" "}
        {item.commitmentName} on {dayLabel(item.draft.paidOn)}
        <span className="tiny mute block">{reasonOf(item)}</span>
      </p>
      {open.length > 0 && (
        <label className="field">
          Pay instead
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {open.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => box.remove(item.id)}>
          Remove
        </button>
        {target && (
          <button
            type="button"
            className="btn pri grow"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await actions.payInstead(item, target, paidOn);
              setBusy(false);
            }}
          >
            Send to {target.name}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The needs-a-look list (item 24, spec 11): unsent items the server no longer takes. A payment goes to another
 * open commitment or is removed; a spend is fixed on the spend sheet or removed. Also the notes about spends
 * moved into this cycle.
 */
export function UnsentCards({
  data,
  state,
  today,
  box,
  actions,
  onFixSpend,
}: {
  data: Ready;
  state: UnsentState;
  today: string;
  box: Outbox;
  actions: CommitmentActions;
  onFixSpend: (spend: Spend) => void;
}) {
  return (
    <>
      {state.look.length > 0 && (
        <section className="card" aria-labelledby="look-h" data-testid="needs-a-look">
          <h3 id="look-h">Needs a look</h3>
          <p className="tiny mute">Made offline and not saved: fix or remove each.</p>
          {state.look.map((item) =>
            item.kind === "payment" ? (
              <LookPayment key={item.id} data={data} item={item} today={today} box={box} actions={actions} />
            ) : (
              <div key={item.id} className="stack look">
                <p className="small">
                  Spend {formatMoney(item.draft.amountMinor, item.currency)}
                  {item.draft.note ? ` · ${item.draft.note}` : ""} on {dayLabel(item.draft.spentOn)}
                  <span className="tiny mute block">{reasonOf(item)}</span>
                </p>
                <div className="row">
                  <button type="button" className="btn" onClick={() => box.remove(item.id)}>
                    Remove
                  </button>
                  <button type="button" className="btn pri grow" onClick={() => onFixSpend(spendOf(item))}>
                    Fix
                  </button>
                </div>
              </div>
            ),
          )}
        </section>
      )}
      {state.notes.map((n) => (
        <section key={n.id} className="card row" data-testid="moved-note">
          <p className="small grow">
            A spend of {formatMoney(n.amountMinor, n.currency)} from {dayLabel(n.movedFrom)} was sent after
            its cycle ended: it is in this cycle now.
          </p>
          <button type="button" className="btn ghost" onClick={() => box.dismissNote(n.id)}>
            OK
          </button>
        </section>
      ))}
    </>
  );
}
