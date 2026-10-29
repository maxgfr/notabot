// The server half of notabot, as a Cloudflare Worker: it signs puzzles, checks solutions,
// re-scores the signals with what only a server sees (IP network, TLS and HTTP version,
// headers), asks a model with its own key, and signs a short-lived token for your backend.
//
//   GET  /challenge   → a signed proof-of-work puzzle
//   POST /verify      ← { signals, behavior, solution }  → { token, verdict, bot, flags }
//   POST /siteverify  ← { secret, response }  → { success, verdict, bot, ... }  (reCAPTCHA-like)
//
// Secrets: NOTABOT_HMAC_KEY (signs everything), NOTABOT_SITE_SECRET (your backend's).
// Optional: LLM_ENDPOINT (OpenAI-compatible base URL), LLM_API_KEY, LLM_MODEL,
// ALLOWED_ORIGINS (comma-separated), and a KV namespace NOTABOT_KV to refuse replays.
import {
  botProbabilityOf,
  buildPrompt,
  parseVerdict,
  SYSTEM_PROMPT,
  toFeatures,
} from "notabot/llm";
import { blend, type Flag, score, verdictOf } from "notabot/score";
import { createChallenge, signToken, verifySolution, verifyToken } from "notabot/server";

interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  NOTABOT_HMAC_KEY: string;
  NOTABOT_SITE_SECRET?: string;
  LLM_ENDPOINT?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  ALLOWED_ORIGINS?: string;
  MAX_NUMBER?: string;
  NOTABOT_KV?: KV;
}

/** What Cloudflare tells a Worker about the connection (request.cf). */
interface Cf {
  asn?: number;
  asOrganization?: string;
  country?: string;
  timezone?: string;
  httpProtocol?: string;
  tlsVersion?: string;
}

const HOSTING =
  /amazon|aws|google cloud|google llc|microsoft|azure|ovh|hetzner|digitalocean|linode|akamai|oracle|alibaba|tencent|scaleway|contabo|vultr|m247|datacamp|leaseweb|choopa/i;

// Without KV, replays are refused for this isolate only.
const seen = new Set<string>();

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "*").split(",").map((s) => s.trim());
  const ok = allowed.includes("*") || allowed.includes(origin);
  return {
    "access-control-allow-origin": ok ? origin || "*" : "null",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
}

