import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript script, no types
import { checkSet, STATUSES, setSql } from "../../scripts/feedback-set.mjs";

// npm run feedback -- --set (ticket SAB-60): checked before any SQL.

const id = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("feedback --set", () => {
  it("knows the same statuses as the app", () => {
    const schema = readFileSync(new URL("../../src/worker/db/schema.ts", import.meta.url), "utf8");
    const list = /FEEDBACK_STATUSES = \[([^\]]*)\] as const/.exec(schema)?.[1] ?? "";
    expect(STATUSES).toEqual([...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  });

  it("takes a good one", () => {
    expect(
      checkSet({ id, status: "planned", reply: "Planned: Next cycle preview", ticket: "SAB-61" }),
    ).toEqual([]);
    expect(checkSet({ id, status: "not doing" })).toEqual([]);
  });

  it("refuses a bad id, status, reply or ticket", () => {
    for (const bad of [
      { id: "x' or 1=1 --", status: "done" },
      { id, status: "fixed" },
      { id, status: "done", reply: "   " },
      { id, status: "done", reply: "x".repeat(281) },
      { id, status: "done", reply: "line one\nline two" },
      { id, status: "done", ticket: "SAB-61; drop table feedback" },
      { id, status: "done", ticket: "WTV-1" },
    ]) {
      expect(checkSet(bad).length).toBeGreaterThan(0);
    }
    expect(checkSet({ id, status: "done", reply: "é".repeat(280) })).toEqual([]);
  });

  it("writes text no quote can end, and leaves out what was not given", () => {
    const sql = setSql({ id, status: "done", reply: "It's fixed'); drop table feedback; --" }, 5);
    expect(sql).not.toContain("drop table");
    expect(sql).toContain(
      `reply = cast(x'${Buffer.from("It's fixed'); drop table feedback; --").toString("hex")}' as text)`,
    );
    expect(sql).toContain("updated_at = 5");
    expect(sql).not.toContain("ticket =");
    expect(sql.endsWith(`where id = '${id}'`)).toBe(true);
  });
});
