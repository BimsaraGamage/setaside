import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Current } from "./data";
import { newId } from "./id";
import { screenOf, trail } from "./trail";

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

/**
 * The feedback sheet's home in the app: opened by `openFeedback` from anywhere. The screenshot is taken as it
 * opens, of the screen behind it.
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
  const [open, setOpen] = useState<{ from: FeedbackFrom; shot: Promise<string | null> } | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const from = (e as CustomEvent<FeedbackFrom>).detail;
      setOpen((o) => o ?? { from, shot: takeScreenshot() });
    };
    window.addEventListener(OPEN, on);
    return () => window.removeEventListener(OPEN, on);
  }, []);
  if (!open) return null;
  return (
    <FeedbackSheet
      from={open.from}
      shot={open.shot}
      today={today}
      unsent={unsent}
      onClose={() => setOpen(null)}
      onSent={() => {
        setOpen(null);
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
  today,
  unsent,
  onClose,
  onSent,
}: {
  from: FeedbackFrom;
  shot: Promise<string | null>;
  today: Current | null;
  unsent: number;
  onClose: () => void;
  onSent: () => void;
}) {
  const [kind, setKind] = useState<Kind>("problem");
  const [text, setText] = useState("");
  const [screenshot, setScreenshot] = useState<string | null | "taking">("taking");
  const [withScreenshot, setWithScreenshot] = useState(true);
  const [picture, setPicture] = useState<string | null>(null);
  const [pictureNote, setPictureNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const online = useOnline();
  const id = useRef(newId());
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
          id: id.current,
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
    if (res?.ok) onSent();
    else setFailed(true);
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
