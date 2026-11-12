import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("answers and reaches the database", async () => {
    const res = await exports.default.fetch("https://setaside.test/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ app: "setaside", database: true });
  });

  it("has the first migration applied", async () => {
    const { env } = await import("cloudflare:workers");
    const row = await env.DB.prepare("select count(*) as n from app_meta").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
