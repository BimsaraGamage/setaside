import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Current } from "./data";
import { newId } from "./id";
import { screenOf, trail } from "./trail";
import { feedbackSent } from "./YourFeedback";

/** One picture, as bytes (the server takes no more: `PICTURE_MAX_BYTES`). */
const PICTURE_MAX_BYTES = 300 * 1024;
/** Longest side of an added picture. */
const PICTURE_MAX_SIDE = 1600;
const TEXT_MAX = 4000;

type Kind = "problem" | "idea";
/** Where the sheet was opened from: Settings, the error toast, or Needs a look. */
export type FeedbackFrom = "settings" | "toast" | "needs-a-look";

const OPEN = "setaside:feedback";

/** Opens the feedback sheet over the screen as it is now (ticket SAB-55). */
export function openFeedback(from: FeedbackFrom) {
  window.dispatchEvent(new CustomEvent<FeedbackFrom>(OPEN, { detail: from }));
}

const sizeOf = (dataUrl: string) => Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function blobOf(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * A canvas as a WebP data URL of at most 300 KB (JPEG where the browser makes no WebP): lower quality first,
 * then a smaller picture. Null if it can't be made small enough.
 */
export async function encodePicture(source: HTMLCanvasElement): Promise<string | null> {
  let canvas = source;
  for (let round = 0; round < 4; round++) {
    for (const quality of [0.8, 0.6, 0.4]) {
      let blob = await blobOf(canvas, "image/webp", quality);
      if (blob && blob.type !== "image/webp") blob = await blobOf(canvas, "image/jpeg", quality);
      if (!blob) return null;
      if (blob.size <= PICTURE_MAX_BYTES) {
        const url = await toDataUrl(blob);
        if (sizeOf(url) <= PICTURE_MAX_BYTES) return url;
      }
    }
    canvas = scaled(canvas, 0.7);
  }
  return null;
}

/** A copy of an image or canvas, `by` its size. */
function scaled(
  source: HTMLCanvasElement | HTMLImageElement,
  by: number,
  w = source.width,
  h = source.height,
) {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(w * by));
  out.height = Math.max(1, Math.round(h * by));
  out.getContext("2d")?.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

/** The screen as it is now, without the feedback sheet: SnapDOM, only loaded here. */
async function takeScreenshot(): Promise<string | null> {
  try {
    const { snapdom } = await import("@zumer/snapdom");
    const canvas = await snapdom.toCanvas(document.body, {
      clip: "viewport",
      scale: Math.min(window.devicePixelRatio || 1, 1.5),
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      exclude: ["[data-feedback]"],
      embedFonts: false,
    });
    return await encodePicture(canvas);
  } catch {
    return null;
  }
}

/** A picture picked from the gallery, made small enough. */
async function readPicture(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const by = Math.min(1, PICTURE_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    return await encodePicture(scaled(img, by, img.naturalWidth, img.naturalHeight));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** What the phone knows besides the trail: app, device, connection, unsent items, the screen. */
function contextOf(unsent: number, from: FeedbackFrom) {
  return {
    version: __APP_VERSION__,
    build: __BUILD_ID__,
    browser: navigator.userAgent.slice(0, 400),
    screen: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    online: navigator.onLine,
    unsent,
    currentScreen: screenOf(window.location.hash),
    from,
    sentAt: new Date().toISOString(),
  };
}

/** What the user has put in the sheet so far: kept while they go to another screen for its screenshot. */
type Draft = {
  id: string;
  kind: Kind;
  text: string;
  withScreenshot: boolean;
  picture: string | null;
};

const newDraft = (): Draft => ({
  id: newId(),
  kind: "problem",
  text: "",
  withScreenshot: true,
  picture: null,
});

type HostState =
  | { at: "sheet"; from: FeedbackFrom; shot: Promise<string | null>; draft: Draft }
  | { at: "picking"; from: FeedbackFrom; draft: Draft };

/**
 * The feedback sheet's home in the app: opened by `openFeedback` from anywhere. The screenshot is taken as it
 * opens, of the screen behind it. **Pick another screen** closes the sheet and leaves a small **Capture this
 * screen** bar over the app; the user goes to the screen that matters and taps it, and the sheet comes back with
 * that screen's screenshot and what was already typed (ticket SAB-58).
 */
export function FeedbackHost({
  today,
  unsent,
  onSent,
}: {
  today: Current | null;
  unsent: number;
  onSent: () => void;
}) {
  const [state, setState] = useState<HostState | null>(null);
  const now = useRef(state);
  now.current = state;
  useEffect(() => {
    const on = (e: Event) => {
      const s = now.current;
      if (s?.at === "sheet") return;
      // While picking, opening it again (e.g. Settings → Send feedback) takes this screen and keeps the draft.
      const shot = takeScreenshot();
      const from = (e as CustomEvent<FeedbackFrom>).detail;
      setState(s ? { ...s, at: "sheet", shot } : { at: "sheet", from, shot, draft: newDraft() });
    };
    window.addEventListener(OPEN, on);
    return () => window.removeEventListener(OPEN, on);
  }, []);
  if (!state) return null;
  if (state.at === "picking") {
    return (
      <section className="feedback-pick" data-feedback aria-label="Feedback screenshot">
        <span className="grow small">Go to the screen with the problem</span>
        <button type="button" className="btn" onClick={() => setState(null)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn pri"
          onClick={() => setState({ ...state, at: "sheet", shot: takeScreenshot() })}
        >
          Capture this screen
        </button>
      </section>
    );
  }
  return (
    <FeedbackSheet
      from={state.from}
      shot={state.shot}
      draft={state.draft}
      today={today}
      unsent={unsent}
      onClose={() => setState(null)}
      onPick={(draft) => setState({ at: "picking", from: state.from, draft })}
      onSent={() => {
        setState(null);
        onSent();
      }}
    />
  );
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  return online;
}

/** Send feedback (ticket SAB-55, spec 14 "Feedback"). */
function FeedbackSheet({
  from,
  shot,
  draft,
  today,
  unsent,
  onClose,
  onPick,
  onSent,
}: {
  from: FeedbackFrom;
  shot: Promise<string | null>;
  draft: Draft;
  today: Current | null;
  unsent: number;
  onClose: () => void;
  onPick: (draft: Draft) => void;
  onSent: () => void;
}) {
  const [kind, setKind] = useState<Kind>(draft.kind);
  const [text, setText] = useState(draft.text);
  const [screenshot, setScreenshot] = useState<string | null | "taking">("taking");
  const [withScreenshot, setWithScreenshot] = useState(draft.withScreenshot);
  const [picture, setPicture] = useState<string | null>(draft.picture);
  const [pictureNote, setPictureNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const online = useOnline();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    shot.then((s) => live && setScreenshot(s));
    return () => {
      live = false;
    };
  }, [shot]);

  async function addPicture(file: File | undefined) {
    if (!file) return;
    setPictureNote(null);
    const p = await readPicture(file);
    if (p) setPicture(p);
    else setPictureNote("That picture couldn't be added.");
  }

  async function send() {
    setBusy(true);
    setFailed(false);
    const shotNow = withScreenshot && screenshot !== "taking" ? screenshot : null;
    const res = await api.api.feedback
      .$post({
        json: {
          id: draft.id,
          kind,
          text,
          context: contextOf(unsent, from),
          trail: trail(),
          today,
          ...(shotNow ? { screenshot: shotNow } : {}),
          ...(picture ? { picture } : {}),
        },
      })
      .catch(() => null);
    setBusy(false);
    if (res?.ok) {
      feedbackSent();
      onSent();
    } else setFailed(true);
  }

  const empty = text.trim() === "";
  return (
    <div
      className="sheet-back"
      data-feedback
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <section
        className="sheet feedback"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-h"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="row">
          <h2 id="feedback-h" className="grow">
            Send feedback
          </h2>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <fieldset className="chips" aria-label="Kind">
          <button
            type="button"
            className="btn"
            aria-pressed={kind === "problem"}
            onClick={() => setKind("problem")}
          >
            Something's wrong
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={kind === "idea"}
            onClick={() => setKind("idea")}
          >
            Idea
          </button>
        </fieldset>

        <label className="field">
          <span className="sr">What went wrong or what you want</span>
          <textarea
            rows={4}
            maxLength={TEXT_MAX}
            placeholder="What went wrong or what you want"
            aria-label="Feedback"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>

        <label className="row check">
          <input
            type="checkbox"
            checked={withScreenshot}
            onChange={(e) => setWithScreenshot(e.target.checked)}
          />
          <span className="grow">
            Include screenshot
            <span className="tiny mute block">
              {screenshot === "taking"
                ? "Taking it…"
                : screenshot
                  ? "Of the screen behind this"
                  : "Couldn't take one this time"}
            </span>
          </span>
        </label>
        {withScreenshot && screenshot && screenshot !== "taking" && (
          <img className="feedback-shot" src={screenshot} alt="Screenshot of the screen behind" />
        )}
        <button
          type="button"
          className="btn ghost"
          onClick={() => onPick({ id: draft.id, kind, text, withScreenshot: true, picture })}
        >
          Pick another screen
        </button>

        {picture ? (
          <div className="row">
            <img className="feedback-shot grow" src={picture} alt="Added" />
            <button type="button" className="btn ghost" onClick={() => setPicture(null)}>
              Remove picture
            </button>
          </div>
        ) : (
          <button type="button" className="btn ghost" onClick={() => fileInput.current?.click()}>
            Add a picture
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          aria-label="Picture"
          onChange={(e) => {
            void addPicture(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {pictureNote && <p className="tiny bad">{pictureNote}</p>}

        <p className="tiny mute">Also sends: last steps in the app, app version, this device.</p>

        {!online && (
          <p className="small bad" data-testid="feedback-offline">
            Needs a connection, try again.
          </p>
        )}
        {failed && online && <p className="error">Not sent. Check the connection and try again.</p>}

        <button
          type="button"
          className="btn pri"
          disabled={busy || empty || !online || (withScreenshot && screenshot === "taking")}
          onClick={send}
        >
          Send
        </button>
      </section>
    </div>
  );
}
