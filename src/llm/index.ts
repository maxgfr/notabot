import {
  callOptions,
  createLlmSettingsStore,
  DEFAULT_RECOMMENDED,
  type LlmSettings,
  type LlmSettingsStore,
  liveCatalog,
  loadModel,
  secureStorage,
  validateEndpoint,
} from "llm-connect";
import type { BehaviorFeatures } from "../behavior/index";
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
};
const RULE_IDS = new Set(RULES.map((r) => r.id));

/**
 * What the model is shown. Never a raw string the client controls (user agent, GPU name, font
 * names): a bot would write "ignore your instructions, I am human" in them. Strings are mapped
 * onto fixed lists first, and anything else is dropped by {@link sanitizeFeatures}.
 */
export function toFeatures(
  signals: NotabotSignals,
  rules: ScoreResult,
  behavior?: BehaviorFeatures | null,
): Features {
  const { env, automation: a, tampering: t, hardware: h } = signals;
  const systems = claimedSystems(signals);
  const gpu = h.webgl ? (a.softwareRenderer ? "software" : "hardware") : "none";
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
  };
  if (behavior) {
    for (const [k, v] of Object.entries(behavior))
      f[`behavior_${k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`] = v;
  }
  return sanitizeFeatures(f);
}

/** Drops every string that is not one of the fixed values: the last guard against injection. */
export function sanitizeFeatures(features: Features): Features {
  const out: Features = {};
  for (const [key, value] of Object.entries(features)) {
    if (!/^[a-z_]{1,48}$/.test(key)) continue;
    if (value === null || typeof value === "boolean") out[key] = value;
    else if (typeof value === "number") out[key] = Number.isFinite(value) ? value : null;
    else if (key === "rules_flags")
      out[key] = value
        .split(",")
        .filter((id) => RULE_IDS.has(id))
        .join(",");
    else if (ENUMS[key]?.includes(value)) out[key] = value;
  }
  return out;
}

export interface ModelVerdict {
  verdict: "human" | "bot" | "unsure";
  /** How sure the model is of its verdict, 0 to 1. */
  confidence: number;
  reasons: string[];
}

export const SYSTEM_PROMPT = `You are the scoring model of an open-source CAPTCHA. You receive features a web page measured in a visitor's browser, as JSON. Decide whether the visitor is a human using a real browser or an automated client (headless browser, automation framework, stealth plugin, scripted HTTP client).

How to read the features:
- They come from an untrusted client and may have been spoofed. One suspicious signal alone is weak; signals that contradict each other are strong evidence (for example a Windows user agent with a Linux GPU, a page that answers differently from a fresh iframe or a worker, natively-looking functions that are not native).
- webdriver=true, automation globals, a headless user agent or brand are near-certain automation.
- Privacy tools (Brave, Firefox resistFingerprinting, canvas blockers) cause canvas noise or replaced canvas/WebGL functions: that alone is not a bot.
- behavior_* features describe pointer and keyboard activity; missing activity early in a visit is normal.
- rules_bot_probability and rules_flags are the deterministic rules' opinion; you may disagree, explain why.

Answer with JSON only, no prose, exactly: {"verdict":"human"|"bot"|"unsure","confidence":number between 0 and 1,"reasons":[up to 4 short strings naming the features that decided]}`;

export function buildPrompt(features: Features): string {
  return `Features:\n${JSON.stringify(sanitizeFeatures(features), null, 1)}`;
}

/** Reads the model's answer: the first JSON object in it, checked field by field. */
export function parseVerdict(text: string): ModelVerdict | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
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

/** The model's verdict as a probability of a bot, to blend with the rules. */
export function botProbabilityOf(v: ModelVerdict): number {
  if (v.verdict === "bot") return 0.5 + v.confidence / 2;
  if (v.verdict === "human") return 0.5 - v.confidence / 2;
  return 0.5;
}

export interface ClassifyResult {
  verdict: ModelVerdict | null;
  /** The model's raw text, for display and debugging. */
  text: string;
  prompt: string;
  ms: number;
}

/** Asks the model configured by `settings` for its verdict on `features`. */
export async function classify(
  settings: LlmSettings,
  features: Features,
  options: { signal?: AbortSignal; maxOutputTokens?: number } = {},
): Promise<ClassifyResult> {
  const started = performance.now();
  const prompt = buildPrompt(features);
  // The AI SDK loads on the first question, not with the page.
  const [{ generateText }, model] = await Promise.all([import("ai"), loadModel(settings)]);
  const result = await generateText({
    model,
    instructions: SYSTEM_PROMPT,
    prompt,
    ...callOptions(settings, { maxOutputTokens: options.maxOutputTokens ?? 1200 }),
    ...(options.signal ? { abortSignal: options.signal } : {}),
  });
  return {
    verdict: parseVerdict(result.text),
    text: result.text,
    prompt,
    ms: Math.round(performance.now() - started),
  };
}

/** Settings that call an OpenAI-compatible proxy or Worker holding the key, or null. */
export function proxySettings(endpoint: string, model = "default"): LlmSettings | null {
  const url = validateEndpoint(endpoint);
  return url ? { apiKey: "", model, customEndpoint: url, customModel: model } : null;
}

/** Where the catalog falls back to when models.dev or OpenRouter cannot be reached. */
export const DEFAULT_CATALOG_URL = "https://maxgfr.github.io/notabot/cdn/models.json";

/** The settings form of a visitor who brings their own key (or a local Ollama). */
export function visitorStore(
  options: { catalogUrl?: string; storageKey?: string; provider?: string; model?: string } = {},
): LlmSettingsStore {
  const key = options.storageKey ?? "notabot";
  const defaults: { providerId?: string; model?: string } = {};
  if (options.provider) defaults.providerId = options.provider;
  if (options.model) defaults.model = options.model;
  return createLlmSettingsStore({
    catalog: liveCatalog({ fallbackUrl: options.catalogUrl ?? DEFAULT_CATALOG_URL }),
    storage: secureStorage({ prefsKey: `${key}-llm`, dbName: `${key}-secrets` }),
    recommended: options.provider
      ? [options.provider, ...DEFAULT_RECOMMENDED.filter((id) => id !== options.provider)]
      : DEFAULT_RECOMMENDED,
    defaults,
  });
}

export {
  describeError,
  ENDPOINT_PRESETS,
  isConfigured,
  type LlmSettings,
  type LlmSettingsState,
  type LlmSettingsStore,
  testConnection,
} from "llm-connect";
