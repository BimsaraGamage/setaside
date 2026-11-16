import { useEffect, useState } from "react";
import { todayIn, zoneToAsk } from "../money";
import { api } from "./api";
import { dayLabel, phoneTimeZone } from "./data";
import type { Toaster } from "./toast";

/** Saves the answer to the switch question (item 22); reloads the numbers and shows a toast. */
export function zoneActions({ done }: Toaster) {
  return {
    /** Switch: the phone's zone becomes home. Keep: home stays; this zone is not asked about again. */
    answer: async (zone: string, switchTo: boolean) => {
      const json = switchTo ? { homeTimeZone: zone, askedTimeZone: zone } : { askedTimeZone: zone };
      const res = await api.api.settings.$patch({ json }).catch(() => null);
      return done(res?.ok ?? false, {
        text: switchTo ? `Home time zone is now ${zoneName(zone)}` : "Kept your home time zone",
      });
    },
  };
}

export type ZoneActions = ReturnType<typeof zoneActions>;

/** "Europe/London" → "London"; "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export function zoneName(zone: string): string {
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}

/** The phone's time zone, looked at again whenever the app comes back to the front. */
function usePhoneTimeZone(): string {
  const [zone, setZone] = useState(phoneTimeZone);
  useEffect(() => {
    const look = () => setZone(phoneTimeZone());
    document.addEventListener("visibilitychange", look);
    return () => document.removeEventListener("visibilitychange", look);
  }, []);
  return zone;
}

/**
 * The switch question on Today (spec 10, item 22): asked once when the phone's
 * time zone differs from home. Shows what today would become there.
 */
export function ZoneSwitchCard({
  home,
  asked,
  actions,
}: {
  home: string;
  asked: string | null;
  actions: ZoneActions;
}) {
  const phone = usePhoneTimeZone();
  const zone = zoneToAsk({ home, phone, asked });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!zone) return null;

  const now = Date.now();
  const todayHome = todayIn(home, now);
  const todayThere = todayIn(zone, now);

  async function pick(switchTo: boolean) {
    if (!zone) return;
    setBusy(true);
    setFailed(false);
    const ok = await actions.answer(zone, switchTo);
    setBusy(false);
    if (!ok) setFailed(true);
  }

  return (
    <section className="card stack" aria-labelledby="zone-switch-h" data-testid="zone-switch">
      <h3 id="zone-switch-h">Your phone is on {zoneName(zone)} time</h3>
      <p className="small">
        {`Days start and end at midnight in your home time zone, ${zoneName(home)}. Switch it to ${zoneName(zone)}?`}
      </p>
      {todayThere !== todayHome && (
        <p className="tiny mute" data-testid="zone-switch-day">
          Today would be {dayLabel(todayThere)} instead of {dayLabel(todayHome)}.
        </p>
      )}
      <div className="row answers">
        <button type="button" className="btn" disabled={busy} onClick={() => pick(false)}>
          Keep {zoneName(home)}
        </button>
        <button type="button" className="btn pri" disabled={busy} onClick={() => pick(true)}>
          Switch to {zoneName(zone)}
        </button>
      </div>
      {failed && <p className="tiny bad">Not saved. Check the connection and try again.</p>}
    </section>
  );
}
