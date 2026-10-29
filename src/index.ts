import type { BehaviorFeatures, BehaviorTracker } from "./behavior/index";
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
import { blend, type ScoreResult, score, type Verdict, verdictOf } from "./score/index";
import { collect } from "./signals/index";
import type { NotabotSignals } from "./signals/types";

export type Step = "signals" | "rules" | "pow" | "model" | "verify" | "done";

export interface CheckOptions {
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

/**
 * The whole check: collect the signals, score them, solve the proof-of-work, ask the model if
 * there is one, and blend. With `verifyUrl`, the server has the last word and signs the token.
 */
export async function check(options: CheckOptions = {}): Promise<CheckResult> {
  const step = (s: Step) => options.onStep?.(s);
  step("signals");
  const signals = await collect();
  const behavior = options.behavior?.features() ?? null;
  step("rules");
  const rules = score({ signals, behavior });

  let solution: Solution | null = null;
  if (options.challenge !== false) {
    step("pow");
    const source = options.challenge ?? "local";
    const challenge =
      source === "local"
        ? await localChallenge()
        : typeof source === "string"
          ? await fetchChallenge(source)
          : source;
    solution = await solveChallenge(challenge, options.signal ? { signal: options.signal } : {});
  }

  let model: ClassifyResult | null = null;
  let modelError: string | null = null;
  if (options.llm) {
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
    ? (await import("./llm/index")).botProbabilityOf(model.verdict)
    : null;
  let bot = blend(rules.bot, llmBot, options.rulesWeight);
  let verdict = verdictOf(bot);
  let token = unsignedToken(verdict, bot, solution);
  let signed = false;

  if (options.verifyUrl) {
    step("verify");
    const res = await fetch(options.verifyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ signals, behavior, solution: solution && encodeSolution(solution) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!res.ok) throw new Error(`notabot: verify ${res.status}`);
    const body = (await res.json()) as { token?: string; verdict?: Verdict; bot?: number };
    if (typeof body.token !== "string") throw new Error("notabot: verify gave no token");
    token = body.token;
    signed = true;
    if (typeof body.bot === "number") bot = body.bot;
    if (body.verdict) verdict = body.verdict;
  }
  step("done");
  return { signals, behavior, rules, solution, model, modelError, bot, verdict, token, signed };
}

export { trackBehavior } from "./behavior/index";
export type { Challenge, Solution } from "./pow/index";
export { RULES, type ScoreResult, score, type Verdict } from "./score/index";
export { collect } from "./signals/index";
export type { NotabotSignals } from "./signals/types";
