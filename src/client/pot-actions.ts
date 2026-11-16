import { api } from "./api";
import type { Pot } from "./data";
import { newId } from "./id";
import type { Toaster } from "./toast";

export interface PotDraft {
  name: string;
  usualAmountMinor: number;
  /** This cycle's amount. */
  amountMinor: number;
  /** Either currency (spec 8), only when it is made; none: the spending currency. */
  currency?: string;
}

const ok = async (res: Promise<Response | { ok: boolean }>) => (await res.catch(() => null))?.ok ?? false;

const add = (id: string, d: PotDraft) =>
  ok(api.api.pots.$post({ json: { id, allocationId: newId(), ...d } }));
const change = (id: string, d: Partial<PotDraft> & { archived?: boolean }) =>
  ok(api.api.pots[":id"].$patch({ param: { id }, json: { ...d, allocationId: newId() } }));
const remove = (id: string) => ok(api.api.pots[":id"].$delete({ param: { id } }));

const draftOf = (p: Pot): Partial<PotDraft> => ({
  name: p.name,
  usualAmountMinor: p.usualAmountMinor,
  ...(p.amountMinor === null ? {} : { amountMinor: p.amountMinor }),
});

/** New, change, stop using, use again and delete pots; each success shows a toast with Undo. */
export function potActions({ done }: Toaster) {
  return {
    add: (id: string, d: PotDraft) =>
      add(id, d).then((ok) => done(ok, { text: `${d.name} pot saved`, undo: () => remove(id) })),
    change: (old: Pot, d: PotDraft) =>
      change(old.id, d).then((ok) =>
        done(ok, { text: "Pot changed", undo: () => change(old.id, draftOf(old)) }),
      ),
    /** "Stop using this pot": what is left goes back to free money. */
    stop: (p: Pot) =>
      change(p.id, { archived: true }).then((ok) =>
        done(ok, { text: `Stopped using ${p.name}`, undo: () => change(p.id, { archived: false }) }),
      ),
    /** Use it again, with the page's amounts; this cycle's amount is set aside again. */
    useAgain: (p: Pot, d: PotDraft) =>
      change(p.id, { ...d, archived: false }).then((ok) =>
        done(ok, {
          text: `Using ${p.name} again`,
          undo: () => change(p.id, { archived: true, ...draftOf(p) }),
        }),
      ),
    /** Only a pot with no spends; Undo makes it again with its amounts. */
    remove: (p: Pot) =>
      remove(p.id).then((ok) =>
        done(ok, {
          text: `${p.name} pot deleted`,
          undo: () =>
            add(p.id, {
              name: p.name,
              usualAmountMinor: p.usualAmountMinor,
              amountMinor: p.amountMinor ?? 0,
              currency: p.currency,
            }),
        }),
      ),
  };
}

export type PotActions = ReturnType<typeof potActions>;
