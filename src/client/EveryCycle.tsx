import { useState } from "react";
import { formatMoney } from "../money";
import { api } from "./api";
import type { Ready, Recurring } from "./data";
import type { Toaster } from "./toast";

const ok = async (res: Promise<Response | { ok: boolean }>) => (await res.catch(() => null))?.ok ?? false;

const setActive = (id: string, active: boolean) =>
  ok(api.api["recurring-commitments"][":id"].$patch({ param: { id }, json: { active } }));

/** Pause a recurring commitment or switch it back on; a toast with Undo (spec 3). */
export function everyCycleActions({ done }: Toaster) {
  return {
    setActive: (r: Recurring, active: boolean) =>
      setActive(r.id, active).then((ok) =>
        done(ok, {
          text: active ? `${r.name} back on` : `${r.name} paused`,
          undo: () => setActive(r.id, !active),
        }),
      ),
  };
}

export type EveryCycleActions = ReturnType<typeof everyCycleActions>;

/** "on the 1st", "on the 22nd". */
function dayOfMonth(n: number): string {
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `on the ${n}${suffix}`;
}

/**
 * Every cycle (spec 10): the usual commitments with amount and day, each with an
 * on/off (paused) switch, and the usual pots. Filled in on salary day.
 */
export function EveryCyclePage({ data, actions }: { data: Ready; actions: EveryCycleActions }) {
  const [busy, setBusy] = useState(false);
  const pots = data.pots.filter((p) => !p.archived);
  return (
    <>
      <div className="row">
        <a className="btn ghost link" href="#Plan">
          ← Back
        </a>
      </div>
      <h1>Every cycle</h1>
      <section className="card" aria-labelledby="usual-h">
        <h3 id="usual-h">Usual commitments</h3>
        {data.recurring.length === 0 && (
          <p className="tiny mute">None yet. Switch on "Every cycle" on a commitment to add it here.</p>
        )}
        {data.recurring.map((r) => (
          <label key={r.id} className={`li check${r.active ? "" : " done"}`}>
            <span className="grow">
              {r.name}
              <span className="tiny mute block">
                {formatMoney(r.usualAmountMinor, r.currency)} {dayOfMonth(r.usualDay)}
                {r.kind === "savings" ? " · savings" : ""}
                {r.active ? "" : " · paused"}
              </span>
            </span>
            <input
              type="checkbox"
              aria-label={`${r.name} every cycle`}
              checked={r.active}
              disabled={busy}
              onChange={async (e) => {
                setBusy(true);
                await actions.setActive(r, e.target.checked);
                setBusy(false);
              }}
            />
          </label>
        ))}
        <p className="tiny mute">A paused one is not filled in on salary day.</p>
      </section>
      <section className="card" aria-labelledby="usual-pots-h">
        <h3 id="usual-pots-h">Usual pots</h3>
        {pots.length === 0 && <p className="tiny mute">No pots in use.</p>}
        {pots.map((p) => (
          <a key={p.id} className="li tap link" href={`#Pot/${p.id}`}>
            <span className="grow">{p.name}</span>
            <b className="small">{formatMoney(p.usualAmountMinor, p.currency)}</b>
          </a>
        ))}
      </section>
    </>
  );
}
