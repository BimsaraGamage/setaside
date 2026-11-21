import { api } from "./api";
import type { Commitment, Payment } from "./data";
import { newId } from "./id";
import type { Toaster } from "./toast";
import type { Outbox, PaymentDraft, UnsentItem } from "./unsent";

export type { PaymentDraft } from "./unsent";

/** Kinds made on the commitment page: a bill, or a savings set-aside (item 10). */
export type CommitmentKind = "bill" | "savings";

export interface CommitmentDraft {
  /** A card bill is made from its card's page (item 18). */
  kind: CommitmentKind | "card_bill";
  /** A card bill's card. */
  cardId?: string;
  name: string;
  plannedMinor: number;
  dueOn: string;
  /** The "Every cycle" switch (item 11). */
  everyCycle: boolean;
  /** Either currency (spec 8), only when it is made; none: the spending currency. */
  currency?: string;
}

type State = "open" | "finished";

const ok = async (res: Promise<Response | { ok: boolean }>) => (await res.catch(() => null))?.ok ?? false;

/** `recurringId`: the template "Every cycle" makes (a new id, or the old one when putting it back). */
const add = (id: string, { everyCycle, ...d }: CommitmentDraft, recurringId?: string | null) =>
  ok(
    api.api.commitments.$post({
      json: { id, ...d, recurringId: everyCycle ? (recurringId ?? newId()) : undefined },
    }),
  );
/** What PATCH takes: the kind only between a bill and savings; never the card or currency. */
type CommitmentChangeBody = Partial<Omit<CommitmentDraft, "kind" | "cardId" | "currency">> & {
  kind?: CommitmentKind;
  state?: State;
  recurringId?: string;
};
const change = (id: string, d: CommitmentChangeBody) =>
  ok(api.api.commitments[":id"].$patch({ param: { id }, json: d }));
const remove = (id: string) => ok(api.api.commitments[":id"].$delete({ param: { id } }));

const addPayment = (commitmentId: string, id: string, d: PaymentDraft, finish = false) =>
  ok(api.api.commitments[":id"].payments.$post({ param: { id: commitmentId }, json: { id, ...d, finish } }));
const changePayment = (id: string, d: Partial<PaymentDraft>) =>
  ok(api.api.payments[":id"].$patch({ param: { id }, json: d }));
const removePayment = (id: string) => ok(api.api.payments[":id"].$delete({ param: { id } }));

const draftOf = (c: Commitment): CommitmentDraft => ({
  kind: c.kind === "savings" || c.kind === "card_bill" ? c.kind : "bill",
  ...(c.kind === "card_bill" && c.cardId ? { cardId: c.cardId } : {}),
  name: c.name,
  plannedMinor: c.plannedMinor,
  dueOn: c.dueOn,
  everyCycle: c.recurringId !== null,
  currency: c.currency,
});
/**
 * What the commitment page changes: a payback to savings keeps its kind and never
 * repeats (item 14); a card bill keeps its kind and card (item 18).
 */
export type CommitmentChange = Pick<CommitmentDraft, "name" | "plannedMinor" | "dueOn"> &
  Partial<{ kind: CommitmentKind; everyCycle: boolean }>;
const changeOf = (c: Commitment): CommitmentChange => {
  const base = { name: c.name, plannedMinor: c.plannedMinor, dueOn: c.dueOn };
  if (c.kind === "savings_payback" || c.kind === "plan_payment" || c.kind === "person_payback") return base;
  if (c.kind === "card_bill") return { ...base, everyCycle: c.recurringId !== null };
  return { ...base, kind: c.kind === "savings" ? "savings" : "bill", everyCycle: c.recurringId !== null };
};
/** Puts a commitment's fields and its "Every cycle" switch back (the template keeps its id). */
const changeBack = (old: Commitment) =>
  change(old.id, { ...changeOf(old), recurringId: old.recurringId ?? undefined });
const paymentDraftOf = (p: Payment): PaymentDraft => ({
  amountMinor: p.amountMinor,
  paidOn: p.paidOn,
  currency: p.currency,
  placeId: p.placeId ?? null,
});

/** Steps in order; stops at the first that fails. */
async function all(steps: (() => Promise<boolean>)[]): Promise<boolean> {
  for (const step of steps) if (!(await step())) return false;
  return true;
}

/** Puts a deleted commitment back as it was: the row, its payments, then its state. */
const restore = (old: Commitment) =>
  all([
    () => add(old.id, draftOf(old), old.recurringId),
    ...old.payments.map((p) => () => addPayment(old.id, p.id, paymentDraftOf(p))),
    ...(old.state === "finished" ? [() => change(old.id, { state: "finished" })] : []),
  ]);

