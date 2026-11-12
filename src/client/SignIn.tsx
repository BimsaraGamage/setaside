import { useEffect, useState } from "react";
import { api } from "./api";
import { authClient, signInAsDemoUser } from "./auth";

const errors: Record<string, string> = {
  not_allowed: "That Google account isn't allowed here yet.",
  access_denied: "Google sign-in was cancelled.",
};

/** Message for `?error=` set by Better Auth after a refused Google sign-in. */
function errorFromUrl(): string | null {
  const code = new URLSearchParams(window.location.search).get("error");
  if (!code) return null;
  window.history.replaceState(null, "", window.location.pathname);
  return errors[code] ?? "Sign-in didn't work. Try again.";
}

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [options, setOptions] = useState({ google: true, demo: false });
  const [error, setError] = useState<string | null>(errorFromUrl);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.api["sign-in-options"]
      .$get()
      .then((r) => r.json())
      .then(setOptions)
      .catch(() => {});
  }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const passkey = () =>
    run(async () => {
      const res = await authClient.signIn.passkey();
      if (res.error) throw new Error("No passkey sign-in. First time here? Use Google, then add a passkey.");
      onSignedIn();
    });

  const google = () =>
    run(async () => {
      const res = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/",
        errorCallbackURL: "/",
      });
      if (res.error) throw new Error("Google sign-in isn't set up on this copy of Setaside.");
    });

  const demo = () =>
    run(async () => {
      await signInAsDemoUser();
      onSignedIn();
    });

  return (
    <main className="sign-in">
      <h1>Setaside</h1>
      <p className="mute">Set aside this pay cycle's bills, see what's free to spend each day.</p>
      <div className="stack">
        <button type="button" className="btn pri" onClick={passkey} disabled={busy}>
          Sign in with passkey
        </button>
        {options.google && (
          <button type="button" className="btn" onClick={google} disabled={busy}>
            Sign in with Google
          </button>
        )}
        {options.demo && (
          <button type="button" className="btn ghost" onClick={demo} disabled={busy}>
            Sign in as demo user
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {options.demo && <p className="tiny mute">Demo sign-in exists only in local development.</p>}
    </main>
  );
}
