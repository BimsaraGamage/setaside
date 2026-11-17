# Workers Free plan: how the 10 ms CPU limit is enforced

Research for SAB-40 (a). Checked 2026-11-17. Primary sources only (Cloudflare docs, Cloudflare blog, Cloudflare's own source code). No Cloudflare staff community answers were needed or used.

Context: Setaside (Hono + Better Auth + Drizzle on D1, Workers Free) measured 12–39 ms `cpuTime` on several live requests, all with outcome `ok`.

## 1. Hard stop per request, or grace?

**Per request, with an unspecified per-isolate tolerance for occasional overruns. No documented averaging, rollover, or burst budget.**

- Free limit is 10 ms per HTTP request (and per Cron Trigger).
  Source: https://developers.cloudflare.com/workers/platform/limits/#cpu-time
  > | CPU time per HTTP request | 10 ms | 5 min (default: 30 seconds) |
- Pricing page wording, Free plan:
  Source: https://developers.cloudflare.com/workers/platform/pricing/
  > 10 milliseconds of CPU time per invocation
- The tolerance (same text on the limits page and on the Wrangler config `limits` section):
  Source: https://developers.cloudflare.com/workers/platform/limits/#cpu-time and https://developers.cloudflare.com/workers/wrangler/configuration/#limits
  > Each isolate has some built-in flexibility to allow for cases where your Worker infrequently runs over the configured limit. If your Worker starts hitting the limit consistently, its execution will be terminated according to the limit configured.
- Not found anywhere in current docs or blog: any number for the "flexibility" (how many ms, how often, over what window), or the older "rollover"/averaging wording. So the tolerance is real but undocumented in size; treat it as "infrequent" only.
- Cloudflare's own guidance on what is normal:
  Source: https://developers.cloudflare.com/workers/platform/limits/#cpu-time
  > The average Worker uses approximately 2.2 ms per request. Heavier workloads that handle authentication, server-side rendering, or parse large payloads typically use 10-20 ms.

## 2. What an overrun looks like

- Client gets error 1102.
  Source: https://developers.cloudflare.com/workers/platform/limits/#cpu-time
  > When a Worker exceeds its CPU time limit, Cloudflare returns Error 1102 to the client with the message `Worker exceeded resource limits`. In the dashboard, this appears as `Exceeded CPU Time Limits` under **Metrics** > **Errors** > **Invocation Statuses**. In analytics and Logpush, the invocation outcome is `exceededCpu`.
- Tail event `outcome` values (what `wrangler tail` / Tail Workers show):
  Source: https://developers.cloudflare.com/workers/runtime-apis/handlers/tail/
  > `exceededCpu`: The Worker invocation exceeded either its CPU limits.
  > Outcome is not the same as HTTP status.
  > a script sends a successful `200` response but an asynchronous task registered via `waitUntil()` later exceeds CPU or memory limits.
- The enum itself (Cloudflare log schema, copied into workerd): `ok @1; exception @2; exceededCpu @3; ... exceededMemory @8; ... exceededWallTime @12;`
  Source: https://github.com/cloudflare/workerd/blob/main/src/workerd/io/outcome.capnp
- Error page: https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1102/
  > This error indicates that a Cloudflare Worker has exceeded its CPU time limit or memory limit.

So: as long as tail shows `outcome: "ok"`, the request was not cut. A kill shows as `exceededCpu` (and 1102 to the browser). Note `waitUntil()` work counts too and can turn an already-sent 200 into `exceededCpu`.

## 3. Does startup or I/O count?

- **I/O waiting: does not count.** (D1 queries, `fetch()` to Google, etc.)
  Source: https://developers.cloudflare.com/workers/platform/limits/#cpu-time
  > Waiting on network requests (such as `fetch()` calls, KV reads, or database queries) does **not** count toward CPU time.
  Also https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1102/
  > Time spent on network requests (fetching, responding) does not count towards CPU time.
- **Startup (global scope): has its own separate 1 s limit**, checked at deploy time. The old 400 ms limit was raised on 2025-10-10.
  Source: https://developers.cloudflare.com/workers/platform/limits/#worker-startup-time
  > A Worker must parse and execute its global scope (top-level code outside of handlers) within 1 second.
  > When the platform rejects a deployment because the Worker exceeds the startup time limit, the validation returns the error `Script startup exceeded CPU time limit` (error code `10021`).
  Source: https://developers.cloudflare.com/changelog/post/2025-10-10-increased-startup-time/
  > You can now upload a Worker that takes up 1 second to parse and execute its global scope. Previously, startup time was limited to 400 ms.
- **Whether startup CPU is added to the first request's `cpuTime` / 10 ms: no primary source says either way.** Searched limits, pricing, how-workers-works, Workers Logs, the 1102 page, the changelog and the "never pay to wait on I/O" blog post. Inference only: startup is governed by its own limit, and the 10 ms is stated "per HTTP request". Lazy work done inside the first handler call (e.g. building Better Auth / Drizzle objects on first use, not at top level) is request CPU, though.

## 4. Is tail `cpuTime` the metric the limit uses?

- Tail/trace events carry `cpuTime` and `wallTime` per invocation, alongside `outcome`:
  - Types: `@cloudflare/workers-types` (5.20261117.1) `interface TraceMetrics { readonly cpuTime: number; readonly wallTime: number; }` and on trace items `readonly cpuTime: number; readonly wallTime: number;` (https://unpkg.com/@cloudflare/workers-types@5.20261117.1/index.d.ts)
  - Runtime: workerd `src/workerd/io/trace.h`, `Trace` has `EventOutcome outcome; ... kj::Duration cpuTime; kj::Duration wallTime;` (https://github.com/cloudflare/workerd/blob/main/src/workerd/io/trace.h)
- Cloudflare points to exactly these fields for watching the limit:
  Source: https://developers.cloudflare.com/workers/platform/limits/#cpu-time ("Monitoring CPU usage")
  > **Workers Logs** — CPU time and wall time appear in the invocation log.
  > **Tail Workers / Logpush** — CPU time and wall time appear at the top level of the Workers Trace Events object.
  Logpush field: https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/workers_trace_events/
  > CPUTimeMs ... The amount of CPU time used by the Worker script, in milliseconds.
- No doc states in one sentence "the limit is enforced on this exact number", but it is the only CPU number Cloudflare exposes and the one its limits page tells you to monitor. Treat it as the same metric (high confidence, not literally stated). The open-source workerd does not contain production CPU-limit enforcement, so the enforcer cannot be checked in source.

## 5. Can Free set `limits.cpu_ms`?

**No. Paid (Standard usage model) only.**

- Source: https://developers.cloudflare.com/workers/wrangler/configuration/#limits
  > Limits are only supported for the Standard Usage Model. Limits are only enforced when deployed to Cloudflare's network, not in local development. The CPU limit can be set to a maximum of 300,000 milliseconds (5 minutes).
- Source: https://developers.cloudflare.com/workers/platform/limits/#cpu-time
  > On the Workers Paid plan, you can increase the maximum CPU time from the default 30 seconds to 5 minutes (300,000 ms).
- Paid includes "30 million CPU milliseconds included per month" then "+$0.02 per additional million CPU milliseconds" (https://developers.cloudflare.com/workers/platform/pricing/).

## Bottom line for Setaside

1. 10 ms is per request, with only an undocumented tolerance for *infrequent* overruns; "hitting the limit consistently" gets requests killed (1102, `exceededCpu`). Today's `ok` results prove nothing about steady use.
2. `GET /api/current` at 19–39 ms on *every* load (2–4x the limit, and growing with cycle size) is exactly "consistently" — real risk, likely to start failing on the main screen; auth calls at 11–16 ms are borderline (inside Cloudflare's "10-20 ms" auth norm, but still over).
3. D1/fetch waiting is free, so the fix is cutting JS work (part (b)/(c): profile `/api/current` first); the only other way out is Workers Paid ($5/mo, 30 s default limit).

---

# Part (b) and (c): where the CPU goes, measured

Measured 2026-11-17 on this computer: `wrangler dev` (workerd) of `main` at v0.0.1, built with `--define import.meta.env.DEV:true` so the demo sign-in works. CPU from a V8 CPU profile through the local inspector (50 µs sampling, non-idle time per request, after 3 warm-up requests). Data: one demo user with a **full month in two cycles** (90 spends, 14 bills with payments, 6 pots, 5 day choices, savings, 8 Every cycle bills, a card, a plan, a person, a prepayment; 293 rows, from `40-cpu-profile/seed.cjs`). Scripts: `40-cpu-profile/` (`prof.mjs` sends N requests while profiling, `analyze.mjs` splits time by source package).

Local numbers include `wrangler dev`'s own overhead (tracing, facade). Live `get-session` is 1–4 ms against 6.4–6.9 ms here, so subtract about 3–4 ms to estimate live.

| Request (30 runs, 20 for the spend) | CPU / request, local | Live (ticket 34) |
| --- | --- | --- |
| `GET /api/health` (one `select 1`) | 4.9 ms | — |
| `GET /api/auth/get-session` | 6.4–6.9 ms | 1–4 ms |
| `GET /api/current`, full month | **29.5–31.7 ms** | 19–39 ms with a fresh cycle |
| `POST /api/spends` (money-rule check + insert) | 12.9 ms | — |
| experiment: the same reads as **one raw `env.DB.batch`** (`select *`, 3x more JSON: 89 kB vs 29 kB) | **9.8 ms** | — |

## (b) Who carries the cost

- **`GET /api/current` is the only steady problem.** `currentData` (`src/worker/first-use.ts`) and its helpers (`savingsLines`, `prepaymentLines`, `cardLines`, `planLines`, `personDebtLines`, `undoRecord`, `lastCycleSpeeds`, `conversionLines`, `countingRateOf`) make **about 25 separate D1 queries**, one after the other. Each costs CPU twice:
  - **Drizzle: 12.8 ms of 29.5 (43%)** building SQL (`buildRelationalQuery`, `buildSelectQuery`, `sqlToQuery`, its `is()` class check alone 4.6 ms) and mapping rows (`mapRelationalRow`).
  - **The D1 binding per call: ~5.7 ms** (`toJson`, `fetch`, `text`, `setAttributes`, `_send`): ~0.25 ms a query.
  - Hono ~2 ms, Better Auth session check ~1.5 ms, the rest runtime.
  - It also explains the **~1.8 s wall time** live: ~25 round trips to D1 in a row.
  - It grows with every backlog item that adds a helper, and with rows (spends, payments).
- **Writes are borderline, not the problem:** a spend is 12.9 ms here, so ~8–9 ms live; Drizzle only ~2 ms of it.
- **Sign-in routes (Google callback 12 ms, passkey verify 16 ms, sign-out 11 ms) and first use (14 ms) are rare**: once per sign-in (sessions last 30 days) or once ever. That is the "infrequent" overrun the isolate tolerance is for, and Cloudflare calls 10–20 ms normal for auth. No fix.
- The reminder cron reads `currentData` for each user it sends to, so the cron run (ticket 39, also 10 ms on Free) carries the same cost per user.

## (c) Cheapest fix

**Read Today's data in one D1 batch with fixed SQL, no per-request query building.** The experiment above (21 statements in one `env.DB.batch` plus the cycle lookup, returning *more* data) took **9.8 ms against 31.7 ms**, and ~7 ms of that 9.8 is the session check plus local overhead, so the route's own work drops from **~25 ms to ~3 ms**: live it should land around 5–8 ms. Wall time drops from ~25 round trips to 2.

Options weighed:

| Option | CPU win | Cost |
| --- | --- | --- |
| **One `env.DB.batch` of fixed SQL strings, rows mapped by hand** (recommended) | ~25 → ~3 ms measured | rewrite `currentData` + helpers' reads; the JSON shape stays the same, so the phone and its tests don't change; server tests check the shape |
| Drizzle `db.batch([...])` of the same builders | saves the binding part (~4–5 ms), keeps Drizzle's 12.8 ms | still over 10 ms |
| Drizzle prepared statements (`.prepare()` once per isolate with `sql.placeholder`) | saves the building part, keeps 25 round trips and mapping | still ~15 ms, still 1.8 s wall |
| Cache the computed view (isolate memory / Cache API) keyed by a data version | near 0 on a hit | every write route must bump the version; easy to get stale money numbers; a miss still costs 30 ms |
| Workers Paid | none needed | money ($5/month minimum): not for v0.1 |

Writes, auth and first use need no change now; check them again live after the fix.
