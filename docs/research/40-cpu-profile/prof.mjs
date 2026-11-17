// CPU-profile the local workerd through its inspector while sending requests.
// usage: node prof.mjs <label> <n> <method> <path> [jsonBody]
import fs from "node:fs";
import { createRequire } from "node:module";
const WS = createRequire("/home/bimsara/projects/AI/setaside/package.json")("ws");
const [label, nStr, method, path, body] = process.argv.slice(2);
const n = Number(nStr);
const JAR = "/home/bimsara/.claude/jobs/efb138a6/tmp/jar";
const cookie = fs
  .readFileSync(JAR, "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("# ") && l.split("\t").length >= 7)
  .map((l) => {
    const p = l.split("\t");
    return `${p[5]}=${p[6]}`;
  })
  .join("; ");
const targets = await (await fetch("http://127.0.0.1:9339/json")).json();
const t = targets.find((x) => x.webSocketDebuggerUrl) ?? targets[0];
const ws = new WS(t.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const req = async (i) => {
  const b = body?.replaceAll("$i", String(i).padStart(4, "0"));
  const res = await fetch(`http://localhost:8799${path}`, {
    method,
    headers: { cookie, origin: "http://localhost:8799", ...(b ? { "content-type": "application/json" } : {}) },
    body: b,
  });
  await res.arrayBuffer();
  return res.status;
};
// warm up (JIT, auth cache, first-request costs)
for (let i = 0; i < 3; i++) await req(1000 + i);
await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 50 });
await send("Profiler.start");
const statuses = [];
const t0 = performance.now();
for (let i = 0; i < n; i++) statuses.push(await req(i));
const wall = performance.now() - t0;
const { result } = await send("Profiler.stop");
ws.close();
const prof = result.profile;
const dt = prof.timeDeltas;
const self = new Map();
const byId = new Map(prof.nodes.map((x) => [x.id, x]));
const counts = new Map();
prof.samples.forEach((s, k) => counts.set(s, (counts.get(s) ?? 0) + (dt[k] ?? 0)));
let busy = 0;
for (const [nodeId, us] of counts) {
  const node = byId.get(nodeId);
  const f = node.callFrame;
  if (f.functionName === "(idle)" || f.functionName === "(program)" || f.functionName === "(garbage collector)") {
    if (f.functionName !== "(idle)") self.set(f.functionName, (self.get(f.functionName) ?? 0) + us);
    if (f.functionName === "(idle)") continue;
  }
  busy += us;
  const file = (f.url || "").split("/").slice(-1)[0];
  const key = `${f.functionName || "(anon)"} ${file}:${f.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + us);
}
// group by package from url
const pkg = new Map();
for (const [nodeId, us] of counts) {
  const f = byId.get(nodeId).callFrame;
  if (f.functionName === "(idle)") continue;
  const u = f.url || f.functionName;
  const m = u.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  const k = m ? m[1] : u.includes("src/") ? `app:${u.split("src/")[1]}` : u.split("/").slice(-1)[0] || f.functionName;
  pkg.set(k, (pkg.get(k) ?? 0) + us);
}
fs.writeFileSync(`/home/bimsara/.claude/jobs/efb138a6/tmp/${label}.cpuprofile`, JSON.stringify(prof));
const ms = (us) => (us / 1000).toFixed(2);
console.log(`${label}: ${n}x ${method} ${path} statuses=${[...new Set(statuses)]} wall/req=${(wall / n).toFixed(1)}ms CPU(non-idle)/req=${ms(busy / n)}ms`);
console.log(" by source (ms/req):", [...pkg].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}=${ms(v / n)}`).join(", "));
console.log(" top self (ms/req):");
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${ms(v / n)}  ${k}`);
