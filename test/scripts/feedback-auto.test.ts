import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBash,
  buildCommand,
  checkDecision,
  DENIED,
  doneStep,
  FIXED_REPLY,
  looksSecret,
  quotaGate,
  refusedChanges,
  runPass,
  SAFE_GIT,
  triageCommand,
  // @ts-expect-error plain JavaScript script, no types
} from "../../scripts/feedback-auto-core.mjs";
// @ts-expect-error plain JavaScript script, no types
import { checkProblems, sandboxArgs } from "../../scripts/feedback-check.mjs";

/** A git call without the hardening flags in front, so tests read what it does. */
const bare = (args: string[]) =>
  args[0] === SAFE_GIT[0] && args[1] === SAFE_GIT[1] ? args.slice(SAFE_GIT.length) : args;

// The feedback job (ticket SAB-61): the decision's shape, the Claude command lines, and whole passes with
// everything outside faked, so no test calls Claude, wrangler or the network.

const id = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const later = "11111111-2222-4333-8444-555555555555";

const decision = (over: Record<string, string> = {}) => ({
  kind: "idea",
  action: "plan",
  ticket: "",
  title: "Show the week's spends on Today",
  question: "They want to see this week's spends on Today.\n\nDone when Today shows them.",
  touches: "today",
  commit: "",
  reply: "Planned: Show the week's spends on Today",
  why: "A new part of a screen: a person decides first.",
  ...over,
});

