/** What one browser realm (the page, a fresh iframe, a worker) says about itself. */
export interface RealmSnapshot {
  userAgent: string;
  platform: string;
  languages: string[];
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  webdriver: boolean | null;
  /** Null when the realm cannot say (its `Intl` is broken, see `RealmComparison.missing`). */
  timezone: string | null;
  webglRenderer: string | null;
  /** `navigator.appVersion`, which names the system on its own (absent from older captures). */
  appVersion?: string;
}

export interface UaData {
  brands: string[];
  mobile: boolean;
  platform: string;
  platformVersion?: string;
  architecture?: string;
  bitness?: string;
  model?: string;
  fullVersionList?: string[];
}

export interface EnvSignals {
  userAgent: string;
  uaData: UaData | null;
  platform: string;
  vendor: string;
  language: string;
  languages: string[];
  timezone: string;
  /** Minutes, as `Date#getTimezoneOffset` gives them (UTC minus local). */
  timezoneOffset: number;
  /** Offset the time zone name implies right now, to compare with `timezoneOffset`. */
  timezoneOffsetFromName: number | null;
  intlLocale: string;
  screen: {
    width: number;
    height: number;
    availWidth: number;
    availHeight: number;
    colorDepth: number;
    pixelRatio: number;
  };
  window: { innerWidth: number; innerHeight: number; outerWidth: number; outerHeight: number };
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  maxTouchPoints: number;
  connection: {
    effectiveType?: string;
    rtt?: number;
    downlink?: number;
    saveData?: boolean;
  } | null;
  cookieEnabled: boolean;
  doNotTrack: string | null;
  globalPrivacyControl: boolean | null;
  pdfViewerEnabled: boolean | null;
  storageQuotaMB: number | null;
  codecs: Record<string, string>;
  mediaQueries: Record<string, boolean>;
  mediaDevices: { audioinput: number; audiooutput: number; videoinput: number } | null;
  permissions: Record<string, string>;
  /** `eval.toString().length`: 33 in V8, 37 in SpiderMonkey and JavaScriptCore. */
  evalLength: number;
  /** Message of a known error, which differs per engine. */
  errorFingerprint: string;
  /** `navigator.appVersion`: "5.0 (Windows)" in Firefox, the user agent's tail elsewhere. */
  appVersion?: string;
  /** `navigator.oscpu`, Firefox only: the system it was built for. */
  oscpu?: string | null;
  /**
   * Whether CSS media queries see the screen `screen` and `devicePixelRatio` report: a value
   * rewritten in JavaScript leaves CSS reading the real one. Null where the query is unsupported.
   */
  screenMedia?: { width: boolean | null; height: boolean | null; resolution: boolean | null };
}

export interface WebGLInfo {
  version: string;
  vendor: string;
  renderer: string;
  unmaskedVendor: string | null;
  unmaskedRenderer: string | null;
  shadingLanguage: string;
  maxTextureSize: number;
  extensions: number;
  /** Hash of a rendered scene: drivers differ in their pixels even when they lie in their strings. */
  sceneHash: string | null;
}

export interface HardwareSignals {
  canvas: { hash: string; stable: boolean } | null;
  webgl: WebGLInfo | null;
  webgpu: { vendor: string; architecture: string } | null;
  audio: { hash: string; sum: number } | null;
  fonts: string[];
}

export interface AutomationSignals {
  webdriver: boolean | null;
  /** `webdriver` defined on the navigator object itself rather than on `Navigator.prototype`. */
  webdriverOwnProperty: boolean;
  headlessUserAgent: boolean;
  headlessBrand: boolean;
  chromeObjectMissing: boolean;
  plugins: number;
  mimeTypes: number;
  pluginsGenuine: boolean;
  notificationPermissionMismatch: boolean;
  /** Globals and attributes left by Selenium, Playwright, Puppeteer, PhantomJS, Nightmare… */
  automationGlobals: string[];
  outerSizeZero: boolean;
  emptyLanguages: boolean;
  softwareRenderer: boolean;
  /** The engine the user agent claims and the one `eval.toString()` reveals. */
  engineClaimed: "blink" | "gecko" | "webkit" | "unknown";
  engineObserved: "blink" | "gecko-or-webkit" | "unknown";
}

export interface TamperingSignals {
  /** Native functions and getters that no longer look native, e.g. "Navigator.webdriver". */
  lies: string[];
  checked: number;
  /** `Function.prototype.toString` itself replaced. */
  toStringPatched: boolean;
}

export interface RealmComparison {
  snapshot: RealmSnapshot;
  /** Fields that differ from the page's own snapshot. */
  mismatches: string[];
  /** Built-ins the page has and this fresh realm lacks, e.g. "Intl.DateTimeFormat". */
  missing?: string[];
}

export interface NotabotSignals {
  version: 1;
  collectedAt: string;
  durationMs: number;
  env: EnvSignals;
  hardware: HardwareSignals;
  automation: AutomationSignals;
  tampering: TamperingSignals;
  page: RealmSnapshot;
  iframe: RealmComparison | null;
  worker: RealmComparison | null;
  /** Storage probes that private windows answer differently (see notabot/smart). */
  privacy?: { opfs: "ok" | "error" | "missing" } | null;
  /** Collectors that failed or timed out, with their error. */
  errors: Record<string, string>;
}
