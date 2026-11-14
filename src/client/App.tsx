import { useEffect, useState } from "react";
import { authClient } from "./auth";
import { type Spend, useCurrent } from "./data";
import { FirstUse } from "./FirstUse";
import { Settings } from "./Settings";
import { SignIn } from "./SignIn";
import { SpendSheet } from "./SpendSheet";
import { Money, SpendsPage } from "./Spends";
import { useSpendActions } from "./spend-actions";
import { Today } from "./Today";

const tabs = ["Today", "Plan", "Money", "Past", "Settings"] as const;
/** Pages opened from a tab: they cover the tab bar and have a ← back (spec 10). */
const pages = { Spends: "Money" } as const;
type Tab = (typeof tabs)[number] | keyof typeof pages;

function tabFromHash(): Tab {
  const h = decodeURIComponent(window.location.hash.slice(1));
  return (tabs as readonly string[]).includes(h) || h in pages ? (h as Tab) : "Today";
}

export function App() {
  const session = authClient.useSession();

  if (session.isPending) return <main className="loading mute">Loading…</main>;
  if (!session.data) return <SignIn onSignedIn={() => session.refetch()} />;
  return <SignedIn onSignedOut={() => session.refetch()} />;
}

function SignedIn({ onSignedOut }: { onSignedOut: () => void }) {
  const { data, error, reload } = useCurrent();
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const actions = useSpendActions(reload);
  /** The spend sheet: open for a new spend, or for one being changed. */
  const [sheet, setSheet] = useState<{ today: string; editing?: Spend } | null>(null);

  useEffect(() => {
    const on = () => setTab(tabFromHash());
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
  const isPage = tab in pages;
  return (
    <>
      <main className={isPage ? "with-tabs page" : "with-tabs"}>
        {tab === "Today" && <Today data={ready} onAdd={(today) => setSheet({ today })} onEdit={edit} />}
        {tab === "Money" && <Money data={ready} />}
        {tab === "Spends" && <SpendsPage data={ready} onOpen={edit} />}
        {tab === "Settings" && (
          <Settings settings={data.settings} onChanged={reload} onSignedOut={onSignedOut} />
        )}
        {(tab === "Plan" || tab === "Past") && (
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
          actions={actions}
          onClose={() => setSheet(null)}
        />
      )}
      {actions.toast && (
        <div className="toast" role="status">
          <span className="grow">{actions.toast.text}</span>
          {actions.toast.undo && (
            <button type="button" className="btn" onClick={actions.undo}>
              Undo
            </button>
          )}
        </div>
      )}
    </>
  );
}
