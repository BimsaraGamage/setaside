import { api } from "./api";
import type { Spend } from "./data";
import type { Toaster } from "./toast";

export interface SpendDraft {
  spentOn: string;
  amountMinor: number;
  note: string | null;
  /** The pot it comes from; null means free money (item 7). */
  potId: string | null;
}

const add = async (id: string, d: SpendDraft) =>
  (await api.api.spends.$post({ json: { id, ...d } }).catch(() => null))?.ok ?? false;
const change = async (id: string, d: Partial<SpendDraft>) =>
  (await api.api.spends[":id"].$patch({ param: { id }, json: d }).catch(() => null))?.ok ?? false;
const remove = async (id: string) =>
  (await api.api.spends[":id"].$delete({ param: { id } }).catch(() => null))?.ok ?? false;

const draftOf = (s: Spend): SpendDraft => ({
  spentOn: s.spentOn,
  amountMinor: s.amountMinor,
  note: s.note,
  potId: s.potId,
});

/** Add, change and delete spends; each success shows a toast with Undo. */
export function spendActions({ done }: Toaster) {
  return {
    add: (id: string, d: SpendDraft) =>
      add(id, d).then((ok) => done(ok, { text: "Spend saved", undo: () => remove(id) })),
    change: (old: Spend, d: SpendDraft) =>
      change(old.id, d).then((ok) =>
        done(ok, { text: "Spend changed", undo: () => change(old.id, draftOf(old)) }),
      ),
    remove: (old: Spend) =>
      remove(old.id).then((ok) => done(ok, { text: "Spend deleted", undo: () => add(old.id, draftOf(old)) })),
  };
}

export type SpendActions = ReturnType<typeof spendActions>;
