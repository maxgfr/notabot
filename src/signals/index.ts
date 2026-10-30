import { collectAutomation } from "./automation";
import { collectEnv } from "./env";
import { collectAudio, collectCanvas, collectFonts, collectWebGL, collectWebGPU } from "./hardware";
import { collectIframe, collectWorker, snapshotOf } from "./realms";
import { collectTampering } from "./tampering";
import type { NotabotSignals } from "./types";
import { errorMessage, withTimeout } from "./util";

export interface CollectOptions {
  /** Per-collector budget in milliseconds. Default 2000. */
  timeoutMs?: number;
  /** Skip the Web Worker realm (pages whose CSP forbids blob: workers). */
  worker?: boolean;
}

/**
 * Reads everything the browser exposes to a page, then asks a fresh iframe and a Web Worker the
 * same questions. Never throws: a collector that fails leaves its default and an entry in `errors`.
 */
export async function collect(options: CollectOptions = {}): Promise<NotabotSignals> {
  if (typeof window === "undefined" || typeof document === "undefined")
    throw new Error("notabot: collect() runs in a browser page");
  const started = performance.now();
  const budget = options.timeoutMs ?? 2000;
  const errors: Record<string, string> = {};
  async function safe<T>(name: string, run: () => T | Promise<T>, fallback: T): Promise<T> {
    // withTimeout turns a rejection into the fallback: note its error first.
    const running = Promise.resolve().then(run);
    running.catch((e) => {
      errors[name] = errorMessage(e);
    });
    return withTimeout(running, budget, fallback);
  }

  const env = await safe("env", collectEnv, null);
  if (!env) throw new Error(`notabot: cannot read the environment (${errors.env ?? "timeout"})`);
  const [canvas, webgl, audio, webgpu, fonts] = await Promise.all([
    safe("canvas", collectCanvas, null),
    safe("webgl", collectWebGL, null),
    safe("audio", collectAudio, null),
    safe("webgpu", collectWebGPU, null),
    safe("fonts", collectFonts, [] as string[]),
  ]);
  const page = snapshotOf(window);
  const [automation, tampering, iframe, worker, privacy] = await Promise.all([
    safe("automation", () => collectAutomation(env, webgl), null),
    safe("tampering", collectTampering, { lies: [], checked: 0, toStringPatched: false }),
    safe("iframe", () => collectIframe(page), null),
    options.worker === false ? null : safe("worker", () => collectWorker(page), null),
    safe("privacy", collectPrivacy, null),
  ]);
  if (!automation) throw new Error(`notabot: automation checks failed (${errors.automation})`);
  return {
    version: 1,
    collectedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    env,
    hardware: { canvas, webgl, webgpu, audio, fonts },
    automation,
    tampering,
    page,
    iframe,
    worker,
    privacy,
    errors,
  };
}

/**
 * Whether the page may open its origin-private file system: Firefox and Safari refuse it in a
 * private window. Read-only: the directory handle is asked for, nothing is written.
 */
async function collectPrivacy(): Promise<NonNullable<NotabotSignals["privacy"]>> {
  const storage = navigator.storage as
    | (StorageManager & { getDirectory?: () => Promise<unknown> })
    | undefined;
  if (!storage?.getDirectory) return { opfs: "missing" };
  try {
    await withTimeout(storage.getDirectory(), 500, null);
    return { opfs: "ok" };
  } catch {
    return { opfs: "error" };
  }
}

export { automationGlobals, collectAutomation } from "./automation";
export { collectEnv, offsetOfTimeZone } from "./env";
export {
  collectAudio,
  collectCanvas,
  collectFonts,
  collectWebGL,
  collectWebGPU,
  paintFingerprint,
  paintWebGLScene,
} from "./hardware";
export { collectIframe, collectWorker, compareSnapshots, snapshotOf } from "./realms";
export { collectTampering, lieOf } from "./tampering";
export type * from "./types";
export { engineOfEvalLength, engineOfUserAgent, fnv1a, osOf } from "./util";
