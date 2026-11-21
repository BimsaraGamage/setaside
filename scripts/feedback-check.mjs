// The feedback job's checks (ticket SAB-61), run in a sandbox: code an AI edited runs here, so it gets no network,
// no home folder (no logins, keys or tokens), a read-only system, and write access to its own worktree only.
//
//   node <repo>/scripts/feedback-check.mjs test|typecheck|lint|format|test:money|test:server
//
// Run from the worktree (the current folder), which must sit under the job's work root. Needs bubblewrap (`bwrap`);
// without it nothing runs. The build run may only call this, and it lives in the main checkout, outside the
// worktree, so the build run can't change what it does.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const CHECKS = {
  test: ["test"],
  typecheck: ["run", "typecheck"],
  lint: ["run", "lint"],
  format: ["run", "format"],
  "test:money": ["run", "test:money"],
  "test:server": ["run", "test:server"],
};

/** Where the job keeps its worktrees: outside the home folder, so the AI's read rules can shut home out. */
export const workRoot = (uid = process.getuid?.() ?? 0) => `/var/tmp/setaside-feedback-${uid}`;

/** The bwrap command line for one check in `work`. */
export function sandboxArgs({ work, check, nodeDir, home }) {
  return [
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--tmpfs",
    "/var/tmp",
    "--tmpfs",
    home,
    "--tmpfs",
    "/run",
    "--ro-bind",
    nodeDir,
    nodeDir,
    "--bind",
    work,
    work,
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--chdir",
    work,
    "--clearenv",
    "--setenv",
    "PATH",
    `${nodeDir}/bin:/usr/bin:/bin`,
    "--setenv",
    "HOME",
    home,
    "--setenv",
    "CI",
    "1",
    "--",
    "npm",
    ...CHECKS[check],
  ];
}

/** Problems with running `check` in `work`, or none. */
export function checkProblems({ work, check, root }) {
  const p = [];
  if (!Object.hasOwn(CHECKS, check)) p.push(`The check is one of: ${Object.keys(CHECKS).join(", ")}.`);
  if (!work.startsWith(root + sep)) p.push(`Run it from a worktree under ${root}.`);
  return p;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const check = process.argv[2] ?? "";
  const work = realpathSync(process.cwd());
  const problems = checkProblems({ work, check, root: workRoot() });
  if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(2);
  }
  const nodeDir = dirname(dirname(realpathSync(process.execPath)));
  const home = process.env.HOME || "/home/nobody";
  const r = spawnSync("bwrap", sandboxArgs({ work, check, nodeDir, home }), { stdio: "inherit" });
  if (r.error) console.error(`No sandbox (bwrap): ${r.error.message}. Nothing ran.`);
  process.exit(r.status ?? 2);
}
