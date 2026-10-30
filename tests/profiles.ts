// People the rules must never call bots: real setups whose readings look odd for good reasons
// (a keyboard, a screen reader, a privacy tool, another engine, a phone). Built from the real
// Chrome fixture and the documented behaviour of each setup, they feed the false-positive budget
// and the benchmark's human side.
import type { BehaviorFeatures } from "../src/behavior/index";
import type { NotabotSignals } from "../src/signals/types";
import { realChrome } from "./fixtures";

export interface Profile {
  id: string;
  /** What the setup is, and why its readings look the way they do. */
  note: string;
  signals: NotabotSignals;
  behavior: BehaviorFeatures | null;
}

function behavior(over: Partial<BehaviorFeatures>): BehaviorFeatures {
  return {
    samples: 0,
    durationMs: 0,
    speedMean: 0,
    speedCv: 0,
    accelCv: 0,
    straightness: 0,
    angleEntropy: 0,
    jitter: 0,
    stepCv: 0,
    turnRate: 0,
    endSlowdown: null,
    overshoot: null,
    tremor: null,
    moves: 0,
    clicks: 0,
    keys: 0,
    scrolls: 0,
    untrusted: 0,
    inputWithoutKeys: 0,
    focusChanges: 0,
    sessionMs: 8000,
    firstInteractionMs: 900,
    coalescedMean: null,
    keyDwellMean: null,
    keyDwellCv: null,
    keyFlightCv: null,
    scrollCv: null,
    pastes: 0,
    honeypot: 0,
    ...over,
  };
}

/** A hand on a trackpad: uneven speed, curved strokes, coalesced samples. */
const HAND = behavior({
  samples: 140,
  durationMs: 2600,
  speedMean: 0.9,
  speedCv: 0.8,
  accelCv: 1.4,
  straightness: 0.91,
  angleEntropy: 0.55,
  jitter: 3.2,
  stepCv: 0.7,
  turnRate: 0.28,
  endSlowdown: 0.34,
  overshoot: 0.25,
  tremor: 1.3,
  moves: 140,
  clicks: 2,
  keys: 14,
  scrolls: 3,
  firstInteractionMs: 420,
  coalescedMean: 2.4,
  keyDwellMean: 92,
  keyDwellCv: 0.3,
  keyFlightCv: 0.5,
});

function chromeOnMac(): Profile {
  return {
    id: "chrome-mac",
    note: "Desktop Chrome on a Mac, a trackpad.",
    signals: realChrome(),
    behavior: HAND,
  };
}

function keyboardOnly(): Profile {
  return {
    id: "keyboard-only",
    note: "Chrome driven from the keyboard only: tabs and keys, no pointer at all.",
    signals: realChrome(),
    behavior: behavior({
      keys: 22,
      focusChanges: 6,
      keyDwellMean: 105,
      keyDwellCv: 0.35,
      keyFlightCv: 0.6,
    }),
  };
}

function screenReader(): Profile {
  // VoiceOver moves focus and activates with keys; the page sees no pointer, often few keys.
  return {
    id: "screen-reader",
    note: "A screen reader with Chrome: focus moves, no pointer, few keys.",
    signals: realChrome(),
    behavior: behavior({ keys: 3, focusChanges: 9, firstInteractionMs: 4200 }),
  };
}

function privacyExtension(): Profile {
  // Canvas fingerprint defenders wrap toDataURL / getImageData and add noise to each read.
  const s = realChrome();
  s.hardware.canvas = { hash: "77aa11ee", stable: false };
  s.tampering.lies = [
    "HTMLCanvasElement.toDataURL: source visible",
    "CanvasRenderingContext2D.getImageData: source visible",
  ];
  return {
    id: "privacy-extension",
    note: "Chrome with a canvas-blocker extension: noisy canvas, wrapped canvas functions.",
    signals: s,
    behavior: HAND,
  };
}

function brave(): Profile {
  // Brave keeps Chrome's user agent, names itself in the brands, farbles canvas, audio and
  // hardwareConcurrency, and restricts fonts.
  const s = realChrome();
  s.env.uaData = {
    brands: ["Brave 142", "Chromium 142", "Not_A Brand 99"],
    mobile: false,
    platform: "macOS",
  };
  s.env.hardwareConcurrency = 4;
  s.hardware.canvas = { hash: "c0ffee11", stable: true };
  s.hardware.audio = { hash: "5eed5eed", sum: 35.7301 };
  s.hardware.fonts = ["Arial", "Helvetica Neue"];
  s.env.globalPrivacyControl = true;
  s.page = { ...s.page, hardwareConcurrency: 4 };
  if (s.iframe) s.iframe.snapshot = { ...s.page };
  if (s.worker) s.worker.snapshot = { ...s.page };
  return {
    id: "brave",
    note: "Brave on a Mac: farbled canvas, audio and core count, few fonts.",
    signals: s,
    behavior: HAND,
  };
}

