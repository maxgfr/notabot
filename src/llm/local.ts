// A local second opinion: a logistic regression over the same sanitised features the model
// reads, trained by `bun run bench` on the labelled corpus. Free, deterministic, no key, no
// download; as small as the corpus it learned from, so it advises and never decides alone.
import { verdictOf } from "../score/index";
import { type Features, type ModelVerdict, RULE_IDS } from "./prompt";
import { LOCAL_MODEL } from "./weights";

export interface LocalModel {
  /** Input names, in the order of `weights`. */
  inputs: string[];
  weights: number[];
  bias: number;
  /** What it learned from: sample counts, for anyone wondering how far to trust it. */
  trainedOn: { humans: number; bots: number; date: string };
}

const BOOLEAN_INPUTS = [
  "webdriver",
  "webdriver_own_property",
  "headless_user_agent",
  "headless_brand",
  "tostring_patched",
  "plugins_genuine",
  "chrome_object_missing",
  "outer_size_zero",
  "systems_agree",
  "language_consistent",
  "timezone_consistent",
  "canvas_stable",
  "has_interaction",
] as const;

/** Every input the regression can use: booleans, a few thresholds, one per rule id. */
export function localInputs(): string[] {
  return [
    ...BOOLEAN_INPUTS,
    "gpu_software",
    "gpu_none",
    "native_lies_any",
    "iframe_mismatch_any",
    "worker_mismatch_any",
    "automation_globals_any",
    "no_plugins",
    "few_fonts",
    "untrusted_events",
    ...[...RULE_IDS].map((id) => `flag_${id}`),
  ];
}

/** The features as numbers in [0, 1], one per input name. */
export function vectorize(f: Features, inputs: readonly string[]): number[] {
  const flags = new Set(typeof f.rules_flags === "string" ? f.rules_flags.split(",") : []);
  const num = (k: string) => (typeof f[k] === "number" ? (f[k] as number) : 0);
  const derived: Record<string, boolean> = {
    gpu_software: f.gpu_class === "software",
    gpu_none: f.gpu_class === "none",
    native_lies_any: num("native_lies") > 0,
    iframe_mismatch_any: num("iframe_mismatches") > 0,
    worker_mismatch_any: num("worker_mismatches") > 0,
    automation_globals_any: num("automation_globals") > 0,
    no_plugins: f.plugins === 0,
    few_fonts: typeof f.fonts_found === "number" && f.fonts_found < 3,
    untrusted_events: num("behavior_untrusted") > 0,
  };
  return inputs.map((name) => {
    if (name.startsWith("flag_")) return flags.has(name.slice(5)) ? 1 : 0;
    if (name in derived) return derived[name] ? 1 : 0;
    return f[name] === true ? 1 : 0;
  });
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Probability of a bot under `model`. */
export function predictLocal(model: LocalModel, f: Features): number {
  const x = vectorize(f, model.inputs);
  return sigmoid(x.reduce((z, v, i) => z + v * (model.weights[i] ?? 0), model.bias));
}

/**
 * Trains a regression on labelled feature vectors (1 = bot): batch gradient descent with an L2
 * penalty, which a corpus this small needs. Deterministic: same samples, same weights.
 */
export function trainLocal(
  samples: { features: Features; bot: boolean }[],
  options: { iterations?: number; rate?: number; l2?: number } = {},
): LocalModel {
  const inputs = localInputs();
  const xs = samples.map((s) => vectorize(s.features, inputs));
  const ys = samples.map((s) => (s.bot ? 1 : 0));
  const weights = new Array<number>(inputs.length).fill(0);
  let bias = 0;
  const rate = options.rate ?? 1;
  const l2 = options.l2 ?? 0.01;
  const n = Math.max(1, samples.length);
  for (let it = 0; it < (options.iterations ?? 5000); it++) {
    const grad = new Array<number>(inputs.length).fill(0);
    let gradBias = 0;
    xs.forEach((x, j) => {
      const err =
        sigmoid(x.reduce((z, v, i) => z + v * (weights[i] as number), bias)) - (ys[j] as number);
      x.forEach((v, i) => {
        grad[i] = (grad[i] as number) + err * v;
      });
      gradBias += err;
    });
    weights.forEach((w, i) => {
      weights[i] = w - rate * ((grad[i] as number) / n + l2 * w);
    });
    bias -= (rate * gradBias) / n;
  }
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return {
    inputs,
    weights: weights.map(round),
    bias: round(bias),
    trainedOn: {
      humans: ys.filter((y) => y === 0).length,
      bots: ys.filter((y) => y === 1).length,
      date: new Date().toISOString().slice(0, 10),
    },
  };
}

/**
 * The local second opinion on sanitised features, shaped like the model's answer: the verdict,
 * a confidence, and the inputs that weighed most.
 */
export function classifyLocal(
  features: Features,
  model: LocalModel = LOCAL_MODEL,
): { bot: number; verdict: ModelVerdict } {
  const bot = predictLocal(model, features);
  const x = vectorize(features, model.inputs);
  const reasons = model.inputs
    .map((name, i) => ({ name, push: (x[i] as number) * (model.weights[i] ?? 0) }))
    .filter((r) => r.push !== 0)
    .sort((a, b) => Math.abs(b.push) - Math.abs(a.push))
    .slice(0, 4)
    .map((r) => `${r.name} ${r.push > 0 ? "+" : ""}${r.push.toFixed(2)}`);
  const confidence = Math.min(1, Math.abs(bot - 0.5) * 2);
  return {
    bot: Math.round(bot * 1000) / 1000,
    verdict: { verdict: verdictOf(bot), confidence: Math.round(confidence * 100) / 100, reasons },
  };
}
