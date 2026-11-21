import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript script, no types
import { checkSet, STATUSES, setSql, WAIT_WORDS, waitSql } from "../../scripts/feedback-set.mjs";

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
    // A new status ends any wait note (SAB-66).
    expect(sql).toContain("waiting = null");
  });
});

// The feedback job's wait note (ticket SAB-66).
describe("wait note", () => {
  it("notes the reason and time on every new one, as text no quote can end", () => {
    const sql = waitSql(WAIT_WORDS.quota, 7);
    expect(sql).toContain(`waiting = cast(x'${Buffer.from(WAIT_WORDS.quota).toString("hex")}' as text)`);
    expect(sql).toContain("checked_at = 7");
    expect(sql.endsWith("where status = 'new'")).toBe(true);
  });

  it("clears it only where there is one", () => {
    expect(waitSql(null)).toBe(
      "update feedback set waiting = null where status = 'new' and waiting is not null",
    );
  });

  it("has words for each reason a pass skips, short enough for the row", () => {
    expect(Object.keys(WAIT_WORDS).sort()).toEqual(["login", "quota"]);
    for (const w of Object.values(WAIT_WORDS) as string[]) {
      expect(w.startsWith("Waiting: ")).toBe(true);
      expect(w.length).toBeLessThanOrEqual(80);
    }
  });
});
