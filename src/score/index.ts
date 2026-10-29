import type { BehaviorFeatures } from "../behavior/index";
import type { NotabotSignals } from "../signals/types";
import { osOf } from "../signals/util";

export type Category = "automation" | "tampering" | "consistency" | "hardware" | "behavior";

export interface ScoreInput {
  signals: NotabotSignals;
  behavior?: BehaviorFeatures | null;
}

export interface Rule {
  id: string;
  category: Category;
  /** How likely a session that trips this rule alone is a bot, from 0 to 1. */
  weight: number;
  /** What it means, in English (the site has French). */
  explain: string;
  /** A detail string when the rule trips, or null. */
  test(input: ScoreInput): string | null;
}

export interface Flag {
  id: string;
  category: Category;
  weight: number;
  explain: string;
  detail: string;
}

export type Verdict = "human" | "unsure" | "bot";

export interface ScoreResult {
  /** Probability that this is a bot, from 0 to 1 (noisy-OR of the flags' weights). */
  bot: number;
  verdict: Verdict;
  flags: Flag[];
  /** Ids of every rule that ran, tripped or not. */
  checked: string[];
}

export const THRESHOLDS = { bot: 0.8, unsure: 0.35 } as const;

const DEVICE_MEMORY = new Set([0.25, 0.5, 1, 2, 4, 8, 16, 32]);
const MOBILE_UA = /Android|iPhone|iPod|Mobile/;
const PRIVACY_TARGETS =
  /^(HTMLCanvasElement|CanvasRenderingContext2D|WebGLRenderingContext|AudioBuffer|Element|Screen)\./;

function uaDataOs(platform: string): ReturnType<typeof osOf> {
  const p = platform.toLowerCase();
  if (p === "macos") return "mac";
  if (p === "windows") return "windows";
  if (p === "linux" || p === "chrome os" || p === "chromeos") return "linux";
  if (p === "android") return "android";
  if (p === "ios") return "ios";
  return "unknown";
}

/** The operating systems each source names; unknown ones left out. */
export function claimedSystems(s: NotabotSignals): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (name: string, os: string) => {
    if (os !== "unknown") out[name] = os;
  };
  add("userAgent", osOf(s.env.userAgent));
  add("platform", osOf(s.env.platform));
  if (s.env.uaData) add("uaData", uaDataOs(s.env.uaData.platform));
  const renderer = s.hardware.webgl?.unmaskedRenderer ?? s.hardware.webgl?.renderer ?? "";
  // Only renderers that name their system for sure: ANGLE's back end, Apple's chips, Mesa.
  if (/Direct3D|D3D1\d/.test(renderer)) add("webgl", "windows");
  else if (/Apple M\d|Apple GPU|ANGLE Metal/.test(renderer)) add("webgl", "mac");
  else if (/Mesa|llvmpipe/.test(renderer)) add("webgl", "linux");
  return out;
}

function systemsDisagree(systems: Record<string, string>): boolean {
  // An iPad asks for the desktop site as a Mac; Android and ChromeOS run on Linux.
  const norm = (os: string) => (os === "ios" ? "mac" : os === "android" ? "linux" : os);
  return new Set(Object.values(systems).map(norm)).size > 1;
}

