import { useState } from "react";
import { type DayChoice, formatMoney, type UnderspendQuestion } from "../money";
import { api } from "./api";
import { newId } from "./id";
import type { Toaster } from "./toast";

/** Saves today's underspend answer; reloads the numbers and shows a toast (no Undo: spec 2). */
export function dayChoiceActions({ done }: Toaster) {
  return {
    answer: async (dayOn: string, choice: DayChoice) => {
      const res = await api.api["day-choices"]
        .$post({ json: { id: newId(), dayOn, choice } })
        .catch(() => null);
      return done(res?.ok ?? false, {
        text: choice === "today" ? "Added to today" : "Spread over the days left",
      });
    },
  };
}

export type DayChoiceActions = ReturnType<typeof dayChoiceActions>;

/**
 * The underspend card on Today (spec 7, 10): allowance not spent since the last
 * answer, and the two answers with what each makes today's allowance.
 */
export function UnderspendCard({
  question: q,
  currency,
  today,
  actions,
}: {
  question: UnderspendQuestion;
  currency: string;
  today: string;
  actions: DayChoiceActions;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const money = (m: number) => formatMoney(m, currency);
  const when = q.days === 1 ? "yesterday" : `in the last ${q.days} days`;

  async function pick(choice: DayChoice) {
    setBusy(true);
    setFailed(false);
    const ok = await actions.answer(today, choice);
    setBusy(false);
    if (!ok) setFailed(true);
  }

  return (
    <section className="card stack" aria-labelledby="underspend-h" data-testid="underspend">
      <h3 id="underspend-h">
        {money(q.unspentMinor)} not spent {when}
      </h3>
      <div className="row answers">
        <button type="button" className="btn" disabled={busy} onClick={() => pick("spread")}>
          Spread over the days left
          <span className="tiny mute block">{money(q.spreadMinor)} a day</span>
        </button>
        <button type="button" className="btn pri" disabled={busy} onClick={() => pick("today")}>
          Add to today
          <span className="tiny block">{money(q.todayMinor)} today</span>
        </button>
      </div>
      {failed && <p className="tiny bad">Not saved. Check the connection and try again.</p>}
    </section>
  );
}
