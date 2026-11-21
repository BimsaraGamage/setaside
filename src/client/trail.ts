/**
 * The trail (ticket SAB-55, glossary **Trail**): the last steps in the app on this phone, kept in memory only
 * and sent with feedback, so whoever fixes a problem sees what happened just before it. Screens opened, buttons
 * and links pressed (by their label), API calls (method, path, status, time taken), app errors, and the
 * connection going and coming back. Nothing typed into a field is kept.
 */

export type Step = { at: number } & (
  | { kind: "screen"; name: string }
  | { kind: "tap"; label: string }
  | { kind: "api"; method: string; path: string; status: number | null; ms: number }
  | { kind: "error"; message: string; stack?: string }
  | { kind: "online"; online: boolean }
);

/** Steps kept; the oldest goes first (the server takes no more). */
export const TRAIL_MAX = 100;
const LABEL_MAX = 60;
const STACK_MAX = 1500;

const steps: Step[] = [];

type NewStep = Step extends infer S ? (S extends Step ? Omit<S, "at"> : never) : never;

/** Adds a step to the trail. */
export function note(step: NewStep, at = Date.now()) {
  steps.push({ ...step, at } as Step);
  if (steps.length > TRAIL_MAX) steps.splice(0, steps.length - TRAIL_MAX);
}

/** The trail so far, oldest first. */
export function trail(): Step[] {
  return steps.slice();
}

/** Clears the trail (tests). */
export function clearTrail() {
  steps.length = 0;
}

const short = (s: string, max = LABEL_MAX) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** What a pressed button or link says: its aria-label, else its text; fields give nothing. */
export function labelOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest("button, a, [role=button], summary");
  if (!el) return null;
  const label = el.getAttribute("aria-label") ?? el.textContent ?? "";
  return short(label) || null;
}

/** The screen a hash names: "#Commitment/<id>" → "Commitment/<id>"; none → "Today". */
export const screenOf = (hash: string) => (hash.replace(/^#/, "") || "Today").slice(0, 200);

/** `fetch` that adds each API call to the trail (used by `api.ts`). */
export const trailFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  // Only the characters the server takes (`step` in src/worker/feedback.ts).
  const path = url.pathname.replace(/[^A-Za-z0-9/_.%-]/g, "_").slice(0, 200);
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  try {
    const res = await fetch(input, init);
    note({ kind: "api", method, path, status: res.status, ms: ms() });
    return res;
  } catch (e) {
    note({ kind: "api", method, path, status: null, ms: ms() });
    throw e;
  }
};

let started = false;

/** Starts keeping the trail: once, when the app starts (`main.tsx`). */
export function startTrail() {
  if (started) return;
  started = true;
  note({ kind: "screen", name: screenOf(window.location.hash) });
  window.addEventListener("hashchange", () => note({ kind: "screen", name: screenOf(window.location.hash) }));
  document.addEventListener(
    "click",
    (e) => {
      const label = labelOf(e.target);
      if (label) note({ kind: "tap", label });
    },
    { capture: true },
  );
  window.addEventListener("error", (e) =>
    note({
      kind: "error",
      message: short(String(e.message), 300),
      stack: e.error instanceof Error ? e.error.stack?.slice(0, STACK_MAX) : undefined,
    }),
  );
  window.addEventListener("unhandledrejection", (e) => {
    const r: unknown = e.reason;
    note({
      kind: "error",
      message: short(r instanceof Error ? r.message : String(r), 300),
      stack: r instanceof Error ? r.stack?.slice(0, STACK_MAX) : undefined,
    });
  });
  window.addEventListener("online", () => note({ kind: "online", online: true }));
  window.addEventListener("offline", () => note({ kind: "online", online: false }));
}
