// What commercial fingerprinting services sell on top of their open-source libraries, computed
// here from the signals notabot already reads: a visitor identifier with its confidence, and
// "smart signals" (private mode, virtual machine, privacy browser, tampering). Pure functions,
// in the page or on a server; nothing is sent anywhere.
import { sha256Hex } from "../pow/crypto";
import type { NotabotSignals } from "../signals/types";

export interface Identification {
  /** A hash of the readings that stay put across visits: 20 hex characters. */
  visitorId: string;
  /**
   * How far to trust that the same browser gets the same id next time, 0 to 1: lower when a
   * privacy browser randomises readings, when the session is likely private (ephemeral), or when
   * the strongest readings (canvas, WebGL, audio) are missing.
   */
  confidence: number;
  /** The readings that went into the hash, by name. */
  components: Record<string, unknown>;
}

/**
 * "resist-fingerprinting": Firefox's resistFingerprinting, which Tor Browser is built on; the two
 * read alike from a page (Tor itself shows on the server, by its exit IP).
 */
export type PrivacyBrowser = "brave" | "resist-fingerprinting" | null;

export interface SmartSignals {
  /** A privacy browser that randomises or flattens readings on purpose. */
  privacyBrowser: PrivacyBrowser;
  /** Readings randomised per session or per read (Brave's farbling, canvas noise). */
  farbling: boolean;
  /**
   * A private or ephemeral session, by heuristics: `true` likely, `false` unlikely, `null`
   * unknown. Never evidence of a bot: people browse privately.
   */
  privateMode: boolean | null;
  privateEvidence: string[];
  /** A virtual machine's or a server's graphics (VMware, VirtualBox, Parallels, software GPU). */
  virtualMachine: boolean;
  virtualMachineEvidence: string | null;
  /** Native functions or getters that no longer look native, and realms that disagree. */
  tampering: { detected: boolean; lies: number; realmMismatches: number };
}

/** The smart signals a server seals in its token and returns from /siteverify. */
export interface SealedSignals {
  /** Keyed with the server's secret: two sites never share an id. */
  visitorId: string;
  confidence: number;
  privacyBrowser: PrivacyBrowser;
  farbling: boolean;
  privateMode: boolean | null;
  virtualMachine: boolean;
  tampering: boolean;
  /** The IP is a Tor exit node (when the server has the list). */
  tor: boolean;
  /** The IP's time zone disagrees with the browser's: a VPN or a proxy, likely. */
  vpn: boolean;
  vpnEvidence: string[];
  /** The IP belongs to a hosting provider. */
  hosting: boolean;
  /** The same fingerprint from many IPs, or many fingerprints from one IP (with `velocity`). */
  velocity: boolean;
}

const VM_RENDERER =
  /VMware|VirtualBox|Parallels|Hyper-V|Microsoft Basic Render|QEMU|virgl|llvmpipe|SwiftShader|softpipe/i;

/** The engine major version a user agent names ("chrome 156", "firefox 128", "safari 18"). */
function browserMajor(ua: string): string {
  const m =
    /(Edg|OPR|Firefox|Chrome|Version)\/(\d+)/.exec(ua) ?? /(Safari)\/(\d+)/.exec(ua) ?? null;
  return m ? `${m[1]?.toLowerCase()} ${m[2]}` : "unknown";
}

