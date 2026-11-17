import { useState } from "react";
import { type Reminder, reminderSubject, remindersOfCurrent, reminderText } from "../money";
import { api } from "./api";
import { type Ready, useTimeOfDay } from "./data";
import { usePush } from "./push";
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

/**
 * Today's reminders (spec 12, items 25 and 26): the list at the top of Today while
 * phone alerts are off on this device, with a dismissable banner on how to turn them on.
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
  const push = usePush();
  const [busy, setBusy] = useState(false);
  // This device gets them as phone notifications instead.
  if (push.state === "on" || push.state === "loading") return null;
  const list = remindersOfCurrent(data, today, time);
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
            Reminders show here while phone alerts are off. For phone alerts, add the app to your Home Screen
            (on iPhone: Share › Add to Home Screen), open it from there, then tap Turn on reminders in
            Settings. Choose which reminders you get in Settings too.
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
  return `${r.kind}:${reminderSubject(r) ?? ""}`;
}
