import { useState } from "react";
import { checkConversion, conversionSplit, formatMoney, parseAmount, parseRate, todayView } from "../money";
import { api } from "./api";
import { currencyContext } from "./CurrencyChoice";
import { type Conversion, dayLabel, entriesOf, type Ready, useToday } from "./data";
import { newId } from "./id";
import type { Toaster } from "./toast";

const ok = async (res: Promise<Response | { ok: boolean }>) => (await res.catch(() => null))?.ok ?? false;

const addConversion = (json: { id: string; givenMinor: number; receivedMinor: number; doneOn: string }) =>
  ok(api.api.conversions.$post({ json }));
const removeConversion = (id: string) => ok(api.api.conversions[":id"].$delete({ param: { id } }));

/** Change dollars: each save shows a toast with Undo (spec 2: the only undo is on screen). */
export function conversionActions({ done }: Toaster) {
  return {
    add: (c: { givenMinor: number; receivedMinor: number; doneOn: string }, text: string) => {
      const id = newId();
      return addConversion({ id, ...c }).then((saved) =>
        done(saved, { text, undo: () => removeConversion(id) }),
      );
    },
  };
}

export type ConversionActions = ReturnType<typeof conversionActions>;

/** "1 USD = 302.5 LKR". */
const rateLabel = (rate: string, from: string, to: string) => `1 ${from} = ${rate} ${to}`;

/** A rate gain (to savings) or loss (from free money) as a short line (spec 8). */
function gainLabel(gainMinor: number, currency: string): string | null {
  if (gainMinor > 0) return `Rate gain ${formatMoney(gainMinor, currency)} → savings`;
  if (gainMinor < 0) return `Rate loss ${formatMoney(-gainMinor, currency)} ← free money`;
  return null;
}

/**
 * Change dollars (spec 8, 10; item 16): dollars given, rupees received, date;
 * the live rate; how much covers rupee bills and how much goes to free money;
 * the rate gain or loss. The counting rate with Set, and this cycle's conversions.
 */
