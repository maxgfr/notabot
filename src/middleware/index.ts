// The server half as a library: analyse a request, verify the token the page obtained, serve the
// challenge / verify / siteverify endpoints, and gate routes in Express, Hono or any Fetch server.

import type { BehaviorFeatures } from "../behavior/index";
import {
  botProbabilityOf,
  buildPrompt,
  parseVerdict,
  SYSTEM_PROMPT,
  toFeatures,
} from "../llm/index";
import { base64urlDecode, hmacHex, sha256Hex } from "../pow/crypto";
import { blend, type Flag, type ScoreResult, score, type Verdict, verdictOf } from "../score/index";
import {
  createChallenge,
  signToken,
  type TokenClaims,
  verifySolution,
  verifyToken,
} from "../server/index";
import type { NotabotSignals } from "../signals/types";
import {
  combine,
  crossCheckFlags,
  type NetworkInfo,
  REQUEST_RULES,
  type RequestInfo,
  type RequestRule,
  requestFlags,
} from "./request";

/** Where single-use ids (puzzles, tokens) are remembered until they expire. */
export interface ReplayStore {
  /** Records `key` for `ttlSeconds`; resolves false when it was already there. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
}

/** An in-memory store: fine for one process; use KV, Redis or a database across instances. */
export function memoryStore(): ReplayStore {
  const seen = new Map<string, number>();
  return {
    async claim(key, ttl) {
      const now = Date.now();
      if (seen.size > 10_000) for (const [k, exp] of seen) if (exp < now) seen.delete(k);
      const exp = seen.get(key);
      if (exp !== undefined && exp > now) return false;
      seen.set(key, now + ttl * 1000);
      return true;
    },
  };
}

/** A store over any key-value API with expiry (Cloudflare KV, Redis, Upstash…). */
export function kvStore(kv: {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}): ReplayStore {
  return {
    async claim(key, ttl) {
      if (await kv.get(key)) return false;
      await kv.put(key, "1", { expirationTtl: Math.max(60, ttl) });
      return true;
    },
  };
}

export interface NotabotServerOptions {
  /** Signs puzzles and tokens. Keep it secret, and long. */
  hmacKey: string;
  /** Secret your backend sends to /siteverify (optional when you use the middleware instead). */
  siteSecret?: string;
  /** Origins allowed to obtain and use tokens; empty or missing means any. */
  allowedOrigins?: string[];
  /** Verdicts the middleware lets through. Default ["human"]. */
  accept?: Verdict[];
  /** Refuse requests that carry no token. Default true; false scores the request alone. */
  requireToken?: boolean;
  /** Bind tokens to the User-Agent and IP they were issued to. Default true. */
  bindToken?: boolean;
  /** Accept the page's unsigned front-only tokens (demos, development). Default false. */
  allowUnsigned?: boolean;
  /** Let a token be used once (default) or until it expires. */
  singleUse?: boolean;
  /** Token lifetime in seconds. Default 300. */
  tokenTtl?: number;
  /** Proof-of-work size (average maxnumber / 2 hashes). Default 50 000. */
  maxnumber?: number;
  /** Header and form field the token arrives in. */
  tokenHeader?: string;
  tokenField?: string;
  /** Path prefix of the endpoints served by handle(). Default "/notabot". */
  basePath?: string;
  store?: ReplayStore;
  /** Request rules; default REQUEST_RULES. Add your own (JA4 lists, ASN lists, paths…). */
  rules?: RequestRule[];
  /** A model for /verify, OpenAI-compatible, with the server's key. */
  llm?: { endpoint: string; apiKey?: string; model?: string };
  /** Requests per IP per minute above which `rate` flags the request (0.4). Off by default. */
  ratePerMinute?: number;
}

export type DecisionReason =
  | "accepted"
  | "missing-token"
  | "bad-token"
  | "expired-token"
  | "wrong-origin"
  | "replayed-token"
  | "token-mismatch"
  | "unsigned-token"
  | "verdict";

export interface Decision {
  ok: boolean;
  reason: DecisionReason;
  verdict: Verdict;
  /** Probability of a bot after combining the token's score and the request's flags. */
  bot: number;
  /** Request flags (and the token's browser flags when the page posted them). */
  flags: Flag[];
  claims: TokenClaims | null;
}

export interface VerifyBody {
  signals?: NotabotSignals;
  behavior?: BehaviorFeatures | null;
  solution?: string;
}

const CORS_HEADERS = "content-type, x-notabot-token";

export interface Notabot {
  readonly options: Required<
    Pick<NotabotServerOptions, "accept" | "basePath" | "tokenHeader" | "tokenField">
  >;
  /** The request alone: headers, protocol, network. */
  analyzeRequest(info: RequestInfo): Promise<{ flags: Flag[]; bot: number; verdict: Verdict }>;
  /** The full decision for a request: its token (verified, bound, single-use) and its own flags. */
  verifyRequest(info: RequestInfo, token?: string | null): Promise<Decision>;
  /** Re-scores what a page posted and signs a token (the /verify endpoint). */
  verifySubmission(info: RequestInfo, body: VerifyBody): Promise<{ status: number; body: unknown }>;
  /** Serves GET {base}/challenge, POST {base}/verify and POST {base}/siteverify; null otherwise. */
  handle(request: Request, extra?: Partial<RequestInfo>): Promise<Response | null>;
  /** Wraps a Fetch handler: refused requests get 403 JSON, accepted ones reach `handler`. */
  protect<A extends unknown[]>(
    handler: (request: Request, ...rest: A) => Response | Promise<Response>,
    options?: { info?: (request: Request, ...rest: A) => Partial<RequestInfo> },
  ): (request: Request, ...rest: A) => Promise<Response>;
}

/** RequestInfo of a Fetch Request, with Cloudflare's `request.cf` when present. */
export function infoFromRequest(request: Request, extra: Partial<RequestInfo> = {}): RequestInfo {
  const cf = (request as Request & { cf?: NetworkInfo & { botManagement?: { ja4?: string } } }).cf;
  const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip");
  return {
    method: request.method,
    url: request.url,
    headers: request.headers,
    ip: forwarded ?? null,
    httpVersion: cf?.httpProtocol ? cf.httpProtocol.replace(/^HTTP\//, "") : null,
    network: cf ?? null,
    ja4: cf?.botManagement?.ja4 ?? null,
    ...extra,
  };
}

async function tokenFromRequest(
  request: Request,
  header: string,
  field: string,
): Promise<string | null> {
  const fromHeader = request.headers.get(header);
  if (fromHeader) return fromHeader;
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await request.clone().json()) as Record<string, unknown>;
      return typeof body[field] === "string" ? (body[field] as string) : null;
    }
    if (type.includes("form")) {
      const value = (await request.clone().formData()).get(field);
      return typeof value === "string" ? value : null;
    }
  } catch {}
  return null;
}

