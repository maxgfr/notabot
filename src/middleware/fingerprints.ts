// Fingerprints of the connection a page cannot touch: TLS (JA4, from a proxy that terminates
// TLS), the HTTP request's own shape (JA4H) and HTTP/2's SETTINGS frame. Every value compared
// against below carries its source; where none is citable, the rule checks coherence only.
import { sha256Hex } from "../pow/crypto";

/** The documents the rules below rely on. */
export const REFERENCES = {
  ja4: {
    what: "JA4 and JA4H formats: protocol, TLS version, SNI, cipher and extension counts, ALPN",
    source: "https://github.com/FoxIO-LLC/ja4/blob/main/technical_details/JA4.md",
    sourceH: "https://github.com/FoxIO-LLC/ja4/blob/main/technical_details/JA4H.md",
  },
  chromiumH2: {
    what: "The SETTINGS Chromium sends on a new HTTP/2 connection (Chrome 106 and later)",
    values:
      "HEADER_TABLE_SIZE 65536, ENABLE_PUSH 0, INITIAL_WINDOW_SIZE 6291456, MAX_HEADER_LIST_SIZE 262144",
    source:
      "Akamai, Passive Fingerprinting of HTTP/2 Clients (Black Hat EU 2017), and curl-impersonate's Chrome profiles: https://github.com/lwthiker/curl-impersonate",
  },
  firefoxH2: {
    what: "The SETTINGS Firefox sends on a new HTTP/2 connection",
    values: "HEADER_TABLE_SIZE 65536, INITIAL_WINDOW_SIZE 131072, MAX_FRAME_SIZE 16384",
    source:
      "Read from node:http2's remoteSettings with Firefox 157 and Camoufox 156 (Firefox's network stack), October 2026; curl-impersonate's Firefox profiles: https://github.com/lwthiker/curl-impersonate",
  },
} as const;

export interface Ja4 {
  /** t: TCP, q: QUIC, d: DTLS. */
  protocol: string;
  /** "13", "12", "11", "10", "s3", "00"… */
  tls: string;
  /** d: a domain name in SNI, i: none (an IP). */
  sni: string;
  ciphers: number;
  extensions: number;
  /** First and last character of the first ALPN value: "h2", "h3", "h1", "00" for none. */
  alpn: string;
}

/** The readable first part of a JA4 (`t13d1516h2_…`), or null when it is not one. */
export function parseJa4(ja4: string): Ja4 | null {
  const m = /^([tqd])([0-9s]{2})([di])(\d{2})(\d{2})([0-9a-z]{2})_[0-9a-f]{12}_[0-9a-f]{12}$/i.exec(
    ja4.trim(),
  );
  if (!m) return null;
  return {
    protocol: m[1]?.toLowerCase() ?? "",
    tls: m[2]?.toLowerCase() ?? "",
    sni: m[3]?.toLowerCase() ?? "",
    ciphers: Number(m[4]),
    extensions: Number(m[5]),
    alpn: m[6]?.toLowerCase() ?? "",
  };
}

/**
 * Whether a TLS client hello fits a modern browser: TLS 1.3, a server name, and HTTP/2 or 3
 * offered by ALPN — what every current Chromium, Firefox and Safari send to a domain. A script
 * on Python's or an old library's TLS stack offers no ALPN, or TLS 1.2. Null when unknown.
 */
export function ja4FitsModernBrowser(ja4: string | null | undefined): boolean | null {
  if (!ja4) return null;
  const p = parseJa4(ja4);
  if (!p) return null;
  return p.tls === "13" && p.sni === "d" && (p.alpn === "h2" || p.alpn === "h3");
}

/** What a Node HTTP/2 session reports as the client's SETTINGS (`session.remoteSettings`). */
export interface Http2Settings {
  headerTableSize?: number;
  enablePush?: boolean;
  initialWindowSize?: number;
  maxFrameSize?: number;
  maxConcurrentStreams?: number;
  maxHeaderListSize?: number;
}

/** Chromium's SETTINGS values (see {@link REFERENCES}.chromiumH2). */
export const CHROMIUM_H2_SETTINGS = {
  headerTableSize: 65536,
  enablePush: false,
  initialWindowSize: 6291456,
  maxHeaderListSize: 262144,
} as const;

/** Firefox's SETTINGS values (see {@link REFERENCES}.firefoxH2). */
export const FIREFOX_H2_SETTINGS = {
  headerTableSize: 65536,
  initialWindowSize: 131072,
  maxFrameSize: 16384,
} as const;

/** The SETTINGS that differ from `expected`, as `name=value` strings; empty when they match. */
function http2SettingsOff(settings: Http2Settings, expected: Http2Settings): string[] {
  const off: string[] = [];
  for (const [name, want] of Object.entries(expected)) {
    const value = settings[name as keyof Http2Settings];
    if (value !== undefined && value !== want) off.push(`${name}=${String(value)}`);
  }
  return off;
}

/** The SETTINGS that differ from Chromium's, as `name=value` strings; empty when they match. */
export function http2SettingsOffChromium(settings: Http2Settings): string[] {
  return http2SettingsOff(settings, CHROMIUM_H2_SETTINGS);
}

/** The SETTINGS that differ from Firefox's, as `name=value` strings; empty when they match. */
export function http2SettingsOffFirefox(settings: Http2Settings): string[] {
  return http2SettingsOff(settings, FIREFOX_H2_SETTINGS);
}

const hash12 = async (text: string) =>
  text ? (await sha256Hex(text)).slice(0, 12) : "0".repeat(12);

/**
 * The JA4H of a request: method, version, cookie and referer presence, header count, language,
 * then hashes of the header names (in the order sent, when the platform keeps it: Node's
 * `rawHeaders`), the cookie names and the cookies. Fetch's Headers sort their names, so a JA4H
 * computed there says less about the client than one computed from `rawHeaders`.
 */
export async function ja4h(input: {
  method: string;
  httpVersion?: string | null;
  headers: Headers;
  headerOrder?: readonly string[] | null;
}): Promise<string> {
  const names = (input.headerOrder ?? [...input.headers.keys()])
    .map((n) => n.toLowerCase())
    .filter((n) => !n.startsWith(":") && n !== "cookie" && n !== "referer");
  const version = (input.httpVersion ?? "1.1").replace(/^HTTP\//i, "");
  const v =
    version === "2" || version === "2.0"
      ? "20"
      : version === "3" || version === "3.0"
        ? "30"
        : version === "1.0"
          ? "10"
          : "11";
  const cookie = input.headers.get("cookie") ?? "";
  const lang = (input.headers.get("accept-language") ?? "")
    .split(",")[0]
    ?.split(";")[0]
    ?.replace(/-/g, "")
    .toLowerCase()
    .slice(0, 4)
    .padEnd(4, "0");
  const a = `${input.method.slice(0, 2).toLowerCase()}${v}${cookie ? "c" : "n"}${
    input.headers.has("referer") ? "r" : "n"
  }${String(Math.min(99, names.length)).padStart(2, "0")}${lang || "0000"}`;
  const pairs = cookie
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)
    .sort();
  const cookieNames = pairs.map((p) => p.split("=")[0] ?? "").sort();
  return [
    a,
    await hash12(names.join(",")),
    await hash12(cookieNames.join(",")),
    await hash12(pairs.join(",")),
  ].join("_");
}
