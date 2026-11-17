/**
 * Standard Web Push from the Worker (spec 12, item 26): no library and no paid service.
 * The message is encrypted for the phone (RFC 8291, `aes128gcm`) and the Worker signs
 * who it is with its VAPID key (RFC 8292). Only Web Crypto is used, so a push costs
 * little CPU: one key pair, one ECDH, a few HKDFs, one AES-GCM and one ECDSA signature.
 */

/** A device's push subscription, as the browser gives it. */
export interface PushTarget {
  endpoint: string;
  /** The phone's public key, base64url (65 bytes). */
  p256dh: string;
  /** The phone's auth secret, base64url (16 bytes). */
  auth: string;
}

/** The Worker's VAPID key pair (Worker secrets) and who it is (the app's address). */
export interface Vapid {
  /** Uncompressed P-256 public key, base64url (65 bytes). The phone subscribes with it. */
  publicKey: string;
  /** The private key's `d`, base64url (32 bytes). */
  privateKey: string;
  subject: string;
}

/** What the service worker shows (src/service-worker.js). */
export interface PushMessage {
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url: string;
}

/** Keep an undelivered push this long (seconds): a morning summary is stale by the evening. */
export const PUSH_TTL = 12 * 3600;

const RECORD_SIZE = 4096;
const text = new TextEncoder();

export function b64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(
  ikm: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  info: string | Uint8Array<ArrayBuffer>,
  bytes: number,
) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: typeof info === "string" ? text.encode(info) : info },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

/** ECDH with the other side's key; the Workers types name the field `$public`, the runtime takes `public`. */
export function ecdhWith(key: CryptoKey): SubtleCryptoDeriveKeyAlgorithm {
  return { name: "ECDH", public: key } as unknown as SubtleCryptoDeriveKeyAlgorithm;
}

/** For tests only: a fixed server key pair and salt (RFC 8291's worked example). */
export interface FixedKeys {
  asPrivate: CryptoKey;
  asPublic: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
}

/** The push body for one device (RFC 8291 and RFC 8188, one record). */
export async function encryptPayload(
  payload: string,
  to: Pick<PushTarget, "p256dh" | "auth">,
  fixed?: FixedKeys,
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromB64u(to.p256dh);
  let asPrivate: CryptoKey;
  let asPublic: Uint8Array<ArrayBuffer>;
  if (fixed) {
    ({ asPrivate, asPublic } = fixed);
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  }
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits(ecdhWith(uaKey), asPrivate, 256));
  const ikm = await hkdf(
    ecdh,
    fromB64u(to.auth),
    concat(text.encode("WebPush: info\0"), uaPublic, asPublic),
    32,
  );
  const cek = await hkdf(ikm, salt, "Content-Encoding: aes128gcm\0", 16);
  const nonce = await hkdf(ikm, salt, "Content-Encoding: nonce\0", 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // One record: the message, then the last-record delimiter 0x02, no padding.
  const plain = concat(text.encode(payload), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plain));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

/** `Authorization: vapid t=<JWT>, k=<public key>` for the push service at `endpoint` (RFC 8292). */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, now = Date.now()): Promise<string> {
  const pub = fromB64u(vapid.publicKey);
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: vapid.privateKey },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const part = (o: object) => b64u(text.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: vapid.subject,
  })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, text.encode(unsigned));
  return `vapid t=${unsigned}.${b64u(new Uint8Array(sig))}, k=${vapid.publicKey}`;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** Sends one push to one device; gives back the push service's status (404 or 410: the device is gone). */
export async function sendPush(
  to: PushTarget,
  message: PushMessage,
  vapid: Vapid,
  fetcher: Fetch = (input, init) => fetch(input, init),
): Promise<number> {
  const body = await encryptPayload(JSON.stringify(message), to);
  const res = await fetcher(to.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidAuthorization(to.endpoint, vapid),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(PUSH_TTL),
      urgency: "normal",
    },
    body,
  });
  // Nothing in the reply is needed; let the connection go.
  await res.body?.cancel();
  return res.status;
}