export const RULES: Rule[] = [
  {
    id: "webdriver",
    category: "automation",
    weight: 0.95,
    explain: "navigator.webdriver is true: the browser says it is driven by automation.",
    test: ({ signals }) => (signals.automation.webdriver === true ? "navigator.webdriver" : null),
  },
  {
    id: "webdriver-own-property",
    category: "tampering",
    weight: 0.8,
    explain:
      "webdriver is defined on navigator itself, not on Navigator.prototype: a stealth layer hid it.",
    test: ({ signals }) =>
      signals.automation.webdriverOwnProperty ? "own property on navigator" : null,
  },
  {
    id: "headless-user-agent",
    category: "automation",
    weight: 0.95,
    explain: "The user agent names a headless browser.",
    test: ({ signals }) =>
      signals.automation.headlessUserAgent ? signals.env.userAgent.slice(0, 120) : null,
  },
  {
    id: "headless-brand",
    category: "automation",
    weight: 0.9,
    explain: "navigator.userAgentData lists a headless brand.",
    test: ({ signals }) =>
      signals.automation.headlessBrand ? (signals.env.uaData?.brands.join(", ") ?? "") : null,
  },
  {
    id: "automation-globals",
    category: "automation",
    weight: 0.95,
    explain:
      "Globals or attributes left by Selenium, Playwright, Puppeteer, PhantomJS and the like.",
    test: ({ signals }) =>
      signals.automation.automationGlobals.length
        ? signals.automation.automationGlobals.slice(0, 6).join(", ")
        : null,
  },
  {
    id: "native-functions-replaced",
    category: "tampering",
    weight: 0.7,
    explain:
      "Navigator getters or core functions no longer look native: something rewrote what the page reads.",
    test: ({ signals }) => {
      const lies = signals.tampering.lies.filter((l) => !PRIVACY_TARGETS.test(l));
      return lies.length ? lies.slice(0, 4).join("; ") : null;
    },
  },
  {
    id: "fingerprint-functions-replaced",
    category: "tampering",
    weight: 0.2,
    explain:
      "Canvas, WebGL or audio functions were replaced: often a privacy extension, sometimes a bot's spoofing.",
    test: ({ signals }) => {
      const lies = signals.tampering.lies.filter((l) => PRIVACY_TARGETS.test(l));
      return lies.length ? lies.slice(0, 4).join("; ") : null;
    },
  },
  {
    id: "tostring-patched",
    category: "tampering",
    weight: 0.7,
    explain:
      "Function.prototype.toString itself was replaced, to make patched functions look native.",
    test: ({ signals }) =>
      signals.tampering.toStringPatched ? "Function.prototype.toString" : null,
  },
  {
    id: "iframe-mismatch",
    category: "tampering",
    weight: 0.75,
    explain:
      "A fresh iframe answers differently from the page: the page was patched, the new realm was not.",
    test: ({ signals }) =>
      signals.iframe?.mismatches.length ? signals.iframe.mismatches.join(", ") : null,
  },
  {
    id: "worker-mismatch",
    category: "tampering",
    weight: 0.55,
    explain: "A Web Worker answers differently from the page.",
    test: ({ signals }) =>
      signals.worker?.mismatches.length ? signals.worker.mismatches.join(", ") : null,
  },
  {
    id: "engine-mismatch",
    category: "consistency",
    weight: 0.8,
    explain:
      "The user agent claims one engine, the JavaScript engine is another (eval.toString().length).",
    test: ({ signals }) => {
      const { engineClaimed: c, engineObserved: o } = signals.automation;
      if (o === "unknown" || c === "unknown") return null;
      const bad = c === "blink" ? o !== "blink" : o === "blink";
      return bad ? `claims ${c}, runs ${o}` : null;
    },
  },
  {
    id: "os-mismatch",
    category: "consistency",
    weight: 0.6,
    explain:
      "The user agent, navigator.platform, userAgentData and the GPU name different systems.",
    test: ({ signals }) => {
      const systems = claimedSystems(signals);
      return systemsDisagree(systems)
        ? Object.entries(systems)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")
        : null;
    },
  },
  {
    id: "timezone-mismatch",
    category: "consistency",
    weight: 0.6,
    explain:
      "The time zone name and the clock's offset disagree: one of them was overridden (a VPN or a bot setting it).",
    test: ({ signals }) => {
      const { timezoneOffset: o, timezoneOffsetFromName: n, timezone } = signals.env;
      return n !== null && Math.abs(n - o) > 1
        ? `${timezone} is ${-n} min, clock says ${-o}`
        : null;
    },
  },
  {
    id: "mobile-without-touch",
    category: "consistency",
    weight: 0.6,
    explain: "A phone user agent on a screen without touch.",
    test: ({ signals }) =>
      MOBILE_UA.test(signals.env.userAgent) && signals.env.maxTouchPoints === 0
        ? "maxTouchPoints = 0"
        : null,
  },
  {
    id: "language-mismatch",
    category: "consistency",
    weight: 0.3,
    explain: "navigator.language is not the first of navigator.languages.",
    test: ({ signals }) => {
      const first = signals.env.languages[0];
      return first && first !== signals.env.language ? `${signals.env.language} vs ${first}` : null;
    },
  },
  {
    id: "empty-languages",
    category: "automation",
    weight: 0.6,
    explain: "navigator.languages is empty, as in some headless browsers.",
    test: ({ signals }) => (signals.automation.emptyLanguages ? "[]" : null),
  },
  {
    id: "outer-size-zero",
    category: "automation",
    weight: 0.6,
    explain: "The window has no outer size: there is no real window around the page.",
    test: ({ signals }) =>
      signals.automation.outerSizeZero ? "outerWidth = outerHeight = 0" : null,
  },
  {
    id: "chrome-object-missing",
    category: "consistency",
    weight: 0.5,
    explain: "A desktop Chrome user agent without the window.chrome object Chrome always has.",
    test: ({ signals }) =>
      signals.automation.chromeObjectMissing ? "window.chrome missing" : null,
  },
  {
    id: "plugins-not-genuine",
    category: "tampering",
    weight: 0.6,
    explain: "navigator.plugins or mimeTypes are not a real PluginArray / MimeTypeArray.",
    test: ({ signals }) =>
      signals.automation.pluginsGenuine ? null : "plugins or mimeTypes replaced",
  },
  {
    id: "no-plugins",
    category: "automation",
    weight: 0.3,
    explain: "A desktop Chromium with no PDF plugin listed, which old headless builds did.",
    test: ({ signals }) =>
      signals.automation.engineClaimed === "blink" &&
      !MOBILE_UA.test(signals.env.userAgent) &&
      signals.automation.plugins === 0
        ? "0 plugins"
        : null,
  },
  {
    id: "notification-permission-mismatch",
    category: "automation",
    weight: 0.5,
    explain:
      "Notification.permission says denied while the Permissions API says prompt: a headless quirk.",
    test: ({ signals }) =>
      signals.automation.notificationPermissionMismatch ? "denied vs prompt" : null,
  },
  {
    id: "software-renderer",
    category: "hardware",
    weight: 0.45,
    explain:
      "WebGL runs on a software renderer (SwiftShader, llvmpipe): typical of servers and headless runs, also of some VMs.",
    test: ({ signals }) =>
      signals.automation.softwareRenderer
        ? (signals.hardware.webgl?.unmaskedRenderer ?? signals.hardware.webgl?.renderer ?? "")
        : null,
  },
  {
    id: "implausible-hardware",
    category: "hardware",
    weight: 0.3,
    explain: "A core count or a memory size no real device reports.",
    test: ({ signals }) => {
      const { hardwareConcurrency: c, deviceMemory: m } = signals.env;
      if (c !== null && (c < 1 || c > 256)) return `${c} cores`;
      if (m !== null && !DEVICE_MEMORY.has(m)) return `${m} GB`;
      return null;
    },
  },
  {
    id: "canvas-noise",
    category: "hardware",
    weight: 0.1,
    explain:
      "The same canvas drawing reads back differently twice: noise was injected (privacy tool or spoofing).",
    test: ({ signals }) =>
      signals.hardware.canvas && !signals.hardware.canvas.stable ? "two different reads" : null,
  },
  {
    id: "untrusted-events",
    category: "behavior",
    weight: 0.7,
    explain: "Events dispatched by a script (isTrusted = false) instead of a person.",
    test: ({ behavior }) => (behavior?.untrusted ? `${behavior.untrusted} events` : null),
  },
  {
    id: "input-without-keys",
    category: "behavior",
    weight: 0.4,
    explain: "Fields changed with no key pressed or text pasted: a script filled them.",
    test: ({ behavior }) =>
      behavior?.inputWithoutKeys ? `${behavior.inputWithoutKeys} inputs` : null,
  },
  {
    id: "robotic-pointer",
    category: "behavior",
    weight: 0.6,
    explain: "Pointer moves in ruler-straight lines at a constant speed.",
    test: ({ behavior }) =>
      behavior &&
      behavior.moves >= 10 &&
      behavior.straightness > 0.995 &&
      behavior.speedCv < 0.05 &&
      behavior.jitter < 0.3
        ? `straightness ${behavior.straightness}, speed cv ${behavior.speedCv}`
        : null,
  },
  {
    id: "no-coalesced-events",
    category: "behavior",
    weight: 0.25,
    explain: "Pointer events carry no raw samples, as synthetic ones often do.",
    test: ({ behavior }) =>
      behavior && behavior.moves >= 10 && behavior.coalescedMean === 0 ? "0 per event" : null,
  },
];

