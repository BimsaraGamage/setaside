import { useState } from "react";
import {
  addDays,
  broughtIn,
  broughtInSalary,
  type CloseInput,
  type ComingUpEntry,
  cardBalanceMinor,
  cardBillFillMinor,
  checkCycleClose,
  checkSalaryDay,
  countedMinor,
  cycleSpeeds,
  formatMoney,
  heldForCardsMinor,
  inHandFromPlaces,
  isComingUp,
  leftoverOf,
  type OverspendChoice,
  parseAmount,
  parseRate,
  paybackDrafts,
  planDrafts,
  type SalaryDayInput,
  salaryCarriedOf,
  salaryDayDrafts,
  salaryDayView,
  salaryLeftoverOf,
  staysInPlaces,
  stillToPayMinor,
  suggestSalaryDay,
  type UnpaidChoice,
  unpaidAtEnd,
} from "../money";
import { api } from "./api";
import { currenciesOf, currencyContext } from "./CurrencyChoice";
import { CommitmentsStep, type PotRow, PotsStep, type Row, typedOk } from "./CycleSteps";
import { dayLabel, entriesOf, potEntry, type Ready, useToday } from "./data";
import { newId } from "./id";
import { lastPlace, placesFor, rememberPlace } from "./last-place";
import { PlaceChoice, usePlaceChoice } from "./PlaceChoice";
import { placesOf } from "./Places";
import { toText } from "./SpendSheet";
import type { Toaster } from "./toast";
import { VerdictChip } from "./Verdict";

const ok = async (res: Promise<Response | { ok: boolean }>) => (await res.catch(() => null))?.ok ?? false;

type Body = Parameters<(typeof api.api)["salary-day"]["$post"]>[0]["json"];

/** Start new cycle; on success a toast with Undo salary day (item 13; also on Plan while allowed). */
export function salaryDayActions({ done }: Toaster) {
  return {
    start: (body: Body) =>
      ok(api.api["salary-day"].$post({ json: body })).then((started) =>
        done(started, {
          text: "New cycle started",
          undo: () => ok(api.api["salary-day"].undo.$post({ json: { cycleId: body.cycleId } })),
        }),
      ),
  };
}

export type SalaryDayActions = ReturnType<typeof salaryDayActions>;

const STEPS = [1, 2, 3, 4, 5, 6, 7] as const;
type Step = (typeof STEPS)[number];
const TITLES: Record<Step, string> = {
  1: "Salary",
  2: "Last cycle's unpaid commitments",
  3: "Last cycle's leftover",
  4: "This cycle's commitments",
  5: "Pots",
  6: "Next salary day",
  7: "Summary",
};

const CHOICES: { choice: UnpaidChoice; label: string }[] = [
  { choice: "paid", label: "Paid it" },
  { choice: "carry", label: "Carry to new cycle" },
  { choice: "drop", label: "Drop" },
];

/** Why "actually have in hand" starts where it does: the places against what the app counts (spec 6). */
function placesStartNote(differenceMinor: number, currency: string): string {
  const by = formatMoney(Math.abs(differenceMinor), currency);
  return differenceMinor < 0
    ? `From your places: they hold ${by} less than the app counts. Clear it to keep the leftover.`
    : `From your places: they hold ${by} more than the app counts. Clear it to keep the leftover.`;
}

const OVERSPEND: { choice: OverspendChoice; label: string }[] = [
  { choice: "take", label: "Take it from the new cycle" },
  { choice: "ignore", label: "Ignore it" },
];

/**
 * Salary day (spec 6): Salary → last cycle's unpaid commitments (Paid it ·
 * Carry · Drop) → its leftover, dropped ones' money included (correct and
 * split, or the overspend choice) → this cycle's commitments (filled from the recurring ones and last cycle's
 * coming-up ones) → pots → expected next salary day and counting rate → summary with the gap
 * warning → Start new cycle. One step per screen.
 * With places (spec 6): the salary names the place it landed in, a Paid it the
 * place it was paid from, and "actually have in hand" starts from the places.
 */
