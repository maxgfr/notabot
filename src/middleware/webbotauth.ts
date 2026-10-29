// Web Bot Auth: AI agents and crawlers that sign their requests (HTTP Message Signatures, RFC
// 9421, Ed25519) with a key their operator publishes in a directory. A verified signature says
// who operates the agent, which no header or fingerprint can. Draft:
// https://datatracker.ietf.org/doc/draft-meunier-web-bot-auth-architecture/
import type { RequestInfo } from "./request";

export interface AgentPolicy {
  /**
   * Operators let through, by origin ("https://chatgpt.com") or host, each with an optional
   * rate. A signed request from anyone else is refused: no policy, no entry.
   */
  allow: Record<string, { ratePerMinute?: number }>;
  /** Fetch used for key directories (tests, proxies). Default the global fetch. */
  fetch?: typeof fetch;
  /** Seconds a signature's `created` may sit in the future. Default 60. */
  clockSkewSeconds?: number;
}

export type AgentResult =
  | { ok: true; operator: string; keyid: string }
  | {
      ok: false;
      operator: string | null;
      reason: "not-allowed" | "malformed" | "expired" | "no-key" | "bad-signature";
    };

const DIRECTORY = "/.well-known/http-message-signatures-directory";
const MAX_DIRECTORY_BYTES = 64 * 1024;

/** Whether the request carries a Web Bot Auth signature at all. */
export function hasAgentSignature(headers: Headers): boolean {
  return headers.has("signature") && headers.has("signature-input");
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || /\.(localhost|local|internal|home|lan)$/.test(h)) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  // Any IPv6 literal: loopback, unique local, link local, mapped v4… none is an operator's site.
  return h.includes(":");
}

/**
 * The key directory of an operator, or null when fetching it could reach inside your network:
 * https only, no credentials in the URL, no IP literal or local name. (DNS cannot be checked
 * from every runtime: only operators of the allow-list are ever fetched.)
 */
export function directoryUrl(operator: string): URL | null {
  let url: URL;
  try {
    url = new URL(operator);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (isPrivateHost(url.hostname)) return null;
  return new URL(DIRECTORY, url.origin);
}

/** Splits a structured-field dictionary at top-level commas (not inside strings or lists). */
function members(value: string): Map<string, string> {
  const out = new Map<string, string>();
  let depth = 0;
  let quoted = false;
  let start = 0;
  const push = (end: number) => {
    const part = value.slice(start, end).trim();
    const eq = part.indexOf("=");
    if (eq > 0) out.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  };
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(value.length);
  return out;
}

interface SignatureInput {
  /** The serialised inner list and parameters, as signed (`("@authority" …);created=…`). */
  raw: string;
  components: string[];
  params: Record<string, string | number>;
}

function parseInput(raw: string): SignatureInput | null {
  const m = /^\(([^)]*)\)(.*)$/.exec(raw);
  if (!m) return null;
  const components = [...(m[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1] as string);
  const params: Record<string, string | number> = {};
  for (const p of (m[2] ?? "").split(";").slice(1)) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim();
    const v = p.slice(eq + 1).trim();
    params[k] = /^".*"$/.test(v) ? v.slice(1, -1) : Number(v);
  }
  return { raw, components, params };
}

/** The value a component stands for in the signature base (RFC 9421 §2). */
function componentValue(name: string, info: RequestInfo): string | null {
  const url = new URL(info.url);
  switch (name) {
    case "@authority":
      return url.host.toLowerCase();
    case "@method":
      return info.method.toUpperCase();
    case "@path":
      return url.pathname;
    case "@target-uri":
      return url.href;
    case "@scheme":
      return url.protocol.replace(":", "");
    case "@query":
      return url.search || "?";
    default:
      return name.startsWith("@") ? null : info.headers.get(name);
  }
}

