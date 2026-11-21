import { useEffect, useState } from "react";
import { api } from "./api";

/** `GET /api/feedback` (ticket SAB-60): the user's own, newest first. */
export interface FeedbackItem {
  id: string;
  kind: "problem" | "idea";
  /** The first line of what they wrote. */
  text: string;
  createdAt: number;
  status: "new" | "seen" | "planned" | "building" | "ready" | "done" | "not doing";
  reply: string | null;
}

/** Where it is, in plain words (spec 14 "Feedback"). */
export const STATUS_WORDS: Record<FeedbackItem["status"], string> = {
  new: "Sent",
  seen: "Seen",
  planned: "Planned",
  building: "Being built",
  ready: "Fix ready",
  done: "Done",
  "not doing": "Not doing",
};

const SENT = "setaside:feedback-sent";

/** Tells Your feedback a new one was saved, so it shows at once. */
export function feedbackSent() {
  window.dispatchEvent(new Event(SENT));
}

const dayOf = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

type Load = { kind: "loading" } | { kind: "error" } | { kind: "ok"; items: FeedbackItem[] };

/** Settings → Feedback → Your feedback: what the user sent and what became of it (ticket SAB-60). */
export function YourFeedback() {
  const [state, setState] = useState<Load>({ kind: "loading" });
  const [tries, setTries] = useState(0);

  useEffect(() => {
    const again = () => setTries((n) => n + 1);
    window.addEventListener(SENT, again);
    return () => window.removeEventListener(SENT, again);
  }, []);

  useEffect(() => {
    let live = true;
    api.api.feedback
      .$get()
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { feedback: FeedbackItem[] };
        if (live) setState({ kind: "ok", items: body.feedback });
      })
      .catch(() => live && setState((s) => (s.kind === "ok" ? s : { kind: "error" })));
    return () => {
      live = false;
    };
  }, [tries]);

  if (state.kind === "loading") return null;
  if (state.kind === "error") {
    return (
      <p className="tiny mute">
        Couldn't load your feedback.{" "}
        <button type="button" className="btn ghost" onClick={() => setTries((n) => n + 1)}>
          Try again
        </button>
      </p>
    );
  }
  if (state.items.length === 0) return null;
  return (
    <div aria-labelledby="your-feedback-h" role="group">
      <h4 id="your-feedback-h" className="tiny mute">
        Your feedback
      </h4>
      {state.items.map((f) => (
        <div key={f.id} className="li" data-testid="your-feedback">
          <span className="grow">
            <span className="block">{f.text}</span>
            {f.reply && <span className="tiny block">{f.reply}</span>}
            <span className="tiny mute block">
              {f.kind === "idea" ? "Idea" : "Something's wrong"} · {dayOf.format(new Date(f.createdAt))}
            </span>
          </span>
          <span className={`tiny status-${f.status.replace(" ", "-")}`} data-testid="your-feedback-status">
            {STATUS_WORDS[f.status]}
          </span>
        </div>
      ))}
    </div>
  );
}
