import { useEffect, useSyncExternalStore } from "react";
import { paymentCovers, type UnsentOutcome, unsentOutcome } from "../money";
import { api } from "./api";
import type { Current } from "./data";

/**
 * The unsent queue (item 24, spec 11): spends and commitment payments made on the phone, kept in its storage
 * (it survives closing the app) and sent by themselves when the connection is back, oldest first, until each
 * is confirmed. Ids are made on the phone, so a resend is saved once. One queue per user: another user signed
 * in on this phone never sees or sends it, and it waits while the session has ended.
 */

export interface SpendDraft {
  spentOn: string;
  amountMinor: number;
  note: string | null;
  /** The pot it comes from; null means free money (item 7). */
  potId: string | null;
  /** The card it was paid with; null means cash (item 18). */
  cardId: string | null;
  /** The place the money came out of (SAB-51); null or none moves no place. */
  placeId?: string | null;
  /** Left out of the spending speed (item 8). */
  oneOff: boolean;
}

export interface PaymentDraft {
  amountMinor: number;
  paidOn: string;
  /** Either currency (item 17); none: the commitment's own. */
  currency?: string;
  /** The place the money came out of (SAB-51); null or none moves no place. */
  placeId?: string | null;
}

/**
 * What the phone knows about an item's trip to the server. `tried`: sent once with no answer, so the server may
 * have it (the answer was lost). Changed or removed after that, it is `changed` (a resend the server already
 * has is followed by a change) or `removed` (sent as a delete, and no longer shown).
 */
interface Trip {
  tried?: boolean;
  changed?: boolean;
  removed?: boolean;
}

export type UnsentItem = Trip &
  (
    | {
        kind: "spend";
        id: string;
        /** The spend's currency (its pot's, else the spending currency), to show it before it is sent. */
        currency: string;
        draft: SpendDraft;
        queuedAt: number;
      }
    | {
        kind: "payment";
        id: string;
        commitmentId: string;
        /** For the needs-a-look list, once its commitment may be gone. */
        commitmentName: string;
        commitmentCurrency: string;
        draft: PaymentDraft;
        finish: boolean;
        queuedAt: number;
      }
  );

/** Items still waiting to be sent and shown as unsent (not the removed ones waiting to be deleted). */
export const waiting = (s: UnsentState) => s.items.filter((i) => !i.removed);

/** Why an unsent item needs a look: the server's error (`locked`, `not_open`, `not_found`, `invalid`, …). */
export type LookItem = UnsentItem & { reason: string };

/** A note to the user about something sent later: a spend moved into the current cycle. */
export interface UnsentNote {
  id: string;
  /** The spend's amount, currency and the day it had. */
  amountMinor: number;
  currency: string;
  movedFrom: string;
}

export interface UnsentState {
  /** Waiting to be sent, oldest first. */
  items: UnsentItem[];
  /** Refused by the server: the user fixes or removes them. */
  look: LookItem[];
  notes: UnsentNote[];
  /** The session has ended: sending waits until the user signs in again. */
  signIn: boolean;
}

const empty: UnsentState = { items: [], look: [], notes: [], signIn: false };
const keyOf = (userId: string) => `setaside.unsent.${userId}`;

const states = new Map<string, UnsentState>();
const listeners = new Set<() => void>();
/** The send under way for each user: one at a time, whoever asks. */
const sendings = new Map<string, Promise<Map<string, UnsentOutcome>>>();

function load(userId: string): UnsentState {
  const known = states.get(userId);
  if (known) return known;
  let state = empty;
  try {
    const raw = localStorage.getItem(keyOf(userId));
    if (raw) {
      const s = JSON.parse(raw) as Partial<UnsentState>;
      state = { items: s.items ?? [], look: s.look ?? [], notes: s.notes ?? [], signIn: false };
    }
  } catch {
    // Unreadable or blocked storage: an empty queue.
  }
  states.set(userId, state);
  return state;
}

function save(userId: string, next: UnsentState): void {
  states.set(userId, next);
  try {
    const { items, look, notes } = next;
    if (items.length + look.length + notes.length === 0) localStorage.removeItem(keyOf(userId));
    else localStorage.setItem(keyOf(userId), JSON.stringify({ items, look, notes }));
  } catch {
    // Storage full or blocked: kept for this visit only.
  }
  for (const l of listeners) l();
}

/** Delete account (item 28): the user's unsent items can never be sent, so they go from this phone. */
export function forgetUnsent(userId: string): void {
  states.delete(userId);
  try {
    localStorage.removeItem(keyOf(userId));
  } catch {
    // Nothing to remove.
  }
}

