// Feedback inbox (ticket SAB-55, spec 14 "Feedback"): reads the feedback people sent from the app and writes each one to
// feedback-inbox/<id>/ for whoever fixes it (a person or an AI agent).
//
//   npm run feedback                 new feedback from the live database
//   npm run feedback -- --all        done ones too
//   npm run feedback -- --done <id>  marks one handled
//   npm run feedback -- --local      the local database (npm run dev) instead
//
// Each folder: note.md (what they wrote, when, the screen, the device), context.json, trail.json (the last
// steps in the app), today.json (Today's data the phone showed), screen.webp and picture.* when sent.
// feedback-inbox/ is never committed: it holds people's money data.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    local: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    done: { type: "string" },
    out: { type: "string", default: "feedback-inbox" },
  },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Runs one SQL command with wrangler on the D1 database `DB`; returns its rows. */
function d1(command) {
  const out = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DB",
      values.local ? "--local" : "--remote",
      "--json",
      "--command",
      command,
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] },
  );
  const parsed = JSON.parse(out);
  return parsed.flatMap((r) => r.results ?? []);
}

if (values.done !== undefined) {
  if (!UUID.test(values.done)) {
    console.error("--done takes a feedback id (a UUID).");
    process.exit(1);
  }
  d1(`update feedback set status = 'done', updated_at = ${Date.now()} where id = '${values.done}'`);
  const [row] = d1(`select status from feedback where id = '${values.done}'`);
  if (row?.status !== "done") {
    console.error(`No feedback ${values.done}.`);
    process.exit(1);
  }
  console.log(`Marked done: ${values.done}`);
  process.exit(0);
}

const rows = d1(
  `select f.*, u.email from feedback f join user u on u.id = f.user_id
   ${values.all ? "" : "where f.status = 'new'"} order by f.created_at`,
);

const EXT = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

/** Writes a data URL to `<dir>/<name>.<ext>`; returns the file name. */
function writePicture(dir, name, dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,(.*)$/s.exec(dataUrl ?? "");
  if (!m) return null;
  const file = `${name}.${EXT[m[1]] ?? "bin"}`;
  writeFileSync(join(dir, file), Buffer.from(m[2], "base64"));
  return file;
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

for (const f of rows) {
  const dir = join(values.out, f.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const context = parse(f.context);
  const trail = parse(f.trail);
  writeFileSync(join(dir, "context.json"), `${JSON.stringify(context, null, 2)}\n`);
  writeFileSync(join(dir, "trail.json"), `${JSON.stringify(trail, null, 2)}\n`);
  if (f.today) writeFileSync(join(dir, "today.json"), `${JSON.stringify(parse(f.today), null, 2)}\n`);
  const screen = writePicture(dir, "screen", f.screenshot);
  const picture = writePicture(dir, "picture", f.picture);
  const steps = Array.isArray(trail) ? trail : [];
  const errors = steps.filter((s) => s.kind === "error" || (s.kind === "api" && (s.status ?? 500) >= 400));
  const note = [
    `# ${f.kind === "idea" ? "Idea" : "Something's wrong"} · ${new Date(f.created_at).toISOString()}`,
    "",
    `> ${String(f.text).replace(/\n/g, "\n> ")}`,
    "",
    `- Id: \`${f.id}\` (status ${f.status}; mark handled: \`npm run feedback -- --done ${f.id}\`)`,
    `- From: ${f.email} (user \`${f.user_id}\`)`,
    `- App: ${context.version ?? "?"} · screen ${context.currentScreen ?? "?"} · opened from ${context.from ?? "?"}`,
    `- Device: ${context.browser ?? "?"} · ${context.screen ?? "?"} · ${context.timeZone ?? "?"}`,
    `- Online: ${context.online ?? "?"} · unsent on the phone: ${context.unsent ?? "?"}`,
    `- Files: context.json, trail.json (${steps.length} steps)${f.today ? ", today.json" : ""}${screen ? `, ${screen}` : ""}${picture ? `, ${picture}` : ""}`,
    "",
    "## Errors and failed calls in the trail",
    "",
    ...(errors.length
      ? errors.map((s) =>
          s.kind === "error"
            ? `- ${new Date(s.at).toISOString()} error: ${s.message}`
            : `- ${new Date(s.at).toISOString()} ${s.method} ${s.path} → ${s.status ?? "no answer"} (${s.ms} ms)`,
        )
      : ["- none"]),
    "",
    "## Reading the rest",
    "",
    "The user's saved records are in D1 under their user id, e.g.",
    `\`npx wrangler d1 execute DB --remote --command "select * from spend where user_id = '${f.user_id}' order by created_at desc limit 20"\``,
    "",
  ].join("\n");
  writeFileSync(join(dir, "note.md"), note);
  console.log(`${f.id}  ${f.status}  ${f.kind}  ${String(f.text).split("\n")[0].slice(0, 60)}`);
}
console.log(rows.length ? `\n${rows.length} written to ${values.out}/` : "No feedback.");
