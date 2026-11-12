import { exports } from "cloudflare:workers";
import type { DemoUser } from "../../src/worker/auth/demo-sign-in";

export const ORIGIN = "https://setaside.test";

/** Calls the Worker like the phone would: same origin, with the given session cookie. */
export function call(path: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("origin", ORIGIN);
  if (cookie) headers.set("cookie", cookie);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }));
}

/** Signs in as a local demo user and returns the session cookie. */
export async function signIn(
  user: DemoUser = "demo",
): Promise<{ cookie: string; id: string; email: string }> {
  const res = await call("/api/auth/demo/sign-in", { method: "POST", body: JSON.stringify({ user }) });
  if (res.status !== 200) throw new Error(`demo sign-in failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const body = await res.json<{ user: { id: string; email: string } }>();
  return { cookie, ...body.user };
}
