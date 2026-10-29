// The model's opinion through llm-connect (the visitor's key, a proxy, or a local Ollama). What
// the model is shown and how its answer is read live in ./prompt, free of the AI stack.
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
import { sha256Hex } from "../pow/crypto";
import {
  buildPrompt,
  type Features,
  type ModelVerdict,
  parseVerdict,
  SYSTEM_PROMPT,
  toVerdict,
  VERDICT_SCHEMA,
} from "./prompt";

export interface ClassifyResult {
  verdict: ModelVerdict | null;
  /** The model's raw text (or its structured answer as JSON), for display and debugging. */
  text: string;
  prompt: string;
  ms: number;
  /** Whether the provider constrained its answer to the verdict's schema. */
  structured: boolean;
  /** Whether the answer came from the cache of earlier identical questions. */
  cached: boolean;
}

/** Providers whose AI SDK package constrains an answer to a JSON Schema. */
const STRUCTURED = new Set([
  "@ai-sdk/openai",
  "@ai-sdk/anthropic",
  "@ai-sdk/google",
  "@ai-sdk/mistral",
]);

/** Whether `settings` reach a provider that supports structured output (not a custom endpoint). */
export function supportsStructuredOutput(settings: LlmSettings): boolean {
  return !settings.customEndpoint && STRUCTURED.has(settings.providerNpm ?? "@ai-sdk/openai");
}

/** The caller's signal and a timeout, whichever fires first. */
function withDeadline(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  const both = new AbortController();
  for (const s of [signal, timeout])
    s.addEventListener("abort", () => both.abort(s.reason), { once: true });
  return both.signal;
}

// Same model, same features, same answer: identical questions are not asked twice.
const cache = new Map<string, ModelVerdict>();
const CACHE_SIZE = 100;

/**
 * Asks the model configured by `settings` for its verdict on `features`: a schema-constrained
 * answer where the provider supports one, else text read by {@link parseVerdict}. Times out after
 * `timeoutMs` (default 20 s).
 */
export async function classify(
  settings: LlmSettings,
  features: Features,
  options: { signal?: AbortSignal; maxOutputTokens?: number; timeoutMs?: number } = {},
): Promise<ClassifyResult> {
  const started = performance.now();
  const prompt = buildPrompt(features);
  const key = await sha256Hex(
    `${settings.customEndpoint ?? settings.providerId ?? ""}|${settings.customModel ?? settings.model}|${prompt}`,
  );
  const hit = cache.get(key);
  if (hit)
    return {
      verdict: hit,
      text: JSON.stringify(hit),
      prompt,
      ms: 0,
      structured: false,
      cached: true,
    };
  const abortSignal = withDeadline(options.signal, options.timeoutMs ?? 20_000);
  // The AI SDK loads on the first question, not with the page.
  const [ai, model] = await Promise.all([import("ai"), loadModel(settings)]);
  const call = {
    model,
    instructions: SYSTEM_PROMPT,
    prompt,
    ...callOptions(settings, { maxOutputTokens: options.maxOutputTokens ?? 1200 }),
    abortSignal,
  };
  let verdict: ModelVerdict | null = null;
  let text = "";
  let structured = false;
  if (supportsStructuredOutput(settings)) {
    try {
      const result = await ai.generateText({
        ...call,
        output: ai.Output.object({
          schema: ai.jsonSchema<ModelVerdict>(VERDICT_SCHEMA as never),
          name: "verdict",
        }),
      });
      verdict = toVerdict(result.output);
      text = result.text || JSON.stringify(result.output);
      structured = verdict !== null;
    } catch (e) {
      if (abortSignal.aborted) throw e;
      // A model of the provider without structured output: ask again, as text.
    }
  }
  if (!verdict) {
    const result = await ai.generateText(call);
    text = result.text;
    verdict = parseVerdict(text);
  }
  if (verdict) {
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    cache.set(key, verdict);
  }
  return {
    verdict,
    text,
    prompt,
    ms: Math.round(performance.now() - started),
    structured,
    cached: false,
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
export * from "./local";
export * from "./prompt";
