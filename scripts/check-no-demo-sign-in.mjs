// Fails if the production build still contains the local-only demo sign-in (spec 13).
// Run after `vite build`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const needles = ["/demo/sign-in", "demo.setaside.local", "local-development-only-secret"];
const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(m?js|html|json)$/.test(name)) {
      const text = readFileSync(p, "utf8");
      for (const n of needles) if (text.includes(n)) hits.push(`${p}: ${n}`);
    }
  }
}
walk("dist");
if (hits.length) {
  console.error("Demo sign-in found in the production build:\n" + hits.join("\n"));
  process.exit(1);
}
console.log("ok: no demo sign-in in dist/");
