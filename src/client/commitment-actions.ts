import { api } from "./api";
import type { Commitment } from "./data";
import type { Toaster } from "./toast";

export interface CommitmentDraft {
  name: string;
  plannedMinor: number;
  dueOn: string;
}

const add = async (id: string, d: CommitmentDraft) =>
  (await api.api.commitments.$post({ json: { id, ...d } }).catch(() => null))?.ok ?? false;
const change = async (id: string, d: Partial<CommitmentDraft>) =>
  (await api.api.commitments[":id"].$patch({ param: { id }, json: d }).catch(() => null))?.ok ?? false;
const remove = async (id: string) =>
  (await api.api.commitments[":id"].$delete({ param: { id } }).catch(() => null))?.ok ?? false;

const draftOf = (c: Commitment): CommitmentDraft => ({
  name: c.name,
  plannedMinor: c.plannedMinor,
  dueOn: c.dueOn,
});

/** Add, change and delete commitments; each success shows a toast with Undo. */
export function commitmentActions({ done }: Toaster) {
  return {
    add: (id: string, d: CommitmentDraft) =>
      add(id, d).then((ok) => done(ok, { text: "Commitment saved", undo: () => remove(id) })),
    change: (old: Commitment, d: CommitmentDraft) =>
      change(old.id, d).then((ok) =>
        done(ok, { text: "Commitment changed", undo: () => change(old.id, draftOf(old)) }),
      ),
    remove: (old: Commitment) =>
      remove(old.id).then((ok) =>
        done(ok, { text: "Commitment deleted", undo: () => add(old.id, draftOf(old)) }),
      ),
  };
}

export type CommitmentActions = ReturnType<typeof commitmentActions>;
