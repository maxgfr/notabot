// Probes: small questions only a real browser answers right, drawn at random for each puzzle and
// checked by the server. Declarative (a kind and its arguments, never code to eval), so a strict
// CSP holds, and different every time, so there is no fixed list to study and fake: a wrong
// answer is refused, not ignored (a fixed check gets learned, as Cap's issue #337 showed).

export type Probe =
  /** `new DOMMatrix(a).multiply(new DOMMatrix(b)).toString()`. */
  | { kind: "matrix"; a: number[]; b: number[] }
  /** `new Intl.NumberFormat(locale).format(value)`. */
  | { kind: "intl"; locale: string; value: number }
  /** `CSS.supports(property, value)`. */
  | { kind: "css"; property: string; value: string }
  /** `String(Object.getOwnPropertyDescriptor(<target>.prototype, property).get)`. */
  | { kind: "native"; target: "Navigator" | "Screen" | "Document"; property: string }
  /** The bytes of `new TextEncoder().encode(text)`, as hex. */
  | { kind: "encode"; text: string };

const LOCALES = ["de-DE", "en-US", "en-IN", "ja-JP", "es-ES"] as const;
/** Pairs every current engine (Blink, Gecko, WebKit) answers the same way. */
const CSS_PAIRS: [string, string, boolean][] = [
  ["display", "grid", true],
  ["display", "flex", true],
  ["display", "contents", true],
  ["color", "rgb(1 2 3 / 50%)", true],
  ["width", "calc(1px + 2%)", true],
  ["aspect-ratio", "16 / 9", true],
  ["display", "not-a-display", false],
  ["color", "not-a-color", false],
  ["width", "12 px", false],
];
const NATIVES: [Probe & { kind: "native" }][] = [
  [{ kind: "native", target: "Navigator", property: "userAgent" }],
  [{ kind: "native", target: "Navigator", property: "webdriver" }],
  [{ kind: "native", target: "Navigator", property: "languages" }],
  [{ kind: "native", target: "Navigator", property: "hardwareConcurrency" }],
  [{ kind: "native", target: "Screen", property: "width" }],
  [{ kind: "native", target: "Document", property: "hidden" }],
];

/** A small seeded generator (mulberry32): the same seed draws the same probes, here and there. */
function random(seed: string): () => number {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (Math.imul(s, 31) + seed.charCodeAt(i)) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` probes of different kinds, drawn from `seed`. */
export function probesFor(seed: string, count = 3): Probe[] {
  const r = random(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)] as T;
  const make: (() => Probe)[] = [
    () => ({
      kind: "matrix",
      a: Array.from({ length: 6 }, () => int(-9, 9)),
      b: Array.from({ length: 6 }, () => int(-9, 9)),
    }),
    () => ({ kind: "intl", locale: pick(LOCALES), value: int(1000, 99_999_999) / 100 }),
    () => {
      const [property, value] = pick(CSS_PAIRS);
      return { kind: "css", property, value };
    },
    () => pick(NATIVES)[0],
    () => ({
      kind: "encode",
      text: `é${int(0, 9999)}漢${String.fromCodePoint(0x1f600 + int(0, 40))}`,
    }),
  ];
  const kinds = make.map((_, i) => i);
  const out: Probe[] = [];
  while (out.length < Math.min(count, make.length)) {
    const i = kinds.splice(int(0, kinds.length - 1), 1)[0] as number;
    out.push((make[i] as () => Probe)());
  }
  return out;
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** `matrix(…)` of the product, as DOMMatrix's 2D toString writes it. */
function matrixProduct(a: number[], b: number[]): string {
  const [a1 = 0, b1 = 0, c1 = 0, d1 = 0, e1 = 0, f1 = 0] = a;
  const [a2 = 0, b2 = 0, c2 = 0, d2 = 0, e2 = 0, f2 = 0] = b;
  const m = [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
  return `matrix(${m.map((v) => String(v + 0)).join(", ")})`;
}

/** Answers a probe with the page's own APIs; "error" when the API is missing or throws. */
export function answerProbe(probe: Probe): string {
  try {
    switch (probe.kind) {
      case "matrix":
        return new DOMMatrix(probe.a).multiply(new DOMMatrix(probe.b)).toString();
      case "intl":
        return new Intl.NumberFormat(probe.locale).format(probe.value);
      case "css":
        return String(CSS.supports(probe.property, probe.value));
      case "native": {
        const proto = (globalThis as unknown as Record<string, { prototype: object }>)[probe.target]
          ?.prototype;
        const get = proto ? Object.getOwnPropertyDescriptor(proto, probe.property)?.get : undefined;
        return get ? Function.prototype.toString.call(get) : "missing";
      }
      case "encode":
        return hex(new TextEncoder().encode(probe.text));
    }
  } catch {}
  return "error";
}

/**
 * Whether an answer is a real browser's. Matrices, numbers, CSS and bytes have one answer; a
 * native getter reads `function get x() { [native code] }` in Blink and WebKit and
 * `function x() {\n    [native code]\n}` in Gecko, and nothing else.
 */
export function checkProbe(probe: Probe, answer: unknown): boolean {
  if (typeof answer !== "string" || answer.length > 2000) return false;
  switch (probe.kind) {
    case "matrix":
      return answer === matrixProduct(probe.a, probe.b);
    case "intl":
      return answer === new Intl.NumberFormat(probe.locale).format(probe.value);
    case "css":
      return (
        answer ===
        String(CSS_PAIRS.find(([p, v]) => p === probe.property && v === probe.value)?.[2])
      );
    case "native":
      return new RegExp(
        `^function (get )?${probe.property}\\(\\) \\{\\s*\\[native code\\]\\s*\\}$`,
      ).test(answer);
    case "encode":
      return answer === hex(new TextEncoder().encode(probe.text));
  }
}

/** The answer a real browser gives (Blink's form for native getters): for tests and docs. */
export function expectedAnswer(probe: Probe): string {
  switch (probe.kind) {
    case "matrix":
      return matrixProduct(probe.a, probe.b);
    case "intl":
      return new Intl.NumberFormat(probe.locale).format(probe.value);
    case "css":
      return String(CSS_PAIRS.find(([p, v]) => p === probe.property && v === probe.value)?.[2]);
    case "native":
      return `function get ${probe.property}() { [native code] }`;
    case "encode":
      return hex(new TextEncoder().encode(probe.text));
  }
}

/** How many answers are wrong (a missing answer counts as wrong). */
export function wrongProbes(probes: Probe[], answers: unknown[]): number {
  return probes.filter((p, i) => !checkProbe(p, answers[i])).length;
}
