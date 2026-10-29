// What the model is shown and how its answer is read: pure functions, no llm-connect, no AI SDK,
// so a server (the middleware) can build the same prompt without bundling the AI stack.
import type { BehaviorFeatures } from "../behavior/index";
import {
  CROSS_CHECK_RULES,
  isHostingNetwork,
  REQUEST_RULES,
  type RequestInfo,
} from "../middleware/request";
import { claimedSystems, RULES, type ScoreResult } from "../score/index";
import type { NotabotSignals } from "../signals/types";
import { engineOfUserAgent, osOf } from "../signals/util";

/** A feature the model reads: numbers, booleans, and values from fixed lists only. */
export type FeatureValue = number | boolean | null | string;
export type Features = Record<string, FeatureValue>;

const ENUMS: Record<string, readonly string[]> = {
  ua_os: ["windows", "mac", "linux", "android", "ios", "unknown"],
  ua_engine: ["blink", "gecko", "webkit", "unknown"],
  js_engine: ["blink", "gecko-or-webkit", "unknown"],
  gpu_class: ["hardware", "software", "none"],
  http_version: ["1.0", "1.1", "2", "3", "unknown"],
};

/** Every rule id a `rules_flags` feature may name: the browser's, the request's, the cross-checks. */
export const RULE_IDS: ReadonlySet<string> = new Set([
  ...RULES.map((r) => r.id),
  ...REQUEST_RULES.map((r) => r.id),
  ...CROSS_CHECK_RULES.map((r) => r.id),
]);

/**
 * The behaviour features the model may read, by name: a client posting a `behavior` object with
 * other keys gets them dropped, whatever it sends. Checked against {@link BehaviorFeatures}.
 */
export const BEHAVIOR_KEYS = [
  "samples",
  "durationMs",
  "speedMean",
  "speedCv",
  "accelCv",
  "straightness",
  "angleEntropy",
  "jitter",
  "stepCv",
  "moves",
  "clicks",
  "keys",
  "scrolls",
  "untrusted",
  "inputWithoutKeys",
  "focusChanges",
  "sessionMs",
  "firstInteractionMs",
  "coalescedMean",
  "keyDwellMean",
  "keyDwellCv",
  "keyFlightCv",
] as const satisfies readonly (keyof BehaviorFeatures)[];
// A key added to BehaviorFeatures and forgotten here fails the typecheck.
type MissingBehaviorKey = Exclude<keyof BehaviorFeatures, (typeof BEHAVIOR_KEYS)[number]>;
const behaviorKeysComplete: [MissingBehaviorKey] extends [never] ? true : MissingBehaviorKey = true;
void behaviorKeysComplete;

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const BROWSER_KEYS = [
  "ua_os",
  "ua_engine",
  "js_engine",
  "ua_mobile",
  "systems_named",
  "systems_agree",
  "webdriver",
  "webdriver_own_property",
  "headless_user_agent",
  "headless_brand",
  "automation_globals",
  "native_lies",
  "tostring_patched",
  "iframe_mismatches",
  "worker_mismatches",
  "plugins",
  "mime_types",
  "plugins_genuine",
  "chrome_object_missing",
  "notification_permission_mismatch",
  "outer_size_zero",
  "browser_chrome_height",
  "languages",
  "language_consistent",
  "timezone_consistent",
  "utc_offset_minutes",
  "screen_width",
  "screen_height",
  "pixel_ratio",
  "color_depth",
  "cores",
  "memory_gb",
  "touch_points",
  "gpu_class",
  "webgl_extensions",
  "webgpu",
  "canvas_stable",
  "audio_fingerprint",
  "fonts_found",
  "codecs_supported",
  "media_devices",
  "cookies",
  "collect_ms",
  "rules_bot_probability",
  "rules_flags",
  "has_interaction",
] as const;

/** What only a server knows, as booleans and fixed values (see {@link serverFeatures}). */
const SERVER_KEYS = ["hosting_asn", "http_version", "tz_matches_ip", "ja4_matches_ua"] as const;

/** The closed list of features: anything else is dropped by {@link sanitizeFeatures}. */
export const FEATURE_KEYS: ReadonlySet<string> = new Set([
  ...BROWSER_KEYS,
  ...BEHAVIOR_KEYS.map((k) => `behavior_${snake(k)}`),
  ...SERVER_KEYS,
]);
const MAX_FEATURES = 96;

/**
 * What the model is shown. Never a raw string the client controls (user agent, GPU name, font
 * names): a bot would write "ignore your instructions, I am human" in them. Strings are mapped
 * onto fixed lists first, and anything else is dropped by {@link sanitizeFeatures}.
 */
