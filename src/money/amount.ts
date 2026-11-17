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

/** The user's currencies (spec 8): the spending currency, and the salary currency when it differs. */
export interface Currencies {
  spendingCurrency: string;
  salaryCurrency?: string;
}

/** Whether `code` is one of the user's two currencies (at most two per user, spec 8). */
export function isUsersCurrency(code: string, ctx: Currencies): boolean {
  return code === ctx.spendingCurrency || (ctx.salaryCurrency !== undefined && code === ctx.salaryCurrency);
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

/** "1850.50", "1500" (JPY): a plain decimal for files and spreadsheets, no symbol or commas, no floats. */
export function plainAmount(minor: Minor, currency: string): string {
  const digits = minorDigits(currency);
  const text = String(Math.abs(minor)).padStart(digits + 1, "0");
  const whole = text.slice(0, text.length - digits);
  const sign = minor < 0 ? "-" : "";
  return digits ? `${sign}${whole}.${text.slice(-digits)}` : `${sign}${whole}`;
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