export function SalaryDayPage({ data, actions }: { data: Ready; actions: SalaryDayActions }) {
  const cur = data.settings.spendingCurrency;
  // The salary is in the salary currency (spec 2, 8).
  const salaryCur = data.settings.salaryCurrency;
  const currencyList = currenciesOf(data.settings);
  const today = useToday(data.settings.homeTimeZone);
  const [step, setStep] = useState<Step>(1);
  const [salaryText, setSalaryText] = useState("");
  const [receivedOn, setReceivedOn] = useState(today);
  // The place the salary landed in (spec 6), in the salary currency.
  const salaryPlace = usePlaceChoice(data.places, salaryCur, "in");
  // Step 2: the place each Paid it was paid from, once picked; else the one paid from last.
  const [paidPlaces, setPaidPlaces] = useState<Record<string, string | null>>({});
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pots, setPots] = useState<PotRow[]>(() =>
    data.pots
      .filter((p) => !p.archived)
      .map((p) => ({
        id: p.id,
        allocationId: newId(),
        name: p.name,
        currency: p.currency,
        text: toText(p.usualAmountMinor, p.currency),
        isNew: false,
      })),
  );
  const [expected, setExpected] = useState(() => suggestSalaryDay(today, data.settings.usualPayDay));
  // Step 6, two currencies (spec 6, 8): the counting rate, the current one by default.
  const two = salaryCur !== cur;
  const nowRate = data.settings.countingRate;
  const [rateText, setRateText] = useState(nowRate ?? "");
  const [rateId] = useState(newId);
  const typedRate = two ? parseRate(rateText) : null;
  const rateBad = two && typedRate === null && !(rateText === "" && nowRate === null);
  /** The rate the new cycle counts dollars at, and keeps as its reserve rate. */
  const rate = typedRate ?? nowRate;
  const newRate = typedRate !== null && typedRate !== nowRate ? typedRate : null;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Steps 2 and 3.
  const [closeIds] = useState(() => ({
    closeId: newId(),
    leftoverIncomeId: newId(),
    salaryLeftoverIncomeId: newId(),
    salaryCloseId: newId(),
  }));
  const [choices, setChoices] = useState<Record<string, { choice: UnpaidChoice; newId: string }>>({});
  // Null until typed in: the field starts from the places, when they differ from the app (spec 6).
  const [inHandTyped, setInHandText] = useState<string | null>(null);
  const [toSavingsText, setToSavingsText] = useState("");
  const [salaryInHandTyped, setSalaryInHandText] = useState<string | null>(null);
  const [salaryToSavingsText, setSalaryToSavingsText] = useState("");
  const [overspend, setOverspend] = useState<OverspendChoice | null>(null);

  const money = (m: number) => formatMoney(m, cur);
  const amount = (t: string, c: string) => parseAmount(t, c) ?? -1;
  const input: SalaryDayInput = {
    salaryMinor: parseAmount(salaryText, salaryCur) ?? 0,
    receivedOn,
    expectedSalaryOn: expected,
    commitments: (rows ?? []).map((r) => ({
      name: r.name,
      kind: r.kind,
      currency: r.currency,
      plannedMinor: amount(r.text, r.currency),
      dueOn: r.dueOn,
    })),
    countingRate: newRate,
    pots: pots.map((p) => ({
      name: p.name,
      currency: p.currency,
      usualAmountMinor: amount(p.text, p.currency),
      amountMinor: amount(p.text, p.currency),
    })),
  };
  const problems = checkSalaryDay(input, {
    today,
    cycleStartedOn: data.cycle.startedOn,
    ...currencyContext(data),
  });
  if (rateBad) problems.push("counting_rate");

  // Steps 2 and 3: the cycle that ends is still the current one.
  const unpaid = unpaidAtEnd(data.commitments, data.cycle.expectedSalaryOn);
  /** The places a Paid it of this commitment can come out of: none for a set-aside moved to savings. */
  const paidChoices = (k: { kind?: string; currency: string }) =>
    staysInPlaces(k.kind ?? "bill") ? [] : placesFor(data.places, k.currency);
  const paidPlace = (k: { id: string; kind?: string; currency: string }) => {
    const offered = paidChoices(k);
    if (offered.length === 0) return null;
    const picked = paidPlaces[k.id];
    return picked === null || offered.some((p) => p.id === picked)
      ? (picked as string | null)
      : lastPlace(data.places, k.currency);
  };
  const chosen = unpaid.flatMap((k) => {
    const c = choices[k.id];
    if (!c) return [];
    const paid = c.choice === "paid" && stillToPayMinor(k) > 0;
    return [{ id: k.id, choice: c.choice, newId: c.newId, ...(paid ? { placeId: paidPlace(k) } : {}) }];
  });
  const leftover = leftoverOf(entriesOf(data), chosen);
  // Two currencies: the salary currency's leftover, split into dollar savings and the new cycle (item 16).
  const salaryLeftover = salaryLeftoverOf(entriesOf(data), chosen);
  const dollarsToSplit = salaryLeftover !== null && salaryLeftover > 0;
  const overspent = leftover.leftoverMinor < 0;
  // Step 3 starts "actually have in hand" from the places, where they differ from what the app counts.
  const placeTotals = placesOf(data).totals;
  const placesOwn = placeTotals.find((t) => t.currency === cur);
  const placesSalary = two ? placeTotals.find((t) => t.currency === salaryCur) : undefined;
  // Rupees short covered from the dollars: the two leftovers lean on each other, so nothing is started.
  const mixed = leftover.fromSalaryMinor > 0;
  const inHandStart = mixed ? null : inHandFromPlaces(leftover.leftoverMinor, placesOwn);
  const salaryInHandStart =
    mixed || !dollarsToSplit ? null : inHandFromPlaces(salaryLeftover ?? 0, placesSalary);
  const inHandText = inHandTyped ?? (inHandStart === null ? "" : toText(inHandStart, cur));
  const salaryInHandText =
    salaryInHandTyped ?? (salaryInHandStart === null ? "" : toText(salaryInHandStart, salaryCur));
  const closeInput: CloseInput = {
    unpaid: chosen.map(({ id, choice }) => ({ id, choice })),
    inHandMinor: overspent || inHandText === "" ? null : (parseAmount(inHandText, cur) ?? -1),
    toSavingsMinor: overspent || toSavingsText === "" ? 0 : (parseAmount(toSavingsText, cur) ?? -1),
    overspend: overspent ? overspend : null,
    salaryInHandMinor:
      !dollarsToSplit || salaryInHandText === "" ? null : (parseAmount(salaryInHandText, salaryCur) ?? -1),
    salaryToSavingsMinor:
      !dollarsToSplit || salaryToSavingsText === "" ? 0 : (parseAmount(salaryToSavingsText, salaryCur) ?? -1),
  };
  const closeCtx = { unpaidIds: unpaid.map((k) => k.id), leftover, salaryLeftoverMinor: salaryLeftover };
  for (const p of checkCycleClose(closeInput, closeCtx)) {
    problems.push(`close.${p}`);
  }
  const brought = broughtIn(closeInput, leftover);
  const salaryBrought =
    salaryLeftover === null
      ? null
      : broughtInSalary(closeInput, salaryLeftover, salaryCarriedOf(entriesOf(data), chosen));
  const salaryKept = closeInput.salaryInHandMinor ?? salaryLeftover ?? 0;
  const kept = closeInput.inHandMinor ?? leftover.leftoverMinor;
  const carried = unpaid
    .filter((k) => choices[k.id]?.choice === "carry")
    .map((k) => ({ ...k, plannedMinor: stillToPayMinor(k), payments: [] }));
  const has = (prefix: string) => problems.some((p) => p.startsWith(prefix));

  /** Card bills Paid it in step 2: paid from the money held for the card (item 18). */
  const paidCardBills = unpaid.filter((k) => k.kind === "card_bill" && choices[k.id]?.choice === "paid");
  const heldMinor =
    heldForCardsMinor(data.cards, data.spends, data.commitments, cur) -
    paidCardBills.filter((k) => k.currency === cur).reduce((n, k) => n + stillToPayMinor(k), 0);

  /**
   * A card bill's amount in step 4 (item 18): the card balance after step 2's
   * Paid it, less what its bills going to the new cycle (carried, coming up) still owe.
   */
  const cardFill = (comingUp: ComingUpEntry[]) => (cardId: string) => {
    const card = data.cards.find((k) => k.id === cardId);
    if (!card) return 0;
    const ofCard = (k: { kind?: string; cardId?: string | null }) =>
      k.kind === "card_bill" && k.cardId === cardId;
    const paidNow = paidCardBills.filter(ofCard).reduce((n, k) => n + stillToPayMinor(k), 0);
    const going = [...carried.filter(ofCard), ...comingUp.filter(ofCard)];
    return cardBillFillMinor(cardBalanceMinor(card, data.spends, data.commitments) - paidNow, going);
  };

  /** Step 4's rows, filled once the day received is known. */
  function fill(): Row[] {
    const comingUp: ComingUpEntry[] = data.commitments
      .filter(
        (c) =>
          isComingUp(c, data.cycle.expectedSalaryOn) &&
          (c.kind === "bill" ||
            c.kind === "savings" ||
            c.kind === "savings_payback" ||
            c.kind === "card_bill" ||
            c.kind === "plan_payment" ||
            c.kind === "person_payback"),
      )
      .map((c) => ({ ...c, kind: c.kind as ComingUpEntry["kind"] }));
    const drafts = salaryDayDrafts({
      recurring: data.recurring,
      comingUp,
      startedOn: receivedOn,
      cardFill: cardFill(comingUp),
    });
    // Paybacks (item 14): what step 2 paid or carried, and coming-up ones carried, count first.
    const paid: Record<string, number> = {};
    const planned: Record<string, number> = {};
    const add = (to: Record<string, number>, id: string | null | undefined, m: number) => {
      if (id) to[id] = (to[id] ?? 0) + m;
    };
    // Plan payments (item 19) the same way, by plan.
    const planPaid: Record<string, number> = {};
    const planPlanned: Record<string, number> = {};
    for (const k of unpaid) {
      const choice = choices[k.id]?.choice;
      if (choice === "paid") add(paid, k.prepaymentId, stillToPayMinor(k));
      if (choice === "carry") add(planned, k.prepaymentId, stillToPayMinor(k));
      if (choice === "paid") add(planPaid, k.planId, stillToPayMinor(k));
      if (choice === "carry") add(planPlanned, k.planId, stillToPayMinor(k));
    }
    for (const d of drafts) add(planned, d.prepaymentId, d.plannedMinor);
    for (const d of drafts) add(planPlanned, d.planId, d.plannedMinor);
    const plans = data.plans.map((p) => ({ ...p, paidMinor: p.paidMinor + (planPaid[p.id] ?? 0) }));
    const prepayments = data.prepayments.map((p) => ({
      ...p,
      paidBackMinor: p.paidBackMinor + (paid[p.id] ?? 0),
    }));
    return [
      ...drafts,
      ...paybackDrafts(prepayments, receivedOn, planned),
      ...planDrafts(plans, receivedOn, expected, planPlanned),
    ].map((d) => ({
      ...d,
      id: newId(),
      text: toText(d.plannedMinor, d.currency),
    }));
  }

  const go = (to: Step) => {
    if (to === 4 && rows === null) setRows(fill());
    setStep(to);
    window.scrollTo(0, 0);
  };
  const at = STEPS.indexOf(step);
  const next = () => go(STEPS[at + 1] as Step);
  const back = () => go(STEPS[at - 1] as Step);
  const typed = (t: string) => typedOk(t, cur);
  const typedSalary = (t: string) => typedOk(t, salaryCur);
  /** Amounts in both currencies, counted in the spending currency (the salary currency's at the counting rate). */
  const inSpending = (list: { currency?: string; minor: number }[]) => {
    let own = 0;
    let other = 0;
    for (const x of list) {
      if ((x.currency ?? cur) === cur) own += x.minor;
      else other += x.minor;
    }
    return own + countedMinor({ ...entriesOf(data), countingRate: rate }, other);
  };

  // The cycle that ends: its speed is the new cycle's in its first days (spec 7).
  const ended = cycleSpeeds(
    { spendingCurrency: cur, spends: data.spends, pots: data.pots.map(potEntry) },
    data.cycle.startedOn,
    receivedOn,
  ).speed;
  const view = salaryDayView({
    input,
    spendingCurrency: cur,
    salaryCurrency: salaryCur,
    countingRate: rate,
    broughtInSalaryMinor: salaryBrought ? salaryBrought.amountMinor - salaryBrought.toSavingsMinor : 0,
    today,
    lastSpeed: ended.days > 0 ? ended : null,
    broughtIn: brought,
    carried,
  });

  async function start() {
    setBusy(true);
    setFailed(false);
    salaryPlace.remember();
    for (const u of chosen) {
      const k = unpaid.find((x) => x.id === u.id);
      if (k && "placeId" in u && paidChoices(k).length > 0) {
        rememberPlace(data.places, k.currency, u.placeId ?? null);
      }
    }
    const done = await actions.start({
      cycleId: newId(),
      incomeId: newId(),
      salaryMinor: input.salaryMinor,
      receivedOn,
      placeId: salaryPlace.placeId,
      expectedSalaryOn: expected,
      ...(newRate ? { countingRate: { id: rateId, rate: newRate } } : {}),
      commitments: (rows ?? []).map((r) => ({
        id: r.id,
        kind: r.kind,
        prepaymentId: r.prepaymentId ?? null,
        cardId: r.cardId ?? null,
        planId: r.planId ?? null,
        name: r.name,
        currency: r.currency,
        plannedMinor: amount(r.text, r.currency),
        dueOn: r.dueOn,
        recurringId: r.everyCycle ? (r.recurringId ?? newId()) : r.recurringId,
        everyCycle: r.everyCycle,
        carriedFromId: r.carriedFromId,
      })),
      pots: pots.map((p) => ({
        id: p.id,
        allocationId: p.allocationId,
        amountMinor: amount(p.text, p.currency),
        ...(p.isNew
          ? { name: p.name, currency: p.currency, usualAmountMinor: amount(p.text, p.currency) }
          : {}),
      })),
      close: {
        ...closeIds,
        ...(salaryLeftover === null ? { salaryLeftoverIncomeId: undefined, salaryCloseId: undefined } : {}),
        ...closeInput,
        salaryInHandMinor: closeInput.salaryInHandMinor ?? null,
        salaryToSavingsMinor: closeInput.salaryToSavingsMinor ?? 0,
        unpaid: chosen,
      },
    });
    setBusy(false);
    if (done) window.location.hash = "Today";
    else setFailed(true);
  }

  const setAside = inSpending(
    [...input.commitments, ...carried]
      // A card bill's money is held from card spends, not set aside (item 18).
      .filter((c) => c.dueOn <= expected && c.kind !== "card_bill")
      .map((c) => ({ currency: c.currency, minor: Math.max(0, c.plannedMinor) })),
  );
  const fromLast = brought.amountMinor - brought.toSavingsMinor;
  const potsTotal = inSpending(
    input.pots.map((p) => ({ currency: p.currency, minor: Math.max(0, p.amountMinor) })),
  );

  return (
    <>
      <div className="row">
        <a className="btn ghost link" href="#Plan">
          ← Back
        </a>
      </div>
      <p className="tiny mute">
        Salary day · step {at + 1} of {STEPS.length}
      </p>
      <h1>{step === 6 && two ? "Next salary day and rate" : TITLES[step]}</h1>

      {step === 1 && (
        <section className="card stack">
          <label className="field">
            Salary ({data.settings.salaryCurrency})
            <input
              value={salaryText}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              onChange={(e) => typedSalary(e.target.value) && setSalaryText(e.target.value)}
            />
          </label>
          <label className="field">
            Date received
            <input
              type="date"
              value={receivedOn}
              min={data.cycle.startedOn}
              max={today}
              onChange={(e) => setReceivedOn(e.target.value)}
            />
            <span className="tiny mute">
              {receivedOn === today ? "Today" : dayLabel(receivedOn)}. The new cycle starts on this day; the
              one from {dayLabel(data.cycle.startedOn, false)} ends and is locked.
            </span>
          </label>
          {has("received_on") && (
            <p className="tiny bad">Pick a day from {dayLabel(data.cycle.startedOn)} up to today.</p>
          )}
          <PlaceChoice label="Received in" choice={salaryPlace} />
        </section>
      )}

      {step === 3 && !overspent && (
        <section className="card stack" aria-label="Leftover">
          <div className="li">
            <span className="grow">Free money left</span>
            <b>{money(leftover.freeMinor)}</b>
          </div>
          <div className="li">
            <span className="grow">Left in pots</span>
            <b>{money(leftover.potsMinor)}</b>
          </div>
          {leftover.droppedMinor > 0 && (
            <div className="li">
              <span className="grow">Bills dropped</span>
              <b>{money(leftover.droppedMinor)}</b>
            </div>
          )}
          <div className="li">
            <span className="grow">Leftover</span>
            <b data-testid="leftover">{money(leftover.leftoverMinor)}</b>
          </div>
          {leftover.fromSalaryMinor > 0 && (
            <p className="tiny mute" data-testid="covered-from-salary">
              Includes {money(leftover.fromSalaryMinor)} from your {salaryCur} at the reserve rate, for {cur}{" "}
              bills paid before changing dollars.
            </p>
          )}
          <label className="field">
            Actually have in hand ({cur})
            <input
              value={inHandText}
              inputMode="decimal"
              autoComplete="off"
              placeholder={toText(leftover.leftoverMinor, cur)}
              onChange={(e) => typed(e.target.value) && setInHandText(e.target.value)}
            />
            <span className="tiny mute">Change it if some spends were never entered.</span>
            {inHandTyped === null && inHandStart !== null && placesOwn?.differenceMinor && (
              <span className="tiny mute block" data-testid="in-hand-from-places">
                {placesStartNote(placesOwn.differenceMinor, cur)}
              </span>
            )}
            {heldMinor > 0 && (
              <span className="tiny mute block" data-testid="held-for-cards">
                Leave out {money(heldMinor)} held for card bills: it is not leftover.
              </span>
            )}
          </label>
          {has("close.in_hand") && <p className="tiny bad">Type a plain amount.</p>}
          <label className="field">
            To savings ({cur})
            <input
              value={toSavingsText}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              onChange={(e) => typed(e.target.value) && setToSavingsText(e.target.value)}
            />
          </label>
          {has("close.to_savings") && <p className="tiny bad">At most {money(Math.max(0, kept))}.</p>}
          <div className="li">
            <span className="grow">To the new cycle</span>
            <b data-testid="leftover-to-cycle">
              {money(Math.max(0, kept - Math.max(0, closeInput.toSavingsMinor)))}
            </b>
          </div>
        </section>
      )}

      {step === 3 && salaryLeftover !== null && (
        <section className="card stack" aria-label={`${salaryCur} leftover`}>
          <div className="li">
            <span className="grow">{salaryCur} not changed yet</span>
            <b data-testid="salary-leftover">{formatMoney(salaryLeftover, salaryCur)}</b>
          </div>
          {dollarsToSplit ? (
            <>
              <label className="field">
                Actually have in hand ({salaryCur})
                <input
                  value={salaryInHandText}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={toText(salaryLeftover, salaryCur)}
                  onChange={(e) => typedSalary(e.target.value) && setSalaryInHandText(e.target.value)}
                />
                {salaryInHandTyped === null &&
                  salaryInHandStart !== null &&
                  placesSalary?.differenceMinor && (
                    <span className="tiny mute block" data-testid="salary-in-hand-from-places">
                      {placesStartNote(placesSalary.differenceMinor, salaryCur)}
                    </span>
                  )}
              </label>
              {has("close.salary_in_hand") && <p className="tiny bad">Type a plain amount.</p>}
              <label className="field">
                To {salaryCur} savings
                <input
                  value={salaryToSavingsText}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  onChange={(e) => typedSalary(e.target.value) && setSalaryToSavingsText(e.target.value)}
                />
              </label>
              {has("close.salary_to_savings") && (
                <p className="tiny bad">At most {formatMoney(Math.max(0, salaryKept), salaryCur)}.</p>
              )}
              <div className="li">
                <span className="grow">Carried over, not changed</span>
                <b data-testid="salary-leftover-to-cycle">
                  {formatMoney(
                    Math.max(0, salaryKept - Math.max(0, closeInput.salaryToSavingsMinor ?? 0)),
                    salaryCur,
                  )}
                </b>
              </div>
            </>
          ) : (
            salaryLeftover < 0 && (
              <p className="tiny mute">
                {salaryCur} bills went past your {salaryCur}: carried to the new cycle.
              </p>
            )
          )}
        </section>
      )}

      {step === 3 && overspent && (
        <section className="card stack" aria-label="Overspend">
          <p>
            You spent <b data-testid="overspend">{money(-leftover.leftoverMinor)}</b> more than your free
            money last cycle.
          </p>
          <div className="row" role="radiogroup" aria-label="Overspend">
            {OVERSPEND.map((o) => (
              <button
                key={o.choice}
                type="button"
                role="radio"
                aria-checked={overspend === o.choice}
                className={overspend === o.choice ? "btn pri grow" : "btn grow"}
                onClick={() => setOverspend(o.choice)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <>
          <p className="mute">
            {unpaid.length === 0
              ? "Nothing left unpaid."
              : "For each one: paid it, carry it to the new cycle (shown as late), or drop it."}
          </p>
          {unpaid.map((k) => {
            const rest = stillToPayMinor(k);
            const pick = choices[k.id]?.choice;
            return (
              <section key={k.id} className="card stack" aria-label={k.name}>
                <div className="li">
                  <span className="grow">
                    {k.name}
                    <span className="tiny mute block">Due {dayLabel(k.dueOn)}</span>
                  </span>
                  <b>{money(rest)}</b>
                </div>
                <div className="row" role="radiogroup" aria-label={`What happened to ${k.name}`}>
                  {CHOICES.map((c) => (
                    <button
                      key={c.choice}
                      type="button"
                      role="radio"
                      aria-checked={pick === c.choice}
                      className={pick === c.choice ? "btn pri grow" : "btn grow"}
                      onClick={() =>
                        setChoices((cs) => ({
                          ...cs,
                          [k.id]: { choice: c.choice, newId: cs[k.id]?.newId ?? newId() },
                        }))
                      }
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                {pick === "paid" && rest > 0 && paidChoices(k).length > 0 && (
                  <label className="field">
                    Paid from
                    <select
                      value={paidPlace(k) ?? ""}
                      onChange={(e) => setPaidPlaces((ps) => ({ ...ps, [k.id]: e.target.value || null }))}
                    >
                      {paidChoices(k).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                      <option value="">No place</option>
                    </select>
                  </label>
                )}
                {pick === "drop" && rest > 0 && (
                  <p className="tiny mute">{money(rest)} joins the leftover (next step).</p>
                )}
              </section>
            );
          })}
        </>
      )}

      {step === 4 && rows && (
        <>
          <p className="mute">Filled from your Every cycle list. Change any, remove any, or add more.</p>
          {rows.length === 0 && <p className="tiny mute">Nothing to fill in yet.</p>}
          <CommitmentsStep
            rows={rows}
            setRows={(f) => setRows((rs) => f(rs ?? []))}
            currencies={currencyList}
            startedOn={receivedOn}
            expected={expected}
            has={has}
          />
        </>
      )}

      {step === 5 && <PotsStep pots={pots} setPots={setPots} currencies={currencyList} has={has} />}

      {step === 6 && (
        <section className="card stack">
          <label className="field">
            Expected next salary day
            <input
              type="date"
              value={expected}
              min={addDays(today, 1)}
              onChange={(e) => setExpected(e.target.value)}
            />
            <span className="tiny mute">{dayLabel(expected)} · suggested from your usual pay day.</span>
          </label>
          {has("expected_salary_on") && <p className="tiny bad">Pick a day after today.</p>}
          {two && (
            <label className="field">
              Counting rate ({cur} for 1 {salaryCur})
              <input
                inputMode="decimal"
                autoComplete="off"
                value={rateText}
                onChange={(e) => setRateText(e.target.value)}
              />
              <span className="tiny mute">
                {salaryCur} not changed yet count toward free money at this rate, and {cur} bills are reserved
                from them at it this cycle. Your last one by default.
              </span>
              {rateBad && <span className="tiny bad">Type a plain rate above zero, like 302.50.</span>}
            </label>
          )}
        </section>
      )}

      {step === 7 && (
        <>
          <section className="card" aria-label="Summary">
            <div className="li">
              <span className="grow">Salary</span>
              <b>{formatMoney(input.salaryMinor, salaryCur)}</b>
            </div>
            {fromLast !== 0 && (
              <div className="li">
                <span className="grow">From last cycle</span>
                <b data-testid="salary-day-from-last">{money(fromLast)}</b>
              </div>
            )}
            <div className="li">
              <span className="grow">Commitments set aside</span>
              <b>{money(setAside)}</b>
            </div>
            <div className="li">
              <span className="grow">Pots</span>
              <b>{money(potsTotal)}</b>
            </div>
            <div className="li">
              <span className="grow">Free money</span>
              <b data-testid="salary-day-free">{money(view.today.freeMinor)}</b>
            </div>
            <div className="li">
              <span className="grow">Days to salary</span>
              <b>{view.today.daysLeft}</b>
            </div>
            <div className="li">
              <span className="grow">Daily allowance</span>
              <b data-testid="salary-day-allowance">{money(view.today.allowanceMinor)}</b>
            </div>
            <div className="li">
              <span className="grow">Verdict</span>
              <VerdictChip verdict={view.today.verdict} currency={cur} />
            </div>
          </section>
          {view.gapMinor > 0 && (
            <p className="error" role="alert" data-testid="salary-day-gap">
              Set-asides are {money(view.gapMinor)} more than the salary. Lower a commitment or a pot, or take
              money out of savings.
            </p>
          )}
          {problems.length > 0 && (
            <p className="tiny bad">Something earlier needs fixing; go back and check.</p>
          )}
          {failed && <p className="error">Not saved. Check the connection and try again.</p>}
        </>
      )}

      <div className="row">
        {at > 0 && (
          <button type="button" className="btn" onClick={back} disabled={busy}>
            Back
          </button>
        )}
        {step === 7 ? (
          <button
            type="button"
            className="btn pri grow"
            onClick={start}
            disabled={busy || problems.length > 0}
          >
            Start new cycle
          </button>
        ) : (
          <button
            type="button"
            className="btn pri grow"
            onClick={next}
            disabled={
              (step === 1 && (input.salaryMinor <= 0 || has("salary") || has("received_on"))) ||
              (step === 2 && has("close.unpaid")) ||
              (step === 3 &&
                (has("close.in_hand") ||
                  has("close.to_savings") ||
                  has("close.overspend") ||
                  has("close.salary_"))) ||
              (step === 4 && has("commitment.")) ||
              (step === 5 && has("pot.")) ||
              (step === 6 && (has("expected_salary_on") || has("counting_rate")))
            }
          >
            Next
          </button>
        )}
      </div>
    </>
  );
}
