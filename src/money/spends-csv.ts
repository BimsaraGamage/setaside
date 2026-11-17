import { type Minor, plainAmount } from "./amount";

/** One spend as the CSV shows it (item 27, spec 14): names, not ids. */
export interface CsvSpend {
  spentOn: string;
  amountMinor: Minor;
  currency: string;
  note: string | null;
  pot: string | null;
  card: string | null;
  oneOff: boolean;
  cycleStartedOn: string;
}

const HEADER = ["Date", "Amount", "Currency", "Note", "Pot", "Card", "One-off", "Cycle started"];

/** One CSV cell: quoted when needed; typed text never starts like a formula. */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The CSV of spends (spec 14): RFC 4180 lines, a byte-order mark so spreadsheet
 * apps read non-Latin notes, plain decimal amounts. Rows in the order given.
 */
export function spendsCsv(spends: CsvSpend[]): string {
  const rows = spends.map((s) => [
    s.spentOn,
    plainAmount(s.amountMinor, s.currency),
    s.currency,
    s.note ?? "",
    s.pot ?? "",
    s.card ?? "",
    s.oneOff ? "yes" : "",
    s.cycleStartedOn,
  ]);
  return `﻿${[HEADER, ...rows].map((r) => `${r.map(cell).join(",")}\r\n`).join("")}`;
}
