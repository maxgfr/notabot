import type {
  BehaviorFeatures,
  BehaviorTracker,
  PointerSample,
  TargetClick,
} from "./behavior/index";
import type { ClassifyResult, LlmSettings } from "./llm/index";
import { base64urlEncode } from "./pow/crypto";
import {
  type Challenge,
  encodeSolution,
  fetchChallenge,
  localChallenge,
  type Solution,
  solveChallenge,
} from "./pow/index";
import { answerProbe } from "./probes/index";
import {
  blend,
  rulesDecided,
  type ScoreResult,
  score,
  type Verdict,
  verdictOf,
} from "./score/index";
import { collect } from "./signals/index";
import type { NotabotSignals } from "./signals/types";
import { identify, type SealedSignals, type SmartSignals, smartSignals } from "./smart/index";

export type Step = "signals" | "rules" | "pow" | "model" | "verify" | "done";

export interface CheckOptions {
  /** Signals already collected (the page read them on arrival): not read a second time. */
  signals?: NotabotSignals;
  /** Pointer and key activity so far (see `trackBehavior`). */
  behavior?: BehaviorTracker | null;
  /**
   * The proof-of-work: a challenge, the URL of a server that signs one, `"local"` (default, made
   * in the page: it measures the cost, proves nothing) or false to skip it.
   */
  challenge?: Challenge | string | false;
  /** A model to ask for a second opinion (llm-connect settings), or null. */
  llm?: LlmSettings | null;
  /** Weight of the rules against the model, 0 to 1. Default 0.7. */
  rulesWeight?: number;
  /**
   * Without a model, blend in the local regression (`classifyLocal`) as the second opinion: free,
   * deterministic, no key. Default false.
   */
  local?: boolean;
  /**
   * A server that scores and signs (see `notabot/server` and examples/cloudflare-worker): the
   * page posts signals, behavior and solution, and receives `{ token, verdict, bot }`.
   */
  verifyUrl?: string;
  signal?: AbortSignal;
  onStep?: (step: Step) => void;
}

export interface CheckResult {
  signals: NotabotSignals;
  behavior: BehaviorFeatures | null;
  rules: ScoreResult;
  solution: Solution | null;
  model: ClassifyResult | null;
  modelError: string | null;
  /** Final probability of a bot, rules blended with the model (or the server's, with verifyUrl). */
  bot: number;
  verdict: Verdict;
  /** What a form posts: a server's signed token, or an unsigned summary in front-only mode. */
  token: string;
  signed: boolean;
  /** When the signed token expires (unix seconds), as the server said; null in front-only mode. */
  expiresAt: number | null;
  /** Where the server put the slider's zone (percent) when its verdict was "unsure". */
  zone: number | null;
  /** The challenge the server chose for an "unsure" verdict (a slider, or targets), signed. */
  visible: VisibleChallenge | null;
  /** The browser's smart signals: privacy browser, private mode, virtual machine, tampering. */
  smart: SmartSignals;
  /** A visitor id from the readings that stay put, and how far to trust it (see notabot/smart). */
  identity: { visitorId: string; confidence: number };
  /** The server's sealed signals (visitor id keyed by the server, VPN, Tor…), with verifyUrl. */
  sealed: SealedSignals | null;
}

/** A slider and its zone, or targets to activate in order ([x, y] percents of their box). */
export type VisibleChallenge =
  | { kind: "slide"; zone: number }
  | { kind: "targets"; targets: [number, number][] };

/** Why a server refused: what the widget tells the visitor, and whether a retry can help. */
export type NotabotErrorCode =
  | "expired"
  | "replayed"
  | "refused"
  | "rate-limited"
  | "malformed"
  | "network";

export class NotabotError extends Error {
  readonly code: NotabotErrorCode;
  readonly status: number | null;
  constructor(code: NotabotErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "NotabotError";
    this.code = code;
    this.status = status;
  }
}

const CODES = new Set<string>(["expired", "replayed", "refused", "rate-limited", "malformed"]);

/** POSTs JSON to a notabot endpoint; a refusal becomes a {@link NotabotError} with its code. */
async function postJson(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new NotabotError("network", `notabot: ${e instanceof Error ? e.message : String(e)}`);
  }
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const reason = typeof out.reason === "string" && CODES.has(out.reason) ? out.reason : "refused";
    const error = typeof out.error === "string" ? out.error : `${res.status}`;
    throw new NotabotError(reason as NotabotErrorCode, `notabot: ${error}`, res.status);
  }
  return out;
}

/** The slide endpoint next to a verify URL: `…/notabot/verify` → `…/notabot/slide`. */
export function slideUrlOf(verifyUrl: string): string {
  return new URL(
    "slide",
    new URL(verifyUrl, typeof location !== "undefined" ? location.href : undefined),
  ).href;
}

export interface SlideAnswer {
  passed: boolean;
  verdict: Verdict;
  /** A new token, signed "human", when the gesture passed. */
  token?: string;
  bot?: number;
  exp?: number;
  attemptsLeft?: number;
}

/**
 * Sends a slider gesture to the server, which judges it again and re-signs the token: in
 * signed mode, the page's own judgement of the slide counts for nothing.
 */
export async function submitSlide(
  url: string,
  body: {
    token: string;
    samples?: PointerSample[];
    track?: { left: number; width: number };
    keyTimes?: number[];
    keysTrusted?: boolean;
    position?: number;
    landed?: boolean;
    clicks?: TargetClick[];
  },
  signal?: AbortSignal,
): Promise<SlideAnswer> {
  const out = await postJson(url, body, signal);
  return {
    passed: out.passed === true,
    verdict: (out.verdict as Verdict) ?? "unsure",
    ...(typeof out.token === "string" ? { token: out.token } : {}),
    ...(typeof out.bot === "number" ? { bot: out.bot } : {}),
    ...(typeof out.exp === "number" ? { exp: out.exp } : {}),
    ...(typeof out.attemptsLeft === "number" ? { attemptsLeft: out.attemptsLeft } : {}),
  };
}

