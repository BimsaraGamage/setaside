import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // Money rules: pure TypeScript, plain Node.
        test: { name: "money", include: ["test/money/**/*.test.ts"], environment: "node" },
      },
      {
        // Server: Workers runtime with a local D1 and the real migrations.
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
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
