import { useMemo, useState } from "react";
import { DUE_SOON_DAYS_MAX, parseRate, type ReminderSettings, reminderTimes } from "../money";
import { api } from "./api";
import type { Current } from "./data";
import { phoneTimeZone, timeZones } from "./data";
import { type Download, download } from "./download";
import { newId } from "./id";
import { type PushState, type TurnOnProblem, usePush } from "./push";
import { SignInSettings } from "./SignInSettings";

/** The six reminders' switches (spec 12), in the order of the spec. */
const SWITCHES: { key: keyof ReminderSettings; label: string; hint: string }[] = [
  { key: "dueSoon", label: "Bill due soon", hint: "Once, a few days before" },
  { key: "dueToday", label: "Bill due today or late", hint: "Every morning until paid" },
  { key: "runningOut", label: "Running out", hint: "Free money or a pot is tight or runs out" },
  { key: "salaryLate", label: "Salary late", hint: "From the day after it was expected" },
  { key: "questions", label: "Questions waiting", hint: "Underspend and salary day questions" },
  { key: "spendNudge", label: "Spend nudge", hint: "In the evening, if nothing was added today" },
];

const DEVICE_NOTE: Record<Exclude<PushState, "loading">, string> = {
  on: "Phone alerts are on for this device.",
  off: "Phone alerts are off for this device.",
  home_screen:
    "For phone alerts on iPhone, add the app to your Home Screen (Share › Add to Home Screen), open it from there, then tap Turn on reminders here.",
  blocked:
    "Notifications are blocked for this app. Allow them in your phone's settings, then come back here.",
  unsupported: "This browser can't show phone alerts.",
};

const PROBLEM_NOTE: Record<TurnOnProblem, string> = {
  blocked: "Notifications were not allowed.",
  not_set_up: "Phone alerts aren't set up on this server yet.",
  failed: "Couldn't turn on phone alerts. Try again.",
};

/** This device's phone alerts (item 26, spec 12): on or off, and a Turn on reminders button. */
function ThisDevice() {
  const { state, turnOn, turnOff } = usePush();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<TurnOnProblem | null>(null);
  if (state === "loading") return null;

  async function run(action: () => Promise<TurnOnProblem | null | void>) {
    setBusy(true);
    setProblem((await action()) ?? null);
    setBusy(false);
  }

  return (
    <div className="stack" data-testid="this-device" data-state={state}>
      <p className="small">{DEVICE_NOTE[state]}</p>
      {state === "off" && (
        <button type="button" className="btn" disabled={busy} onClick={() => run(turnOn)}>
          Turn on reminders
        </button>
      )}
      {state === "on" && (
        <button type="button" className="btn ghost" disabled={busy} onClick={() => run(turnOff)}>
          Turn off on this device
        </button>
      )}
      {problem && (
        <p className="tiny" role="alert">
          {PROBLEM_NOTE[problem]}
        </p>
      )}
    </div>
  );
}

/** Settings → Reminders (spec 12, items 25 and 26): this device's alerts, six switches, the two times, the days-ahead number. */
function RemindersSettings({
  reminders,
  save,
}: {
  reminders: ReminderSettings;
  save: (change: Partial<ReminderSettings>) => Promise<void>;
}) {
  const times = useMemo(reminderTimes, []);
  return (
    <section className="card" aria-labelledby="reminders-settings-h">
      <h3 id="reminders-settings-h">Reminders</h3>
      <ThisDevice />
      {SWITCHES.map(({ key, label, hint }) => (
        <label key={key} className="li">
          <span className="grow">
            {label}
            <span className="tiny mute block">{hint}</span>
          </span>
          <input
            type="checkbox"
            aria-label={label}
            checked={reminders[key] as boolean}
            onChange={(e) => save({ [key]: e.target.checked })}
          />
        </label>
      ))}
      <label className="li">
        <span className="grow">Days ahead for bill due soon</span>
        <select
          aria-label="Days ahead"
          value={reminders.dueSoonDays}
          onChange={(e) => save({ dueSoonDays: Number(e.target.value) })}
        >
          {Array.from({ length: DUE_SOON_DAYS_MAX }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <label className="li">
        <span className="grow">Morning summary at</span>
        <select
          aria-label="Morning summary at"
          value={reminders.morningAt}
          onChange={(e) => save({ morningAt: e.target.value })}
        >
          {times.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="li">
        <span className="grow">Spend nudge at</span>
        <select
          aria-label="Spend nudge at"
          value={reminders.nudgeAt}
          onChange={(e) => save({ nudgeAt: e.target.value })}
        >
          {times.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <p className="tiny mute">
        Times are in your home time zone. While phone alerts are off on a device, reminders show at the top of
        Today.
      </p>
    </section>
  );
}

/** Settings → Your data (item 27, spec 14): every record as one JSON file, or spends as a CSV. */
function YourData() {
  const [busy, setBusy] = useState<Download | null>(null);
  const [failed, setFailed] = useState(false);

  async function get(what: Download) {
    setFailed(false);
    setBusy(what);
    const ok = await download(what);
    setBusy(null);
    setFailed(!ok);
  }

  return (
    <section className="card" aria-labelledby="your-data-h">
      <h3 id="your-data-h">Your data</h3>
      <button type="button" className="li tap" disabled={busy !== null} onClick={() => get("data")}>
        <span className="grow">
          Download my data
          <span className="tiny mute block">Everything you saved, as one JSON file</span>
        </span>
        {busy === "data" && <span className="small">…</span>}
      </button>
      <button type="button" className="li tap" disabled={busy !== null} onClick={() => get("spends")}>
        <span className="grow">
          Download spends
          <span className="tiny mute block">Every spend, as a CSV for a spreadsheet</span>
        </span>
        {busy === "spends" && <span className="small">…</span>}
      </button>
      {failed && (
        <p className="tiny bad" role="alert">
          Not downloaded. Check the connection and try again.
        </p>
      )}
    </section>
  );
}

/** Settings (spec 10): salary and spending currency, counting rate, usual pay day, home time zone; reminders; your data; sign-in. */
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

  async function save(change: {
    usualPayDay?: number;
    homeTimeZone?: string;
    askedTimeZone?: string;
    reminders?: Partial<ReminderSettings>;
  }) {
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
      <RemindersSettings reminders={settings.reminders} save={(reminders) => save({ reminders })} />
      <YourData />
      <SignInSettings onSignedOut={onSignedOut} />
    </>
  );
}
