import { api } from "./api";
import type { Commitment, Payment } from "./data";
import { newId } from "./id";
import type { Toaster } from "./toast";

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

export interface PaymentDraft {
  amountMinor: number;
  paidOn: string;
  /** Either currency (item 17); none: the commitment's own. */
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
  if (c.kind === "savings_payback" || c.kind === "plan_payment") return base;
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

/** Add, change, pay, finish and delete commitments; each success shows a toast with Undo. */
export function commitmentActions({ done }: Toaster) {
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
    pay: (c: Commitment, id: string, d: PaymentDraft, finish: boolean) =>
      addPayment(c.id, id, d, finish).then((ok) =>
        done(ok, {
          text: finish
            ? `${c.name} ${c.kind === "savings" || c.kind === "savings_payback" ? "moved" : "paid"} · finished`
            : c.kind === "savings" || c.kind === "savings_payback"
              ? "Moved to savings"
              : "Payment saved",
          undo: () =>
            all([...(finish ? [() => change(c.id, { state: "open" })] : []), () => removePayment(id)]),
        }),
      ),
    changePayment: (old: Payment, d: PaymentDraft) =>
      changePayment(old.id, d).then((ok) =>
        done(ok, { text: "Payment changed", undo: () => changePayment(old.id, paymentDraftOf(old)) }),
      ),
    removePayment: (c: Commitment, old: Payment) =>
      removePayment(old.id).then((ok) =>
        done(ok, {
          text: "Payment deleted",
          // A finished one takes no payments: reopen, add it back, finish again.
          undo: () =>
            c.state === "finished"
              ? all([
                  () => change(c.id, { state: "open" }),
                  () => addPayment(c.id, old.id, paymentDraftOf(old), true),
                ])
              : addPayment(c.id, old.id, paymentDraftOf(old)),
        }),
      ),
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
