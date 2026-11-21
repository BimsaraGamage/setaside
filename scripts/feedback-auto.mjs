// The feedback job (ticket SAB-61): one pass, run every 5 minutes by `setaside-feedback.timer`.
//
//   SETASIDE_MAP=<map folder> npm run feedback:auto          one pass
//   SETASIDE_MAP=<map folder> npm run feedback:auto -- --local   against the local database (npm run dev)
//
// Off unless SETASIDE_MAP names the wayfinder map folder the job charts tickets on. What a pass does, and what it
// never does: scripts/feedback-auto-core.mjs. Its state (lock, run log with each run's cost) lives in
// $XDG_STATE_HOME/setaside-feedback (default ~/.local/state/setaside-feedback); each run's worktree and copies
// in /var/tmp/setaside-feedback-<uid>/, outside the home folder. Needs bubblewrap (`bwrap`) for its checks.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { quotaGate, runPass } from "./feedback-auto-core.mjs";
import { workRoot } from "./feedback-check.mjs";

const { values } = parseArgs({ options: { local: { type: "boolean", default: false } } });

const mapDir = process.env.SETASIDE_MAP;
if (!mapDir) {
  console.log("Off: set SETASIDE_MAP to the map folder to turn the feedback job on.");
  process.exit(0);
}
if (!existsSync(join(mapDir, "map.md"))) {
  console.error(`No map.md in ${mapDir}.`);
  process.exit(1);
}

const repo = resolve(import.meta.dirname, "..");
const home = process.env.HOME || homedir();
const stateDir = join(process.env.XDG_STATE_HOME || join(home, ".local/state"), "setaside-feedback");
const where = values.local ? "--local" : "--remote";
const checker = join(repo, "scripts", "feedback-check.mjs");
if (spawnSync("bwrap", ["--version"]).status !== 0) {
  console.error("Off: the feedback job needs bubblewrap (bwrap) to run its checks in a sandbox.");
  process.exit(1);
}

const sh = (cmd, args, cwd = repo) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

await runPass({
  repo,
  mapDir: resolve(mapDir),
  inboxRoot: join(repo, "feedback-inbox"),
  stateDir,
  workRoot: workRoot(),
  checker,
  check: (name, work) => {
    const r = spawnSync(process.execPath, [checker, name], {
      cwd: work,
      stdio: "ignore",
      timeout: 20 * 60_000,
    });
    return { code: r.status ?? 1 };
  },
  d1: (sql) =>
    JSON.parse(sh("npx", ["wrangler", "d1", "execute", "DB", where, "--json", "--command", sql])).flatMap(
      (r) => r.results ?? [],
    ),
  set: ({ id, status, reply, ticket }) => {
    const args = ["scripts/feedback.mjs", "--set", id, "--status", status];
    if (reply !== undefined) args.push("--reply", reply);
    if (ticket !== undefined) args.push("--ticket", ticket);
    if (values.local) args.push("--local");
    sh(process.execPath, args);
  },
  inbox: () => sh(process.execPath, ["scripts/feedback.mjs", ...(values.local ? ["--local"] : [])]),
  git: (args, cwd = repo) => sh("git", args, cwd),
  claude: ([cmd, ...args], { cwd, timeoutMs }) => {
    const r = spawnSync(cmd, args, {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      code: r.status ?? 1,
      stdout: r.stdout ?? "",
      stderr: `${r.stderr ?? ""}${r.error ? `\n${r.error.message}` : ""}`,
    };
  },
  npm: (args, cwd, timeoutMs) => {
    const r = spawnSync("npm", args, {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  },
  loggedIn: () => {
    try {
      const r = spawnSync("claude", ["auth", "status", "--json"], { encoding: "utf8", timeout: 60_000 });
      return Boolean(JSON.parse(r.stdout || "{}").loggedIn);
    } catch {
      return true; // can't tell: let the run say it
    }
  },
  gate: () => {
    let claudeJson = "{}";
    try {
      claudeJson = readFileSync(join(home, ".claude.json"), "utf8");
    } catch {
      // no file: go ahead
    }
    return quotaGate({
      claudeJson,
      cacheDir: join(process.env.XDG_DATA_HOME || join(home, ".local/share"), "cqm", "cache"),
      now: Date.now(),
      sha256: (t) => createHash("sha256").update(t).digest("hex"),
    });
  },
  notify: (title, body) => spawnSync("notify-send", ["-a", "setaside", title, body], { timeout: 10_000 }),
  log: (entry) => appendFileSync(join(stateDir, "runs.jsonl"), `${JSON.stringify(entry)}\n`),
  say: (line) => console.log(line),
  now: () => Date.now(),
});
