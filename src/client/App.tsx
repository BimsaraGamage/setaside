import { useEffect, useReducer, useState } from "react";
import { todayIn } from "../money";
import { authClient } from "./auth";
import { CardPage, cardActions } from "./Cards";
import { ChangeDollarsPage, conversionActions } from "./ChangeDollars";
import { commitmentActions } from "./commitment-actions";
import { type Spend, useCurrent } from "./data";
import { EveryCyclePage, everyCycleActions } from "./EveryCycle";
import { FirstUse } from "./FirstUse";
import { agoLabel, clearCopy, readCopy } from "./offline-copy";
import { PastCyclePage, PastList } from "./Past";
import { PayPage } from "./Pay";
import { LendPage, PeoplePage, PersonPage, peopleActions } from "./People";
import { CommitmentPage, Plan } from "./Plan";
import { PlanPage, planActions } from "./Plans";
import { PotPage } from "./Pots";
import { potActions } from "./pot-actions";
import { reminderActions } from "./Reminders";
import { SalaryDayPage, salaryDayActions } from "./SalaryDay";
import { AddIncomePage, SavingsMovePage, SavingsPage, savingsActions } from "./Savings";
import { Settings } from "./Settings";
import { SignIn } from "./SignIn";
import { SpendSheet } from "./SpendSheet";
import { Money, SpendsPage } from "./Spends";
import { spendActions } from "./spend-actions";
import { cycleActions } from "./ThisCycle";
import { Today } from "./Today";
import { useToast } from "./toast";
import { dayChoiceActions } from "./Underspend";
import { UnsentCards } from "./Unsent";
import { useUnsent, waiting, withUnsent } from "./unsent";
import { zoneActions } from "./ZoneSwitch";

const tabs = ["Today", "Plan", "Money", "Past", "Settings"] as const;
/** Pages opened from a tab: they cover the tab bar and have a ← back (spec 10). */
const pages = {
  Spends: "Money",
  Savings: "Money",
  SavingsMove: "Money",
  AddIncome: "Money",
  ChangeDollars: "Money",
  Card: "Money",
  Instalments: "Money",
  People: "Money",
  Lend: "Money",
  Person: "Money",
  Commitment: "Plan",
  Pay: "Plan",
  Payment: "Plan",
  Pot: "Plan",
  EveryCycle: "Plan",
  SalaryDay: "Plan",
  PastCycle: "Past",
} as const;
type Tab = (typeof tabs)[number] | keyof typeof pages;

/** "#Commitment/<id>" → the Commitment page for that id; "#Pot/new/<name>" → a new pot named so; unknown → Today. */
function routeFromHash(): { tab: Tab; id?: string; extra?: string } {
  const [h = "", id, extra] = window.location.hash.slice(1).split("/").map(decodeURIComponent);
  if ((tabs as readonly string[]).includes(h) || h in pages) return { tab: h as Tab, id, extra };
  return { tab: "Today" };
}

export function App() {
  const session = authClient.useSession();

  const signedOut = () => {
    clearCopy();
    session.refetch();
  };

  const noSession = !session.isPending && !session.data && !session.error;
  useEffect(() => {
    // The server says nobody is signed in (session ended or revoked): the saved copy goes too.
    if (noSession) clearCopy();
  }, [noSession]);

  if (session.isPending) return <main className="loading mute">Loading…</main>;
  if (!session.data) {
    // The sign-in couldn't be checked (no connection): the phone's saved copy, if any (item 23, spec 11).
    const copy = session.error ? readCopy() : null;
    if (copy) return <SignedIn userId={copy.userId} onSignedOut={signedOut} />;
    return <SignIn onSignedIn={() => session.refetch()} />;
  }
  return <SignedIn userId={session.data.user.id} onSignedOut={signedOut} />;
}

/**
 * "Offline · 2 not sent · last updated 5 min ago" while the saved copy is shown (spec 11); online with items
 * still waiting, "2 not sent · sending" (or waiting for sign-in).
 */
function OfflineBar({ since, unsent, signIn }: { since: number | null; unsent: number; signIn: boolean }) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <p className="offline-bar small" data-testid="offline">
      {[
        since !== null && "Offline",
        unsent > 0 && `${unsent} not sent`,
        since === null && (signIn ? "sign in to send" : "sending"),
        since !== null && `last updated ${agoLabel(since)}`,
      ]
        .filter(Boolean)
        .join(" · ")}
    </p>
  );
}