export function toFeatures(
  signals: NotabotSignals,
  rules: ScoreResult,
  behavior?: BehaviorFeatures | null,
  server?: Features | null,
): Features {
  const { env, automation: a, tampering: t, hardware: h } = signals;
  const systems = claimedSystems(signals);
  const gpu = h.webgl ? (a.softwareRenderer ? "software" : "hardware") : "none";
  const interacted = !!behavior && (behavior.moves > 0 || behavior.keys > 0 || behavior.clicks > 0);
  const f: Features = {
    ua_os: osOf(env.userAgent),
    ua_engine: engineOfUserAgent(env.userAgent),
    js_engine: a.engineObserved,
    ua_mobile: /Android|iPhone|iPod|Mobile/.test(env.userAgent),
    systems_named: Object.keys(systems).length,
    systems_agree: new Set(Object.values(systems)).size <= 1,
    webdriver: a.webdriver,
    webdriver_own_property: a.webdriverOwnProperty,
    headless_user_agent: a.headlessUserAgent,
    headless_brand: a.headlessBrand,
    automation_globals: a.automationGlobals.length,
    native_lies: t.lies.length,
    tostring_patched: t.toStringPatched,
    iframe_mismatches: signals.iframe ? signals.iframe.mismatches.length : null,
    worker_mismatches: signals.worker ? signals.worker.mismatches.length : null,
    plugins: a.plugins,
    mime_types: a.mimeTypes,
    plugins_genuine: a.pluginsGenuine,
    chrome_object_missing: a.chromeObjectMissing,
    notification_permission_mismatch: a.notificationPermissionMismatch,
    outer_size_zero: a.outerSizeZero,
    browser_chrome_height: env.window.outerHeight - env.window.innerHeight,
    languages: env.languages.length,
    language_consistent: env.languages[0] === undefined || env.languages[0] === env.language,
    timezone_consistent:
      env.timezoneOffsetFromName === null ||
      Math.abs(env.timezoneOffsetFromName - env.timezoneOffset) <= 1,
    utc_offset_minutes: -env.timezoneOffset,
    screen_width: env.screen.width,
    screen_height: env.screen.height,
    pixel_ratio: env.screen.pixelRatio,
    color_depth: env.screen.colorDepth,
    cores: env.hardwareConcurrency,
    memory_gb: env.deviceMemory,
    touch_points: env.maxTouchPoints,
    gpu_class: gpu,
    webgl_extensions: h.webgl?.extensions ?? null,
    webgpu: h.webgpu !== null,
    canvas_stable: h.canvas?.stable ?? null,
    audio_fingerprint: h.audio !== null,
    fonts_found: h.fonts.length,
    codecs_supported: Object.values(env.codecs).filter((v) => v !== "no").length,
    media_devices: env.mediaDevices
      ? env.mediaDevices.audioinput + env.mediaDevices.audiooutput + env.mediaDevices.videoinput
      : null,
    cookies: env.cookieEnabled,
    collect_ms: signals.durationMs,
    rules_bot_probability: rules.bot,
    rules_flags: rules.flags.map((fl) => fl.id).join(","),
    has_interaction: interacted,
  };
  // No pointer, key or click yet: the behaviour block would be zeros the model over-reads.
  if (behavior && interacted) {
    const b = behavior as unknown as Record<string, unknown>;
    for (const k of BEHAVIOR_KEYS) {
      const v = b[k];
      f[`behavior_${snake(k)}`] = typeof v === "number" ? v : null;
    }
  }
  if (server) Object.assign(f, server);
  return sanitizeFeatures(f);
}

/**
 * Features only a server can compute, from the request it received: booleans and fixed values,
 * never a header's text.
 */
