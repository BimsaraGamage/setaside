import { useMemo, useState } from "react";
import { api } from "./api";
import type { Current } from "./data";
import { timeZones } from "./data";
import { SignInSettings } from "./SignInSettings";

/** Settings (spec 10): currency, usual pay day, home time zone; sign-in. */
export function Settings({
  settings,
  onChanged,
  onSignedOut,
}: {
  settings: NonNullable<Current["settings"]>;
  onChanged: () => void;
  onSignedOut: () => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const zones = useMemo(() => timeZones(settings.homeTimeZone), [settings.homeTimeZone]);

  async function save(change: { usualPayDay?: number; homeTimeZone?: string }) {
    setNote(null);
    const res = await api.api.settings.$patch({ json: change }).catch(() => null);
    if (!res?.ok) setNote("Not saved. Check the connection and try again.");
    onChanged();
  }

  return (
    <>
      <h1>Settings</h1>
      <section className="card" aria-labelledby="money-settings-h">
        <h3 id="money-settings-h">Money</h3>
        <div className="li">
          <span className="grow">Currency</span>
          <span className="small">{settings.spendingCurrency}</span>
        </div>
        <label className="li">
          <span className="grow">Usual pay day</span>
          <select
            value={settings.usualPayDay}
            onChange={(e) => save({ usualPayDay: Number(e.target.value) })}
            aria-label="Usual pay day"
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="li">
          <span className="grow">Home time zone</span>
          <select
            value={settings.homeTimeZone}
            onChange={(e) => save({ homeTimeZone: e.target.value })}
            aria-label="Home time zone"
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        {note && (
          <p className="tiny bad" role="alert">
            {note}
          </p>
        )}
      </section>
      <SignInSettings onSignedOut={onSignedOut} />
    </>
  );
}
