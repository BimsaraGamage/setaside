// node analyze.mjs <profile> <n requests> : self time by source module, inclusive time by app function
import fs from "node:fs";
const [file, nStr] = process.argv.slice(2);
const n = Number(nStr);
const B = "/home/bimsara/.claude/jobs/efb138a6/tmp/.wrangler/tmp/dev-c56i7b/index.js";
const lines = fs.readFileSync(B, "utf8").split("\n");
const mods = [];
lines.forEach((l, i) => {
  const m = l.match(/^\/\/ (\S+\.(?:js|ts|mjs|cjs))$/);
  if (m) mods.push([i, m[1].replace(/^(\.\.\/)+/, "").replace(/.*node_modules\//, "nm:").replace(/.*sab-40-cpu\//, "")]);
});
const modOf = (line) => {
  let lo = 0, hi = mods.length - 1, r = "?";
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (mods[mid][0] <= line) { r = mods[mid][1]; lo = mid + 1; } else hi = mid - 1; }
  return r;
};
const short = (m) => (m.startsWith("nm:") ? m.slice(3).split("/").slice(0, m.includes("@") ? 2 : 1).join("/") : m);
const prof = JSON.parse(fs.readFileSync(file));
const byId = new Map(prof.nodes.map((x) => [x.id, x]));
const parent = new Map();
for (const x of prof.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
const selfT = new Map();
prof.samples.forEach((s, k) => selfT.set(s, (selfT.get(s) ?? 0) + (prof.timeDeltas[k] ?? 0)));
const label = (x) => {
  const f = x.callFrame;
  if (!f.url.endsWith("index.js")) return `[${f.functionName || "anon"}]`;
  return `${f.functionName || "anon"}@${short(modOf(f.lineNumber))}`;
};
const mod = new Map(), incl = new Map();
let busy = 0;
for (const [id, us] of selfT) {
  const x = byId.get(id);
  if (x.callFrame.functionName === "(idle)") continue;
  busy += us;
  const k = x.callFrame.url.endsWith("index.js") ? short(modOf(x.callFrame.lineNumber)) : `[${x.callFrame.functionName}]`;
  mod.set(k, (mod.get(k) ?? 0) + us);
  // inclusive: each distinct app-function label on the stack gets the time once
  const seen = new Set();
  for (let p = id; p !== undefined; p = parent.get(p)) {
    const y = byId.get(p);
    const m = y.callFrame.url.endsWith("index.js") ? modOf(y.callFrame.lineNumber) : "";
    if (m.startsWith("src/") || /better-auth|drizzle-orm\/(d1|sqlite-core\/session|relations|sqlite-core\/dialect)|hono/.test(m)) {
      const l = label(y);
      if (!seen.has(l)) { seen.add(l); incl.set(l, (incl.get(l) ?? 0) + us); }
    }
  }
}
const ms = (u) => (u / 1000 / n).toFixed(2);
console.log(`busy/req ${ms(busy)} ms`);
console.log("self by module:"); for (const [k, v] of [...mod].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${ms(v)} ${k}`);
console.log("inclusive:"); for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`  ${ms(v)} ${k}`);
