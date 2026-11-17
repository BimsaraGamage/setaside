import type { Vapid } from "./web-push";

/**
 * The VAPID key pair is two optional Worker secrets (docs/self-hosting.md). Without
 * them the app works as before: no phone alerts, reminders listed on Today.
 */
export interface PushSecrets {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
}

/** The Worker's VAPID keys, signed as the app's address; null when not set up. */
export function vapidOf(env: Pick<Env, "APP_URL"> & PushSecrets): Vapid | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = env;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: env.APP_URL };
}
