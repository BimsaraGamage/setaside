import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";

/** Better Auth on this same address, under /api/auth (spec 13). */
export const authClient = createAuthClient({
  baseURL: `${window.location.origin}/api/auth`,
  plugins: [passkeyClient()],
});

/** Local development only: the server has this route only in DEV (see demo-sign-in.ts). */
export async function signInAsDemoUser() {
  if (!import.meta.env.DEV) return;
  const res = await fetch("/api/auth/demo/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: "demo" }),
  });
  if (!res.ok) throw new Error("Demo sign-in failed");
}
