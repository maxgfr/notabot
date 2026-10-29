import type { NotabotSignals, RealmSnapshot } from "../src/signals/types";

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

const page: RealmSnapshot = {
  userAgent: CHROME_UA,
  platform: "MacIntel",
  languages: ["fr-FR", "fr", "en"],
  hardwareConcurrency: 10,
  deviceMemory: 8,
  webdriver: false,
  timezone: "Europe/Paris",
  webglRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)",
};

/** A real desktop Chrome on a Mac, as collect() reads it. */
export function realChrome(): NotabotSignals {
  return {
    version: 1,
    collectedAt: "2026-10-28T12:00:00.000Z",
    durationMs: 180,
    env: {
      userAgent: CHROME_UA,
      uaData: {
        brands: ["Chromium 142", "Google Chrome 142", "Not_A Brand 99"],
        mobile: false,
        platform: "macOS",
        platformVersion: "15.4.0",
        architecture: "arm",
      },
      platform: "MacIntel",
      vendor: "Google Inc.",
      language: "fr-FR",
      languages: ["fr-FR", "fr", "en"],
      timezone: "Europe/Paris",
      timezoneOffset: -60,
      timezoneOffsetFromName: -60,
      intlLocale: "fr-FR",
      screen: {
        width: 1512,
        height: 982,
        availWidth: 1512,
        availHeight: 944,
        colorDepth: 30,
        pixelRatio: 2,
      },
      window: { innerWidth: 1512, innerHeight: 860, outerWidth: 1512, outerHeight: 944 },
      hardwareConcurrency: 10,
      deviceMemory: 8,
      maxTouchPoints: 0,
      connection: { effectiveType: "4g", rtt: 50, downlink: 10 },
      cookieEnabled: true,
      doNotTrack: null,
      globalPrivacyControl: null,
      pdfViewerEnabled: true,
      storageQuotaMB: 200000,
      codecs: { h264: "probably", vp9: "probably", av1: "probably", aac: "probably" },
      mediaQueries: { darkScheme: true, reducedMotion: false },
      mediaDevices: { audioinput: 1, audiooutput: 1, videoinput: 1 },
      permissions: { notifications: "prompt", geolocation: "prompt" },
      evalLength: 33,
      errorFingerprint: "Cannot read properties of null (reading 'x')",
    },
    hardware: {
      canvas: { hash: "1a2b3c4d", stable: true },
      webgl: {
        version: "WebGL 1.0 (OpenGL ES 2.0 Chromium)",
        vendor: "WebKit",
        renderer: "WebKit WebGL",
        unmaskedVendor: "Google Inc. (Apple)",
        unmaskedRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)",
        shadingLanguage: "WebGL GLSL ES 1.0",
        maxTextureSize: 16384,
        extensions: 36,
        sceneHash: "deadbeef",
      },
      webgpu: { vendor: "apple", architecture: "metal-3" },
      audio: { hash: "0badf00d", sum: 35.73 },
      fonts: ["Arial", "Helvetica Neue", "Menlo", "Monaco"],
    },
    automation: {
      webdriver: false,
      webdriverOwnProperty: false,
      headlessUserAgent: false,
      headlessBrand: false,
      chromeObjectMissing: false,
      plugins: 5,
      mimeTypes: 2,
      pluginsGenuine: true,
      notificationPermissionMismatch: false,
      automationGlobals: [],
      outerSizeZero: false,
      emptyLanguages: false,
      softwareRenderer: false,
      engineClaimed: "blink",
      engineObserved: "blink",
    },
    tampering: { lies: [], checked: 27, toStringPatched: false },
    page,
    iframe: { snapshot: { ...page }, mismatches: [] },
    worker: { snapshot: { ...page }, mismatches: [] },
    errors: {},
  };
}

/** Headless Chromium driven by Playwright, out of the box. */
export function headlessChromium(): NotabotSignals {
  const s = realChrome();
  const ua = CHROME_UA.replace("Chrome/", "HeadlessChrome/");
  s.env.userAgent = ua;
  s.env.uaData = {
    brands: ["HeadlessChrome 142", "Chromium 142"],
    mobile: false,
    platform: "Linux",
  };
  s.env.platform = "Linux x86_64";
  s.page.userAgent = ua;
  s.automation = {
    ...s.automation,
    webdriver: true,
    headlessUserAgent: true,
    headlessBrand: true,
    softwareRenderer: true,
  };
  s.hardware.webgl = {
    ...(s.hardware.webgl as NonNullable<NotabotSignals["hardware"]["webgl"]>),
    unmaskedRenderer:
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)",
  };
  return s;
}

/** A stealth-patched browser: webdriver hidden on the page, but the iframe and natives tell. */
export function stealth(): NotabotSignals {
  const s = realChrome();
  s.automation.webdriverOwnProperty = true;
  s.tampering = {
    lies: [
      "Navigator.webdriver: accepts a foreign receiver",
      "Navigator.languages: source visible",
    ],
    checked: 27,
    toStringPatched: true,
  };
  s.iframe = { snapshot: { ...s.page, webdriver: true }, mismatches: ["webdriver"] };
  return s;
}
