import { useEffect, useState } from "react";
import { authClient } from "./auth";
import { useCurrent } from "./data";
import { FirstUse } from "./FirstUse";
import { Settings } from "./Settings";
import { SignIn } from "./SignIn";
import { Today } from "./Today";

const tabs = ["Today", "Plan", "Money", "Past", "Settings"] as const;
type Tab = (typeof tabs)[number];

function tabFromHash(): Tab {
  const h = decodeURIComponent(window.location.hash.slice(1));
  return (tabs as readonly string[]).includes(h) ? (h as Tab) : "Today";
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
  return (
    <>
      <main className="with-tabs">
        {tab === "Today" && <Today data={ready} />}
        {tab === "Settings" && (
          <Settings settings={data.settings} onChanged={reload} onSignedOut={onSignedOut} />
        )}
        {(tab === "Plan" || tab === "Money" || tab === "Past") && (
          <>
            <h1>{tab}</h1>
            <p className="mute">Comes in a later build step.</p>
          </>
        )}
      </main>
      <nav className="tabs" aria-label="Main">
        {tabs.map((t) => (
          <a key={t} href={`#${t}`} aria-current={t === tab ? "page" : undefined}>
            {t}
          </a>
        ))}
      </nav>
    </>
  );
}
