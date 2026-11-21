import { useCallback, useRef, useState } from "react";

/** What the toast says and how its Undo puts things back (spec 2: the only undo is on screen). */
export interface Toast {
  text: string;
  undo?: () => Promise<boolean>;
  /** Something failed: the toast offers "Report this" (ticket SAB-55). */
  report?: boolean;
}

/** The one toast with Undo; every change reloads the numbers, then shows it. */
export function useToast(reload: () => Promise<void>) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((t: Toast | null) => {
    clearTimeout(timer.current);
    setToast(t);
    if (t) timer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  /** After a write: reload, and show the toast if it worked. Returns whether it worked. */
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
    done,
    /** A toast with only text. */
    say: (text: string) => show({ text }),
    dismiss: () => show(null),
    async undo() {
      if (!toast?.undo) return;
      const t = { undo: toast.undo };
      show(null);
      const ok = await t.undo();
      await reload();
      if (!ok) show({ text: "Couldn't undo. Check the connection.", report: true });
    },
  };
}

export type Toaster = ReturnType<typeof useToast>;