export function smartSignals(signals: NotabotSignals): SmartSignals {
  const { env, hardware: h, tampering: t, automation: a } = signals;
  const brands = env.uaData?.brands.join(" ") ?? "";
  const renderer = h.webgl?.unmaskedRenderer ?? h.webgl?.renderer ?? "";
  const gecko = a.engineClaimed === "gecko";
  // Firefox's resistFingerprinting (and Tor Browser, built on it): UTC, English, flattened
  // hardware, a generic WebGL renderer.
  const rfp =
    gecko &&
    env.timezone === "UTC" &&
    env.timezoneOffset === 0 &&
    (renderer === "Mozilla" || renderer === "") &&
    (env.hardwareConcurrency ?? 0) <= 4;
  const privacyBrowser: PrivacyBrowser =
    /Brave/.test(brands) || renderer === "Brave" ? "brave" : rfp ? "resist-fingerprinting" : null;
  const farbling = privacyBrowser === "brave" || (h.canvas !== null && !h.canvas.stable);

  const evidence: string[] = [];
  const quota = env.storageQuotaMB;
  const probe = signals.privacy;
  if (probe?.opfs === "error" && a.engineClaimed !== "blink")
    evidence.push("storage directory refused, as in Firefox and Safari private windows");
  // Chromium caps an incognito (or ephemeral) profile's quota far below a normal profile's,
  // which gets a share of the disk. Brave caps every profile at 2 GB: not evidence there.
  if (a.engineClaimed === "blink" && privacyBrowser !== "brave" && quota !== null && quota < 20_480)
    evidence.push(`storage quota ${quota} MB, an ephemeral profile's`);
  const privateMode = evidence.length > 0 ? true : quota === null && !probe ? null : false;

  const vm = VM_RENDERER.exec(renderer);
  return {
    privacyBrowser,
    farbling,
    privateMode,
    privateEvidence: evidence,
    virtualMachine: vm !== null,
    virtualMachineEvidence: vm ? renderer.slice(0, 120) : null,
    tampering: {
      detected:
        t.lies.length > 0 ||
        t.toStringPatched ||
        (signals.iframe?.mismatches.length ?? 0) > 0 ||
        (signals.worker?.mismatches.length ?? 0) > 0,
      lies: t.lies.length,
      realmMismatches:
        (signals.iframe?.mismatches.length ?? 0) + (signals.worker?.mismatches.length ?? 0),
    },
  };
}

/**
 * The readings that identify a browser and stay put across visits: no clock, no window size, no
 * behaviour, and canvas only when two reads agree. Exported for anyone who wants to see them.
 */
export function stableComponents(signals: NotabotSignals): Record<string, unknown> {
  const { env, hardware: h } = signals;
  return {
    browser: browserMajor(env.userAgent),
    platform: env.platform,
    uaPlatform: env.uaData?.platform ?? null,
    languages: env.languages,
    timezone: env.timezone,
    screen: [env.screen.width, env.screen.height, env.screen.colorDepth, env.screen.pixelRatio],
    cores: env.hardwareConcurrency,
    memory: env.deviceMemory,
    touch: env.maxTouchPoints,
    webgl: h.webgl
      ? [
          h.webgl.unmaskedVendor,
          h.webgl.unmaskedRenderer,
          h.webgl.extensions,
          h.webgl.maxTextureSize,
        ]
      : null,
    webglScene: h.webgl?.sceneHash ?? null,
    webgpu: h.webgpu ? [h.webgpu.vendor, h.webgpu.architecture] : null,
    canvas: h.canvas?.stable ? h.canvas.hash : null,
    audio: h.audio?.hash ?? null,
    fonts: h.fonts,
    codecs: env.codecs,
    engine: [env.evalLength, env.errorFingerprint],
  };
}

/**
 * A visitor identifier from the signals, with its confidence: the same browser, the same id,
 * visit after visit, while its readings stay the same. A privacy browser that randomises per
 * session (Brave) gets a new id per session, by design: the confidence says so.
 */
export async function identify(signals: NotabotSignals, salt = ""): Promise<Identification> {
  const components = stableComponents(signals);
  const smart = smartSignals(signals);
  const visitorId = (await sha256Hex(`${salt}${JSON.stringify(components)}`)).slice(0, 20);
  let confidence = 1;
  if (smart.farbling) confidence -= 0.35;
  if (smart.privacyBrowser === "resist-fingerprinting") confidence -= 0.3;
  if (smart.privateMode) confidence -= 0.15;
  for (const key of ["canvas", "webgl", "audio"] as const)
    if (components[key] === null) confidence -= 0.1;
  return {
    visitorId,
    confidence: Math.round(Math.min(1, Math.max(0.1, confidence)) * 100) / 100,
    components,
  };
}
