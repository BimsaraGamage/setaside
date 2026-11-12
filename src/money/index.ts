/**
 * Money rules: one pure module, no browser or Worker APIs (ADR 0003).
 * The phone runs it to show every number; the server runs it to check writes.
 * Amounts are whole minor units plus a currency code (ADR 0002).
 */
export * from "./amount";
export * from "./cycle";
export * from "./days";