const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15";

function safari(): Profile {
  // WebKit: no userAgentData, no deviceMemory, no window.chrome, the real PDF plugins, an
  // "Apple GPU" renderer, and eval.toString() of 37 characters.
  const s = realChrome();
  s.env.userAgent = SAFARI_UA;
  s.env.appVersion = SAFARI_UA.slice("Mozilla/".length);
  s.env.uaData = null;
  s.env.vendor = "Apple Computer, Inc.";
  s.env.deviceMemory = null;
  s.env.hardwareConcurrency = 8;
  s.env.evalLength = 37;
  s.env.errorFingerprint = "null is not an object (evaluating 'x.x')";
  s.env.mediaDevices = null;
  s.hardware.webgl = {
    version: "WebGL 1.0",
    vendor: "WebKit",
    renderer: "WebKit WebGL",
    unmaskedVendor: "Apple Inc.",
    unmaskedRenderer: "Apple GPU",
    shadingLanguage: "WebGL GLSL ES 1.0 (1.0)",
    maxTextureSize: 16384,
    extensions: 30,
    sceneHash: "a11ce5ed",
  };
  s.hardware.webgpu = null;
  s.automation = {
    ...s.automation,
    engineClaimed: "webkit",
    engineObserved: "gecko-or-webkit",
    chromeObjectMissing: false,
  };
  s.page = {
    ...s.page,
    userAgent: SAFARI_UA,
    appVersion: s.env.appVersion,
    deviceMemory: null,
    hardwareConcurrency: 8,
  };
  if (s.iframe) s.iframe.snapshot = { ...s.page };
  if (s.worker) s.worker.snapshot = { ...s.page };
  return { id: "safari", note: "Safari 18 on a Mac.", signals: s, behavior: HAND };
}

const FIREFOX_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";

function firefoxResistFingerprinting(): Profile {
  // privacy.resistFingerprinting: UTC, en-US, a rounded window, two cores, a generic WebGL
  // renderer, a randomised canvas read.
  const s = realChrome();
  s.env.userAgent = FIREFOX_UA;
  s.env.appVersion = "5.0 (X11)";
  s.env.oscpu = "Linux x86_64";
  s.env.uaData = null;
  s.env.platform = "Linux x86_64";
  s.env.vendor = "";
  s.env.language = "en-US";
  s.env.languages = ["en-US", "en"];
  s.env.timezone = "UTC";
  s.env.timezoneOffset = 0;
  s.env.timezoneOffsetFromName = 0;
  s.env.intlLocale = "en-US";
  s.env.screen = {
    width: 1400,
    height: 900,
    availWidth: 1400,
    availHeight: 900,
    colorDepth: 24,
    pixelRatio: 1,
  };
  s.env.window = { innerWidth: 1400, innerHeight: 900, outerWidth: 1400, outerHeight: 900 };
  s.env.hardwareConcurrency = 2;
  s.env.deviceMemory = null;
  s.env.evalLength = 37;
  s.env.errorFingerprint = 'can\'t access property "x", x is null';
  s.env.mediaDevices = null;
  s.hardware.canvas = { hash: "f1f0f1f0", stable: false };
  s.hardware.webgl = {
    version: "WebGL 1.0",
    vendor: "Mozilla",
    renderer: "Mozilla",
    unmaskedVendor: null,
    unmaskedRenderer: null,
    shadingLanguage: "WebGL GLSL ES 1.0",
    maxTextureSize: 8192,
    extensions: 28,
    sceneHash: null,
  };
  s.hardware.webgpu = null;
  s.hardware.audio = null;
  s.hardware.fonts = ["Arial"];
  s.automation = {
    ...s.automation,
    engineClaimed: "gecko",
    engineObserved: "gecko-or-webkit",
    chromeObjectMissing: false,
  };
  s.page = {
    ...s.page,
    userAgent: FIREFOX_UA,
    appVersion: "5.0 (X11)",
    platform: "Linux x86_64",
    languages: ["en-US", "en"],
    hardwareConcurrency: 2,
    deviceMemory: null,
    timezone: "UTC",
    webglRenderer: "Mozilla",
  };
  if (s.iframe) s.iframe.snapshot = { ...s.page };
  if (s.worker) s.worker.snapshot = { ...s.page };
  return {
    id: "firefox-rfp",
    note: "Firefox with resistFingerprinting on Linux, a mouse.",
    signals: s,
    behavior: HAND,
  };
}