/** The unsigned summary a front-only page can post: readable, forgeable, for demos only. */
export function unsignedToken(verdict: Verdict, bot: number, solution: Solution | null): string {
  return `unsigned.${base64urlEncode(
    JSON.stringify({
      v: 1,
      verdict,
      bot,
      pow: solution ? encodeSolution(solution) : null,
      iat: Math.floor(Date.now() / 1000),
    }),
  )}`;
}

async function localOpinion(
  signals: NotabotSignals,
  rules: ScoreResult,
  behavior: BehaviorFeatures | null,
): Promise<number> {
  const [{ classifyLocal }, { toFeatures }] = await Promise.all([
    import("./llm/local"),
    import("./llm/prompt"),
  ]);
  return classifyLocal(toFeatures(signals, rules, behavior)).bot;
}

/**
 * The whole check: collect the signals, score them, solve the proof-of-work, ask the model if
 * there is one, and blend. With `verifyUrl`, the server has the last word and signs the token.
 */
export async function check(options: CheckOptions = {}): Promise<CheckResult> {
  const step = (s: Step) => options.onStep?.(s);
  step("signals");
  const signals = options.signals ?? (await collect());
  const behavior = options.behavior?.features() ?? null;
  step("rules");
  const rules = score({ signals, behavior });

  let probeAnswers: string[] | null = null;
  const solve = async (): Promise<Solution | null> => {
    if (options.challenge === false) return null;
    step("pow");
    const source = options.challenge ?? "local";
    const challenge =
      source === "local"
        ? await localChallenge()
        : typeof source === "string"
          ? await fetchChallenge(source)
          : source;
    // The puzzle's probes are answered with the page's own APIs, posted with the solution.
    probeAnswers = challenge.probes?.map(answerProbe) ?? null;
    return solveChallenge(challenge, options.signal ? { signal: options.signal } : {});
  };
  let solution = await solve();

  let model: ClassifyResult | null = null;
  let modelError: string | null = null;
  // With a server, the server asks its own model: the page's would be a second, forgeable opinion.
  // Nor when the rules decided alone: a second opinion could not change the verdict.
  if (options.llm && !options.verifyUrl && !rulesDecided(rules.bot)) {
    step("model");
    const llm = await import("./llm/index");
    try {
      model = await llm.classify(
        options.llm,
        llm.toFeatures(signals, rules, behavior),
        options.signal ? { signal: options.signal } : {},
      );
      if (!model.verdict) modelError = "unreadable answer";
    } catch (e) {
      modelError = llm.describeError(e, options.llm.apiKey).message;
    }
  }
  const llmBot = model?.verdict
    ? (await import("./llm/prompt")).botProbabilityOf(model.verdict)
    : options.local && !options.verifyUrl && !rulesDecided(rules.bot)
      ? await localOpinion(signals, rules, behavior)
      : null;
  let bot = blend(rules.bot, llmBot, options.rulesWeight);
  let verdict = verdictOf(bot);
  let token = unsignedToken(verdict, bot, solution);
  let signed = false;
  let expiresAt: number | null = null;
  let zone: number | null = null;
  let visible: VisibleChallenge | null = null;
  let sealed: SealedSignals | null = null;

  if (options.verifyUrl) {
    step("verify");
    const url = options.verifyUrl;
    const send = () =>
      postJson(
        url,
        {
          signals,
          behavior,
          solution: solution && encodeSolution(solution),
          ...(probeAnswers ? { probes: probeAnswers } : {}),
        },
        options.signal,
      );
    let body: Record<string, unknown>;
    try {
      body = await send();
    } catch (e) {
      // A puzzle that expired while the tab slept: one fresh puzzle, one more try.
      if (!(e instanceof NotabotError && e.code === "expired")) throw e;
      solution = await solve();
      step("verify");
      body = await send();
    }
    if (typeof body.token !== "string")
      throw new NotabotError("malformed", "notabot: verify gave no token");
    token = body.token;
    signed = true;
    if (typeof body.bot === "number") bot = body.bot;
    if (typeof body.verdict === "string") verdict = body.verdict as Verdict;
    if (typeof body.exp === "number") expiresAt = body.exp;
    if (typeof body.zone === "number") zone = body.zone;
    visible = visibleOf(body.challenge) ?? (zone !== null ? { kind: "slide", zone } : null);
    if (body.smart && typeof body.smart === "object") sealed = body.smart as SealedSignals;
  }
  const { visitorId, confidence } = await identify(signals);
  step("done");
  return {
    signals,
    behavior,
    rules,
    solution,
    model,
    modelError,
    bot,
    verdict,
    token,
    signed,
    expiresAt,
    zone,
    visible,
    smart: smartSignals(signals),
    identity: { visitorId, confidence },
    sealed,
  };
}

function visibleOf(raw: unknown): VisibleChallenge | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (c.kind === "slide" && typeof c.zone === "number") return { kind: "slide", zone: c.zone };
  if (
    c.kind === "targets" &&
    Array.isArray(c.targets) &&
    c.targets.every(
      (p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number"),
    )
  )
    return { kind: "targets", targets: c.targets as [number, number][] };
  return null;
}

export { trackBehavior } from "./behavior/index";
export type { Challenge, Solution } from "./pow/index";
export { RULES, type ScoreResult, score, type Verdict } from "./score/index";
export { collect } from "./signals/index";
export type { NotabotSignals } from "./signals/types";
export { identify, type SealedSignals, type SmartSignals, smartSignals } from "./smart/index";