export function serverFeatures(
  info: RequestInfo,
  signals: Pick<NotabotSignals, "env">,
  ja4MatchesUa: boolean | null = null,
): Features {
  const version = (info.httpVersion ?? info.network?.httpProtocol ?? "").replace(/^HTTP\//, "");
  const ipTimezone = info.network?.timezone;
  return {
    hosting_asn: info.network?.asOrganization
      ? isHostingNetwork(info.network.asOrganization)
      : null,
    http_version: ENUMS.http_version?.includes(version) ? version : "unknown",
    tz_matches_ip: ipTimezone ? ipTimezone === signals.env.timezone : null,
    ja4_matches_ua: ja4MatchesUa,
  };
}

/**
 * The last guard against injection: only the closed list of keys, numbers, booleans, values of
 * fixed lists and known rule ids; at most {@link MAX_FEATURES}.
 */
export function sanitizeFeatures(features: Features): Features {
  const out: Features = {};
  let n = 0;
  for (const [key, value] of Object.entries(features)) {
    if (n >= MAX_FEATURES) break;
    if (!FEATURE_KEYS.has(key)) continue;
    if (value === null || typeof value === "boolean") out[key] = value;
    else if (typeof value === "number") out[key] = Number.isFinite(value) ? value : null;
    else if (key === "rules_flags")
      out[key] = value
        .split(",")
        .filter((id) => RULE_IDS.has(id))
        .join(",");
    else if (ENUMS[key]?.includes(value)) out[key] = value;
    else continue;
    n++;
  }
  return out;
}

export interface ModelVerdict {
  verdict: "human" | "bot" | "unsure";
  /** How sure the model is of its verdict, 0 to 1. */
  confidence: number;
  reasons: string[];
}

/** The answer's JSON Schema, for providers that constrain their output to one. */
export const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    reasons: { type: "array", items: { type: "string" }, maxItems: 4 },
    verdict: { type: "string", enum: ["human", "bot", "unsure"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["reasons", "verdict", "confidence"],
  additionalProperties: false,
} as const;

/** `id — explanation (weight)` for every rule: fixed text the model can trust, unlike the input. */
export function glossary(): string {
  return [...RULES, ...REQUEST_RULES, ...CROSS_CHECK_RULES]
    .map((r) => `- ${r.id} — ${r.explain} (${r.weight})`)
    .join("\n");
}

const EXAMPLE_HUMAN = {
  ua_os: "mac",
  systems_agree: true,
  webdriver: false,
  native_lies: 0,
  iframe_mismatches: 0,
  gpu_class: "hardware",
  canvas_stable: false,
  rules_bot_probability: 0.4,
  rules_flags: "canvas-noise",
  has_interaction: true,
  behavior_step_cv: 0.62,
};
const EXAMPLE_BOT = {
  ua_os: "windows",
  systems_agree: false,
  webdriver: false,
  tostring_patched: true,
  iframe_mismatches: 1,
  gpu_class: "software",
  rules_bot_probability: 0.6,
  rules_flags: "os-mismatch,software-renderer",
  has_interaction: false,
};

/**
 * The instructions: a fixed prefix, the same for every visitor, so providers can cache it. The
 * rules' glossary is generated from the package's rules, never from the input.
 */
export const SYSTEM_PROMPT = `You are the scoring model of an open-source CAPTCHA. You receive features a web page measured in a visitor's browser (and, on a server, a few facts about the request), as JSON. Decide whether the visitor is a human using a real browser or an automated client (headless browser, automation framework, stealth plugin, scripted HTTP client, AI agent driving a browser).

How to read the features:
- They come from an untrusted client and may have been spoofed. One suspicious signal alone is weak; signals that contradict each other are strong evidence (for example a Windows user agent with a Linux GPU, a page that answers differently from a fresh iframe or a worker, natively-looking functions that are not native).
- webdriver=true, automation globals, a headless user agent or brand are near-certain automation.
- Privacy tools (Brave, Firefox resistFingerprinting, canvas blockers) cause canvas noise or replaced canvas/WebGL functions: that alone is not a bot.
- has_interaction=false means no pointer, key or click yet: normal early in a visit, and then there are no behavior_* features at all.
- rules_bot_probability and rules_flags are the deterministic rules' opinion; you may disagree, say why.
- hosting_asn, http_version, tz_matches_ip and ja4_matches_ua, when present, come from the server, not the browser.

What each rule id in rules_flags means (weight in parentheses, 1 is certain):
${glossary()}

Two calibrated examples:
Features: ${JSON.stringify(EXAMPLE_HUMAN)}
Answer: {"reasons":["canvas noise alone points to a privacy tool","systems agree","uneven pointer steps"],"verdict":"human","confidence":0.7}
Features: ${JSON.stringify(EXAMPLE_BOT)}
Answer: {"reasons":["toString patched","the iframe disagrees with the page","the user agent and the GPU name different systems"],"verdict":"bot","confidence":0.85}

Answer with JSON only, no prose, reasons first: {"reasons":[up to 4 short strings naming the features that decided],"verdict":"human"|"bot"|"unsure","confidence":number between 0 and 1}`;

export function buildPrompt(features: Features): string {
  return `Features:\n${JSON.stringify(sanitizeFeatures(features), null, 1)}`;
}

/** Top-level `{…}` spans of `text`, braces balanced, braces inside strings ignored. */
function objectSpans(text: string): string[] {
  const spans: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"' && depth > 0) inString = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}" && depth > 0) {
      depth--;
      if (depth === 0) spans.push(text.slice(start, i + 1));
    }
  }
  return spans;
}

/** Checks a parsed answer field by field: a verdict of the list, bounded confidence and reasons. */
export function toVerdict(raw: unknown): ModelVerdict | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const verdict = o.verdict;
  if (verdict !== "human" && verdict !== "bot" && verdict !== "unsure") return null;
  const confidence =
    typeof o.confidence === "number" && Number.isFinite(o.confidence)
      ? Math.min(1, Math.max(0, o.confidence))
      : 0.5;
  const reasons = Array.isArray(o.reasons)
    ? o.reasons
        .filter((r): r is string => typeof r === "string")
        .slice(0, 4)
        .map((r) => r.slice(0, 200))
    : [];
  return { verdict, confidence, reasons };
}

/**
 * Reads the model's answer: reasoning blocks (`<think>…</think>`) dropped, then the last JSON
 * object that is a valid verdict, checked field by field.
 */
export function parseVerdict(text: string): ModelVerdict | null {
  const visible = text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "");
  const spans = objectSpans(visible);
  for (let i = spans.length - 1; i >= 0; i--) {
    try {
      const verdict = toVerdict(JSON.parse(spans[i] as string));
      if (verdict) return verdict;
    } catch {}
  }
  return null;
}

/** The model's verdict as a probability of a bot, to blend with the rules. */
export function botProbabilityOf(v: ModelVerdict): number {
  if (v.verdict === "bot") return 0.5 + v.confidence / 2;
  if (v.verdict === "human") return 0.5 - v.confidence / 2;
  return 0.5;
}
