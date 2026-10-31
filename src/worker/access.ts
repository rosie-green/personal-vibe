// Optional defence in depth: verify the Cloudflare Access JWT on API requests.
//
// Cloudflare Access already stops anyone who isn't logged in from reaching the
// site. Checking the JWT as well means the API still refuses requests if Access
// is ever misconfigured, or someone reaches the Worker by another hostname.
//
// Only enforced when ACCESS_TEAM_DOMAIN and ACCESS_AUD are both set.

export interface AccessConfig {
  teamDomain: string;
  aud: string;
}

export interface AccessDeps {
  fetchImpl: typeof fetch;
  nowSec: number;
}

interface Jwk {
  kid?: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

const keyCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();
const KEY_TTL_SEC = 3600;
const REFETCH_MIN_SEC = 60;

export function accessConfigFromEnv(env: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string }): AccessConfig | null {
  const domain = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_AUD?.trim();
  if (!domain || !aud) return null;
  return { teamDomain: domain.replace(/^https?:\/\//, "").replace(/\/+$/, ""), aud };
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseJson(bytes: Uint8Array): Record<string, unknown> {
  const v: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("bad json");
  return v as Record<string, unknown>;
}

async function getKeys(cfg: AccessConfig, deps: AccessDeps, force: boolean): Promise<Jwk[]> {
  const cached = keyCache.get(cfg.teamDomain);
  const age = cached ? deps.nowSec - cached.fetchedAt : Infinity;
  if (cached && age < KEY_TTL_SEC && !(force && age >= REFETCH_MIN_SEC)) return cached.keys;
  const res = await deps.fetchImpl(`https://${cfg.teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`certs fetch failed: ${res.status}`);
  const data = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(data.keys) ? data.keys : [];
  keyCache.set(cfg.teamDomain, { keys, fetchedAt: deps.nowSec });
  return keys;
}

/** Resolves to the email claim (if any) when the token is valid; throws otherwise. */
export async function verifyAccessJwt(token: string, cfg: AccessConfig, deps: AccessDeps): Promise<{ email?: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h, p, s] = parts as [string, string, string];

  const header = parseJson(b64urlToBytes(h));
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("unsupported header");

  let keys = await getKeys(cfg, deps, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await getKeys(cfg, deps, true); // keys may have rotated
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error("unknown key id");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new Error("bad signature");

  const claims = parseJson(b64urlToBytes(p));
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.aud)) throw new Error("wrong audience");
  if (claims.iss !== `https://${cfg.teamDomain}`) throw new Error("wrong issuer");
  if (typeof claims.exp !== "number" || claims.exp <= deps.nowSec) throw new Error("expired");
  if (typeof claims.nbf === "number" && claims.nbf > deps.nowSec + 60) throw new Error("not yet valid");

  return typeof claims.email === "string" ? { email: claims.email } : {};
}

/** Test helper: forget cached keys. */
export function clearAccessKeyCache(): void {
  keyCache.clear();
}