export function ChangeDollarsPage({
  data,
  actions,
  onRate,
}: {
  data: Ready;
  actions: ConversionActions;
  onRate: () => void;
}) {
  const cur = data.settings.spendingCurrency;
  const salaryCur = data.settings.salaryCurrency;
  const today = useToday(data.settings.homeTimeZone);
  const [givenText, setGivenText] = useState("");
  const [receivedText, setReceivedText] = useState("");
  const [doneOn, setDoneOn] = useState(today);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const givenMinor = parseAmount(givenText, salaryCur) ?? 0;
  const receivedMinor = parseAmount(receivedText, cur) ?? 0;
  const input = { givenMinor, receivedMinor, doneOn };
  const problems = checkConversion(input, {
    ...currencyContext(data),
    cycleStartedOn: data.cycle.startedOn,
    today,
  });
  const entries = entriesOf(data);
  const split = conversionSplit(entries, givenMinor, receivedMinor);
  const ready = problems.length === 0 && split.rate !== null;
  const after = todayView(
    ready
      ? {
          ...entries,
          countingRate: split.rate,
          conversions: [...entries.conversions, { givenMinor, receivedMinor, gainMinor: split.gainMinor }],
        }
      : entries,
    today,
  );
  const gain = gainLabel(split.gainMinor, cur);

  async function save() {
    setBusy(true);
    setFailed(false);
    const text = `Changed ${formatMoney(givenMinor, salaryCur)} into ${formatMoney(receivedMinor, cur)}`;
    const saved = await actions.add(input, text);
    setBusy(false);
    if (saved) {
      setGivenText("");
      setReceivedText("");
    } else setFailed(true);
  }

  const typed = (t: string, c: string) => t === "" || parseAmount(t.replace(/\.$/, ""), c) !== null;

  return (
    <>
      <div className="row">
        <a className="btn ghost link" href="#Money">
          ← Back
        </a>
      </div>
      <h1>Change {salaryCur}</h1>
      <section className="card stack">
        <label className="field">
          {salaryCur} given
          <input
            value={givenText}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            onChange={(e) => typed(e.target.value, salaryCur) && setGivenText(e.target.value)}
          />
        </label>
        <label className="field">
          {cur} received
          <input
            value={receivedText}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            onChange={(e) => typed(e.target.value, cur) && setReceivedText(e.target.value)}
          />
        </label>
        <label className="field">
          Date
          <input
            type="date"
            value={doneOn}
            min={data.cycle.startedOn}
            max={today}
            onChange={(e) => setDoneOn(e.target.value)}
          />
        </label>
        {problems.includes("done_on") && (
          <p className="tiny bad">Pick a day from {dayLabel(data.cycle.startedOn)} up to today.</p>
        )}
        {ready && split.rate && (
          <div className="stack" data-testid="conversion-split">
            <p className="small">
              Rate: <b data-testid="conversion-rate">{rateLabel(split.rate, salaryCur, cur)}</b>
            </p>
            {split.coveredMinor > 0 && (
              <p className="small">
                Covers {cur} bills:{" "}
                <b data-testid="conversion-covered">{formatMoney(split.coveredMinor, cur)}</b>
              </p>
            )}
            <p className="small">
              To free money: <b data-testid="conversion-free">{formatMoney(split.toFreeMinor, cur)}</b>
            </p>
            {gain && (
              <p className="small" data-testid="conversion-gain">
                {gain}
              </p>
            )}
            <p className="small" data-testid="conversion-after">
              You can spend today after this: <b>{formatMoney(after.allowanceMinor, cur)}</b>
            </p>
          </div>
        )}
        {problems.includes("rate") && <p className="tiny bad">These amounts don't make a rate.</p>}
      </section>
      {failed && <p className="error">Not saved. Check the connection and try again.</p>}
      <div className="row">
        <button type="button" className="btn pri grow" disabled={busy || !ready} onClick={save}>
          Save
        </button>
      </div>
      {/* A new rate (a conversion, or Set) shows in the field: it starts again from it. */}
      <CountingRate key={data.settings.countingRate ?? ""} data={data} onRate={onRate} />
      <section className="card" aria-labelledby="conversions-h">
        <h3 id="conversions-h">This cycle's conversions</h3>
        {data.conversions.length === 0 ? (
          <p className="small mute">None yet.</p>
        ) : (
          data.conversions.map((c) => <ConversionRow key={c.id} c={c} from={salaryCur} to={cur} />)
        )}
      </section>
    </>
  );
}

function ConversionRow({ c, from, to }: { c: Conversion; from: string; to: string }) {
  const gain = gainLabel(c.gainMinor, to);
  return (
    <div className="li">
      <span className="grow">
        {formatMoney(c.givenMinor, from)} → {formatMoney(c.receivedMinor, to)}
        <span className="tiny mute block">
          {[dayLabel(c.doneOn), rateLabel(c.rate, from, to), gain].filter(Boolean).join(" · ")}
        </span>
      </span>
    </div>
  );
}

/** The counting rate with Set (spec 8): the last conversion's rate, or one typed here or in Settings. */
function CountingRate({ data, onRate }: { data: Ready; onRate: () => void }) {
  const cur = data.settings.spendingCurrency;
  const salaryCur = data.settings.salaryCurrency;
  const now = data.settings.countingRate;
  const [text, setText] = useState(now ?? "");
  const rate = parseRate(text);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function set() {
    if (!rate) return;
    setBusy(true);
    setFailed(false);
    const saved = await ok(api.api["counting-rates"].$post({ json: { id: newId(), rate } }));
    setBusy(false);
    if (!saved) setFailed(true);
    onRate();
  }

  return (
    <section className="card stack" aria-labelledby="counting-rate-h">
      <h3 id="counting-rate-h">Counting rate</h3>
      <label className="field">
        {cur} for 1 {salaryCur}
        <input
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <span className="tiny mute">
          {salaryCur} not changed yet count toward free money at this rate. Each conversion sets it to the
          rate you got.
        </span>
        {text !== "" && rate === null && (
          <span className="tiny bad">Type a plain rate above zero, like 302.50.</span>
        )}
      </label>
      {failed && <p className="tiny bad">Not saved. Check the connection and try again.</p>}
      <button type="button" className="btn" disabled={busy || rate === null || rate === now} onClick={set}>
        Set
      </button>
    </section>
  );
}
