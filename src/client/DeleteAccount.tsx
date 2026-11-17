import { useState } from "react";
import { api } from "./api";
import { authClient } from "./auth";
import { download } from "./download";
import { forgetPushHere } from "./push";
import { DELETED_PARAM } from "./SignIn";
import { forgetUnsent } from "./unsent";

/** The word typed to confirm, exactly (spec 14; the server checks it too). */
const CONFIRM_WORD = "DELETE";

type SignalApi = { signalUnknownCredential?: (o: { rpId: string; credentialId: string }) => Promise<void> };

/**
 * Tells the phone's password manager these passkeys are gone, so it stops offering them.
 * Only some browsers can (Chrome 132+, Safari 26); elsewhere they stay until removed by hand.
 */
async function forgetPasskeys(credentialIds: string[]) {
  const pkc = (window as { PublicKeyCredential?: SignalApi }).PublicKeyCredential;
  if (!pkc?.signalUnknownCredential) return;
  for (const credentialId of credentialIds) {
    await pkc.signalUnknownCredential({ rpId: window.location.hostname, credentialId }).catch(() => {});
  }
}

/**
 * Settings → Delete account (item 28, spec 14): a warning, "download first", and
 * typing DELETE. Every row of the account goes and every device is signed out.
 */
export function DeleteAccount({ userId, onDeleted }: { userId: string; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<"download" | "delete" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function downloadFirst() {
    setNote(null);
    setBusy("download");
    const ok = await download("data");
    setBusy(null);
    setNote(ok ? null : "Not downloaded. Check the connection and try again.");
  }

  async function remove() {
    setNote(null);
    setBusy("delete");
    // Read before deleting: afterwards the server has none of them.
    const passkeys = await authClient.passkey.listUserPasskeys().catch(() => null);
    const res = await api.api.account.delete.$post({ json: { confirm: CONFIRM_WORD } }).catch(() => null);
    if (!res?.ok) {
      setBusy(null);
      setNote("Not deleted. Check the connection and try again.");
      return;
    }
    forgetUnsent(userId);
    await forgetPushHere();
    await forgetPasskeys((passkeys?.data ?? []).map((p) => p.credentialID));
    window.history.replaceState(null, "", `/?${DELETED_PARAM}=1`);
    onDeleted();
  }

  return (
    <section className="card" aria-labelledby="delete-account-h">
      <h3 id="delete-account-h">Delete account</h3>
      {!open ? (
        <button type="button" className="li tap bad" onClick={() => setOpen(true)}>
          Delete my account…
        </button>
      ) : (
        <div className="stack">
          <p className="small" role="note">
            This deletes your account and everything in it: every cycle, spend, bill, pot, saving, plan and
            person. It can't be undone. Every device you're signed in on is signed out.
          </p>
          <button type="button" className="btn ghost" disabled={busy !== null} onClick={downloadFirst}>
            {busy === "download" ? "Downloading…" : "Download my data first"}
          </button>
          <label className="field">
            Type {CONFIRM_WORD} to confirm
            <input
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn bad"
            disabled={busy !== null || typed !== CONFIRM_WORD}
            onClick={remove}
          >
            {busy === "delete" ? "Deleting…" : "Delete my account"}
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={busy !== null}
            onClick={() => {
              setOpen(false);
              setTyped("");
              setNote(null);
            }}
          >
            Keep my account
          </button>
          <p className="tiny mute">
            Passkeys saved on your phones may stay there; remove them in its settings.
          </p>
        </div>
      )}
      {note && (
        <p className="tiny bad" role="alert">
          {note}
        </p>
      )}
    </section>
  );
}
