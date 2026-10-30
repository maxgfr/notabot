import type { EnvSignals, UaData } from "./types";
import { withTimeout } from "./util";

interface NavigatorUaData {
  brands?: { brand: string; version: string }[];
  mobile?: boolean;
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
}

type LooseNavigator = Navigator & {
  userAgentData?: NavigatorUaData;
  deviceMemory?: number;
  connection?: { effectiveType?: string; rtt?: number; downlink?: number; saveData?: boolean };
  globalPrivacyControl?: boolean;
};

const CODECS: Record<string, string> = {
  h264: 'video/mp4; codecs="avc1.42E01E"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
  vp9: 'video/webm; codecs="vp9"',
  av1: 'video/mp4; codecs="av01.0.05M.08"',
  theora: 'video/ogg; codecs="theora"',
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  opus: 'audio/webm; codecs="opus"',
  flac: "audio/flac",
  mp3: "audio/mpeg",
};

const MEDIA_QUERIES: Record<string, string> = {
  darkScheme: "(prefers-color-scheme: dark)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
  moreContrast: "(prefers-contrast: more)",
  forcedColors: "(forced-colors: active)",
  hoverNone: "(hover: none)",
  pointerCoarse: "(pointer: coarse)",
  hdr: "(dynamic-range: high)",
  p3: "(color-gamut: p3)",
};

const PERMISSIONS = ["notifications", "geolocation", "camera", "microphone", "persistent-storage"];

async function uaData(nav: LooseNavigator): Promise<UaData | null> {
  const data = nav.userAgentData;
  if (!data) return null;
  const out: UaData = {
    brands: (data.brands ?? []).map((b) => `${b.brand} ${b.version}`),
    mobile: Boolean(data.mobile),
    platform: data.platform ?? "",
  };
  if (data.getHighEntropyValues) {
    const high = await withTimeout(
      data.getHighEntropyValues([
        "platformVersion",
        "architecture",
        "bitness",
        "model",
        "fullVersionList",
      ]),
      800,
      {},
    );
    if (typeof high.platformVersion === "string") out.platformVersion = high.platformVersion;
    if (typeof high.architecture === "string") out.architecture = high.architecture;
    if (typeof high.bitness === "string") out.bitness = high.bitness;
    if (typeof high.model === "string") out.model = high.model;
    if (Array.isArray(high.fullVersionList))
      out.fullVersionList = (high.fullVersionList as { brand: string; version: string }[]).map(
        (b) => `${b.brand} ${b.version}`,
      );
  }
  return out;
}

/** The UTC offset, in `getTimezoneOffset` minutes, that a time zone name has right now. */
export function offsetOfTimeZone(timeZone: string, at = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    const seconds = Math.floor(at.getTime() / 1000) * 1000;
    return Math.round((seconds - asUtc) / 60000);
  } catch {
    return null;
  }
}

async function permissions(nav: Navigator): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!nav.permissions?.query) return out;
  await Promise.all(
    PERMISSIONS.map(async (name) => {
      try {
        const status = await withTimeout(
          nav.permissions.query({ name } as PermissionDescriptor),
          500,
          null,
        );
        if (status) out[name] = status.state;
      } catch {
        out[name] = "unsupported";
      }
    }),
  );
  return out;
}

async function mediaDevices(nav: Navigator): Promise<EnvSignals["mediaDevices"]> {
  if (!nav.mediaDevices?.enumerateDevices) return null;
  const devices = await withTimeout(nav.mediaDevices.enumerateDevices(), 800, null);
  if (!devices) return null;
  const count = { audioinput: 0, audiooutput: 0, videoinput: 0 };
  for (const d of devices) if (d.kind in count) count[d.kind as keyof typeof count]++;
  return count;
}

function errorFingerprint(): string {
  try {
    // biome-ignore lint/suspicious/noExplicitAny: provoking an engine-specific TypeError
    (null as any).x;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "";
}

/**
 * Whether CSS sees the screen size and pixel ratio JavaScript reports, a pixel (or a hundredth)
 * of rounding allowed; null when the engine does not support the query at all.
 */
export function screenMedia(): NonNullable<EnvSignals["screenMedia"]> {
  const supported = (query: string) => matchMedia(query).matches;
  const within = (feature: string, value: number, slack: number, unit: string) =>
    supported(`(min-${feature}: 0.001${unit})`)
      ? supported(
          `(min-${feature}: ${value - slack}${unit}) and (max-${feature}: ${value + slack}${unit})`,
        )
      : null;
  return {
    width: within("device-width", screen.width, 1, "px"),
    height: within("device-height", screen.height, 1, "px"),
    resolution: within("resolution", devicePixelRatio, 0.01, "dppx"),
  };
}

/** Everything the page can read about the browser, its settings and its machine. */
export async function collectEnv(): Promise<EnvSignals> {
  const nav = navigator as LooseNavigator;
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  const codecs: Record<string, string> = {};
  const video = document.createElement("video");
  for (const [name, type] of Object.entries(CODECS)) codecs[name] = video.canPlayType(type) || "no";
  const mediaQueries: Record<string, boolean> = {};
  for (const [name, query] of Object.entries(MEDIA_QUERIES))
    mediaQueries[name] = matchMedia(query).matches;
  const [ua, perms, devices, quota] = await Promise.all([
    uaData(nav),
    permissions(nav),
    mediaDevices(nav),
    nav.storage?.estimate
      ? withTimeout(nav.storage.estimate(), 500, {} as StorageEstimate)
      : Promise.resolve({} as StorageEstimate),
  ]);
  const c = nav.connection;
  return {
    userAgent: nav.userAgent,
    uaData: ua,
    platform: nav.platform,
    vendor: nav.vendor,
    language: nav.language,
    languages: [...(nav.languages ?? [])],
    timezone: resolved.timeZone,
    timezoneOffset: new Date().getTimezoneOffset(),
    timezoneOffsetFromName: offsetOfTimeZone(resolved.timeZone),
    intlLocale: resolved.locale,
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelRatio: devicePixelRatio,
    },
    window: { innerWidth, innerHeight, outerWidth, outerHeight },
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    deviceMemory: nav.deviceMemory ?? null,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    connection: c
      ? {
          ...(c.effectiveType !== undefined && { effectiveType: c.effectiveType }),
          ...(c.rtt !== undefined && { rtt: c.rtt }),
          ...(c.downlink !== undefined && { downlink: c.downlink }),
          ...(c.saveData !== undefined && { saveData: c.saveData }),
        }
      : null,
    cookieEnabled: nav.cookieEnabled,
    doNotTrack: nav.doNotTrack ?? null,
    globalPrivacyControl: nav.globalPrivacyControl ?? null,
    pdfViewerEnabled: nav.pdfViewerEnabled ?? null,
    storageQuotaMB: quota.quota ? Math.round(quota.quota / 1048576) : null,
    codecs,
    mediaQueries,
    mediaDevices: devices,
    permissions: perms,
    // Reading eval's source, never calling it.
    evalLength: String(Reflect.get(globalThis, "eval")).length,
    errorFingerprint: errorFingerprint(),
    appVersion: nav.appVersion,
    oscpu: (nav as { oscpu?: string }).oscpu ?? null,
    screenMedia: screenMedia(),
  };
}
