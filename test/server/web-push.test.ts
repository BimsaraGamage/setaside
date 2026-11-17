import { describe, expect, it } from "vitest";
import { b64u, encryptPayload, fromB64u, sendPush, vapidAuthorization } from "../../src/worker/push/web-push";
import { decrypt, ecKey, RFC } from "./push-phone";

/** A fresh VAPID key pair: the public key and private `d`, base64url. */
async function vapidKeys() {
  const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer;
  const jwk = (await crypto.subtle.exportKey("jwk", keys.privateKey)) as JsonWebKey;
  return { keys, pub: b64u(new Uint8Array(raw)), d: jwk.d! };
}

describe("Web Push (item 26, spec 12)", () => {
  it("encrypts the RFC 8291 example to its exact bytes", async () => {
    const asPrivate = await ecKey(RFC.asPublic, RFC.asPrivate, "ecdh");
    const body = await encryptPayload(
      RFC.plaintext,
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      { asPrivate, asPublic: fromB64u(RFC.asPublic), salt: fromB64u(RFC.salt) },
    );
    expect(b64u(body)).toBe(RFC.body);
    expect(await decrypt(body, RFC.uaPublic, RFC.uaPrivate, RFC.auth)).toBe(RFC.plaintext);
    // The record size is 4096 and the key id is the 65-byte server key.
    expect([...body.slice(16, 21)]).toEqual([0, 0, 16, 0, 65]);
    expect(b64u(body.slice(21, 86))).toBe(RFC.asPublic);
    expect(body.length).toBe(86 + RFC.plaintext.length + 1 + 16);
  });

  it("encrypts with a fresh key and salt each time, and the phone can read it", async () => {
    const sub = { p256dh: RFC.uaPublic, auth: RFC.auth };
    const a = await encryptPayload("hello", sub);
    const b = await encryptPayload("hello", sub);
    expect(b64u(a)).not.toBe(b64u(b));
    expect(await decrypt(a, RFC.uaPublic, RFC.uaPrivate, RFC.auth)).toBe("hello");
  });

  it("signs a VAPID token for the push service's origin, valid 12 hours", async () => {
    const { keys, pub, d } = await vapidKeys();
    const now = Date.UTC(2026, 10, 17, 2, 30);
    const header = await vapidAuthorization(
      "https://fcm.googleapis.com/fcm/send/abc",
      { publicKey: pub, privateKey: d, subject: "https://setaside.test" },
      now,
    );
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(m?.[2]).toBe(pub);
    const [h, p, s] = m![1]!.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromB64u(h!)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(new TextDecoder().decode(fromB64u(p!)))).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: now / 1000 + 12 * 3600,
      sub: "https://setaside.test",
    });
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keys.publicKey,
      fromB64u(s!),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });

  it("posts the encrypted push with its headers and gives back the status", async () => {
    const { pub, d } = await vapidKeys();
    const seen: Request[] = [];
    const status = await sendPush(
      { endpoint: "https://push.example/send/1", p256dh: RFC.uaPublic, auth: RFC.auth },
      { title: "Setaside", body: "Rent due today", url: "/" },
      { publicKey: pub, privateKey: d, subject: "https://setaside.test" },
      async (input, init) => {
        seen.push(new Request(input, init));
        return new Response(null, { status: 410 });
      },
    );
    expect(status).toBe(410);
    const req = seen[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://push.example/send/1");
    expect(req.headers.get("content-encoding")).toBe("aes128gcm");
    expect(req.headers.get("ttl")).toBe("43200");
    expect(req.headers.get("authorization")).toMatch(/^vapid t=.+, k=/);
    const body = new Uint8Array(await req.arrayBuffer());
    expect(JSON.parse(await decrypt(body, RFC.uaPublic, RFC.uaPrivate, RFC.auth))).toEqual({
      title: "Setaside",
      body: "Rent due today",
      url: "/",
    });
  });
});
