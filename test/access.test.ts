// Tests for the optional Cloudflare Access JWT check, using a real RSA key pair
// generated on the fly and a stubbed "certs" endpoint.

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { accessConfigFromEnv, clearAccessKeyCache, verifyAccessJwt } from "../src/worker/access.ts";
import { handle } from "../src/worker/index.ts";
import { createTestDb } from "./d1-shim.ts";

const TEAM = "my-team.cloudflareaccess.com";
const AUD = "abc123audience";
const NOW = 1_800_000_000;

const b64url = (bytes: Uint8Array | string): string => {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (const b of data) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function makeKey() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
}

async function sign(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: "k1", typ: "JWT" },
): Promise<string> {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(claims));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url(sig)}`;
}

const goodClaims = (over: Record<string, unknown> = {}) => ({
  aud: [AUD],
  iss: `https://${TEAM}`,
  exp: NOW + 3600,
  iat: NOW - 10,
  email: "me@example.com",
  ...over,
});

let kp: CryptoKeyPair;
let certsFetches = 0;
let fetchImpl: typeof fetch;

async function stubFetch(keys: { kid: string; key: CryptoKey }[]): Promise<typeof fetch> {
  const jwks = await Promise.all(
    keys.map(async ({ kid, key }) => ({ ...(await crypto.subtle.exportKey("jwk", key)), kid })),
  );
  return (async (input: RequestInfo | URL) => {
    certsFetches++;
    assert.equal(String(input), `https://${TEAM}/cdn-cgi/access/certs`);
    return new Response(JSON.stringify({ keys: jwks }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

beforeEach(async () => {
  clearAccessKeyCache();
  certsFetches = 0;
  kp = await makeKey();
  fetchImpl = await stubFetch([{ kid: "k1", key: kp.publicKey }]);
});

const cfg = { teamDomain: TEAM, aud: AUD };
const deps = () => ({ fetchImpl, nowSec: NOW });

describe("verifyAccessJwt", () => {
  test("accepts a valid token and returns the email", async () => {
    const token = await sign(kp.privateKey, goodClaims());
    assert.deepEqual(await verifyAccessJwt(token, cfg, deps()), { email: "me@example.com" });
  });

  test("caches the signing keys", async () => {
    const token = await sign(kp.privateKey, goodClaims());
    await verifyAccessJwt(token, cfg, deps());
    await verifyAccessJwt(token, cfg, deps());
    assert.equal(certsFetches, 1);
  });

  test("rejects a token signed by a different key", async () => {
    const other = await makeKey();
    const token = await sign(other.privateKey, goodClaims());
    await assert.rejects(verifyAccessJwt(token, cfg, deps()), /bad signature/);
  });

  test("rejects a tampered payload", async () => {
    const token = await sign(kp.privateKey, goodClaims());
    const [h, , s] = token.split(".") as [string, string, string];
    const forged = `${h}.${b64url(JSON.stringify(goodClaims({ email: "evil@example.com" })))}.${s}`;
    await assert.rejects(verifyAccessJwt(forged, cfg, deps()), /bad signature/);
  });

  test("rejects the wrong audience, issuer, expiry", async () => {
    await assert.rejects(
      verifyAccessJwt(await sign(kp.privateKey, goodClaims({ aud: ["someone-else"] })), cfg, deps()),
      /audience/,
    );
    await assert.rejects(
      verifyAccessJwt(await sign(kp.privateKey, goodClaims({ iss: "https://evil.example.com" })), cfg, deps()),
      /issuer/,
    );
    await assert.rejects(
      verifyAccessJwt(await sign(kp.privateKey, goodClaims({ exp: NOW - 1 })), cfg, deps()),
      /expired/,
    );
    await assert.rejects(
      verifyAccessJwt(await sign(kp.privateKey, goodClaims({ exp: undefined })), cfg, deps()),
      /expired/,
    );
  });

  test("rejects garbage, wrong algorithm and 'none'", async () => {
    await assert.rejects(verifyAccessJwt("not-a-jwt", cfg, deps()), /malformed/);
    const none = `${b64url(JSON.stringify({ alg: "none", kid: "k1" }))}.${b64url(JSON.stringify(goodClaims()))}.`;
    await assert.rejects(verifyAccessJwt(none, cfg, deps()), /unsupported header/);
    const hs = await sign(kp.privateKey, goodClaims(), { alg: "HS256", kid: "k1" });
    await assert.rejects(verifyAccessJwt(hs, cfg, deps()), /unsupported header/);
  });

  test("an unknown key id is rejected after one refresh attempt", async () => {
    const token = await sign(kp.privateKey, goodClaims(), { alg: "RS256", kid: "unknown" });
    await assert.rejects(verifyAccessJwt(token, cfg, deps()), /unknown key id/);
  });

  test("picks up a rotated key (after the minimum refresh gap)", async () => {
    const first = await verifyAccessJwt(await sign(kp.privateKey, goodClaims()), cfg, deps());
    assert.equal(first.email, "me@example.com");

    const rotated = await makeKey();
    fetchImpl = await stubFetch([
      { kid: "k1", key: kp.publicKey },
      { kid: "k2", key: rotated.publicKey },
    ]);
    const token = await sign(rotated.privateKey, goodClaims(), { alg: "RS256", kid: "k2" });
    // 2 minutes later, so a refresh is allowed
    const later = { fetchImpl, nowSec: NOW + 120 };
    const ok = await verifyAccessJwt(token, cfg, later);
    assert.equal(ok.email, "me@example.com");
  });
});

describe("accessConfigFromEnv", () => {
  test("only enforced when both values are set; tidies the domain", () => {
    assert.equal(accessConfigFromEnv({}), null);
    assert.equal(accessConfigFromEnv({ ACCESS_TEAM_DOMAIN: TEAM }), null);
    assert.equal(accessConfigFromEnv({ ACCESS_AUD: AUD }), null);
    assert.deepEqual(accessConfigFromEnv({ ACCESS_TEAM_DOMAIN: `https://${TEAM}/`, ACCESS_AUD: AUD }), cfg);
  });
});

describe("the API with Access enforced", () => {
  const callApi = async (headers: Record<string, string>, env: object) => {
    const { db } = createTestDb();
    const res = await handle(new Request("http://app.test/api/health", { headers }), { DB: db, ...env }, {
      fetchImpl,
      nowSec: NOW,
      nowIso: new Date(NOW * 1000).toISOString(),
    });
    return res.status;
  };
  const enforced = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

  test("no header -> 403, bad token -> 403, good token -> 200", async () => {
    const quiet = console.warn;
    console.warn = () => {};
    try {
      assert.equal(await callApi({}, enforced), 403);
      assert.equal(await callApi({ "cf-access-jwt-assertion": "junk" }, enforced), 403);
      const good = await sign(kp.privateKey, goodClaims());
      assert.equal(await callApi({ "cf-access-jwt-assertion": good }, enforced), 200);
    } finally {
      console.warn = quiet;
    }
  });

  test("not enforced when the variables aren't set (local dev)", async () => {
    assert.equal(await callApi({}, {}), 200);
  });
});
