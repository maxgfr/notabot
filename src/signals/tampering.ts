import { withFreshFrame } from "./realms";
import type { TamperingSignals } from "./types";

const NATIVE = /\{\s*\[native code\]\s*\}\s*$/;

type Target = { label: string; fn: unknown; getter: boolean };

function getter(proto: object | undefined, prop: string, owner: string): Target | null {
  if (!proto) return null;
  const fn = Object.getOwnPropertyDescriptor(proto, prop)?.get;
  return fn ? { label: `${owner}.${prop}`, fn, getter: true } : null;
}

function method(proto: object | undefined, prop: string, owner: string): Target | null {
  if (!proto) return null;
  const fn = Object.getOwnPropertyDescriptor(proto, prop)?.value;
  return typeof fn === "function" ? { label: `${owner}.${prop}`, fn, getter: false } : null;
}

/** The functions and getters a stealth layer or an anti-fingerprinting tool tends to replace. */
export function targets(win: Window & typeof globalThis = window): Target[] {
  const g = win as unknown as Record<string, { prototype?: object } | undefined>;
  const p = (name: string) => g[name]?.prototype;
  const list = [
    ...[
      "webdriver",
      "userAgent",
      "platform",
      "languages",
      "hardwareConcurrency",
      "deviceMemory",
      "plugins",
      "vendor",
      "maxTouchPoints",
    ].map((prop) => getter(p("Navigator"), prop, "Navigator")),
    ...["width", "height", "colorDepth"].map((prop) => getter(p("Screen"), prop, "Screen")),
    method(p("HTMLCanvasElement"), "toDataURL", "HTMLCanvasElement"),
    method(p("HTMLCanvasElement"), "getContext", "HTMLCanvasElement"),
    method(p("CanvasRenderingContext2D"), "getImageData", "CanvasRenderingContext2D"),
    method(p("CanvasRenderingContext2D"), "measureText", "CanvasRenderingContext2D"),
    method(p("WebGLRenderingContext"), "getParameter", "WebGLRenderingContext"),
    method(p("WebGLRenderingContext"), "readPixels", "WebGLRenderingContext"),
    method(p("Permissions"), "query", "Permissions"),
    method(p("MediaDevices"), "enumerateDevices", "MediaDevices"),
    method(p("AudioBuffer"), "getChannelData", "AudioBuffer"),
    method(p("Element"), "getBoundingClientRect", "Element"),
    method(win.Date.prototype, "getTimezoneOffset", "Date"),
    method(win.Intl.DateTimeFormat.prototype, "resolvedOptions", "Intl.DateTimeFormat"),
    method(win.Function.prototype, "toString", "Function"),
    method(win.Object, "getOwnPropertyDescriptor", "Object"),
  ];
  return list.filter((t): t is Target => t !== null);
}

/**
 * Why a function no longer looks native, or null. A replaced function shows its source, gains
 * a `prototype` or an own `toString`, or (for a getter) stops refusing a foreign receiver.
 */
export function lieOf(target: Target, stringify: (fn: unknown) => string): string | null {
  const fn = target.fn as { (...args: unknown[]): unknown; prototype?: unknown };
  let source: string;
  try {
    source = stringify(fn);
  } catch {
    return "toString threw";
  }
  if (!NATIVE.test(source)) return "source visible";
  if ("prototype" in fn) return "has a prototype";
  if (Object.getOwnPropertyNames(fn).some((n) => n === "toString" || n === "toSource"))
    return "own toString";
  if (target.getter) {
    try {
      fn.call(Object.create(null));
      return "accepts a foreign receiver";
    } catch (e) {
      if (!(e instanceof TypeError) && e?.constructor?.name !== "TypeError")
        return "unexpected error";
    }
  }
  return null;
}

/** Native functions of the page that were replaced, judged with a fresh realm's `toString`. */
export async function collectTampering(): Promise<TamperingSignals> {
  const judge = (stringify: (fn: unknown) => string, patched: boolean): TamperingSignals => {
    const lies: string[] = [];
    const list = targets();
    for (const t of list) {
      const why = lieOf(t, stringify);
      if (why) lies.push(`${t.label}: ${why}`);
    }
    return { lies, checked: list.length, toStringPatched: patched };
  };
  const pageToString = Function.prototype.toString;
  // The detached frame's functions may stop working: judge while it is attached.
  const fromFrame = await withFreshFrame((win) => {
    const fresh = win.Function.prototype.toString;
    return judge((fn) => fresh.call(fn as () => void), !NATIVE.test(fresh.call(pageToString)));
  });
  return fromFrame ?? judge((fn) => pageToString.call(fn as () => void), false);
}
