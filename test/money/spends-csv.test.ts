import { describe, expect, it } from "vitest";
import { type CsvSpend, plainAmount, spendsCsv } from "../../src/money";

// Item 27 · Download my data (spec 14): the CSV of spends.

const row = (s: Partial<CsvSpend> = {}): CsvSpend => ({
  spentOn: "2026-11-12",
  amountMinor: 185_050,
  currency: "LKR",
  note: "Lunch",
  pot: null,
  card: null,
  oneOff: false,
  cycleStartedOn: "2026-10-25",
  ...s,
});

const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n");

describe("plain amounts for a spreadsheet (spec 14)", () => {
  it("writes minor units as a plain decimal: no symbol, no commas", () => {
    expect(plainAmount(185_050, "LKR")).toBe("1850.50");
    expect(plainAmount(100, "USD")).toBe("1.00");
    expect(plainAmount(7, "USD")).toBe("0.07");
    expect(plainAmount(0, "LKR")).toBe("0.00");
    expect(plainAmount(1500, "JPY")).toBe("1500");
    expect(plainAmount(12_345, "KWD")).toBe("12.345");
  });

  it("keeps big amounts exact", () => {
    expect(plainAmount(999_999_999_999_99, "LKR")).toBe("999999999999.99");
  });
});

describe("CSV of spends (spec 14)", () => {
  it("has a header and one line per spend, in RFC 4180 lines", () => {
    const out = lines(spendsCsv([row(), row({ spentOn: "2026-11-13", note: null, oneOff: true })]));
    expect(out).toEqual([
      "Date,Amount,Currency,Note,Pot,Card,One-off,Cycle started",
      "2026-11-12,1850.50,LKR,Lunch,,,,2026-10-25",
      "2026-11-13,1850.50,LKR,,,,yes,2026-10-25",
      "",
    ]);
  });

  it("starts with a byte-order mark so spreadsheets read Sinhala and Tamil notes", () => {
    expect(spendsCsv([]).startsWith("﻿")).toBe(true);
  });

  it("names the pot and card, and the dollar pot's currency", () => {
    const out = lines(spendsCsv([row({ pot: "Fuel", card: "Visa", currency: "USD", amountMinor: 1999 })]));
    expect(out[1]).toBe("2026-11-12,19.99,USD,Lunch,Fuel,Visa,,2026-10-25");
  });

  it("quotes commas, quotes and line breaks", () => {
    const out = spendsCsv([row({ note: 'Rice, "red"\nand dhal', pot: "Food, home" })]);
    expect(out).toContain('"Rice, ""red""\nand dhal","Food, home"');
  });

  it("never lets a note run as a spreadsheet formula", () => {
    for (const note of ["=1+1", "+94 77", "-cash", "@SUM(A1)", "\tx", "\rx"]) {
      const cell = lines(spendsCsv([row({ note })]))[1]?.split(",")[3] ?? "";
      expect(cell.replace(/^"/, "").startsWith("'")).toBe(true);
    }
  });
});
