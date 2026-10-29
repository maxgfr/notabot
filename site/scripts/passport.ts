// The passport data page: guilloché security print, the portrait (the visitor's own canvas and
// WebGL renders), the fields, the machine-readable zone with real ICAO check digits, the stamp.
import { paintFingerprint, paintWebGLScene } from "../../src/signals/hardware";
import type { NotabotSignals } from "../../src/signals/types";
import { engineOfUserAgent, osOf } from "../../src/signals/util";

const SVG = "http://www.w3.org/2000/svg";

/** A hypotrochoid: the rosette engraving machines cut into banknotes and passports. */
function rosette(cx: number, cy: number, R: number, r: number, d: number, turns: number): string {
  const steps = 1400;
  let path = "";
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2 * turns;
    const x = cx + (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
    const y = cy + (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
    path += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return path;
}

/** Interlaced sine bands, the border pattern of a security page. */
function band(y: number, amplitude: number, period: number, phase: number, width: number): string {
  let path = "";
  for (let x = 0; x <= width; x += 3) {
    const v = y + amplitude * Math.sin((x / period) * Math.PI * 2 + phase);
    path += `${x ? "L" : "M"}${x} ${v.toFixed(1)}`;
  }
  return path;
}

export function drawGuilloche(svg: SVGSVGElement): void {
  const w = 700;
  const h = 480;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  const add = (d: string, cls: string) => {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    p.setAttribute("class", cls);
    svg.append(p);
  };
  // Rosette centres sit outside the page: only their rings cross it, never the empty hub.
  add(rosette(760, 120, 150, 41, 70, 41), "g-teal");
  add(rosette(760, 120, 112, 29, 46, 29), "g-violet");
  add(rosette(-40, 520, 96, 23, 58, 23), "g-teal faint");
  for (let i = 0; i < 6; i++) {
    add(band(30 + i * 2.2, 9, 46, i * 0.7, w), i % 2 ? "g-violet" : "g-teal");
    add(band(h - 120 + i * 2.2, 7, 38, i * 0.9, w), i % 2 ? "g-teal" : "g-violet");
  }
}

/** The portrait: the WebGL scene the GPU fingerprint hashes, then the canvas drawing. */
export function drawPortrait(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#e4e8da";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const scene = paintWebGLScene();
  ctx.imageSmoothingEnabled = false;
  if (scene) ctx.drawImage(scene, 0, 0, 64, 64, 0, 0, canvas.width, canvas.width);
  const print = paintFingerprint();
  if (print) {
    ctx.fillStyle = "#f7f8f2";
    ctx.fillRect(0, canvas.width, canvas.width, canvas.height - canvas.width);
    ctx.drawImage(print, 0, canvas.width);
  }
}

const CODES = {
  windows: "WIN",
  mac: "MAC",
  linux: "LNX",
  android: "AND",
  ios: "IOS",
  unknown: "UNK",
};

export function browserName(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/HeadlessChrome/.test(ua)) return "HeadlessChrome";
  if (/Chrome\/|CriOS\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Unknown";
}

export function browserVersion(ua: string): string {
  const m = /(?:Edg|OPR|Firefox|HeadlessChrome|Chrome|CriOS|Version)\/([\d.]+)/.exec(ua);
  return m?.[1] ?? "—";
}

export function systemCode(s: NotabotSignals): string {
  return CODES[osOf(s.env.userAgent)];
}

const SYSTEM_NAMES = {
  windows: "Windows",
  mac: "macOS",
  linux: "Linux",
  android: "Android",
  ios: "iOS",
  unknown: "Unknown",
};

/** ICAO 9303 check digit: weights 7, 3, 1 over digits, A–Z = 10–35 and < = 0. */
export function checkDigit(field: string): string {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const c = field[i] ?? "<";
    const v = c >= "0" && c <= "9" ? Number(c) : c >= "A" && c <= "Z" ? c.charCodeAt(0) - 55 : 0;
    sum += v * (weights[i % 3] ?? 1);
  }
  return String(sum % 10);
}

const mrzText = (s: string) =>
  s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[^A-Z0-9]+/g, "<");

const pad = (s: string, n: number) => (s + "<".repeat(n)).slice(0, n);

