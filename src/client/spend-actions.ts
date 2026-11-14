import { useCallback, useRef, useState } from "react";
import { api } from "./api";
import type { Spend } from "./data";

export interface SpendDraft {
  spentOn: string;
  amountMinor: number;
  note: string | null;
}

/** What the toast says and how its Undo puts things back (spec 3: the only undo is on screen). */
export interface Toast {
  text: string;
  undo?: () => Promise<boolean>;
}

const add = async (id: string, d: SpendDraft) =>
  (await api.api.spends.$post({ json: { id, ...d } }).catch(() => null))?.ok ?? false;
const change = async (id: string, d: Partial<SpendDraft>) =>
  (await api.api.spends[":id"].$patch({ param: { id }, json: d }).catch(() => null))?.ok ?? false;
const remove = async (id: string) =>
  (await api.api.spends[":id"].$delete({ param: { id } }).catch(() => null))?.ok ?? false;

/** Add, change and delete spends; each success shows a toast with Undo. */
export function useSpendActions(reload: () => Promise<void>) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((t: Toast | null) => {
    clearTimeout(timer.current);
    setToast(t);
    if (t) timer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  const done = useCallback(
    async (ok: boolean, t: Toast) => {
      await reload();
      if (ok) show(t);
      return ok;
    },
    [reload, show],
  );

  return {
    toast,
    dismiss: () => show(null),
    async undo() {
      if (!toast?.undo) return;
      const t = { undo: toast.undo };
      show(null);
      const ok = await t.undo();
      await reload();
      if (!ok) show({ text: "Couldn't undo. Check the connection." });
    },
    add: (id: string, d: SpendDraft) =>
      add(id, d).then((ok) => done(ok, { text: "Spend saved", undo: () => remove(id) })),
    change: (old: Spend, d: SpendDraft) =>
      change(old.id, d).then((ok) =>
        done(ok, {
          text: "Spend changed",
          undo: () => change(old.id, { spentOn: old.spentOn, amountMinor: old.amountMinor, note: old.note }),
        }),
      ),
    remove: (old: Spend) =>
      remove(old.id).then((ok) =>
        done(ok, {
          text: "Spend deleted",
          undo: () => add(old.id, { spentOn: old.spentOn, amountMinor: old.amountMinor, note: old.note }),
        }),
      ),
  };
}

export type SpendActions = ReturnType<typeof useSpendActions>;
