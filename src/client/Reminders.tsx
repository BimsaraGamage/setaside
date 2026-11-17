import { useState } from "react";
import { formatMoney, type Reminder, reminders } from "../money";
import { api } from "./api";
import { dayLabel, entriesOf, inDaysLabel, potEntry, type Ready, useTimeOfDay } from "./data";
import type { Toaster } from "./toast";

/** Hides the turn-on banner for good (spec 12: it is dismissable). */
export function reminderActions({ done }: Toaster) {
  return {
    dismissBanner: async () => {
      const res = await api.api.settings
        .$patch({ json: { reminderBannerDismissed: true } })
        .catch(() => null);
      return done(res?.ok ?? false, { text: "Banner hidden" });
    },
  };
}

export type ReminderActions = ReturnType<typeof reminderActions>;

/** One reminder in words, as the list and the morning summary say it (spec 12). */
export function reminderText(r: Reminder): string {
  switch (r.kind) {
    case "due_today":
      return `${r.name} ${r.lateDays === 0 ? "due today" : inDaysLabel(-r.lateDays)} · ${formatMoney(r.stillMinor, r.currency)}`;
    case "due_soon":
      return `${r.name} ${inDaysLabel(r.inDays)} · ${formatMoney(r.stillMinor, r.currency)}`;
    case "running_out": {
      const who = r.name ?? "Free money";
      const v = r.verdict;
      if (v.kind === "tight") return `${who}: tight`;
      if (v.kind === "runs_out") return `${who}: runs out on ${dayLabel(v.on)}`;
      return `${who}: over by ${formatMoney(v.overMinor, r.currency)}`;
    }
    case "salary_late":
      return `Salary late: expected ${dayLabel(r.expectedOn)}, ${r.lateDays} day${r.lateDays === 1 ? "" : "s"} ago`;
    case "questions": {
      const parts: string[] = [];
      if (r.unspentDays > 0) {
        const when = r.unspentDays === 1 ? "yesterday" : `in the last ${r.unspentDays} days`;
        parts.push(
          `${formatMoney(r.unspentMinor, r.currency)} not spent ${when}: spread it or add to today?`,
        );
      }
      const asks: string[] = [];
      if (r.unpaid > 0) asks.push(`${r.unpaid} unpaid bill${r.unpaid === 1 ? "" : "s"}`);
      if (r.overMinor > 0) asks.push(`an overspend of ${formatMoney(r.overMinor, r.currency)}`);
      if (asks.length > 0) parts.push(`Salary day will ask about ${asks.join(" and ")}`);
      return parts.join(" · ");
    }
    case "spend_nudge":
      return "Any spends today? Add them with +";
  }
}

/**
 * Today's reminders (spec 12, item 25): the list at the top of Today while phone
 * alerts are off, with a dismissable banner on how to turn them on.
 */
export function RemindersCard({
  data,
  today,
  actions,
}: {
  data: Ready;
  today: string;
  actions: ReminderActions;
}) {
  const { settings } = data;
  const time = useTimeOfDay(settings.homeTimeZone);
  const [busy, setBusy] = useState(false);
  const list = reminders({
    entries: entriesOf(data),
    commitments: data.commitments,
    pots: data.pots.map((p) => ({ ...potEntry(p), name: p.name })),
    potLastSpeeds: data.lastCycle?.pots,
    today,
    time,
    settings: settings.reminders,
  });
  if (list.length === 0) return null;

  async function dismiss() {
    setBusy(true);
    await actions.dismissBanner();
    setBusy(false);
  }

  return (
    <section className="card stack" aria-labelledby="reminders-h" data-testid="reminders">
      <h3 id="reminders-h">Reminders</h3>
      {list.map((r) => (
        <div key={reminderKey(r)} className="li small" data-kind={r.kind}>
          <span className="grow">{reminderText(r)}</span>
        </div>
      ))}
      {!settings.reminderBannerDismissed && (
        <div className="stack" data-testid="reminders-banner">
          <p className="tiny mute">
            Reminders show here while phone alerts are off. Phone alerts need the app on your Home Screen (on
            iPhone: Share › Add to Home Screen). Choose which reminders you get in Settings.
          </p>
          <button type="button" className="btn ghost" disabled={busy} onClick={dismiss}>
            Got it
          </button>
        </div>
      )}
    </section>
  );
}

function reminderKey(r: Reminder): string {
  if (r.kind === "due_today" || r.kind === "due_soon") return `${r.kind}:${r.id}`;
  if (r.kind === "running_out") return `${r.kind}:${r.potId ?? "free"}`;
  return r.kind;
}
