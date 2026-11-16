import { useMemo, useState } from "react";
import { parseRate } from "../money";
import { api } from "./api";
import type { Current } from "./data";
import { phoneTimeZone, timeZones } from "./data";
import { newId } from "./id";
import { SignInSettings } from "./SignInSettings";

/** Settings (spec 10): salary and spending currency, counting rate, usual pay day, home time zone; sign-in. */
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
  const two = settings.salaryCurrency !== settings.spendingCurrency;
  const [rateText, setRateText] = useState(settings.countingRate ?? "");
  const rate = parseRate(rateText);
  const [rateBusy, setRateBusy] = useState(false);

  /** Counting rate with Set (spec 8): free salary-currency money counts at it from now on. */
  async function setRate() {
    if (!rate) return;
    setNote(null);
    setRateBusy(true);
    const res = await api.api["counting-rates"].$post({ json: { id: newId(), rate } }).catch(() => null);
    setRateBusy(false);
    if (!res?.ok) setNote("Not saved. Check the connection and try again.");
    onChanged();
  }

  async function save(change: { usualPayDay?: number; homeTimeZone?: string; askedTimeZone?: string }) {
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
        {two ? (
          <>
            <div className="li">
              <span className="grow">Salary currency</span>
              <span className="small">{settings.salaryCurrency}</span>
            </div>
            <div className="li">
              <span className="grow">Spending currency</span>
              <span className="small">{settings.spendingCurrency}</span>
            </div>
            <label className="field">
              Counting rate ({settings.spendingCurrency} for 1 {settings.salaryCurrency})
              <input
                inputMode="decimal"
                autoComplete="off"
                value={rateText}
                onChange={(e) => setRateText(e.target.value)}
              />
              <span className="tiny mute">
                {settings.salaryCurrency} not changed yet count toward free money at this rate.
              </span>
              {rateText !== "" && rate === null && (
                <span className="tiny bad">Type a plain rate above zero, like 302.50.</span>
              )}
            </label>
            <button
              type="button"
              className="btn"
              disabled={rateBusy || rate === null || rate === settings.countingRate}
              onClick={setRate}
            >
              Set
            </button>
          </>
        ) : (
          <div className="li">
            <span className="grow">Currency</span>
            <span className="small">{settings.spendingCurrency}</span>
          </div>
        )}
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
            // Item 22: a zone picked here by hand is the answer for the phone's zone too.
            onChange={(e) => save({ homeTimeZone: e.target.value, askedTimeZone: phoneTimeZone() })}
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
