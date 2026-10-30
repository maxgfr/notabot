import type { RealmComparison, RealmSnapshot } from "./types";
import { withTimeout } from "./util";

type Realm = Window & typeof globalThis;

function webglRenderer(make: () => HTMLCanvasElement | OffscreenCanvas | null): string | null {
  try {
    const canvas = make();
    const gl = canvas?.getContext("webgl") as WebGLRenderingContext | null;
    if (!gl) return null;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch {
    return null;
  }
}

function timeZoneOf(win: Realm): string | null {
  try {
    return new win.Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** What a window (the page, or a fresh iframe) says about the browser. */
export function snapshotOf(win: Realm): RealmSnapshot {
  const nav = win.navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    languages: [...(nav.languages ?? [])],
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    deviceMemory: nav.deviceMemory ?? null,
    webdriver: typeof nav.webdriver === "boolean" ? nav.webdriver : null,
    timezone: timeZoneOf(win),
    webglRenderer: webglRenderer(() => win.document.createElement("canvas")),
    appVersion: nav.appVersion,
  };
}

/** Constructors every current engine puts in every realm. */
const BUILTINS = ["DateTimeFormat", "NumberFormat", "Collator", "PluralRules"] as const;

/**
 * The built-ins `page` has and `win` lacks. A fresh realm is built by the engine itself: one
 * missing what the page has was assembled by a patched browser (Camoufox leaves a fresh iframe's
 * `Intl` empty), not by a stock one.
 */
export function missingBuiltins(win: Realm, page: Realm = window): string[] {
  const has = (w: Realm, name: string) =>
    typeof (w.Intl as unknown as Record<string, unknown> | undefined)?.[name] === "function";
  return BUILTINS.filter((name) => has(page, name) && !has(win, name)).map((n) => `Intl.${n}`);
}

/** The fields of `other` that do not match the page's snapshot. */
export function compareSnapshots(page: RealmSnapshot, other: RealmSnapshot): string[] {
  const out: string[] = [];
  for (const key of Object.keys(page) as (keyof RealmSnapshot)[]) {
    // A field the other realm does not expose (a worker has no navigator.webdriver, and no
    // WebGL without OffscreenCanvas) is unknown there, not a lie.
    if (other[key] === null || other[key] === undefined) continue;
    if (JSON.stringify(page[key]) !== JSON.stringify(other[key])) out.push(key);
  }
  return out;
}

/**
 * A fresh same-origin iframe: a stealth layer that patched the page often forgets new realms.
 * Kept attached while `use` runs, then removed.
 */
export async function withFreshFrame<T>(use: (win: Realm) => T | Promise<T>): Promise<T | null> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText =
    "position:absolute;width:1px;height:1px;left:-9999px;border:0;visibility:hidden";
  (document.body ?? document.documentElement).appendChild(frame);
  try {
    const win = frame.contentWindow as Realm | null;
    return win ? await use(win) : null;
  } finally {
    frame.remove();
  }
}

export async function collectIframe(page: RealmSnapshot): Promise<RealmComparison | null> {
  const read = await withFreshFrame((win) => ({
    snapshot: snapshotOf(win),
    missing: missingBuiltins(win),
  }));
  return read ? { ...read, mismatches: compareSnapshots(page, read.snapshot) } : null;
}

const WORKER_SOURCE = `
const n = self.navigator;
let webglRenderer = null;
try {
  const gl = new OffscreenCanvas(1, 1).getContext("webgl");
  const d = gl && gl.getExtension("WEBGL_debug_renderer_info");
  if (gl) webglRenderer = String(gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
} catch (e) {}
postMessage({
  userAgent: n.userAgent,
  platform: n.platform,
  languages: Array.from(n.languages || []),
  hardwareConcurrency: n.hardwareConcurrency ?? null,
  deviceMemory: n.deviceMemory ?? null,
  webdriver: typeof n.webdriver === "boolean" ? n.webdriver : null,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  webglRenderer,
  appVersion: n.appVersion,
});`;

/** The same questions asked from a Web Worker, which page-level patches rarely reach. */
export async function collectWorker(page: RealmSnapshot): Promise<RealmComparison | null> {
  if (typeof Worker === "undefined" || typeof Blob === "undefined") return null;
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  let worker: Worker | null = null;
  try {
    worker = new Worker(url);
    const w = worker;
    const snapshot = await withTimeout(
      new Promise<RealmSnapshot>((resolve, reject) => {
        w.onmessage = (e: MessageEvent<RealmSnapshot>) => resolve(e.data);
        w.onerror = (e) => reject(new Error(e.message || "worker failed"));
      }),
      1500,
      null,
    );
    return snapshot ? { snapshot, mismatches: compareSnapshots(page, snapshot) } : null;
  } catch {
    return null;
  } finally {
    worker?.terminate();
    URL.revokeObjectURL(url);
  }
}
