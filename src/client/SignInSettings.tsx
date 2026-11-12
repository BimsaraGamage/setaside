import { useEffect, useState } from "react";
import { authClient } from "./auth";

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** Settings → Sign-in (spec 10): passkeys + Add, Google backup, Sign out, Sign out everywhere. */
export function SignInSettings({ onSignedOut }: { onSignedOut: () => void }) {
  const passkeys = authClient.useListPasskeys();
  const [google, setGoogle] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    authClient
      .listAccounts()
      .then((r) => setGoogle(Boolean(r.data?.some((a) => a.providerId === "google"))))
      .catch(() => setGoogle(false));
  }, []);

  async function addPasskey() {
    setNote(null);
    const res = await authClient.passkey.addPasskey({ name: deviceName() });
    setNote(res?.error ? "Passkey not added." : "Passkey added.");
  }

  async function signOut() {
    await authClient.signOut();
    onSignedOut();
  }

  async function signOutEverywhere() {
    await authClient.revokeSessions();
    onSignedOut();
  }

  return (
    <section className="card" aria-labelledby="sign-in-heading">
      <h3 id="sign-in-heading">Sign-in</h3>
      <div className="li">
        <div className="grow">
          Passkeys
          <div className="tiny mute">
            {passkeys.isPending
              ? "…"
              : passkeys.data?.length
                ? passkeys.data
                    .map((p) => `${p.name ?? "Passkey"} · added ${dateFmt.format(new Date(p.createdAt))}`)
                    .join(", ")
                : "None yet: add one for quick sign-in"}
          </div>
        </div>
        <button type="button" className="btn ghost" onClick={addPasskey}>
          + Add
        </button>
      </div>
      <div className="li">
        <div className="grow">
          Google
          <div className="tiny mute">Backup sign-in</div>
        </div>
        <span className="small">{google === null ? "…" : google ? "linked" : "not linked"}</span>
      </div>
      <button type="button" className="li tap" onClick={signOut}>
        Sign out
      </button>
      <button type="button" className="li tap" onClick={signOutEverywhere}>
        Sign out everywhere
      </button>
      {note && (
        <p className="tiny mute" role="status">
          {note}
        </p>
      )}
    </section>
  );
}

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}