const FIREFOX_MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:157.0) Gecko/20100101 Firefox/157.0";
const FIREFOX_LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0";

/**
 * Firefox as it reads on its own system: no userAgentData, no deviceMemory, no window.chrome,
 * eval.toString() of 37 characters, Gecko's error text, and a WebGL renderer Firefox rounds to a
 * family ("…, or similar"). Read from Firefox 157 on a Mac, the rest from its documentation.
 */
function firefoxOn(
  ua: string,
  platform: string,
  renderer: string,
  fonts: string[],
): NotabotSignals {
  const s = realChrome();
  const mac = platform === "MacIntel";
  s.env.userAgent = ua;
  s.env.appVersion = mac ? "5.0 (Macintosh)" : "5.0 (X11)";
  s.env.oscpu = mac ? "Intel Mac OS X 10.15" : platform;
  s.env.uaData = null;
  s.env.platform = platform;
  s.env.vendor = "";
  s.env.deviceMemory = null;
  s.env.evalLength = 37;
  s.env.errorFingerprint = 'can\'t access property "x", x is null';
  s.hardware.webgl = {
    version: "WebGL 1.0",
    vendor: "Mozilla",
    renderer: "Mozilla",
    unmaskedVendor: renderer.startsWith("Apple") ? "Apple" : "Intel",
    unmaskedRenderer: renderer,
    shadingLanguage: "WebGL GLSL ES 1.0",
    maxTextureSize: 16384,
    extensions: 36,
    sceneHash: "f12efox0",
  };
  s.hardware.fonts = fonts;
  s.automation = {
    ...s.automation,
    engineClaimed: "gecko",
    engineObserved: "gecko-or-webkit",
    chromeObjectMissing: false,
  };
  s.page = {
    ...s.page,
    userAgent: ua,
    appVersion: s.env.appVersion,
    platform,
    deviceMemory: null,
    webglRenderer: renderer,
  };
  if (s.iframe) s.iframe.snapshot = { ...s.page };
  if (s.worker) s.worker.snapshot = { ...s.page };
  return s;
}

const MAC_FONTS = ["Arial", "Courier New", "Geneva", "Helvetica Neue", "Lucida Grande", "Menlo"];

function firefoxMac(): Profile {
  const s = firefoxOn(FIREFOX_MAC_UA, "MacIntel", "Apple M1, or similar", MAC_FONTS);
  s.hardware.webgpu = { vendor: "apple", architecture: "metal-3" };
  return { id: "firefox-mac", note: "Firefox on a Mac, a trackpad.", signals: s, behavior: HAND };
}

function firefoxStrict(): Profile {
  // Enhanced Tracking Protection set to strict turns fingerprinting protection on: the canvas is
  // randomised per session and per site (two reads agree, the hash is another one), fonts are
  // limited to the system's base ones.
  const s = firefoxOn(FIREFOX_MAC_UA, "MacIntel", "Apple M1, or similar", ["Arial", "Geneva"]);
  s.hardware.canvas = { hash: "e7b0e7b0", stable: true };
  s.hardware.webgpu = null;
  return {
    id: "firefox-strict",
    note: "Firefox with Enhanced Tracking Protection on strict: randomised canvas, base fonts.",
    signals: s,
    behavior: HAND,
  };
}

function firefoxLinux(): Profile {
  const s = firefoxOn(FIREFOX_LINUX_UA, "Linux x86_64", "Intel(R) HD Graphics, or similar", [
    "DejaVu Sans",
    "Liberation Sans",
    "Noto Sans",
    "Ubuntu",
  ]);
  s.hardware.webgpu = null;
  s.env.screen = { ...s.env.screen, pixelRatio: 1 };
  return {
    id: "firefox-linux",
    note: "Firefox on Ubuntu, Intel graphics through Mesa, a mouse.",
    signals: s,
    behavior: HAND,
  };
}

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

