import type { Ready } from "./data";

/** The user's currencies (spec 8): the spending currency first, then the salary currency when it differs. */
export function currenciesOf(s: { spendingCurrency: string; salaryCurrency: string }): string[] {
  return s.salaryCurrency === s.spendingCurrency
    ? [s.spendingCurrency]
    : [s.spendingCurrency, s.salaryCurrency];
}

/** The money-rule checks' currency context for this user. */
export function currencyContext(data: Pick<Ready, "settings">) {
  const { spendingCurrency, salaryCurrency } = data.settings;
  return salaryCurrency === spendingCurrency ? { spendingCurrency } : { spendingCurrency, salaryCurrency };
}

/**
 * A choice of the user's two currencies (spec 8). Hidden with one currency:
 * "if they are the same, everything about conversions is hidden".
 */
export function CurrencyChoice({
  currencies,
  value,
  onChange,
  label = "Currency",
}: {
  currencies: string[];
  value: string;
  onChange: (c: string) => void;
  label?: string;
}) {
  if (currencies.length < 2) return null;
  return (
    <div className="row" role="radiogroup" aria-label={label}>
      {currencies.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          className={c === value ? "btn pri grow" : "btn grow"}
          onClick={() => onChange(c)}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
