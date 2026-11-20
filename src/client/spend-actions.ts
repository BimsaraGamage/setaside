import { api } from "./api";
import type { Spend } from "./data";
import type { Toaster } from "./toast";
import type { Outbox, SpendDraft } from "./unsent";

export type { SpendDraft } from "./unsent";

const change = async (id: string, d: Partial<SpendDraft>) =>
  (await api.api.spends[":id"].$patch({ param: { id }, json: d }).catch(() => null))?.ok ?? false;
const remove = async (id: string) =>
  (await api.api.spends[":id"].$delete({ param: { id } }).catch(() => null))?.ok ?? false;

const draftOf = (s: Spend): SpendDraft => ({
  spentOn: s.spentOn,
  amountMinor: s.amountMinor,
  note: s.note,
  potId: s.potId,
  cardId: s.cardId,
  placeId: s.placeId ?? null,
  oneOff: s.oneOff,
});

/** What the toast says after a new spend was put in the queue and sent (or not yet). */
const NOT_SENT = "Spend saved on this phone · sends when back online";

/**
 * Add, change and delete spends; each success shows a toast with Undo. A new spend goes through the unsent
 * queue (item 24, spec 11): saved on the phone first, then sent; with no connection it waits there. An unsent
 * spend is changed or removed on the phone; a saved one only with a connection.
 */
export function spendActions({ done }: Toaster, box: Outbox) {
  /** Removes a spend wherever it is now: still unsent, or already on the server. */
  const undoAdd = async (id: string) => box.remove(id) || remove(id);
  const queue = async (id: string, currency: string, d: SpendDraft, queuedAt = Date.now()) => {
    box.add({ kind: "spend", id, currency, draft: d, queuedAt });
    await box.flush();
    return !box.has(id);
  };
  return {
    add: async (id: string, currency: string, d: SpendDraft) => {
      const sent = await queue(id, currency, d);
      const look = box.get().look.some((i) => i.id === id);
      return done(true, {
        text: sent ? "Spend saved" : look ? "Spend not saved · needs a look" : NOT_SENT,
        undo: () => undoAdd(id),
      });
    },
    change: async (old: Spend, currency: string, d: SpendDraft) => {
      const unsent = box.find(old.id);
      if (unsent?.kind === "spend") {
        box.change(old.id, () => ({ ...unsent, currency, draft: d }));
        await box.flush();
        return done(true, {
          text: "Spend changed",
          undo: async () => {
            if (box.has(old.id)) box.change(old.id, () => unsent);
            else await change(old.id, draftOf(old));
            return true;
          },
        });
      }
      const ok = await change(old.id, d);
      return done(ok, { text: "Spend changed", undo: () => change(old.id, draftOf(old)) });
    },
    remove: async (old: Spend) => {
      const unsent = box.find(old.id);
      if (unsent?.kind === "spend") {
        box.remove(old.id);
        return done(true, {
          text: "Spend deleted",
          undo: () => queue(unsent.id, unsent.currency, unsent.draft, unsent.queuedAt).then(() => true),
        });
      }
      const ok = await remove(old.id);
      return done(ok, {
        text: "Spend deleted",
        undo: () => queue(old.id, old.currency, draftOf(old)).then(() => true),
      });
    },
  };
}

export type SpendActions = ReturnType<typeof spendActions>;