/** Evidence only the server has: the network, the protocol, the headers the browser really sent. */
export function serverFlags(req: Request, signals: Parameters<typeof score>[0]["signals"]): Flag[] {
  const cf = (req as Request & { cf?: Cf }).cf;
  const flags: Flag[] = [];
  const add = (id: string, weight: number, explain: string, detail: string) =>
    flags.push({ id, category: "consistency", weight, explain, detail });
  const ua = req.headers.get("user-agent") ?? "";
  if (ua && ua !== signals.env.userAgent)
    add(
      "server-user-agent",
      0.8,
      "The User-Agent header differs from navigator.userAgent.",
      ua.slice(0, 80),
    );
  const lang = (req.headers.get("accept-language") ?? "").split(",")[0]?.split(";")[0]?.trim();
  if (
    lang &&
    signals.env.languages[0] &&
    lang.toLowerCase() !== signals.env.languages[0].toLowerCase()
  )
    add(
      "server-language",
      0.3,
      "Accept-Language differs from navigator.languages.",
      `${lang} vs ${signals.env.languages[0]}`,
    );
  if (cf?.asOrganization && HOSTING.test(cf.asOrganization))
    add(
      "server-hosting-network",
      0.5,
      "The IP belongs to a hosting provider, not an internet access provider.",
      cf.asOrganization,
    );
  if (cf?.timezone && signals.env.timezone && cf.timezone !== signals.env.timezone)
    add(
      "server-timezone",
      0.35,
      "The IP's time zone differs from the browser's (VPNs do this too).",
      `${cf.timezone} vs ${signals.env.timezone}`,
    );
  if (cf?.httpProtocol?.startsWith("HTTP/1") && /Chrome\//.test(signals.env.userAgent))
    add(
      "server-http1",
      0.4,
      "A Chrome that speaks HTTP/1: real Chrome negotiates HTTP/2 or 3.",
      cf.httpProtocol,
    );
  return flags;
}

async function askModel(env: Env, features: ReturnType<typeof toFeatures>): Promise<number | null> {
  if (!env.LLM_ENDPOINT) return null;
  try {
    const res = await fetch(`${env.LLM_ENDPOINT.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.LLM_API_KEY ? { authorization: `Bearer ${env.LLM_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: env.LLM_MODEL ?? "default",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt(features) },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const verdict = parseVerdict(body.choices?.[0]?.message?.content ?? "");
    return verdict ? botProbabilityOf(verdict) : null;
  } catch {
    return null;
  }
}

async function used(env: Env, challenge: string): Promise<boolean> {
  if (env.NOTABOT_KV) {
    if (await env.NOTABOT_KV.get(challenge)) return true;
    await env.NOTABOT_KV.put(challenge, "1", { expirationTtl: 900 });
    return false;
  }
  if (seen.has(challenge)) return true;
  seen.add(challenge);
  return false;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const headers = cors(req, env);
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (!env.NOTABOT_HMAC_KEY) return json({ error: "NOTABOT_HMAC_KEY is not set" }, 500);
    const path = url.pathname.replace(/\/$/, "").split("/").pop();

    if (path === "challenge" && req.method === "GET") {
      const maxnumber = Number(env.MAX_NUMBER) || undefined;
      return json(
        await createChallenge({
          hmacKey: env.NOTABOT_HMAC_KEY,
          ...(maxnumber ? { maxnumber } : {}),
        }),
      );
    }

    if (path === "verify" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as {
        signals?: Parameters<typeof score>[0]["signals"];
        behavior?: Parameters<typeof score>[0]["behavior"];
        solution?: string;
      } | null;
      if (!body?.signals?.env || !body.solution)
        return json({ error: "signals and solution required" }, 400);
      const pow = await verifySolution(body.solution, env.NOTABOT_HMAC_KEY);
      if (!pow.ok) return json({ error: `proof of work: ${pow.reason}` }, 403);
      if (await used(env, pow.solution.challenge))
        return json({ error: "proof of work: replayed" }, 403);
      const rules = score({ signals: body.signals, behavior: body.behavior ?? null });
      const flags = [...rules.flags, ...serverFlags(req, body.signals)];
      const rulesBot = 1 - flags.reduce((p, f) => p * (1 - f.weight), 1);
      const modelBot = await askModel(
        env,
        toFeatures(body.signals, { ...rules, bot: rulesBot, flags }, body.behavior),
      );
      const bot = Math.round(blend(rulesBot, modelBot) * 1000) / 1000;
      const verdict = verdictOf(bot);
      const origin = req.headers.get("origin") ?? undefined;
      const token = await signToken(
        { verdict, bot, ...(origin ? { origin } : {}) },
        env.NOTABOT_HMAC_KEY,
      );
      return json({ token, verdict, bot, flags: flags.map((f) => f.id), model: modelBot !== null });
    }

    if (path === "siteverify" && req.method === "POST") {
      const form = req.headers.get("content-type")?.includes("json")
        ? ((await req.json().catch(() => ({}))) as Record<string, string>)
        : Object.fromEntries(await req.formData().catch(() => new FormData()));
      if (env.NOTABOT_SITE_SECRET && form.secret !== env.NOTABOT_SITE_SECRET)
        return json({ success: false, "error-codes": ["invalid-input-secret"] }, 403);
      const result = await verifyToken(String(form.response ?? ""), env.NOTABOT_HMAC_KEY);
      if (!result.ok) return json({ success: false, "error-codes": [result.reason] });
      if (await used(env, `token:${result.claims.jti}`))
        return json({ success: false, "error-codes": ["timeout-or-duplicate"] });
      const c = result.claims;
      return json({
        success: c.verdict === "human",
        verdict: c.verdict,
        bot: c.bot,
        score: Math.round((1 - c.bot) * 100) / 100,
        challenge_ts: new Date(c.iat * 1000).toISOString(),
        hostname: c.origin ? new URL(c.origin).hostname : null,
      });
    }

    return json({ error: "not found" }, 404);
  },
};