/**
 * Runs every rule and combines the tripped ones as independent evidence (noisy-OR):
 * `bot = 1 − Π(1 − weight)`. Deterministic, no network.
 */
export function score(input: ScoreInput, rules: readonly Rule[] = RULES): ScoreResult {
  const flags: Flag[] = [];
  for (const rule of rules) {
    let detail: string | null = null;
    try {
      detail = rule.test(input);
    } catch {
      detail = null;
    }
    if (detail !== null)
      flags.push({
        id: rule.id,
        category: rule.category,
        weight: rule.weight,
        explain: rule.explain,
        detail,
      });
  }
  const bot = 1 - flags.reduce((p, f) => p * (1 - f.weight), 1);
  return {
    bot: Math.round(bot * 1000) / 1000,
    verdict: verdictOf(bot),
    flags,
    checked: rules.map((r) => r.id),
  };
}

export function verdictOf(bot: number): Verdict {
  if (bot >= THRESHOLDS.bot) return "bot";
  if (bot >= THRESHOLDS.unsure) return "unsure";
  return "human";
}

/** Blends the rules with a model's opinion, the rules weighing `rulesWeight` (default 0.7). */
export function blend(rulesBot: number, modelBot: number | null, rulesWeight = 0.7): number {
  if (modelBot === null) return rulesBot;
  const w = Math.min(1, Math.max(0, rulesWeight));
  // A decisive rule (webdriver, automation globals) is never argued away by a model.
  if (rulesBot >= 0.95) return rulesBot;
  return Math.round((w * rulesBot + (1 - w) * modelBot) * 1000) / 1000;
}
