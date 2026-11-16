import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays, moveIntoCycle, unsentOutcome } from "../../src/money";

// Item 24 · Offline spends and payments (spec 11). Each case names the rule it checks (spec 16).

describe("moveIntoCycle: a spend sent after its cycle ended", () => {
  it("a spend dated in the current cycle stays on its day", () => {
    expect(moveIntoCycle("2026-11-28", "2026-11-25")).toEqual({ spentOn: "2026-11-28", movedFrom: null });
    expect(moveIntoCycle("2026-11-25", "2026-11-25")).toEqual({ spentOn: "2026-11-25", movedFrom: null });
  });

  it("a spend dated before the current cycle moves to its first day, keeping where it came from", () => {
    expect(moveIntoCycle("2026-11-24", "2026-11-25")).toEqual({
      spentOn: "2026-11-25",
      movedFrom: "2026-11-24",
    });
  });

  it("anything that is not a day is left for the spend check to refuse", () => {
    expect(moveIntoCycle("soon", "2026-11-25")).toEqual({ spentOn: "soon", movedFrom: null });
  });

  it("the day it ends on is never before the cycle's first day, and moves only when it was", () => {
    const day = fc.integer({ min: -400, max: 400 }).map((n) => addDays("2026-11-25", n));
    fc.assert(
      fc.property(day, day, (spentOn, startedOn) => {
        const out = moveIntoCycle(spentOn, startedOn);
        expect(out.spentOn >= startedOn).toBe(true);
        expect(out.movedFrom === null).toBe(spentOn >= startedOn);
      }),
      { seed: 20261116, numRuns: 2000 },
    );
  });
});

describe("unsentOutcome: what the phone does with the server's answer", () => {
  it("saved, or saved before (a resend), leaves the queue", () => {
    expect(unsentOutcome(201)).toBe("saved");
    expect(unsentOutcome(200)).toBe("saved");
  });

  it("no answer, a server fault or too many requests: try again later", () => {
    expect(unsentOutcome(null)).toBe("retry");
    expect(unsentOutcome(500)).toBe("retry");
    expect(unsentOutcome(503)).toBe("retry");
    expect(unsentOutcome(429)).toBe("retry");
  });

  it("the session has ended: wait until the user signs in again", () => {
    expect(unsentOutcome(401)).toBe("sign_in");
    expect(unsentOutcome(403)).toBe("sign_in");
  });

  it("it no longer fits (cycle ended, commitment removed or finished, refused by the rules): needs a look", () => {
    // 409 locked / not_open / conflict, 404 not_found, 400 invalid.
    expect(unsentOutcome(409)).toBe("look");
    expect(unsentOutcome(404)).toBe("look");
    expect(unsentOutcome(400)).toBe("look");
  });
});