function yymmdd(d: Date): string {
  return `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** The two 44-character lines of a TD3 machine-readable zone, built from the signals. */
export function machineReadableZone(
  s: NotabotSignals,
  verdict: string | null,
  now = new Date(),
): [string, string] {
  const code = systemCode(s);
  const name = `${mrzText(browserName(s.env.userAgent))}<<${mrzText(browserVersion(s.env.userAgent))}`;
  const line1 = pad(`P<${code}${name}`, 44);
  const number = pad(mrzText(s.hardware.canvas?.hash ?? "000000000"), 9);
  const issued = yymmdd(now);
  const expires = yymmdd(new Date(now.getTime() + 600_000));
  const optional = pad(mrzText(verdict ?? "PENDING"), 14);
  const head = `${number}${checkDigit(number)}${code}${issued}${checkDigit(issued)}<${expires}${checkDigit(expires)}${optional}${checkDigit(optional)}`;
  const composite = `${number}${checkDigit(number)}${issued}${checkDigit(issued)}${expires}${checkDigit(expires)}${optional}${checkDigit(optional)}`;
  return [line1, pad(head, 43) + checkDigit(composite)];
}

export function fillPassport(s: NotabotSignals, verdict: string | null): void {
  const set = (id: string, text: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  const ua = s.env.userAgent;
  const engine = engineOfUserAgent(ua);
  set("pp-code", systemCode(s));
  set("pp-engine", `${browserName(ua)} · ${engine === "unknown" ? "?" : engine}`);
  set("pp-version", browserVersion(ua));
  set(
    "pp-system",
    `${SYSTEM_NAMES[osOf(ua)]}${s.env.uaData?.platformVersion ? ` ${s.env.uaData.platformVersion}` : ""}`,
  );
  set("pp-languages", s.env.languages.join(", ") || "—");
  set("pp-timezone", s.env.timezone);
  set("pp-screen", `${s.env.screen.width}×${s.env.screen.height} @${s.env.screen.pixelRatio}x`);
  set(
    "pp-cpu",
    `${s.env.hardwareConcurrency ?? "—"} · ${s.env.deviceMemory ? `${s.env.deviceMemory} GB` : "—"}`,
  );
  const gpu = s.hardware.webgl?.unmaskedRenderer ?? s.hardware.webgl?.renderer ?? "—";
  set("pp-gpu", gpu.replace(/^ANGLE \((.*)\)$/, "$1"));
  set("pp-print", (s.hardware.canvas?.hash ?? "—").toUpperCase());
  set("pp-issued", new Date(s.collectedAt).toISOString().slice(0, 16).replace("T", " "));
  const mrz = document.getElementById("mrz");
  if (mrz) {
    const [a, b] = machineReadableZone(s, verdict);
    const l1 = document.createElement("span");
    l1.textContent = a;
    const l2 = document.createElement("span");
    l2.textContent = b;
    mrz.replaceChildren(l1, l2);
  }
}

/** The rubber stamp, pressed onto the data page. */
export function stamp(
  zone: HTMLElement,
  kind: "human" | "unsure" | "bot" | "error",
  word: string,
  lang: string,
): void {
  const date = new Intl.DateTimeFormat(lang, { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date())
    .toUpperCase();
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 260 120");
  svg.setAttribute("class", `stamp stamp-${kind}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${word}, ${date}`);
  const rect = (inset: number, sw: number) => {
    const r = document.createElementNS(SVG, "rect");
    r.setAttribute("x", String(inset));
    r.setAttribute("y", String(inset));
    r.setAttribute("width", String(260 - inset * 2));
    r.setAttribute("height", String(120 - inset * 2));
    r.setAttribute("rx", "10");
    r.setAttribute("stroke-width", String(sw));
    svg.append(r);
  };
  rect(3, 5);
  rect(11, 1.5);
  const text = (y: number, size: number, content: string, cls = "") => {
    const t = document.createElementNS(SVG, "text");
    t.setAttribute("x", "130");
    t.setAttribute("y", String(y));
    t.setAttribute("font-size", String(size));
    t.setAttribute("text-anchor", "middle");
    if (cls) t.setAttribute("class", cls);
    t.textContent = content;
    svg.append(t);
    return t;
  };
  text(36, 12, "NOTABOT · BORDER CONTROL", "small").setAttribute("textLength", "196");
  const big = text(76, 34, word.toUpperCase(), "word");
  // Long words are squeezed to the frame, as a stamp maker would cut them.
  if (word.length > 10) {
    big.setAttribute("textLength", "214");
    big.setAttribute("lengthAdjust", "spacingAndGlyphs");
    big.setAttribute("font-size", String(Math.max(20, 34 - (word.length - 10) * 1.2)));
  }
  text(100, 12, date, "small");
  zone.replaceChildren(svg);
}
