import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/**
 * Phone alerts on this device (item 26, spec 12). Turned on per device: the browser
 * makes a push subscription with the Worker's key and the server keeps it; the cron
 * sends the reminders to every device that has them on.
 *
 * - `unsupported`: this browser has no Web Push.
 * - `home_screen`: iPhone or iPad, not opened from the Home Screen (iOS 16.4 or later needed).
 * - `blocked`: notifications were refused for this app.
 * - `off` / `on`: this device's alerts.
 */
export type PushState = "loading" | "unsupported" | "home_screen" | "blocked" | "off" | "on";

const isAppleMobile = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** This device's push subscription, or null; never waits for a service worker that isn't there. */
async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

function keysOf(sub: PushSubscription) {
  const json = sub.toJSON();
  return { endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" };
}

function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

/** Saves this device's subscription on the server; false when it belongs to someone else or failed. */
async function save(sub: PushSubscription): Promise<boolean> {
  const res = await api.api["push-subscriptions"].$post({ json: keysOf(sub) }).catch(() => null);
  return res?.ok ?? false;
}

/** Turns alerts off on this device (also on signing out, so the next user starts clean). */
export async function turnOffPushHere(): Promise<void> {
  if (!supported()) return;
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  await api.api["push-subscriptions"].remove.$post({ json: { endpoint: sub.endpoint } }).catch(() => null);
  await sub.unsubscribe().catch(() => false);
}

/** Delete account (item 28): the server's rows are gone already; this browser stops listening too. */
export async function forgetPushHere(): Promise<void> {
  if (!supported()) return;
  const sub = await currentSubscription().catch(() => null);
  await sub?.unsubscribe().catch(() => false);
}

/** Sign out everywhere: alerts go off on every device of the user, this one included. */
export async function turnOffPushEverywhere(): Promise<void> {
  await turnOffPushHere();
  await api.api["push-subscriptions"]["remove-all"].$post().catch(() => null);
}

/** Why turning on did not work, in words for the screen. */
export type TurnOnProblem = "blocked" | "not_set_up" | "failed";

/** This device's alerts, with Turn on and Turn off. */
export function usePush() {
  const [state, setState] = useState<PushState>("loading");

  const check = useCallback(async () => {
    if (!supported()) return setState(isAppleMobile() ? "home_screen" : "unsupported");
    if (Notification.permission === "denied") return setState("blocked");
    const sub = Notification.permission === "granted" ? await currentSubscription().catch(() => null) : null;
    if (!sub) return setState("off");
    // Kept fresh on the server (its keys can change); a device that is now someone else's stays off.
    setState("on");
    const res = await api.api["push-subscriptions"].$post({ json: keysOf(sub) }).catch(() => null);
    if (res?.status === 409) {
      await sub.unsubscribe().catch(() => false);
      setState("off");
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const turnOn = useCallback(async (): Promise<TurnOnProblem | null> => {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState(permission === "denied" ? "blocked" : "off");
      return "blocked";
    }
    const keyRes = await api.api.push.key.$get().catch(() => null);
    const publicKey = keyRes?.ok ? (await keyRes.json()).publicKey : null;
    if (!publicKey) return "not_set_up";
    try {
      // No service worker yet (it is still installing, or blocked): give up rather than wait for ever.
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no service worker")), 10_000)),
      ]);
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: fromB64u(publicKey),
        }));
      if (!(await save(sub))) {
        await sub.unsubscribe().catch(() => false);
        return "failed";
      }
      setState("on");
      return null;
    } catch {
      return "failed";
    }
  }, []);

  const turnOff = useCallback(async () => {
    await turnOffPushHere();
    setState("off");
  }, []);

  return { state, turnOn, turnOff };
}
