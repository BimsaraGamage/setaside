/** Amounts: whole minor units plus a currency code (ADR 0002). */
export type Minor = number;

export interface Money {
  minor: Minor;
  currency: string;
}

const currencies = new Set(Intl.supportedValuesOf("currency"));

/** A real ISO 4217 code, upper case. */
export function isCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && currencies.has(code);
}

const digitsCache = new Map<string, number>();

/** Digits after the point for this currency: LKR 2, JPY 0, KWD 3. */
export function minorDigits(currency: string): number {
  let d = digitsCache.get(currency);
  if (d === undefined) {
    d =
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ??
      2;
    digitsCache.set(currency, d);
  }
  return d;
}

/** One whole unit of the currency, in minor units (LKR 100, JPY 1). */
export function unitMinor(currency: string): Minor {
  return 10 ** minorDigits(currency);
}

/**
 * Reads a typed amount ("1,850.50") into minor units without floats.
 * Commas and spaces are ignored; negative, exponent or too many decimals → null.
 */
export function parseAmount(text: string, currency: string): Minor | null {
  const t = text.replace(/[,\s]/g, "");
  const m = /^(\d{1,13})(?:\.(\d+))?$/.exec(t);
  if (!m) return null;
  const digits = minorDigits(currency);
  const frac = m[2] ?? "";
  if (frac.length > digits) return null;
  return Number(m[1]) * 10 ** digits + Number(frac.padEnd(digits, "0") || "0");
}

const formatters = new Map<string, { whole: Intl.NumberFormat; exact: Intl.NumberFormat }>();

/** "Rs 1,850", "Rs 1,850.50", "$19.99": the symbol, and no ".00" on whole amounts. */
export function formatMoney(minor: Minor, currency: string): string {
  let f = formatters.get(currency);
  if (!f) {
    const base = { style: "currency", currency, currencyDisplay: "narrowSymbol" } as const;
    f = {
      whole: new Intl.NumberFormat("en", { ...base, maximumFractionDigits: 0 }),
      exact: new Intl.NumberFormat("en", base),
    };
    formatters.set(currency, f);
  }
  const unit = unitMinor(currency);
  const fmt = minor % unit === 0 ? f.whole : f.exact;
  return fmt.format(minor / unit).replace(/ /g, " ");
}