function chromeWindows(): Profile {
  const s = realChrome();
  const renderer =
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)";
  s.env.userAgent = WINDOWS_UA;
  s.env.appVersion = WINDOWS_UA.slice("Mozilla/".length);
  s.env.uaData = {
    brands: ["Chromium 142", "Google Chrome 142", "Not_A Brand 99"],
    mobile: false,
    platform: "Windows",
  };
  s.env.platform = "Win32";
  s.env.screen = {
    width: 1920,
    height: 1080,
    availWidth: 1920,
    availHeight: 1032,
    colorDepth: 24,
    pixelRatio: 1.25,
  };
  s.hardware.webgl = {
    version: "WebGL 1.0 (OpenGL ES 2.0 Chromium)",
    vendor: "WebKit",
    renderer: "WebKit WebGL",
    unmaskedVendor: "Google Inc. (NVIDIA)",
    unmaskedRenderer: renderer,
    shadingLanguage: "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)",
    maxTextureSize: 16384,
    extensions: 36,
    sceneHash: "d3d11aaa",
  };
  s.hardware.webgpu = { vendor: "nvidia", architecture: "ampere" };
  s.hardware.fonts = ["Arial", "Calibri", "Cambria", "Consolas", "Segoe UI", "Tahoma", "Verdana"];
  s.page = {
    ...s.page,
    userAgent: WINDOWS_UA,
    appVersion: s.env.appVersion,
    platform: "Win32",
    webglRenderer: renderer,
  };
  if (s.iframe) s.iframe.snapshot = { ...s.page };
  if (s.worker) s.worker.snapshot = { ...s.page };
  return {
    id: "chrome-windows",
    note: "Chrome on Windows 11, an NVIDIA card, 125 % scaling, a mouse.",
    signals: s,
    behavior: HAND,
  };
}

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36";

function mobile(): Profile {
  // Chrome on Android: touch, no plugins, a phone screen, an Adreno GPU, no pointer moves.
  const s = realChrome();
  s.env.userAgent = ANDROID_UA;
  s.env.appVersion = ANDROID_UA.slice("Mozilla/".length);
  s.env.uaData = {
    brands: ["Chromium 142", "Google Chrome 142", "Not_A Brand 99"],
    mobile: true,
    platform: "Android",
  };
  s.env.platform = "Linux armv81";
  s.env.maxTouchPoints = 5;
  s.env.screen = {
    width: 412,
    height: 915,
    availWidth: 412,
    availHeight: 915,
    colorDepth: 24,
    pixelRatio: 2.625,
  };
  s.env.window = { innerWidth: 412, innerHeight: 788, outerWidth: 412, outerHeight: 915 };
  s.env.hardwareConcurrency = 8;
  s.env.deviceMemory = 4;
  s.hardware.webgl = {
    version: "WebGL 1.0 (OpenGL ES 2.0 Chromium)",
    vendor: "WebKit",
    renderer: "WebKit WebGL",
    unmaskedVendor: "Qualcomm",
    unmaskedRenderer: "Adreno (TM) 730",
    shadingLanguage: "WebGL GLSL ES 1.0",
    maxTextureSize: 4096,
    extensions: 30,
    sceneHash: "0ddba11",
  };
  s.hardware.webgpu = null;
  s.automation = { ...s.automation, plugins: 0, mimeTypes: 0 };
  s.page = {
    ...s.page,
    userAgent: ANDROID_UA,
    appVersion: s.env.appVersion,
    platform: "Linux armv81",
    hardwareConcurrency: 8,
    deviceMemory: 4,
    webglRenderer: "Adreno (TM) 730",
  };
  if (s.iframe) s.iframe.snapshot = { ...s.page };
  if (s.worker) s.worker.snapshot = { ...s.page };
  return {
    id: "android-chrome",
    note: "Chrome on an Android phone, a thumb.",
    signals: s,
    behavior: behavior({ clicks: 3, scrolls: 6, sessionMs: 9000 }),
  };
}

/** Every human profile, in a stable order. */
export function humanProfiles(): Profile[] {
  return [
    chromeOnMac(),
    keyboardOnly(),
    screenReader(),
    privacyExtension(),
    brave(),
    safari(),
    firefoxResistFingerprinting(),
    firefoxMac(),
    firefoxStrict(),
    firefoxLinux(),
    chromeWindows(),
    mobile(),
  ];
}
