// The server half as a library: analyse a request, verify the token the page obtained, serve the
// challenge / verify / slide / siteverify endpoints, and gate routes in Express, Hono or any
// Fetch server.

import {
  type BehaviorFeatures,
  judgeKeySlide,
  judgeSlide,
  type PointerSample,
} from "../behavior/index";
import {
  botProbabilityOf,
  buildPrompt,
  parseVerdict,
  SYSTEM_PROMPT,
  toFeatures,
} from "../llm/index";
import { base64urlDecode, hmacHex, safeEqual, sha256Hex } from "../pow/crypto";
import {
  blend,
  type Flag,
  type ScoreResult,
  score,
  THRESHOLDS,
  type Verdict,
  verdictOf,
} from "../score/index";
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
import { isBehavior, isSignals } from "./schema";
import { countIn, memoryStore, type ReplayStore } from "./store";

/** Which proxy, if any, may tell the client IP: never trust a header nobody vouches for. */
export type TrustProxy = "cloudflare" | "x-forwarded-for" | false;

export interface NotabotServerOptions {
  /** Signs puzzles and tokens. Keep it secret, and long. */
  hmacKey: string;
  /** Secret your backend sends to /siteverify (optional when you use the middleware instead). */
  siteSecret?: string;
  /**
   * Origins allowed to obtain and use tokens; empty or missing means any. When set, a POST to
   * /verify or /slide without an Origin header is refused: a browser always sends one.
   */
  allowedOrigins?: string[];
  /** Verdicts the middleware lets through. Default ["human"]. */
  accept?: Verdict[];
  /** Refuse requests that carry no token. Default true; false scores the request alone. */
  requireToken?: boolean;
  /**
   * Bind tokens to the User-Agent and IP they were issued to. Default true. A token bound to an
   * IP is refused when the request's IP is unknown.
   */
  bindToken?: boolean;
  /** Accept the page's unsigned front-only tokens (demos, development). Default false. */
  allowUnsigned?: boolean;
  /** Let a token be used once per use (gate, siteverify) — the default — or until it expires. */
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
  /** Default {@link memoryStore}: one process only. Use {@link redisStore} across instances. */
  store?: ReplayStore;
  /** Request rules; default REQUEST_RULES. Add your own (JA4 lists, ASN lists, paths…). */
  rules?: RequestRule[];
  /** A model for /verify, OpenAI-compatible, with the server's key. */
  llm?: { endpoint: string; apiKey?: string; model?: string };
  /**
   * Requests per IP per minute above which `rate` flags the request (0.4) and /challenge answers
   * 429. Off by default.
   */
  ratePerMinute?: number;
  /**
   * Who tells the client IP. Default false: only the platform (Cloudflare's `request.cf`, the
   * Node adapter's `req.ip`) or an `ip` you pass. "cloudflare" reads cf-connecting-ip,
   * "x-forwarded-for" the last hop your proxy appended. A header no proxy overwrites is forged.
   */
  trustProxy?: TrustProxy;
  /** Your own way to read the client IP, when the platform has one (Deno's `remoteAddr`…). */
  getIp?: (request: Request) => string | null | undefined;
  /** Largest body the endpoints read, in bytes. Default 128 KiB. */
  maxBodyBytes?: number;
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

/** What the widget posts to {base}/slide: the token it got and the gesture, never a verdict. */
export interface SlideBody {
  token?: string;
  /** Pointer samples of the drag, with the track's left edge and width in the same pixels. */
  samples?: PointerSample[];
  track?: { left: number; width: number };
  /** Or the keyboard way: timestamps of the arrow keys, and where the handle ended (0–100). */
  keyTimes?: number[];
  keysTrusted?: boolean;
  position?: number;
  /** Whether the handle ended in the zone; read only when the token carries no zone. */
  landed?: boolean;
}

/** Why an endpoint refused, for the widget to tell an expired puzzle from a refusal. */
export type EndpointReason = "malformed" | "expired" | "replayed" | "refused" | "rate-limited";

export interface EndpointResult {
  status: number;
  body: { error?: string; reason?: EndpointReason } & Record<string, unknown>;
}

const CORS_HEADERS = "content-type, x-notabot-token";
const DEFAULT_MAX_BODY = 128 * 1024;
/** Times one exact signals blob may be posted to /verify in ten minutes. */
const SIGNALS_REUSE = 5;
/** Slider attempts per token, as many as the widget allows. */
const SLIDE_ATTEMPTS = 3;
/** Width of the slider's target zone, in percent of the track. */
const ZONE_WIDTH = 14;

export interface Notabot {
  readonly options: Required<
    Pick<
      NotabotServerOptions,
      "accept" | "basePath" | "tokenHeader" | "tokenField" | "trustProxy" | "maxBodyBytes"
    >
  >;
  /** RequestInfo of a Fetch Request, its IP read as `trustProxy` / `getIp` allow. */
  requestInfo(request: Request, extra?: Partial<RequestInfo>): RequestInfo;
  /** The request alone: headers, protocol, network, rate. */
  analyzeRequest(info: RequestInfo): Promise<{ flags: Flag[]; bot: number; verdict: Verdict }>;
  /** The full decision for a request: its token (verified, bound, single-use) and its own flags. */
  verifyRequest(info: RequestInfo, token?: string | null): Promise<Decision>;
  /** Re-scores what a page posted and signs a token (the /verify endpoint). */
  verifySubmission(info: RequestInfo, body: unknown): Promise<EndpointResult>;
  /** Re-judges a slider gesture and re-signs the token as human when it passes (/slide). */
  verifySlide(info: RequestInfo, body: unknown): Promise<EndpointResult>;
  /**
   * Serves GET {base}/challenge and POST {base}/verify, {base}/slide and {base}/siteverify; null
   * for any other path.
   */
  handle(request: Request, extra?: Partial<RequestInfo>): Promise<Response | null>;
  /** Wraps a Fetch handler: refused requests get 403 JSON, accepted ones reach `handler`. */
  protect<A extends unknown[]>(
    handler: (request: Request, ...rest: A) => Response | Promise<Response>,
    options?: { info?: (request: Request, ...rest: A) => Partial<RequestInfo> },
  ): (request: Request, ...rest: A) => Promise<Response>;
}

/**
 * The client IP a request can vouch for: cf-connecting-ip when Cloudflare set it (`request.cf`
 * exists, or `trust` says Cloudflare is in front), the last X-Forwarded-For hop when `trust`
 * says a proxy appends it, and null otherwise.
 */
export function clientIp(request: Request, trust: TrustProxy = false): string | null {
  const cf = (request as Request & { cf?: unknown }).cf;
  if (cf || trust === "cloudflare") return request.headers.get("cf-connecting-ip");
  if (trust === "x-forwarded-for") {
    const hops = (request.headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return hops[hops.length - 1] ?? null;
  }
  return null;
}

export interface IpTrust {
  trustProxy?: TrustProxy;
  getIp?: (request: Request) => string | null | undefined;
}

/** RequestInfo of a Fetch Request, with Cloudflare's `request.cf` when present. */
export function infoFromRequest(
  request: Request,
  extra: Partial<RequestInfo> = {},
  trust: IpTrust = {},
): RequestInfo {
  const cf = (request as Request & { cf?: NetworkInfo & { botManagement?: { ja4?: string } } }).cf;
  return {
    method: request.method,
    url: request.url,
    headers: request.headers,
    ip: trust.getIp?.(request) ?? clientIp(request, trust.trustProxy ?? false),
    httpVersion: cf?.httpProtocol ? cf.httpProtocol.replace(/^HTTP\//, "") : null,
    network: cf ?? null,
    ja4: cf?.botManagement?.ja4 ?? null,
    ...extra,
  };
}

/** The body as text, or null when it is larger than `max` bytes (read no further than that). */
export async function readCapped(request: Request, max: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isSamples(v: unknown): v is PointerSample[] {
  return (
    Array.isArray(v) &&
    v.length <= 2000 &&
    v.every(
      (s) =>
        isRecord(s) &&
        finite(s.x) &&
        finite(s.y) &&
        finite(s.t) &&
        typeof s.trusted === "boolean" &&
        finite(s.coalesced) &&
        finite(s.pressure) &&
        typeof s.type === "string",
    )
  );
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
  const trustProxy = options.trustProxy ?? false;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const bind = options.bindToken !== false;
  const singleUse = options.singleUse !== false;
  const ttl = options.tokenTtl ?? 300;
  const allowed = options.allowedOrigins ?? [];
  const trust: IpTrust = { trustProxy, ...(options.getIp ? { getIp: options.getIp } : {}) };

  const originOk = (origin: string | null) =>
    !allowed.length || (origin !== null && allowed.includes(origin));
  // A browser's POST always carries Origin: without one, it did not come from an allowed page.
  const postOriginOk = (origin: string | null) => (origin ? originOk(origin) : !allowed.length);
  const uaHashOf = async (ua: string) => (await sha256Hex(ua)).slice(0, 16);
  const uaHash = (info: RequestInfo) => uaHashOf(info.headers.get("user-agent") ?? "");
  const ipHashOf = async (ip: string) => (await hmacHex(key, `ip:${ip}`)).slice(0, 16);
  const minute = () => Math.floor(Date.now() / 60_000);
  const lifetime = (c: TokenClaims) => Math.max(60, c.exp - c.iat);

  /** Whether `claims` were issued to this user agent and IP; an IP-bound token needs an IP. */
  async function bound(claims: TokenClaims, ua: string, ip: string | null | undefined) {
    if (claims.uah && claims.uah !== (await uaHashOf(ua))) return false;
    if (claims.iph && (!ip || claims.iph !== (await ipHashOf(ip)))) return false;
    return true;
  }

  async function analyzeRequest(info: RequestInfo) {
    const flags = requestFlags(info, rules);
    const limit = options.ratePerMinute;
    if (limit && info.ip) {
      const count = await countIn(store, `rate:${await ipHashOf(info.ip)}:${minute()}`, 120, limit);
      if (count > limit)
        flags.push({
          id: "rate",
          category: "behavior",
          weight: 0.4,
          explain: `More than ${limit} requests a minute from this IP.`,
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
        if (!finite(raw.iat)) return refuse("bad-token", analysis.flags);
        claims = {
          v: 1,
          verdict: raw.verdict ?? "unsure",
          bot: typeof raw.bot === "number" ? raw.bot : 0.5,
          iat: raw.iat,
          exp: raw.iat + ttl,
          jti: "unsigned",
        };
      } catch {
        return refuse("bad-token", analysis.flags);
      }
      if (claims.exp * 1000 < Date.now()) return refuse("expired-token", analysis.flags);
    } else {
      const result = await verifyToken(token, key);
      if (!result.ok)
        return refuse(result.reason === "expired" ? "expired-token" : "bad-token", analysis.flags);
      claims = result.claims;
      if (claims.origin && !originOk(claims.origin))
        return refuse("wrong-origin", analysis.flags, claims);
      if (bind && !(await bound(claims, info.headers.get("user-agent") ?? "", info.ip)))
        return refuse("token-mismatch", analysis.flags, claims);
      if (singleUse && !(await store.claim(`token:gate:${claims.jti}`, lifetime(claims))))
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

  /** Signs a token for this request: origin, user agent and IP bound as the options say. */
  async function issue(
    info: RequestInfo,
    claims: { verdict: Verdict; bot: number; zone?: number },
  ): Promise<{ token: string; exp: number }> {
    const origin = info.headers.get("origin");
    const iph = bind && info.ip ? await ipHashOf(info.ip) : undefined;
    const token = await signToken(
      {
        ...claims,
        ttlSeconds: ttl,
        ...(origin ? { origin } : {}),
        ...(bind ? { uah: await uaHash(info) } : {}),
        ...(iph ? { iph } : {}),
      },
      key,
    );
    return { token, exp: Math.floor(Date.now() / 1000) + ttl };
  }

  const fail = (status: number, reason: EndpointReason, error: string): EndpointResult => ({
    status,
    body: { error, reason },
  });

  async function verifySubmission(info: RequestInfo, raw: unknown): Promise<EndpointResult> {
    const body: VerifyBody = isRecord(raw) ? raw : {};
    if (!isSignals(body.signals) || typeof body.solution !== "string" || !isBehavior(body.behavior))
      return fail(400, "malformed", "signals and solution required");
    if (!postOriginOk(info.headers.get("origin")))
      return fail(403, "refused", "origin not allowed");
    const pow = await verifySolution(body.solution, key);
    if (!pow.ok)
      return fail(
        403,
        pow.reason === "expired" ? "expired" : "refused",
        `proof of work: ${pow.reason}`,
      );
    if (!(await store.claim(`pow:${pow.solution.challenge}`, 900)))
      return fail(403, "replayed", "proof of work: replayed");
    // A recorded blob posted again and again, each time with a fresh proof of work.
    const blob = await sha256Hex(JSON.stringify(body.signals));
    if ((await countIn(store, `signals:${blob}`, 600, SIGNALS_REUSE)) > SIGNALS_REUSE)
      return fail(429, "replayed", "signals replayed");
    const behavior = body.behavior ?? null;
    const scored: ScoreResult = score({ signals: body.signals, behavior });
    const analysis = await analyzeRequest(info);
    const flags = [...scored.flags, ...analysis.flags, ...crossCheckFlags(info, body.signals)];
    const rulesBot = combine(...flags.map((f) => f.weight));
    const modelBot = await askModel(
      toFeatures(body.signals, { ...scored, bot: rulesBot, flags }, behavior),
    );
    const bot = Math.round(blend(rulesBot, modelBot) * 1000) / 1000;
    const verdict = verdictOf(bot);
    // Where the slider's zone sits: chosen and signed here, so the page cannot pick it.
    const zone = verdict === "unsure" ? Math.round(45 + Math.random() * 38) : undefined;
    const { token, exp } = await issue(info, { verdict, bot, ...(zone ? { zone } : {}) });
    return {
      status: 200,
      body: {
        token,
        verdict,
        bot,
        exp,
        ...(zone ? { zone } : {}),
        flags: flags.map((f) => f.id),
        model: modelBot !== null,
      },
    };
  }

  async function verifySlide(info: RequestInfo, raw: unknown): Promise<EndpointResult> {
    const body: SlideBody = isRecord(raw) ? raw : {};
    const track = isRecord(body.track) ? body.track : null;
    const samples = isSamples(body.samples) && track ? body.samples : null;
    const keyTimes =
      Array.isArray(body.keyTimes) && body.keyTimes.length <= 500 && body.keyTimes.every(finite)
        ? body.keyTimes
        : null;
    if (typeof body.token !== "string" || (!samples && !keyTimes))
      return fail(400, "malformed", "token and gesture required");
    const origin = info.headers.get("origin");
    if (!postOriginOk(origin)) return fail(403, "refused", "origin not allowed");
    const result = await verifyToken(body.token, key);
    if (!result.ok)
      return fail(403, result.reason === "expired" ? "expired" : "refused", "bad token");
    const claims = result.claims;
    if (claims.origin && claims.origin !== origin) return fail(403, "refused", "wrong origin");
    if (bind && !(await bound(claims, info.headers.get("user-agent") ?? "", info.ip)))
      return fail(403, "refused", "token mismatch");
    // The slider settles doubt; it never overturns a decisive "bot" from the signals.
    if (claims.bot >= THRESHOLDS.bot)
      return { status: 200, body: { passed: false, verdict: "bot", bot: claims.bot } };
    const attempt = await countIn(store, `slide:${claims.jti}`, lifetime(claims), SLIDE_ATTEMPTS);
    if (attempt > SLIDE_ATTEMPTS) return fail(429, "rate-limited", "too many attempts");
    const zone = claims.zone;
    const inZone = (percent: number) =>
      zone === undefined ? body.landed === true : percent >= zone && percent <= zone + ZONE_WIDTH;
    let passed: boolean;
    if (samples && track) {
      const last = samples[samples.length - 1];
      const percent =
        last && finite(track.left) && finite(track.width) && track.width > 0
          ? ((last.x - track.left) / track.width) * 100
          : Number.NaN;
      passed = judgeSlide(samples, inZone(percent)).passed;
    } else {
      const position = finite(body.position) ? body.position : Number.NaN;
      passed = judgeKeySlide(keyTimes ?? [], body.keysTrusted === true, inZone(position));
    }
    if (!passed)
      return {
        status: 200,
        body: { passed: false, verdict: claims.verdict, attemptsLeft: SLIDE_ATTEMPTS - attempt },
      };
    if (!(await store.claim(`token:slide:${claims.jti}`, lifetime(claims))))
      return fail(403, "replayed", "token already slid");
    const bot = Math.min(claims.bot, 0.3);
    const { token, exp } = await issue(info, { verdict: "human", bot });
    return { status: 200, body: { passed: true, token, verdict: "human", bot, exp } };
  }

  async function siteverify(request: Request): Promise<EndpointResult> {
    const codes = (status: number, ...errors: string[]): EndpointResult => ({
      status,
      body: { success: false, "error-codes": errors },
    });
    const text = await readCapped(request, maxBodyBytes);
    if (text === null) return codes(413, "too-large");
    const type = request.headers.get("content-type") ?? "";
    let form: unknown = {};
    try {
      if (type.includes("json")) form = JSON.parse(text);
      else if (type.includes("multipart"))
        form = Object.fromEntries(
          await new Request(request.url, {
            method: "POST",
            headers: { "content-type": type },
            body: text,
          }).formData(),
        );
      else form = Object.fromEntries(new URLSearchParams(text));
    } catch {}
    const fields = isRecord(form) ? form : {};
    const field = (k: string) => (typeof fields[k] === "string" ? (fields[k] as string) : "");
    if (options.siteSecret && !safeEqual(field("secret"), options.siteSecret))
      return codes(403, "invalid-input-secret");
    const result = await verifyToken(field("response"), key);
    if (!result.ok) return codes(200, result.reason);
    const c = result.claims;
    // The backend may pass the visitor's IP and User-Agent, as with reCAPTCHA's remoteip.
    const remoteip = field("remoteip");
    const useragent = field("useragent");
    if (
      bind &&
      ((remoteip && c.iph && c.iph !== (await ipHashOf(remoteip))) ||
        (useragent && c.uah && c.uah !== (await uaHashOf(useragent))))
    )
      return codes(200, "token-mismatch");
    if (singleUse && !(await store.claim(`token:siteverify:${c.jti}`, lifetime(c))))
      return codes(200, "timeout-or-duplicate");
    return {
      status: 200,
      body: {
        success: accept.includes(c.verdict),
        verdict: c.verdict,
        bot: c.bot,
        score: Math.round((1 - c.bot) * 100) / 100,
        challenge_ts: new Date(c.iat * 1000).toISOString(),
        hostname: c.origin ? new URL(c.origin).hostname : null,
      },
    };
  }

  function cors(request: Request): Record<string, string> {
    const origin = request.headers.get("origin");
    const allow = origin && originOk(origin) ? origin : allowed.length ? null : "*";
    return {
      // A refused origin gets no allow-origin at all, so its page cannot read the answer.
      ...(allow ? { "access-control-allow-origin": allow } : {}),
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": CORS_HEADERS,
      vary: "origin",
    };
  }

  async function serve(
    request: Request,
    extra: Partial<RequestInfo>,
    route: string,
  ): Promise<Response> {
    const headers = cors(request);
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const info = infoFromRequest(request, extra, trust);
    if (route === "challenge" && request.method === "GET") {
      const limit = options.ratePerMinute;
      const rateKey = info.ip && `rate:challenge:${await ipHashOf(info.ip)}:${minute()}`;
      if (limit && rateKey && (await countIn(store, rateKey, 120, limit)) > limit)
        return Response.json(
          { error: "too many challenges", reason: "rate-limited" },
          { status: 429, headers: { ...headers, "retry-after": "60" } },
        );
      return json(
        await createChallenge({
          hmacKey: key,
          ...(options.maxnumber ? { maxnumber: options.maxnumber } : {}),
        }),
      );
    }
    if ((route === "verify" || route === "slide") && request.method === "POST") {
      const text = await readCapped(request, maxBodyBytes);
      if (text === null) return json({ error: "body too large", reason: "malformed" }, 413);
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {}
      const out =
        route === "verify" ? await verifySubmission(info, body) : await verifySlide(info, body);
      return json(out.body, out.status);
    }
    if (route === "siteverify" && request.method === "POST") {
      const out = await siteverify(request);
      return json(out.body, out.status);
    }
    return json({ error: "not found" }, 404);
  }

  async function handle(
    request: Request,
    extra: Partial<RequestInfo> = {},
  ): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${basePath}/`) && url.pathname !== basePath) return null;
    const route = url.pathname.slice(basePath.length).replace(/^\/|\/$/g, "");
    try {
      return await serve(request, extra, route);
    } catch {
      return Response.json({ error: "internal error" }, { status: 500, headers: cors(request) });
    }
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
        infoFromRequest(request, extra, trust),
        await tokenFromRequest(request, tokenHeader, tokenField),
      );
      if (!decision.ok) return refusal(decision);
      return handler(request, ...rest);
    };
  }

  return {
    options: { accept, basePath, tokenHeader, tokenField, trustProxy, maxBodyBytes },
    requestInfo: (request, extra = {}) => infoFromRequest(request, extra, trust),
    analyzeRequest,
    verifyRequest,
    verifySubmission,
    verifySlide,
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
export { isBehavior, isSignals } from "./schema";
export {
  countIn,
  kvStore,
  memoryStore,
  type RedisLike,
  type ReplayStore,
  redisStore,
} from "./store";
export { tokenFromRequest };