type UnsentPayment = Extract<UnsentItem, { kind: "payment" }>;

/**
 * Add, change, pay, finish and delete commitments; each success shows a toast with Undo. A payment goes
 * through the unsent queue (item 24, spec 11): saved on the phone, then sent; with no connection it waits
 * there. An unsent payment is changed or removed on the phone; a saved one only with a connection.
 */
export function commitmentActions({ done }: Toaster, box: Outbox) {
  const queue = async (item: UnsentPayment) => {
    box.add(item);
    await box.flush();
    return !box.has(item.id);
  };
  const unsentPayment = (id: string) => {
    const i = box.find(id);
    return i?.kind === "payment" ? i : undefined;
  };
  return {
    add: (id: string, d: CommitmentDraft) =>
      add(id, d).then((ok) => done(ok, { text: "Commitment saved", undo: () => remove(id) })),
    change: (old: Commitment, d: CommitmentChange) =>
      change(old.id, { ...d, recurringId: d.everyCycle && !old.recurringId ? newId() : undefined }).then(
        (ok) => done(ok, { text: "Commitment changed", undo: () => changeBack(old) }),
      ),
    remove: (old: Commitment) =>
      remove(old.id).then((ok) => done(ok, { text: "Commitment deleted", undo: () => restore(old) })),
    /** A payment, in full or in part; `finish` also marks the commitment finished. */
    pay: async (c: Commitment, id: string, d: PaymentDraft, finish: boolean) => {
      const sent = await queue({
        kind: "payment",
        id,
        commitmentId: c.id,
        commitmentName: c.name,
        commitmentCurrency: c.currency,
        draft: d,
        finish,
        queuedAt: Date.now(),
      });
      const saving = c.kind === "savings" || c.kind === "savings_payback";
      const look = box.get().look.some((i) => i.id === id);
      const text = !sent
        ? look
          ? "Payment not saved · needs a look"
          : "Payment saved on this phone · sends when back online"
        : finish
          ? `${c.name} ${saving ? "moved" : "paid"} · finished`
          : saving
            ? "Moved to savings"
            : "Payment saved";
      return done(true, {
        text,
        undo: async () =>
          box.remove(id) ||
          all([...(finish ? [() => change(c.id, { state: "open" })] : []), () => removePayment(id)]),
      });
    },
    changePayment: async (old: Payment, d: PaymentDraft) => {
      const unsent = unsentPayment(old.id);
      if (unsent) {
        box.change(old.id, () => ({ ...unsent, draft: d }));
        await box.flush();
        return done(true, {
          text: "Payment changed",
          undo: async () => {
            if (box.has(old.id)) box.change(old.id, () => unsent);
            else await changePayment(old.id, paymentDraftOf(old));
            return true;
          },
        });
      }
      const ok = await changePayment(old.id, d);
      return done(ok, { text: "Payment changed", undo: () => changePayment(old.id, paymentDraftOf(old)) });
    },
    removePayment: async (c: Commitment, old: Payment) => {
      const unsent = unsentPayment(old.id);
      if (unsent) {
        box.remove(old.id);
        return done(true, { text: "Payment deleted", undo: () => queue(unsent).then(() => true) });
      }
      const ok = await removePayment(old.id);
      const finished = c.state === "finished";
      return done(ok, {
        // The server reopens a finished one, so it is set aside again (SAB-57).
        text: finished ? `Payment deleted · ${c.name} open again` : "Payment deleted",
        // Undo: add it back, and finish it again in the same write.
        undo: () => addPayment(c.id, old.id, paymentDraftOf(old), finished),
      });
    },
    /** Sends a payment that needs a look to an open commitment instead (item 24). */
    payInstead: async (item: UnsentPayment, c: Commitment, paidOn: string) => {
      box.remove(item.id);
      const moved = {
        ...item,
        commitmentId: c.id,
        commitmentName: c.name,
        commitmentCurrency: c.currency,
        draft: { ...item.draft, paidOn, currency: item.draft.currency ?? item.commitmentCurrency },
        finish: false,
      };
      const sent = await queue(moved);
      return done(true, { text: sent ? `Payment saved to ${c.name}` : "Payment saved on this phone" });
    },
    finish: (c: Commitment) =>
      change(c.id, { state: "finished" }).then((ok) =>
        done(ok, { text: `${c.name} finished`, undo: () => change(c.id, { state: "open" }) }),
      ),
    reopen: (c: Commitment) =>
      change(c.id, { state: "open" }).then((ok) =>
        done(ok, { text: `${c.name} reopened`, undo: () => change(c.id, { state: "finished" }) }),
      ),
  };
}

export type CommitmentActions = ReturnType<typeof commitmentActions>;
