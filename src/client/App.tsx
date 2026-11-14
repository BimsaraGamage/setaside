import { useEffect, useState } from "react";
import { authClient } from "./auth";
import { commitmentActions } from "./commitment-actions";
import { type Spend, useCurrent } from "./data";
import { FirstUse } from "./FirstUse";
import { PayPage } from "./Pay";
import { CommitmentPage, Plan } from "./Plan";
import { Settings } from "./Settings";
import { SignIn } from "./SignIn";
import { SpendSheet } from "./SpendSheet";
import { Money, SpendsPage } from "./Spends";
import { spendActions } from "./spend-actions";
import { Today } from "./Today";
import { useToast } from "./toast";

const tabs = ["Today", "Plan", "Money", "Past", "Settings"] as const;
/** Pages opened from a tab: they cover the tab bar and have a ← back (spec 10). */
const pages = { Spends: "Money", Commitment: "Plan", Pay: "Plan", Payment: "Plan" } as const;
type Tab = (typeof tabs)[number] | keyof typeof pages;

/** "#Commitment/<id>" → the Commitment page for that id; unknown → Today. */
function routeFromHash(): { tab: Tab; id?: string } {
  const [h = "", id] = decodeURIComponent(window.location.hash.slice(1)).split("/");
  if ((tabs as readonly string[]).includes(h) || h in pages) return { tab: h as Tab, id };
  return { tab: "Today" };
}

export function App() {
  const session = authClient.useSession();

  if (session.isPending) return <main className="loading mute">Loading…</main>;
  if (!session.data) return <SignIn onSignedIn={() => session.refetch()} />;
  return <SignedIn onSignedOut={() => session.refetch()} />;
}

function SignedIn({ onSignedOut }: { onSignedOut: () => void }) {
  const { data, error, reload } = useCurrent();
  const [route, setRoute] = useState(routeFromHash);
  const toaster = useToast(reload);
  const spends = spendActions(toaster);
  const commitments = commitmentActions(toaster);
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
  const { tab, id } = route;
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
  const toast = toaster.toast;
  return (
    <>
      <main className={isPage ? "with-tabs page" : "with-tabs"}>
        {tab === "Today" && <Today data={ready} onAdd={(today) => setSheet({ today })} onEdit={edit} />}
        {tab === "Plan" && <Plan data={ready} />}
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
            <PayPage key={id} data={ready} commitment={payFor} editing={payment} actions={commitments} />
          ) : (
            <>
              <a className="btn ghost link" href="#Plan">
                ← Back
              </a>
              <p className="mute">This payment is no longer here.</p>
            </>
          ))}
        {tab === "Money" && <Money data={ready} />}
        {tab === "Spends" && <SpendsPage data={ready} onOpen={edit} />}
        {tab === "Settings" && (
          <Settings settings={data.settings} onChanged={reload} onSignedOut={onSignedOut} />
        )}
        {tab === "Past" && (
          <>
            <h1>{tab}</h1>
            <p className="mute">Comes in a later build step.</p>
          </>
        )}
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