/** RFC 7638 thumbprint of an Ed25519 JWK, the keyid Web Bot Auth signs with. */
export async function jwkThumbprint(jwk: { crv: string; kty: string; x: string }): Promise<string> {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  let bin = "";
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

type Jwk = { kty: string; crv: string; x: string };

/** Key directories, by operator origin, for an hour (a failure for five minutes). */
const directories = new Map<string, { keys: Jwk[]; until: number }>();

async function directoryKeys(operator: string, fetchFn: typeof fetch): Promise<Jwk[]> {
  const url = directoryUrl(operator);
  if (!url) return [];
  const cached = directories.get(url.origin);
  if (cached && cached.until > Date.now()) return cached.keys;
  let keys: Jwk[] = [];
  try {
    const res = await fetchFn(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(3000),
      headers: { accept: "application/http-message-signatures-directory+json, application/json" },
    });
    const text = res.ok ? await res.text() : "";
    if (text.length <= MAX_DIRECTORY_BYTES && text) {
      const body = JSON.parse(text) as { keys?: unknown[] };
      keys = (body.keys ?? []).filter(
        (k): k is Jwk =>
          typeof k === "object" &&
          k !== null &&
          (k as Jwk).kty === "OKP" &&
          (k as Jwk).crv === "Ed25519" &&
          typeof (k as Jwk).x === "string",
      );
    }
  } catch {}
  directories.set(url.origin, {
    keys,
    until: Date.now() + (keys.length ? 3_600_000 : 300_000),
  });
  return keys;
}

/** Drops cached key directories (tests, key rotation). */
export function clearAgentDirectories(): void {
  directories.clear();
}

const originOf = (s: string) => {
  try {
    return new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).origin;
  } catch {
    return null;
  }
};

/**
 * Verifies a request's Web Bot Auth signature against the policy: the operator must be allowed,
 * the signature fresh, its key in the operator's directory, and the Ed25519 signature valid over
 * the components it names.
 */
export async function verifyAgent(info: RequestInfo, policy: AgentPolicy): Promise<AgentResult> {
  const inputs = members(info.headers.get("signature-input") ?? "");
  const signatures = members(info.headers.get("signature") ?? "");
  let label: string | null = null;
  let input: SignatureInput | null = null;
  for (const [l, raw] of inputs) {
    const parsed = parseInput(raw);
    if (parsed?.params.tag === "web-bot-auth") {
      label = l;
      input = parsed;
      break;
    }
  }
  const agentHeader = info.headers.get("signature-agent") ?? "";
  // A string (`"https://…"`) in early drafts, a dictionary keyed by the signature's label later.
  const agentValue = /^".*"$/.test(agentHeader.trim())
    ? agentHeader.trim()
    : label
      ? (members(agentHeader).get(label) ?? "")
      : "";
  const operator = originOf(agentValue.replace(/^"|"$/g, ""));
  if (!label || !input || !operator) return { ok: false, operator, reason: "malformed" };
  const allowed = Object.keys(policy.allow).some((k) => originOf(k) === operator);
  if (!allowed) return { ok: false, operator, reason: "not-allowed" };
  const now = Math.floor(Date.now() / 1000);
  const { created, expires, keyid, alg } = input.params;
  if (typeof created !== "number" || typeof keyid !== "string")
    return { ok: false, operator, reason: "malformed" };
  if (alg !== undefined && alg !== "ed25519") return { ok: false, operator, reason: "malformed" };
  if (
    created > now + (policy.clockSkewSeconds ?? 60) ||
    (typeof expires === "number" && expires < now)
  )
    return { ok: false, operator, reason: "expired" };
  const signature = /^:([A-Za-z0-9+/=]+):$/.exec(signatures.get(label) ?? "")?.[1];
  if (!signature) return { ok: false, operator, reason: "malformed" };
  const lines: string[] = [];
  for (const name of input.components) {
    const value = componentValue(name, info);
    if (value === null) return { ok: false, operator, reason: "malformed" };
    lines.push(`"${name}": ${value.trim()}`);
  }
  lines.push(`"@signature-params": ${input.raw}`);
  const keys = await directoryKeys(operator, policy.fetch ?? fetch);
  let jwk: Jwk | undefined;
  for (const k of keys) if ((await jwkThumbprint(k)) === keyid) jwk = k;
  if (!jwk) return { ok: false, operator, reason: "no-key" };
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "OKP", crv: "Ed25519", x: jwk.x },
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const sig = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify(
      "Ed25519",
      key,
      sig,
      new TextEncoder().encode(lines.join("\n")),
    );
    return ok ? { ok: true, operator, keyid } : { ok: false, operator, reason: "bad-signature" };
  } catch {
    return { ok: false, operator, reason: "bad-signature" };
  }
}

/** The operator key of `policy.allow` matching a verified operator origin. */
export function policyFor(policy: AgentPolicy, operator: string) {
  const key = Object.keys(policy.allow).find((k) => originOf(k) === operator);
  return key ? policy.allow[key] : undefined;
}