const byQueued = (a: UnsentItem, b: UnsentItem) => a.queuedAt - b.queuedAt;

/** The queue of one user: add, change, remove, send. */
export function outbox(userId: string) {
  const get = () => load(userId);
  const set = (f: (s: UnsentState) => UnsentState) => save(userId, f(get()));
  const strip = (s: UnsentState, id: string): UnsentState => ({
    ...s,
    items: s.items.filter((i) => i.id !== id),
    look: s.look.filter((i) => i.id !== id),
  });

  async function sendOne(
    item: UnsentItem,
  ): Promise<{ outcome: UnsentOutcome; body: Record<string, unknown> }> {
    const answer = async (send: () => Promise<Response>) => {
      try {
        const res = await send();
        return { res, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
      } catch {
        return null;
      }
    };
    if (item.removed) {
      // Removed on the phone after a send with no answer: deleted on the server (already gone is fine).
      const a = await answer(() =>
        item.kind === "spend"
          ? api.api.spends[":id"].$delete({ param: { id: item.id } })
          : api.api.payments[":id"].$delete({ param: { id: item.id } }),
      );
      if (!a) return { outcome: "retry", body: {} };
      return { outcome: a.res.status === 404 ? "saved" : unsentOutcome(a.res.status), body: a.body };
    }
    const a = await answer(() =>
      item.kind === "spend"
        ? api.api.spends.$post({ json: { id: item.id, ...item.draft, queued: true } })
        : api.api.commitments[":id"].payments.$post({
            param: { id: item.commitmentId },
            json: { id: item.id, ...item.draft, finish: item.finish },
          }),
    );
    if (!a) return { outcome: "retry", body: {} };
    if (a.body.already !== true || !item.changed)
      return { outcome: unsentOutcome(a.res.status), body: a.body };
    // The server had it from a send whose answer was lost, and it was changed on the phone since: change it.
    const c = await answer(() =>
      item.kind === "spend"
        ? api.api.spends[":id"].$patch({ param: { id: item.id }, json: item.draft })
        : api.api.payments[":id"].$patch({
            param: { id: item.id },
            json: {
              amountMinor: item.draft.amountMinor,
              paidOn: item.draft.paidOn,
              currency: item.draft.currency,
              placeId: item.draft.placeId ?? null,
            },
          }),
    );
    if (!c) return { outcome: "retry", body: {} };
    return { outcome: unsentOutcome(c.res.status), body: c.body };
  }

  const live = (s: UnsentState) => waiting(s);
  const has = (id: string) => live(get()).some((i) => i.id === id) || get().look.some((i) => i.id === id);

  return {
    get,
    /** Is this id unsent (waiting, or in the needs-a-look list)? */
    has,
    find: (id: string): UnsentItem | undefined =>
      live(get()).find((i) => i.id === id) ?? get().look.find((i) => i.id === id),
    add: (item: UnsentItem) =>
      set((s) => ({ ...strip(s, item.id), items: [...s.items, item].sort(byQueued) })),
    /** Changes an unsent item; one in the needs-a-look list goes back in the queue (it was fixed). */
    change: (id: string, f: (i: UnsentItem) => UnsentItem) =>
      set((s) => {
        const old = live(s).find((i) => i.id === id) ?? s.look.find((i) => i.id === id);
        if (!old) return s;
        const { reason: _reason, ...item } = f(old) as LookItem;
        const next = { ...item, changed: old.tried || old.changed } as UnsentItem;
        return { ...strip(s, id), items: [...strip(s, id).items, next].sort(byQueued) };
      }),
    /** Removes an unsent item; false when it is not unsent (sent already). */
    remove(id: string): boolean {
      if (!has(id)) return false;
      set((s) => {
        const old = s.items.find((i) => i.id === id);
        // The server may have it (a send with no answer): kept, to be deleted there.
        if (old?.tried)
          return { ...s, items: s.items.map((i) => (i.id === id ? { ...i, removed: true } : i)) };
        return strip(s, id);
      });
      return true;
    },
    dismissNote: (id: string) => set((s) => ({ ...s, notes: s.notes.filter((n) => n.id !== id) })),
    /**
     * Sends the queue, oldest first, stopping at the first that can't be sent now (no connection, or the
     * session has ended). Returns what happened to each item it tried.
     */
    flush(): Promise<Map<string, UnsentOutcome>> {
      const under = sendings.get(userId);
      if (under) return under;
      const sending = (async () => {
        const out = new Map<string, UnsentOutcome>();
        if (get().signIn) set((s) => ({ ...s, signIn: false }));
        // Oldest first, as each is now (changed meanwhile, or added while this send runs).
        for (;;) {
          const now = get().items.find((i) => !out.has(i.id));
          if (!now) break;
          const { outcome, body } = await sendOne(now);
          out.set(now.id, outcome);
          const after = get().items.find((i) => i.id === now.id);
          if (outcome === "retry") {
            // No answer: the server may have it now.
            if (after)
              set((s) => ({
                ...s,
                items: s.items.map((i) => (i.id === now.id ? { ...i, tried: true } : i)),
              }));
            break;
          }
          if (outcome === "sign_in") {
            set((s) => ({ ...s, signIn: true }));
            break;
          }
          if (outcome === "saved" && after && after !== now) {
            // Changed or removed on the phone while it was being sent: the server has it, so the next round
            // changes or deletes it there.
            const next = { ...after, tried: true, changed: !after.removed };
            set((s) => ({ ...s, items: s.items.map((i) => (i.id === now.id ? next : i)) }));
            continue;
          }
          set((s) => {
            const rest = strip(s, now.id);
            if (outcome === "look") {
              const reason = typeof body.error === "string" ? body.error : "invalid";
              if (now.removed) return rest;
              // Refused: the server does not have it.
              return { ...rest, look: [...rest.look, { ...now, tried: false, changed: false, reason }] };
            }
            if (now.kind === "spend" && typeof body.movedFrom === "string") {
              const note = {
                id: now.id,
                amountMinor: now.draft.amountMinor,
                currency: now.currency,
                movedFrom: body.movedFrom,
              };
              return { ...rest, notes: [...rest.notes, note] };
            }
            return rest;
          });
        }
        return out;
      })().finally(() => {
        sendings.delete(userId);
      });
      sendings.set(userId, sending);
      return sending;
    },
  };
}

export type Outbox = ReturnType<typeof outbox>;

/**
 * The user's queue, kept in step with storage, sent when the app opens, when the connection comes back, when
 * the app is shown again, and every 30 seconds while items wait. `onSent` runs after anything was sent.
 */
export function useUnsent(userId: string, onSent: () => void) {
  const box = outbox(userId);
  const state = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => load(userId),
  );
  useEffect(() => {
    const b = outbox(userId);
    const send = async () => {
      if (b.get().items.length === 0) return;
      const out = await b.flush();
      if ([...out.values()].some((o) => o === "saved" || o === "look")) onSent();
    };
    send();
    const t = setInterval(send, 30_000);
    const shown = () => document.visibilityState === "visible" && send();
    window.addEventListener("online", send);
    document.addEventListener("visibilitychange", shown);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", send);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [userId, onSent]);
  return { state, box };
}

/**
 * The current cycle with the unsent items in it, as if saved (spec 11: the allowance offline is worked out
 * from the saved copy plus unsent items). Unsent ones are marked; one the server already has is not added
 * twice. A payment whose commitment is not here waits to be sent (it will need a look).
 */
export function withUnsent(data: Current, all: UnsentItem[]): Current {
  const items = all.filter((i) => !i.removed);
  if (items.length === 0) return data;
  const known = new Set(data.spends.map((s) => s.id));
  const spends = [
    ...data.spends,
    ...items.flatMap((i) =>
      i.kind === "spend" && !known.has(i.id)
        ? [{ id: i.id, currency: i.currency, ...i.draft, unsent: true }]
        : [],
    ),
  ];
  const rates = {
    spendingCurrency: data.settings?.spendingCurrency ?? "",
    countingRate: data.settings?.countingRate ?? null,
  };
  const commitments = data.commitments.map((c) => {
    const mine = items.filter(
      (i): i is Extract<UnsentItem, { kind: "payment" }> =>
        i.kind === "payment" && i.commitmentId === c.id && !c.payments.some((p) => p.id === i.id),
    );
    if (mine.length === 0) return c;
    return {
      ...c,
      state: mine.some((i) => i.finish) ? ("finished" as const) : c.state,
      payments: [
        ...c.payments,
        ...mine.map((i) => {
          const currency = i.draft.currency ?? c.currency;
          return {
            id: i.id,
            amountMinor: i.draft.amountMinor,
            currency,
            coversMinor:
              currency === c.currency
                ? null
                : paymentCovers(i.draft.amountMinor, currency, c.currency, rates),
            paidOn: i.draft.paidOn,
            placeId: i.draft.placeId ?? null,
            unsent: true,
          };
        }),
      ],
    };
  });
  return { ...data, spends, commitments };
}
