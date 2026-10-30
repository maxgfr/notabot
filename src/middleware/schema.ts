// The shape of what a page posts to /verify, checked before any rule reads it: a client can post
// anything, and a rule that trips on a missing field must not turn into a 500 or a free pass.
import type { BehaviorFeatures } from "../behavior/index";
import type { NotabotSignals } from "../signals/types";

type Check = (v: unknown) => boolean;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num: Check = (v) => typeof v === "number" && Number.isFinite(v);
const bool: Check = (v) => typeof v === "boolean";
const str =
  (max = 1024): Check =>
  (v) =>
    typeof v === "string" && v.length <= max;
const strings: Check = (v) =>
  Array.isArray(v) && v.length <= 512 && v.every((s) => typeof s === "string" && s.length <= 512);
const object: Check = isObject;
const orNull =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
const optional =
  (check: Check): Check =>
  (v) =>
    v === undefined || check(v);
const shape =
  (spec: Record<string, Check>): Check =>
  (v) =>
    isObject(v) && Object.entries(spec).every(([k, check]) => check(v[k]));

const realm = shape({ mismatches: strings, missing: optional(strings) });

const SIGNALS = shape({
  durationMs: num,
  env: shape({
    userAgent: str(),
    uaData: orNull(shape({ brands: strings })),
    platform: str(),
    language: str(64),
    languages: strings,
    timezone: str(64),
    timezoneOffset: num,
    timezoneOffsetFromName: orNull(num),
    screen: shape({ width: num, height: num, colorDepth: num, pixelRatio: num }),
    window: shape({ innerWidth: num, innerHeight: num, outerWidth: num, outerHeight: num }),
    hardwareConcurrency: orNull(num),
    deviceMemory: orNull(num),
    maxTouchPoints: num,
    cookieEnabled: bool,
    codecs: object,
    mediaDevices: orNull(object),
    appVersion: optional(str()),
    oscpu: optional(orNull(str(256))),
    screenMedia: optional(object),
  }),
  hardware: shape({
    canvas: orNull(shape({ stable: bool })),
    webgl: orNull(object),
    webgpu: orNull(object),
    audio: orNull(object),
    fonts: strings,
  }),
  automation: shape({
    webdriver: orNull(bool),
    webdriverOwnProperty: bool,
    headlessUserAgent: bool,
    headlessBrand: bool,
    chromeObjectMissing: bool,
    plugins: num,
    mimeTypes: num,
    pluginsGenuine: bool,
    notificationPermissionMismatch: bool,
    automationGlobals: strings,
    outerSizeZero: bool,
    emptyLanguages: bool,
    softwareRenderer: bool,
    engineClaimed: str(16),
    engineObserved: str(16),
  }),
  tampering: shape({ lies: strings, toStringPatched: bool }),
  iframe: optional(orNull(realm)),
  worker: optional(orNull(realm)),
});

/** Whether `value` has every field the rules and the features read, with the right types. */
export function isSignals(value: unknown): value is NotabotSignals {
  return SIGNALS(value);
}

/** Behavior features: an object of at most 64 numbers (or nulls); null or absent is fine. */
export function isBehavior(value: unknown): value is BehaviorFeatures | null | undefined {
  if (value === null || value === undefined) return true;
  if (!isObject(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 64 && entries.every(([, v]) => v === null || num(v));
}