function SignedIn({ userId, onSignedOut }: { userId: string; onSignedOut: () => void }) {
  const { data: served, error, offlineSince, reload } = useCurrent(userId);
  const unsent = useUnsent(userId, reload);
  const data = served && withUnsent(served, unsent.state.items);
  const [route, setRoute] = useState(routeFromHash);
  const toaster = useToast(reload);
  const spends = spendActions(toaster, unsent.box);
  const commitments = commitmentActions(toaster, unsent.box);
  const pots = potActions(toaster);
  const dayChoices = dayChoiceActions(toaster);
  const savings = savingsActions(toaster);
  const conversions = conversionActions(toaster);
  const cards = cardActions(toaster);
  const plans = planActions(toaster);
  const people = peopleActions(toaster);
  const salaryDay = salaryDayActions(toaster);
  const everyCycle = everyCycleActions(toaster);
  const thisCycle = cycleActions(toaster);
  const zone = zoneActions(toaster);
  const reminders = reminderActions(toaster);
  /** The spend sheet: open for a new spend, or for one being changed. */
  const [sheet, setSheet] = useState<{ today: string; editing?: Spend } | null>(null);

  useEffect(() => {
    const on = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  if (!data) {
    return (
      <main className="loading mute">
        {error ? (
          <>
            Couldn't load.{" "}
            <button type="button" className="btn ghost" onClick={reload}>
              Try again
            </button>
          </>
        ) : (
          "Loading…"
        )}
      </main>
    );
  }
  if (!data.settings || !data.cycle) return <FirstUse onDone={reload} onSignedOut={onSignedOut} />;

  const ready = { ...data, settings: data.settings, cycle: data.cycle };
  const edit = (editing: Spend, today: string) => setSheet({ today, editing });
  const { tab, id, extra } = route;
  const isPage = tab in pages;
  const editing = tab === "Commitment" && id ? ready.commitments.find((c) => c.id === id) : undefined;
  // "#Pay/<commitment id>" pays it; "#Payment/<payment id>" changes that payment.
  const payFor =
    tab === "Pay"
      ? ready.commitments.find((c) => c.id === id)
      : tab === "Payment"
        ? ready.commitments.find((c) => c.payments.some((p) => p.id === id))
        : undefined;
  const payment = tab === "Payment" ? payFor?.payments.find((p) => p.id === id) : undefined;
  // "#Pot" and "#Pot/new/<starter name>" make a pot; "#Pot/<id>" opens one.
  const newPot = tab === "Pot" && (!id || id === "new");
  const pot = tab === "Pot" && !newPot ? ready.pots.find((p) => p.id === id) : undefined;
  // "#Card" adds a card; "#Card/<id>" opens one (item 18).
  const card = tab === "Card" && id ? ready.cards.find((k) => k.id === id) : undefined;
  // "#Instalments" makes a plan; "#Instalments/<id>" opens one (item 19).
  const plan = tab === "Instalments" && id ? ready.plans.find((p) => p.id === id) : undefined;
  // "#Person/<id>" opens one person entry (item 20).
  const person = tab === "Person" && id ? ready.people.find((p) => p.id === id) : undefined;
  const toast = toaster.toast;
  return (
    <>
      <main className={isPage ? "with-tabs page" : "with-tabs"}>
        {(offlineSince !== null || waiting(unsent.state).length > 0) && (
          <OfflineBar
            since={offlineSince}
            unsent={waiting(unsent.state).length}
            signIn={unsent.state.signIn}
          />
        )}
        {tab === "Today" && (
          <Today
            data={ready}
            onAdd={(today) => setSheet({ today })}
            onEdit={edit}
            dayChoices={dayChoices}
            cycle={thisCycle}
            zone={zone}
            reminders={reminders}
            offlineSince={offlineSince}
          >
            <UnsentCards
              data={ready}
              state={unsent.state}
              today={todayIn(ready.settings.homeTimeZone, Date.now())}
              box={unsent.box}
              actions={commitments}
              onFixSpend={(s) => edit(s, todayIn(ready.settings.homeTimeZone, Date.now()))}
            />
          </Today>
        )}
        {tab === "Plan" && <Plan data={ready} actions={thisCycle} />}
        {tab === "Commitment" &&
          (id && !editing ? (
            <>
              <a className="btn ghost link" href="#Plan">
                ← Back
              </a>
              <p className="mute">This commitment is no longer here.</p>
            </>
          ) : (
            <CommitmentPage key={id ?? "new"} data={ready} editing={editing} actions={commitments} />
          ))}
        {(tab === "Pay" || tab === "Payment") &&
          (payFor ? (
            <PayPage
              key={id}
              data={ready}
              commitment={payFor}
              editing={payment}
              actions={commitments}
              offline={offlineSince !== null}
            />
          ) : (
            <>
              <a className="btn ghost link" href="#Plan">
                ← Back
              </a>
              <p className="mute">This payment is no longer here.</p>
            </>
          ))}
        {tab === "Pot" &&
          (newPot || pot ? (
            <PotPage
              key={id ?? "new"}
              data={ready}
              editing={pot}
              starter={newPot ? extra : undefined}
              actions={pots}
              onOpenSpend={edit}
            />
          ) : (
            <>
              <a className="btn ghost link" href="#Plan">
                ← Back
              </a>
              <p className="mute">This pot is no longer here.</p>
            </>
          ))}
        {tab === "EveryCycle" && <EveryCyclePage data={ready} actions={everyCycle} />}
        {tab === "SalaryDay" && <SalaryDayPage key={ready.cycle.id} data={ready} actions={salaryDay} />}
        {tab === "Money" && <Money data={ready} />}
        {tab === "Spends" && <SpendsPage data={ready} onOpen={edit} />}
        {tab === "Savings" && <SavingsPage data={ready} />}
        {tab === "SavingsMove" && (
          <SavingsMovePage
            key={id}
            data={ready}
            kind={id === "take_out" ? "take_out" : "put_in"}
            actions={savings}
          />
        )}
        {tab === "AddIncome" && (
          // "#AddIncome/borrowed", "#AddIncome/paid_back/<person id>" (item 20).
          <AddIncomePage
            key={`${id ?? ""}/${extra ?? ""}`}
            data={ready}
            actions={savings}
            people={people}
            kind={id}
            personId={extra}
          />
        )}
        {tab === "People" && <PeoplePage data={ready} />}
        {tab === "Lend" && <LendPage data={ready} actions={people} />}
        {tab === "Person" &&
          (person ? (
            <PersonPage key={person.id} data={ready} person={person} actions={people} />
          ) : (
            <>
              <a className="btn ghost link" href="#People">
                ← Back
              </a>
              <p className="mute">This entry is no longer here.</p>
            </>
          ))}
        {tab === "Card" &&
          (!id || card ? (
            <CardPage
              key={id ?? "new"}
              data={ready}
              editing={card}
              actions={cards}
              bills={commitments}
              onOpenSpend={edit}
            />
          ) : (
            <>
              <a className="btn ghost link" href="#Money">
                ← Back
              </a>
              <p className="mute">This card is no longer here.</p>
            </>
          ))}
        {tab === "Instalments" &&
          (!id || plan ? (
            <PlanPage key={id ?? "new"} data={ready} editing={plan} actions={plans} />
          ) : (
            <>
              <a className="btn ghost link" href="#Money">
                ← Back
              </a>
              <p className="mute">This plan is no longer here.</p>
            </>
          ))}
        {tab === "ChangeDollars" && <ChangeDollarsPage data={ready} actions={conversions} onRate={reload} />}
        {tab === "Settings" && (
          <Settings userId={userId} settings={data.settings} onChanged={reload} onSignedOut={onSignedOut} />
        )}
        {tab === "Past" && <PastList data={ready} />}
        {tab === "PastCycle" && id && <PastCyclePage key={id} data={ready} id={id} />}
      </main>
      <nav className="tabs" aria-label="Main" hidden={isPage}>
        {tabs.map((t) => (
          <a key={t} href={`#${t}`} aria-current={t === tab ? "page" : undefined}>
            {t}
          </a>
        ))}
      </nav>
      {sheet && (
        <SpendSheet
          data={ready}
          today={sheet.today}
          editing={sheet.editing}
          actions={spends}
          offline={offlineSince !== null}
          onClose={() => setSheet(null)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <span className="grow">{toast.text}</span>
          {toast.undo && (
            <button type="button" className="btn" onClick={toaster.undo}>
              Undo
            </button>
          )}
        </div>
      )}
    </>
  );
}
