import { describe, expect, it } from "vitest";
import type { Money } from "../../src/money";

// Placeholder until backlog item 3 brings the first real rule, written test-first.
describe("money rules", () => {
  it("keeps amounts as whole minor units (ADR 0002)", () => {
    const m: Money = { minor: 185_000, currency: "LKR" };
    expect(Number.isInteger(m.minor)).toBe(true);
  });
});
