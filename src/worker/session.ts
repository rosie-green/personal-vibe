const COOKIE = "myday_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function key(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function passwordMatches(candidate: string, password: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(candidate)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(password)),
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i]! ^ bb[i]!;
  return diff === 0;
}

export async function makeSession(password: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const payload = String(nowSec + SESSION_SECONDS);
  const signature = await crypto.subtle.sign("HMAC", await key(password), new TextEncoder().encode(payload));
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function validSession(cookieHeader: string | null, password: string, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const token = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token) return false;
  const [expires, signature, ...extra] = token.split(".");
  if (!expires || !signature || extra.length || !/^\d+$/.test(expires)) return false;
  const expiry = Number(expires);
  if (!Number.isSafeInteger(expiry) || expiry <= nowSec || expiry > nowSec + SESSION_SECONDS + 60) return false;
  try {
    return await crypto.subtle.verify("HMAC", await key(password), base64UrlToBytes(signature), new TextEncoder().encode(expires));
  } catch {
    return false;
  }
}

export function sessionCookie(value: string): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

export function loginPage(returnTo: string): Response {
  const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.startsWith("/login") ? returnTo : "/";
  const destination = JSON.stringify(safeReturn).replace(/</g, "\\u003c");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Sign in · My Day</title><style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f5f5fa;color:#24233a;font:16px system-ui,sans-serif}.card{width:min(100%,380px);padding:32px;border:1px solid #e5e4ef;border-radius:20px;background:#fff;box-shadow:0 12px 40px #27204412}h1{margin:0 0 8px;font-size:1.5rem}p{margin:0 0 24px;color:#6b6980}label{display:block;margin-bottom:8px;font-weight:600}input{width:100%;padding:13px;border:1px solid #cbc9da;border-radius:10px;font:inherit}button{width:100%;margin-top:16px;padding:13px;border:0;border-radius:10px;background:#4f46e5;color:white;font:inherit;font-weight:650;cursor:pointer}#error{min-height:1.4em;margin-top:12px;color:#b42318;font-size:.92rem}@media(prefers-color-scheme:dark){body{background:#15141c;color:#f3f2fa}.card{background:#211f2b;border-color:#393646}p{color:#bbb8cb}input{background:#171620;color:#fff;border-color:#4b485a}}
    </style><main class="card"><h1>My Day</h1><p>Enter your password to continue.</p><form id="form"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button>Sign in</button><div id="error" role="alert"></div></form></main><script>
    const destination=${destination};document.querySelector('#form').addEventListener('submit',async e=>{e.preventDefault();const button=document.querySelector('button'),error=document.querySelector('#error');button.disabled=true;error.textContent='';try{const res=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:document.querySelector('#password').value})});if(!res.ok)throw new Error(res.status===401?'That password is incorrect.':'Unable to sign in. Try again.');location.replace(destination)}catch(err){error.textContent=err.message;button.disabled=false}});
    </script></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
