import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/** A throwaway VAPID key pair for the server tests (phone alerts, item 26); made fresh each run. */
async function testVapid() {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const raw = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  return { VAPID_PUBLIC_KEY: raw.toString("base64url"), VAPID_PRIVATE_KEY: jwk.d ?? "" };
}

export default defineConfig({
  test: {
    projects: [
      {
        // Money rules: pure TypeScript, plain Node.
        test: { name: "money", include: ["test/money/**/*.test.ts"], environment: "node" },
      },
      {
        // Scripts run by hand or by a timer (`scripts/`): plain Node, no database.
        test: { name: "scripts", include: ["test/scripts/**/*.test.ts"], environment: "node" },
      },
      {
        // Server: Workers runtime with a local D1 and the real migrations.
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
                ...(await testVapid()),
              },
            },
          })),
        ],
        test: {
          name: "server",
          include: ["test/server/**/*.test.ts"],
          setupFiles: ["./test/server/apply-migrations.ts"],
        },
      },
    ],
  },
});