describe("the triage decision", () => {
  it("takes good ones", () => {
    expect(checkDecision(decision())).toEqual([]);
    expect(checkDecision(decision({ action: "link", kind: "duplicate", ticket: "SAB-57" }))).toEqual([]);
    expect(
      checkDecision(decision({ action: "build", kind: "bug", commit: "fix: the week total counts today" })),
    ).toEqual([]);
    expect(
      checkDecision(
        decision({ action: "later", title: "", touches: "", question: "Something about charts" }),
      ),
    ).toEqual([]);
    expect(
      checkDecision(decision({ action: "not doing", kind: "other", title: "", question: "", touches: "" })),
    ).toEqual([]);
  });

  it("refuses the wrong shape", () => {
    for (const bad of [
      null,
      "build it",
      { ...decision(), reply: undefined },
      decision({ action: "deploy" }),
      decision({ kind: "urgent" }),
      decision({ reply: "" }),
      decision({ reply: "x".repeat(281) }),
      decision({ reply: "one\ntwo" }),
      decision({ action: "link", ticket: "SAB-57; rm -rf /" }),
      decision({ action: "link", ticket: "WTV-1" }),
      decision({ ticket: "SAB-3" }),
      decision({ title: "" }),
      decision({ title: "a\nb" }),
      decision({ touches: "everything, all of it, and more, plus" }),
      decision({ action: "build", commit: "" }),
      decision({ action: "build", commit: "chore: release 9.9.9" }),
      decision({ action: "build", commit: "fix: x\n\nCo-Authored-By: someone" }),
      decision({ commit: "fix: only for build" }),
      decision({ action: "later", question: "line one\nline two" }),
    ]) {
      expect(checkDecision(bad).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
});

describe("the Claude command lines", () => {
  const triage = triageCommand({ id, inboxDir: "/inbox/x", mapDir: "/map" });
  const build = buildCommand({
    id,
    work: "/var/tmp/setaside-feedback-1000/0a1b2c3d/work",
    checker: "/repo/scripts/feedback-check.mjs",
    ticketCode: "SAB-70",
    ticketTitle: "T",
    question: "Q",
  });
  const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
  const list = (args: string[], flag: string) => {
    const from = args.indexOf(flag) + 1;
    const end = args.findIndex((a, i) => i >= from && a.startsWith("--"));
    return args.slice(from, end === -1 ? undefined : end);
  };

  it("run Opus 5.5 at medium, no prompts, user settings only, no MCP", () => {
    for (const args of [triage, build]) {
      expect(args[0]).toBe("claude");
      expect(after(args, "--model")).toBe("claude-opus-5-5");
      expect(after(args, "--effort")).toBe("medium");
      expect(after(args, "--permission-mode")).toBe("dontAsk");
      expect(after(args, "--setting-sources")).toBe("user");
      expect(args).toContain("--strict-mcp-config");
      expect(Number(after(args, "--max-budget-usd"))).toBeGreaterThan(0);
    }
  });

  it("deny the web, Cloudflare, GitHub, pushing and deploying in both", () => {
    for (const args of [triage, build]) {
      const denied = list(args, "--disallowedTools");
      expect(denied.slice(0, DENIED.length)).toEqual(DENIED);
      for (const t of [
        "WebFetch",
        "WebSearch",
        "Bash(wrangler:*)",
        "Bash(npx:*)",
        "Bash(gh:*)",
        "Bash(curl:*)",
        "Bash(git push:*)",
        "Bash(npm run deploy:*)",
        "Read(//home/**)",
        "Read(//proc/**)",
        "Read(//run/**)",
        "Read(//tmp/**)",
      ])
        expect(denied).toContain(t);
    }
  });

  it("give triage only reading tools and a fixed answer shape", () => {
    expect(after(triage, "--tools")).toBe("Read,Grep,Glob");
    expect(list(triage, "--allowedTools")).toEqual(["Read", "Grep", "Glob"]);
    expect(JSON.parse(after(triage, "--json-schema") ?? "{}").required).toContain("action");
    expect(list(triage, "--add-dir")).toEqual(["/inbox/x", "/map"]);
  });

  it("let build edit only its worktree and start only the sandboxed checker: no git, no npm", () => {
    const w = "//var/tmp/setaside-feedback-1000/0a1b2c3d/work";
    const allowed = list(build, "--allowedTools");
    expect(allowed).toEqual([
      "Read",
      "Grep",
      "Glob",
      ...buildBash("/repo/scripts/feedback-check.mjs"),
      `Edit(${w}/**)`,
      `Write(${w}/**)`,
    ]);
    for (const t of allowed.filter((a: string) => a.startsWith("Bash(")))
      expect(t).toMatch(/^Bash\(node \/repo\/scripts\/feedback-check\.mjs [a-z:]+:\*\)$/);
    const denied = list(build, "--disallowedTools");
    for (const t of [`Edit(${w}/.git)`, `Write(${w}/.git)`, `Edit(${w}/.git/**)`, "Bash(git:*)"])
      expect(denied).toContain(t);
    expect(build).not.toContain("--add-dir");
  });
});

describe("what a fix may change", () => {
  it("only files in src/, test/ and e2e/", () => {
    expect(refusedChanges(" M src/client/Today.tsx\0?? test/money/x.test.ts\0 M e2e/a.spec.ts\0")).toEqual(
      [],
    );
    expect(
      refusedChanges(
        " M package.json\0 M package-lock.json\0?? .github/workflows/x.yml\0 M vitest.config.ts\0" +
          " M scripts/feedback-check.mjs\0 M migrations/0028.sql\0?? src/.npmrc\0 M docs/spec.md\0" +
          "?? test/node_modules/x/index.js\0",
      ),
    ).toEqual([
      "package.json",
      "package-lock.json",
      ".github/workflows/x.yml",
      "vitest.config.ts",
      "scripts/feedback-check.mjs",
      "migrations/0028.sql",
      "src/.npmrc",
      "docs/spec.md",
      "test/node_modules/x/index.js",
    ]);
  });
});

describe("text sent back or pushed", () => {
  it("is caught when it looks like a key, a token or an address", () => {
    for (const bad of [
      "Your key is sk-ant-api03-abcdefghijklmnop",
      "token ghp_1234567890abcdefghij",
      "write to someone@example.com",
      "x".repeat(40),
      "-----BEGIN OPENSSH PRIVATE KEY-----",
    ])
      expect(looksSecret(bad), bad).toBe(true);
    for (const ok of ["Thanks: planned as Show the week's spends on Today", "Fixed in v0.1.9."])
      expect(looksSecret(ok), ok).toBe(false);
  });
});

describe("the sandboxed checker", () => {
  const args = sandboxArgs({
    work: "/var/tmp/setaside-feedback-1000/0a1b2c3d/work",
    check: "test",
    nodeDir: "/home/me/.nvm/versions/node/v24",
    home: "/home/me",
  });
  const pairs = (flag: string) => args.flatMap((a: string, i: number) => (a === flag ? [args[i + 1]] : []));

  it("has no network, an empty home, and writes only to the worktree", () => {
    expect(args).toContain("--unshare-all");
    expect(args).toContain("--clearenv");
    expect(pairs("--tmpfs")).toEqual(
      expect.arrayContaining(["/home/me", "/home", "/tmp", "/var", "/run", "/opt", "/srv", "/mnt", "/media"]),
    );
    expect(pairs("--bind")).toEqual(["/var/tmp/setaside-feedback-1000/0a1b2c3d/work"]);
    // the worktree's .git link is read-only inside, and mounted after the worktree so it wins
    const ro = args.lastIndexOf("/var/tmp/setaside-feedback-1000/0a1b2c3d/work/.git");
    expect(args[ro - 2]).toBe("--ro-bind");
    expect(ro).toBeGreaterThan(args.indexOf("--bind"));
    expect(args.slice(args.indexOf("--") + 1)).toEqual(["npm", "test"]);
  });

  it("runs only a known check, only in a worktree under the work root", () => {
    const root = "/var/tmp/setaside-feedback-1000";
    expect(checkProblems({ work: `${root}/0a1b2c3d/work`, check: "lint", root })).toEqual([]);
    expect(checkProblems({ work: `${root}/0a1b2c3d/work`, check: "deploy", root }).length).toBe(1);
    expect(checkProblems({ work: "/home/me/setaside", check: "test", root }).length).toBe(1);
    expect(checkProblems({ work: `${root}-evil/x`, check: "test", root }).length).toBe(1);
  });
});

/** A map folder with one open and one resolved ticket. */
function fakeMap() {
  const dir = mkdtempSync(join(tmpdir(), "fb-map-"));
  mkdirSync(join(dir, "issues"));
  writeFileSync(
    join(dir, "map.md"),
    "# Map\n\n## Notes\n\n- x\n\n## Not yet specified\n\n- old fog\n\n## Out of scope\n\n- y\n",
  );
  writeFileSync(
    join(dir, "issues", "57-open-one.md"),
    "# 57 · Open one\n\nType: task\nBlocked by: none\nSessions: a (claimed)\nMap: [map.md](../map.md)\n\n## Question\n\nQ\n",
  );
  writeFileSync(
    join(dir, "issues", "58-closed-one.md"),
    "# 58 · Closed one\n\nType: task\nBlocked by: none\nSessions: a\n\n## Question\n\nQ\n\n## Answer\n\nDone.\n",
  );
  return dir;
}

type Change = { id: string; status: string; reply?: string; ticket?: string };

function fakeDeps(rows: { id: string; status: string }[], answer?: unknown) {
  const calls = {
    claude: [] as string[][],
    set: [] as Change[],
    git: [] as string[][],
    said: [] as string[],
  };
  const mapDir = fakeMap();
  const inboxRoot = mkdtempSync(join(tmpdir(), "fb-inbox-"));
  for (const r of rows) {
    mkdirSync(join(inboxRoot, r.id));
    writeFileSync(join(inboxRoot, r.id, "note.md"), "# Idea\n");
  }
  const deps = {
    repo: "/repo",
    mapDir,
    inboxRoot,
    stateDir: mkdtempSync(join(tmpdir(), "fb-state-")),
    workRoot: join(mkdtempSync(join(tmpdir(), "fb-work-")), "root"),
    checker: "/repo/scripts/feedback-check.mjs",
    check: () => ({ code: 0 }),
    d1: () => rows,
    set: (c: Change) => calls.set.push(c),
    inbox: () => {},
    git: (args: string[]) => {
      calls.git.push(bare(args));
      return "";
    },
    claude: (args: string[]) => {
      calls.claude.push(args);
      return {
        code: 0,
        stdout: JSON.stringify({
          result: "ok",
          structured_output: answer,
          total_cost_usd: 0.4,
          num_turns: 3,
        }),
        stderr: "",
      };
    },
    npm: () => ({ code: 0, output: "" }),
    loggedIn: () => true,
    gate: () => [true, ""],
    notify: () => {},
    log: () => {},
    say: (l: string) => calls.said.push(l),
    now: () => Date.UTC(2026, 10, 21, 12),
  };
  return { deps, calls, mapDir };
}

describe("a pass", () => {
  it("with no new feedback never runs Claude, the login check or the quota gate", async () => {
    const { deps, calls } = fakeDeps([{ id: later, status: "planned" }]);
    const never = () => {
      throw new Error("must not run");
    };
    await runPass({ ...deps, claude: never, loggedIn: never, gate: never, inbox: never });
    expect(calls.claude).toEqual([]);
    expect(calls.set).toEqual([]);
    expect(calls.said).toEqual(["No new feedback."]);
  });

  it("skips Claude when the quota is low", async () => {
    const { deps, calls } = fakeDeps([{ id, status: "new" }], decision());
    await runPass({ ...deps, gate: () => [false, "Skipped: the 5-hour quota is 80% used."] });
    expect(calls.claude).toEqual([]);
    expect(calls.said).toContain("Skipped: the 5-hour quota is 80% used.");
  });

  it("charts a grilling ticket for a bigger idea and tells the sender", async () => {
    const { deps, calls, mapDir } = fakeDeps([{ id, status: "new" }], decision());
    await runPass(deps);
    expect(calls.claude).toHaveLength(1);
    expect(calls.set).toEqual([
      { id, status: "seen" },
      { id, status: "planned", reply: "Planned: Show the week's spends on Today", ticket: "SAB-59" },
    ]);
    const ticket = readFileSync(join(mapDir, "issues", "59-show-the-week-s-spends-on.md"), "utf8");
    expect(ticket).toContain("# 59 · Show the week's spends on Today");
    expect(ticket).toContain("Type: grilling");
    expect(ticket).toContain(`Feedback: ${id}`);
    expect(ticket).not.toContain("(claimed)");
    const saved = JSON.parse(readFileSync(join(deps.inboxRoot, id, "decision.json"), "utf8"));
    expect(saved.action).toBe("plan");
  });

  it("links to an open ticket, but not to a resolved one", async () => {
    const link = decision({
      action: "link",
      kind: "duplicate",
      ticket: "SAB-57",
      title: "",
      reply: "Already on the list",
    });
    const a = fakeDeps([{ id, status: "new" }], link);
    await runPass(a.deps);
    expect(a.calls.set.at(-1)).toEqual({
      id,
      status: "planned",
      reply: "Already on the list",
      ticket: "SAB-57",
    });
    const open = readFileSync(join(a.mapDir, "issues", "57-open-one.md"), "utf8");
    expect(open).toContain(`Feedback: ${id}\nSessions:`);
    expect(open).toMatch(/## Progress\n\n- 2026-11-21: feedback `0a1b2c3d`/);

    const b = fakeDeps([{ id, status: "new" }], { ...link, ticket: "SAB-58" });
    await runPass(b.deps);
    expect(b.calls.set.at(-1)).toEqual({ id, status: "new" }); // back for another try
  });

  it("puts a wrong-shaped answer back as new, then gives up after two tries", async () => {
    const { deps, calls } = fakeDeps([{ id, status: "new" }], { action: "deploy" });
    await runPass(deps);
    expect(calls.set.at(-1)).toEqual({ id, status: "new" });
    await runPass(deps);
    expect(calls.set.at(-1)).toEqual({ id, status: "seen" });
  });

  it("builds a small fix: commits with the trailer, pushes fb/<id>, never a PR", async () => {
    const fix = decision({ action: "build", kind: "bug", commit: "fix: the week total counts today" });
    const { deps, calls, mapDir } = fakeDeps([{ id, status: "new" }], fix);
    const git = (args: string[]) => {
      calls.git.push(bare(args));
      return bare(args)[0] === "status" ? " M src/x.ts\0" : "";
    };
    await runPass({ ...deps, git });
    expect(calls.claude).toHaveLength(2);
    expect(calls.git).toContainEqual([
      "commit",
      "--quiet",
      "--no-verify",
      "-m",
      "fix: the week total counts today",
      "-m",
      `Feedback: ${id}`,
    ]);
    expect(calls.git).toContainEqual([
      "push",
      "--quiet",
      "--no-verify",
      "-u",
      "origin",
      "fb/0a1b2c3d:fb/0a1b2c3d",
    ]);
    expect(calls.git.some((a) => a.includes("main") && a[0] === "push")).toBe(false);
    expect(calls.git.some((a) => a.some((x) => /force/.test(x) && a[0] === "push"))).toBe(false);
    expect(calls.set.map((c) => c.status)).toEqual(["seen", "building", "ready"]);
    const ticket = readFileSync(join(mapDir, "issues", "59-show-the-week-s-spends-on.md"), "utf8");
    expect(ticket).toContain("Type: task");
    expect(ticket).toContain("built fb/0a1b2c3d, checks green, pushed");
  });

  it("leaves a build that stops as planned, unpushed", async () => {
    const fix = decision({ action: "build", kind: "bug", commit: "fix: x happens" });
    const { deps, calls } = fakeDeps([{ id, status: "new" }], fix);
    let n = 0;
    const claude = (args: string[]) => {
      calls.claude.push(args);
      n++;
      const out =
        n === 1
          ? { result: "ok", structured_output: fix }
          : { result: "Looked.\nSTOPPED: needs a money rule change" };
      return { code: 0, stdout: JSON.stringify(out), stderr: "" };
    };
    await runPass({ ...deps, claude });
    expect(calls.git.some((a) => a[0] === "push")).toBe(false);
    expect(calls.set.at(-1)?.status).toBe("planned");
  });

  it("commits only the paths that passed the gate", async () => {
    const fix = decision({ action: "build", kind: "bug", commit: "fix: x happens" });
    const { deps, calls } = fakeDeps([{ id, status: "new" }], fix);
    const git = (args: string[]) => {
      calls.git.push(bare(args));
      return bare(args)[0] === "status" ? " M src/x.ts\0?? test/x.test.ts\0" : "";
    };
    await runPass({ ...deps, git });
    expect(calls.git).toContainEqual(["add", "--", "src/x.ts", "test/x.test.ts"]);
    expect(calls.git.some((a) => a[0] === "add" && a.includes("--all"))).toBe(false);
  });

  it("never commits when files changed while the checks ran", async () => {
    const fix = decision({ action: "build", kind: "bug", commit: "fix: x happens" });
    const { deps, calls } = fakeDeps([{ id, status: "new" }], fix);
    let checked = false;
    const git = (args: string[]) => {
      calls.git.push(bare(args));
      if (bare(args)[0] !== "status") return "";
      return checked ? " M src/x.ts\0 M package.json\0" : " M src/x.ts\0";
    };
    const check = () => {
      checked = true;
      return { code: 0 };
    };
    await runPass({ ...deps, git, check });
    expect(calls.git.some((a) => a[0] === "commit" || a[0] === "push")).toBe(false);
    expect(calls.set.at(-1)?.status).toBe("planned");
  });

  it("never commits a build that changed a file outside src/, test/ and e2e/", async () => {
    const fix = decision({ action: "build", kind: "bug", commit: "fix: x happens" });
    const { deps, calls } = fakeDeps([{ id, status: "new" }], fix);
    const checks: string[] = [];
    const git = (args: string[]) => {
      calls.git.push(bare(args));
      return bare(args)[0] === "status" ? " M src/x.ts\0 M package.json\0" : "";
    };
    await runPass({ ...deps, git, check: (name: string) => (checks.push(name), { code: 0 }) });
    expect(checks).toEqual([]); // nothing it wrote ran outside the build run's own sandboxed checks
    expect(calls.git.some((a) => a[0] === "commit" || a[0] === "push")).toBe(false);
    expect(calls.set.at(-1)?.status).toBe("planned");
  });

  it("runs every git command in the worktree without hooks or fsmonitor", async () => {
    const fix = decision({ action: "build", kind: "bug", commit: "fix: x happens" });
    const { deps } = fakeDeps([{ id, status: "new" }], fix);
    const raw: string[][] = [];
    const git = (args: string[], cwd?: string) => {
      if (cwd) raw.push(args);
      return bare(args)[0] === "status" ? " M src/x.ts\0" : "";
    };
    await runPass({ ...deps, git });
    expect(raw.length).toBeGreaterThan(0);
    for (const a of raw) expect(a.slice(0, SAFE_GIT.length)).toEqual(SAFE_GIT);
  });

  it("sends a fixed reply when the AI's reply looks like it holds a secret", async () => {
    const leak = decision({
      action: "not doing",
      title: "",
      question: "",
      touches: "",
      reply: "ok ghp_abcdefgh12345678",
    });
    const { deps, calls } = fakeDeps([{ id, status: "new" }], leak);
    await runPass(deps);
    expect(calls.set.at(-1)).toEqual({ id, status: "not doing", reply: FIXED_REPLY["not doing"] });
  });

  it("works on copies outside the real inbox and map, and leaves nothing behind", async () => {
    const { deps, calls } = fakeDeps([{ id, status: "new" }], decision());
    await runPass(deps);
    const args = calls.claude[0] ?? [];
    const dirs = args.slice(args.indexOf("--add-dir") + 1, args.indexOf("--add-dir") + 3);
    expect(dirs).toEqual([join(deps.workRoot, "0a1b2c3d", "inbox"), join(deps.workRoot, "0a1b2c3d", "map")]);
    expect(existsSync(join(deps.workRoot, "0a1b2c3d"))).toBe(false);
  });

  it("does nothing while another pass holds the lock", async () => {
    const { deps, calls } = fakeDeps([{ id, status: "new" }], decision());
    writeFileSync(join(deps.stateDir, "lock"), "4242\n");
    await runPass({ ...deps, alive: () => true });
    expect(calls.set).toEqual([]);
    expect(calls.said).toEqual(["Another pass is running."]);
  });
});

describe("the Done step", () => {
  function repo() {
    const dir = mkdtempSync(join(tmpdir(), "fb-repo-"));
    const g = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    g("init", "--quiet");
    g("commit", "--quiet", "--allow-empty", "-m", "first");
    g("commit", "--quiet", "--allow-empty", "-m", "fix: shipped one", "-m", `Feedback: ${id}`);
    g("tag", "setaside-v0.1.9");
    g("commit", "--quiet", "--allow-empty", "-m", "chore: release", "-m", "x");
    g("tag", "setaside-v0.1.10");
    g("commit", "--quiet", "--allow-empty", "-m", "fix: not shipped yet", "-m", `Feedback: ${later}`);
    return (args: string[]) => g(...args);
  }

  it("marks done the feedback whose fix is in a release, with the first release that has it", () => {
    const set: Change[] = [];
    const n = doneStep({ git: repo(), set: (c: Change) => set.push(c), say: () => {} }, [
      { id, status: "ready" },
      { id: later, status: "ready" },
    ]);
    expect(n).toBe(1);
    expect(set).toEqual([{ id, status: "done", reply: "Fixed in v0.1.9." }]);
  });
});

describe("the quota gate", () => {
  const claudeJson = JSON.stringify({ oauthAccount: { accountUuid: "a", organizationUuid: "o" } });
  const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");
  const cache = (used: number, fetchedAt: number) => {
    const dir = mkdtempSync(join(tmpdir(), "fb-cqm-"));
    const ident = sha256("a:o").slice(0, 16);
    writeFileSync(
      join(dir, `claude-${ident}.json`),
      JSON.stringify({ fetched_at: fetchedAt, response: { windows: [{ key: "5h", used_pct: used }] } }),
    );
    return dir;
  };
  const now = 1_800_000_000_000;

  it("skips when the 5-hour window is 70% used, goes ahead when the cache is old or missing", () => {
    expect(quotaGate({ claudeJson, cacheDir: cache(75, now / 1000), now, sha256 })[0]).toBe(false);
    expect(quotaGate({ claudeJson, cacheDir: cache(40, now / 1000), now, sha256 })[0]).toBe(true);
    expect(quotaGate({ claudeJson, cacheDir: cache(99, now / 1000 - 3600), now, sha256 })[0]).toBe(true);
    expect(quotaGate({ claudeJson, cacheDir: "/nowhere", now, sha256 })[0]).toBe(true);
  });
});