export function createNotabot(options: NotabotServerOptions): Notabot {
  if (!options.hmacKey) throw new Error("notabot: hmacKey is required");
  const key = options.hmacKey;
  const store = options.store ?? memoryStore();
  const rules = options.rules ?? REQUEST_RULES;
  const accept = options.accept ?? ["human"];
  const basePath = (options.basePath ?? "/notabot").replace(/\/$/, "");
  const tokenHeader = options.tokenHeader ?? "x-notabot-token";
  const tokenField = options.tokenField ?? "notabot-token";
  const bind = options.bindToken !== false;
  const ttl = options.tokenTtl ?? 300;
  const allowed = options.allowedOrigins ?? [];

  const originOk = (origin: string | null) =>
    !allowed.length || (origin !== null && allowed.includes(origin));
  const uaHash = async (info: RequestInfo) =>
    (await sha256Hex(info.headers.get("user-agent") ?? "")).slice(0, 16);
  const ipHash = async (info: RequestInfo) =>
    info.ip ? (await hmacHex(key, `ip:${info.ip}`)).slice(0, 16) : undefined;

  async function analyzeRequest(info: RequestInfo) {
    const flags = requestFlags(info, rules);
    if (options.ratePerMinute && info.ip) {
      const minute = Math.floor(Date.now() / 60_000);
      let count = 0;
      for (let i = 0; i <= options.ratePerMinute; i++) {
        if (await store.claim(`rate:${info.ip}:${minute}:${i}`, 120)) break;
        count++;
      }
      if (count >= options.ratePerMinute)
        flags.push({
          id: "rate",
          category: "behavior",
          weight: 0.4,
          explain: `More than ${options.ratePerMinute} requests a minute from this IP.`,
          detail: info.ip,
        });
    }
    const bot = combine(...flags.map((f) => f.weight));
    return { flags, bot, verdict: verdictOf(bot) };
  }

  const refuse = (
    reason: DecisionReason,
    flags: Flag[],
    claims: TokenClaims | null = null,
    bot = 1,
  ): Decision => ({
    ok: false,
    reason,
    verdict: "bot",
    bot,
    flags,
    claims,
  });

  async function verifyRequest(info: RequestInfo, token?: string | null): Promise<Decision> {
    const analysis = await analyzeRequest(info);
    const origin = info.headers.get("origin");
    if (origin && !originOk(origin)) return refuse("wrong-origin", analysis.flags);
    if (!token) {
      if (options.requireToken !== false)
        return refuse("missing-token", analysis.flags, null, analysis.bot);
      return {
        ok: accept.includes(analysis.verdict),
        reason: accept.includes(analysis.verdict) ? "accepted" : "verdict",
        verdict: analysis.verdict,
        bot: analysis.bot,
        flags: analysis.flags,
        claims: null,
      };
    }
    let claims: TokenClaims;
    if (token.startsWith("unsigned.")) {
      if (!options.allowUnsigned) return refuse("unsigned-token", analysis.flags);
      try {
        const raw = JSON.parse(
          base64urlDecode(token.slice("unsigned.".length)),
        ) as Partial<TokenClaims>;
        claims = {
          v: 1,
          verdict: raw.verdict ?? "unsure",
          bot: typeof raw.bot === "number" ? raw.bot : 0.5,
          iat: raw.iat ?? 0,
          exp: (raw.iat ?? 0) + ttl,
          jti: "unsigned",
        };
      } catch {
        return refuse("bad-token", analysis.flags);
      }
    } else {
      const result = await verifyToken(token, key);
      if (!result.ok)
        return refuse(result.reason === "expired" ? "expired-token" : "bad-token", analysis.flags);
      claims = result.claims;
      if (claims.origin && !originOk(claims.origin))
        return refuse("wrong-origin", analysis.flags, claims);
      if (bind) {
        if (claims.uah && claims.uah !== (await uaHash(info)))
          return refuse("token-mismatch", analysis.flags, claims);
        const iph = await ipHash(info);
        if (claims.iph && iph && claims.iph !== iph)
          return refuse("token-mismatch", analysis.flags, claims);
      }
      if (
        options.singleUse !== false &&
        !(await store.claim(`token:${claims.jti}`, Math.max(60, claims.exp - claims.iat)))
      )
        return refuse("replayed-token", analysis.flags, claims);
    }
    const bot = combine(claims.bot, ...analysis.flags.map((f) => f.weight));
    // The token's verdict holds unless the request itself pushes the score past a threshold.
    const verdict = analysis.flags.length ? verdictOf(bot) : claims.verdict;
    const ok = accept.includes(verdict);
    return { ok, reason: ok ? "accepted" : "verdict", verdict, bot, flags: analysis.flags, claims };
  }

  async function askModel(features: ReturnType<typeof toFeatures>): Promise<number | null> {
    const llm = options.llm;
    if (!llm) return null;
    try {
      const res = await fetch(`${llm.endpoint.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(llm.apiKey ? { authorization: `Bearer ${llm.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: llm.model ?? "default",
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

  async function verifySubmission(info: RequestInfo, body: VerifyBody) {
    if (!body?.signals?.env || typeof body.solution !== "string")
      return { status: 400, body: { error: "signals and solution required" } };
    const origin = info.headers.get("origin");
    if (origin && !originOk(origin)) return { status: 403, body: { error: "origin not allowed" } };
    const pow = await verifySolution(body.solution, key);
    if (!pow.ok) return { status: 403, body: { error: `proof of work: ${pow.reason}` } };
    if (!(await store.claim(`pow:${pow.solution.challenge}`, 900)))
      return { status: 403, body: { error: "proof of work: replayed" } };
    const scored: ScoreResult = score({ signals: body.signals, behavior: body.behavior ?? null });
    const flags = [
      ...scored.flags,
      ...requestFlags(info, rules),
      ...crossCheckFlags(info, body.signals),
    ];
    const rulesBot = combine(...flags.map((f) => f.weight));
    const modelBot = await askModel(
      toFeatures(body.signals, { ...scored, bot: rulesBot, flags }, body.behavior),
    );
    const bot = Math.round(blend(rulesBot, modelBot) * 1000) / 1000;
    const verdict = verdictOf(bot);
    const token = await signToken(
      {
        verdict,
        bot,
        ttlSeconds: ttl,
        ...(origin ? { origin } : {}),
        ...(bind ? { uah: await uaHash(info) } : {}),
        ...(bind && info.ip ? { iph: await ipHash(info) } : {}),
      } as Parameters<typeof signToken>[0],
      key,
    );
    return {
      status: 200,
      body: { token, verdict, bot, flags: flags.map((f) => f.id), model: modelBot !== null },
    };
  }

  function cors(request: Request): Record<string, string> {
    const origin = request.headers.get("origin");
    return {
      "access-control-allow-origin":
        origin && originOk(origin) ? origin : allowed.length ? "null" : "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": CORS_HEADERS,
      vary: "origin",
    };
  }

  async function handle(
    request: Request,
    extra: Partial<RequestInfo> = {},
  ): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${basePath}/`) && url.pathname !== basePath) return null;
    const route = url.pathname.slice(basePath.length).replace(/^\/|\/$/g, "");
    const headers = cors(request);
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const info = infoFromRequest(request, extra);
    if (route === "challenge" && request.method === "GET")
      return json(
        await createChallenge({
          hmacKey: key,
          ...(options.maxnumber ? { maxnumber: options.maxnumber } : {}),
        }),
      );
    if (route === "verify" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as VerifyBody | null;
      const out = await verifySubmission(info, body ?? {});
      return json(out.body, out.status);
    }
    if (route === "siteverify" && request.method === "POST") {
      const form = (request.headers.get("content-type") ?? "").includes("json")
        ? ((await request.json().catch(() => ({}))) as Record<string, string>)
        : (Object.fromEntries(await request.formData().catch(() => new FormData())) as Record<
            string,
            string
          >);
      if (options.siteSecret && form.secret !== options.siteSecret)
        return json({ success: false, "error-codes": ["invalid-input-secret"] }, 403);
      const result = await verifyToken(String(form.response ?? ""), key);
      if (!result.ok) return json({ success: false, "error-codes": [result.reason] });
      if (
        !(await store.claim(
          `token:${result.claims.jti}`,
          Math.max(60, result.claims.exp - result.claims.iat),
        ))
      )
        return json({ success: false, "error-codes": ["timeout-or-duplicate"] });
      const c = result.claims;
      return json({
        success: accept.includes(c.verdict),
        verdict: c.verdict,
        bot: c.bot,
        score: Math.round((1 - c.bot) * 100) / 100,
        challenge_ts: new Date(c.iat * 1000).toISOString(),
        hostname: c.origin ? new URL(c.origin).hostname : null,
      });
    }
    return json({ error: "not found" }, 404);
  }

  function protect<A extends unknown[]>(
    handler: (request: Request, ...rest: A) => Response | Promise<Response>,
    opts: { info?: (request: Request, ...rest: A) => Partial<RequestInfo> } = {},
  ) {
    return async (request: Request, ...rest: A): Promise<Response> => {
      const extra = opts.info?.(request, ...rest) ?? {};
      const served = await handle(request, extra);
      if (served) return served;
      const decision = await verifyRequest(
        infoFromRequest(request, extra),
        await tokenFromRequest(request, tokenHeader, tokenField),
      );
      if (!decision.ok) return refusal(decision);
      return handler(request, ...rest);
    };
  }

  return {
    options: { accept, basePath, tokenHeader, tokenField },
    analyzeRequest,
    verifyRequest,
    verifySubmission,
    handle,
    protect,
  };
}

/** The JSON a refused request gets: the reason and the flags, never the token. */
export function refusal(decision: Decision): Response {
  return Response.json(
    {
      error: "notabot",
      reason: decision.reason,
      verdict: decision.verdict,
      bot: decision.bot,
      flags: decision.flags.map((f) => f.id),
    },
    { status: 403 },
  );
}

export * from "./adapters";
export {
  combine,
  crossCheckFlags,
  HTTP_LIBRARIES,
  type NetworkInfo,
  REQUEST_RULES,
  type RequestInfo,
  type RequestRule,
  requestFlags,
} from "./request";
export { tokenFromRequest };
