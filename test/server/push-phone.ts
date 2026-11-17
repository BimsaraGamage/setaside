import { b64u, ecdhWith, fromB64u } from "../../src/worker/push/web-push";

/** The phone's side of Web Push for the tests (item 26): RFC 8291's example keys and the decrypt a browser does. */

/** RFC 8291 section 5: the worked example. */
export const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

export async function ecKey(publicB64u: string, privateB64u: string, usage: "ecdh" | "ecdsa") {
  const pub = fromB64u(publicB64u);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: b64u(pub.slice(1, 33)),
    y: b64u(pub.slice(33, 65)),
    d: privateB64u,
  };
  return usage === "ecdh"
    ? crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"])
    : crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** The phone's side of RFC 8291: what the browser does to read the push. */
export async function decrypt(body: Uint8Array, uaPublic: string, uaPrivate: string, auth: string) {
  const salt = body.slice(0, 16);
  const idLen = body[20]!;
  const asPublic = body.slice(21, 21 + idLen);
  const cipher = body.slice(21 + idLen);
  const uaKey = await ecKey(uaPublic, uaPrivate, "ecdh");
  const asKey = await crypto.subtle.importKey(
    "raw",
    asPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits(ecdhWith(asKey), uaKey, 256));
  const hkdf = async (ikm: Uint8Array, s: Uint8Array, info: Uint8Array, bytes: number) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: s, info },
        await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]),
        bytes * 8,
      ),
    );
  const text = new TextEncoder();
  const keyInfo = new Uint8Array([...text.encode("WebPush: info\0"), ...fromB64u(uaPublic), ...asPublic]);
  const ikm = await hkdf(ecdh, fromB64u(auth), keyInfo, 32);
  const cek = await hkdf(ikm, salt, text.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(ikm, salt, text.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher));
  if (plain.at(-1) !== 2) throw new Error("no last-record delimiter");
  return new TextDecoder().decode(plain.slice(0, -1));
}
