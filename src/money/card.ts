import { type Currencies, isUsersCurrency, type Minor } from "./amount";
import { type CommitmentEntry, coveredMinor, stillToPayMinor } from "./commitment";
import type { SpendEntry } from "./spend";

/** One `card` row (spec 9), with what it owed at the end of the cycles before this one. */
export interface CardEntry {
  id: string;
  currency: string;
  /** "Stop using this card": not offered on the spend sheet. */
  archived: boolean;
  /** Card spends less card bill payments of ended cycles (worked out by the server). */
  earlierMinor: Minor;
}

/** A commitment as the card rules need it: its kind and card. */
export type CardBillEntry = CommitmentEntry & { kind?: string; cardId?: string | null };

/**
 * A card bill (spec 9): its money is held, not set aside. The card spends it pays
 * for already came out of free money, so neither the bill nor its payments touch
 * free money, the gap or the leftover.
 */
export function isCardBill(c: { kind?: string }): boolean {
  return c.kind === "card_bill";
}

/**
 * Card balance (spec 9): what is owed on one card. Its card spends add to it,
 * payments on its card bills take it down; ended cycles' part is `earlierMinor`.
 * Below zero the card is in credit (a spend deleted after its bill was paid).
 */
export function cardBalanceMinor(
  card: Pick<CardEntry, "id" | "earlierMinor">,
  spends: (SpendEntry & { cardId?: string | null })[],
  commitments: CardBillEntry[],
): Minor {
  let total = card.earlierMinor;
  for (const s of spends) if (s.cardId === card.id) total += s.amountMinor;
  for (const c of commitments) if (isCardBill(c) && c.cardId === card.id) total -= coveredMinor(c);
  return total;
}

/**
 * Money held for card balances in one currency (spec 6): not part of free money
 * or the leftover; a card in credit holds nothing.
 */
export function heldForCardsMinor(
  cards: CardEntry[],
  spends: (SpendEntry & { cardId?: string | null })[],
  commitments: CardBillEntry[],
  currency: string,
): Minor {
  let total = 0;
  for (const card of cards) {
    if (card.currency === currency) total += Math.max(0, cardBalanceMinor(card, spends, commitments));
  }
  return total;
}

/**
 * A new card bill's amount (spec 9): filled from the card balance, less what the
 * card's other open bills still owe (a carried one already holds that part).
 */
export function cardBillFillMinor(balanceMinor: Minor, otherOpenBills: CommitmentEntry[]): Minor {
  let rest = balanceMinor;
  for (const c of otherOpenBills) if (c.state === "open") rest -= stillToPayMinor(c);
  return Math.max(0, rest);
}

export interface CardInput {
  name: string;
  currency: string;
}

export type CardProblem = "name" | "currency";

export const CARD_NAME_MAX = 40;

/** Checks a new or changed card (spec 9). The phone shows the problems; the server refuses them. */
export function checkCard(input: CardInput, ctx: Currencies): CardProblem[] {
  const out: CardProblem[] = [];
  const name = input.name.trim();
  if (!name || name.length > CARD_NAME_MAX) out.push("name");
  if (!isUsersCurrency(input.currency, ctx)) out.push("currency");
  return out;
}
