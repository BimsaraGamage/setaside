import { describe, expect, it } from "vitest";
import { inHandFromPlaces, type PlaceTotal } from "../../src/money";

// Salary day step 3 "actually have in hand", started from the places (spec 6, ticket SAB-52).

const total = (differenceMinor: number | null): PlaceTotal => ({
  currency: "LKR",
  totalMinor: 0,
  appMinor: 0,
  differenceMinor,
});

describe("in hand from the places (spec 6)", () => {
  it("is the leftover moved by what the places hold more or less than the app counts", () => {
    // Places hold Rs 1,200 less than the app counts: spends never entered.
    expect(inHandFromPlaces(1_000_000, total(-120_000))).toBe(880_000);
    // Places hold more: money came in that was never entered.
    expect(inHandFromPlaces(1_000_000, total(50_000))).toBe(1_050_000);
  });

  it("never goes below zero", () => {
    expect(inHandFromPlaces(100_000, total(-250_000))).toBe(0);
  });

  it("is nothing when the places match the app: the leftover stands", () => {
    expect(inHandFromPlaces(1_000_000, total(0))).toBeNull();
  });

  it("is nothing with no place in that currency, or a place with no balance yet", () => {
    expect(inHandFromPlaces(1_000_000, undefined)).toBeNull();
    expect(inHandFromPlaces(1_000_000, total(null))).toBeNull();
  });

  it("is nothing on an overspend: there is no leftover to correct", () => {
    expect(inHandFromPlaces(-5_000, total(-120_000))).toBeNull();
  });
});
