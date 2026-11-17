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
