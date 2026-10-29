/** 32-bit FNV-1a of a string or bytes, as 8 hex digits: enough to compare fingerprints. */
export function fnv1a(input: string | ArrayLike<number>): string {
  let h = 0x811c9dc5;
  if (typeof input === "string") {
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  } else {
    for (let i = 0; i < input.length; i++) {
      h ^= input[i] ?? 0;
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Resolves to `fallback` when `promise` takes longer than `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The page's `window`, or null outside a browser (SSR, workers, tests). */
export function browserWindow(): (Window & typeof globalThis) | null {
  return typeof window !== "undefined" && typeof document !== "undefined" ? window : null;
}

export type Engine = "blink" | "gecko" | "webkit" | "unknown";

/** The engine a user agent string claims. */
export function engineOfUserAgent(ua: string): Engine {
  if (/Firefox\//.test(ua)) return "gecko";
  if (/Chrome\/|Chromium\/|CriOS\/|Edg\//.test(ua)) return /CriOS\//.test(ua) ? "webkit" : "blink";
  if (/AppleWebKit\//.test(ua)) return "webkit";
  return "unknown";
}

export type ObservedEngine = "blink" | "gecko-or-webkit" | "unknown";

/** The engine `eval.toString().length` reveals: each spells out "native code" its own way. */
export function engineOfEvalLength(length: number): ObservedEngine {
  if (length === 33) return "blink";
  if (length === 37) return "gecko-or-webkit";
  return "unknown";
}

/** The operating system a string names (user agent, platform, WebGL renderer). */
export function osOf(text: string): "windows" | "mac" | "linux" | "android" | "ios" | "unknown" {
  if (/Android/i.test(text)) return "android";
  if (/iPhone|iPad|iPod|iOS/i.test(text)) return "ios";
  if (/Win/i.test(text) || /Direct3D|D3D11/i.test(text)) return "windows";
  if (/Mac|Apple M\d|Apple GPU/i.test(text)) return "mac";
  if (/Linux|X11|CrOS|Mesa/i.test(text)) return "linux";
  return "unknown";
}
