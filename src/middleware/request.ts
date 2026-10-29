// What a server can read about a request that a page cannot fake as easily: the headers the
// browser really sent, the protocol, the network. Framework-free: every adapter builds a
// RequestInfo and the rules read only that.
import type { Category, Flag } from "../score/index";
import { osOf } from "../signals/util";

/** What Cloudflare tells a Worker about the connection (`request.cf`), or a proxy's equivalent. */
export interface NetworkInfo {
  asn?: number;
  asOrganization?: string;
  country?: string;
  timezone?: string;
  httpProtocol?: string;
  tlsVersion?: string;
}

export interface RequestInfo {
  method: string;
  url: string;
  headers: Headers;
  /** Client IP, as the platform or a trusted proxy reports it. */
  ip?: string | null;
  /** "1.0", "1.1", "2" or "3" when known. */
  httpVersion?: string | null;
  network?: NetworkInfo | null;
  /** A JA4 TLS fingerprint, when the platform or a proxy computes one. */
  ja4?: string | null;
}

export interface RequestRule {
  id: string;
  weight: number;
  explain: string;
  category?: Category;
  /** A detail string when the rule trips, or null. */
  test(info: RequestInfo): string | null;
}

/** HTTP libraries, scrapers and headless tools that name themselves. */
export const HTTP_LIBRARIES =
  /\b(curl|wget|python-requests|python-urllib|aiohttp|httpx|go-http-client|okhttp|java\/|apache-httpclient|axios|node-fetch|undici|got\b|postmanruntime|insomnia|scrapy|libwww-perl|ruby|php\/|guzzlehttp|headlesschrome|phantomjs|puppeteer|playwright|selenium|httpie|bot\b|spider|crawler)/i;

const HOSTING =
  /amazon|aws|google cloud|google llc|microsoft|azure|ovh|hetzner|digitalocean|linode|akamai|oracle|alibaba|tencent|scaleway|contabo|vultr|m247|datacamp|leaseweb|choopa/i;

function chromiumVersion(ua: string): number | null {
  const m = /(?:Chrome|Chromium|Edg|OPR)\/(\d+)/.exec(ua);
  return m && !/Firefox\//.test(ua) ? Number(m[1]) : null;
}

function isModernBrowser(ua: string): boolean {
  const chrome = chromiumVersion(ua);
  if (chrome !== null) return chrome >= 80;
  const firefox = /Firefox\/(\d+)/.exec(ua);
  if (firefox) return Number(firefox[1]) >= 90;
  const safari = /Version\/(\d+)(?:\.(\d+))?.*Safari\//.exec(ua);
  if (safari)
    return Number(safari[1]) > 16 || (Number(safari[1]) === 16 && Number(safari[2] ?? 0) >= 4);
  return false;
}

const unquote = (v: string) => v.replace(/^"|"$/g, "");

function hintOs(platform: string): string {
  const p = unquote(platform).toLowerCase();
  if (p === "macos") return "mac";
  if (p === "windows") return "windows";
  if (p === "linux" || p === "chrome os" || p === "chromium os") return "linux";
  if (p === "android") return "android";
  if (p === "ios") return "ios";
  return "unknown";
}

const header = (info: RequestInfo, name: string) => info.headers.get(name) ?? "";

export const REQUEST_RULES: RequestRule[] = [
  {
    id: "missing-user-agent",
    weight: 0.9,
    explain: "No User-Agent header: every browser sends one.",
    test: (i) => (header(i, "user-agent") ? null : "no user-agent"),
  },
  {
    id: "http-library",
    weight: 0.95,
    explain: "The User-Agent names an HTTP library, a scraper or a headless tool.",
    test: (i) => {
      const m = HTTP_LIBRARIES.exec(header(i, "user-agent"));
      return m ? m[0] : null;
    },
  },
  {
    id: "missing-accept-language",
    weight: 0.5,
    explain: "No Accept-Language header: browsers always send the user's languages.",
    test: (i) =>
      header(i, "user-agent") && !header(i, "accept-language") ? "no accept-language" : null,
  },
  {
    id: "missing-accept",
    weight: 0.3,
    explain: "No Accept header, which browsers always send.",
    test: (i) => (header(i, "user-agent") && !header(i, "accept") ? "no accept" : null),
  },
  {
    id: "missing-accept-encoding",
    weight: 0.35,
    explain: "No Accept-Encoding header: browsers always accept compressed responses.",
    test: (i) =>
      isModernBrowser(header(i, "user-agent")) && !header(i, "accept-encoding")
        ? "no accept-encoding"
        : null,
  },
  {
    id: "chromium-without-client-hints",
    weight: 0.5,
    explain:
      "A Chromium user agent without the sec-ch-ua client hints Chromium sends on every secure request.",
    test: (i) => {
      const v = chromiumVersion(header(i, "user-agent"));
      const secure = i.url.startsWith("https:") || /^http:\/\/(localhost|127\.)/.test(i.url);
      return v !== null && v >= 90 && secure && !i.headers.has("sec-ch-ua")
        ? `Chrome ${v}, no sec-ch-ua`
        : null;
    },
  },
  {
    id: "headless-client-hint",
    weight: 0.9,
    explain: "The sec-ch-ua brands name HeadlessChrome.",
    test: (i) =>
      /Headless/i.test(header(i, "sec-ch-ua")) ? header(i, "sec-ch-ua").slice(0, 80) : null,
  },
  {
    id: "client-hints-platform-mismatch",
    weight: 0.7,
    explain: "sec-ch-ua-platform names another system than the User-Agent.",
    test: (i) => {
      const hint = header(i, "sec-ch-ua-platform");
      if (!hint) return null;
      const a = osOf(header(i, "user-agent"));
      const b = hintOs(hint);
      const norm = (os: string) => (os === "ios" ? "mac" : os === "android" ? "linux" : os);
      return a !== "unknown" && b !== "unknown" && norm(a) !== norm(b)
        ? `${a} vs ${unquote(hint)}`
        : null;
    },
  },
  {
    id: "client-hints-mobile-mismatch",
    weight: 0.5,
    explain: "sec-ch-ua-mobile disagrees with the User-Agent about being a phone.",
    test: (i) => {
      const hint = header(i, "sec-ch-ua-mobile");
      if (!hint) return null;
      const uaMobile = /Mobile|Android|iPhone/.test(header(i, "user-agent"));
      return (hint === "?1") !== uaMobile ? `sec-ch-ua-mobile ${hint}` : null;
    },
  },
  {
    id: "missing-fetch-metadata",
    weight: 0.45,
    explain:
      "A modern browser user agent without the Sec-Fetch-* headers every modern browser sends.",
    test: (i) =>
      isModernBrowser(header(i, "user-agent")) &&
      !i.headers.has("sec-fetch-site") &&
      !i.headers.has("sec-fetch-mode")
        ? "no sec-fetch-*"
        : null,
  },
  {
    id: "http1-chromium",
    weight: 0.35,
    explain: "A Chromium speaking HTTP/1.x where real Chromium negotiates HTTP/2 or 3.",
    test: (i) => {
      const version = i.httpVersion ?? i.network?.httpProtocol?.replace(/^HTTP\//, "") ?? null;
      return version?.startsWith("1") && chromiumVersion(header(i, "user-agent")) !== null
        ? `HTTP/${version}`
        : null;
    },
  },
  {
    id: "hosting-network",
    weight: 0.5,
    explain: "The IP belongs to a hosting provider, not an internet access provider.",
    test: (i) =>
      i.network?.asOrganization && HOSTING.test(i.network.asOrganization)
        ? i.network.asOrganization
        : null,
  },
];

/** Runs the request rules; a rule that throws is skipped. */
export function requestFlags(
  info: RequestInfo,
  rules: readonly RequestRule[] = REQUEST_RULES,
): Flag[] {
  const flags: Flag[] = [];
  for (const rule of rules) {
    let detail: string | null = null;
    try {
      detail = rule.test(info);
    } catch {}
    if (detail !== null)
      flags.push({
        id: rule.id,
        category: rule.category ?? "consistency",
        weight: rule.weight,
        explain: rule.explain,
        detail,
      });
  }
  return flags;
}

/**
 * What the request says against what the page said: the headers the browser really sent versus
 * navigator, the IP's time zone versus the browser's.
 */
export function crossCheckFlags(
  info: RequestInfo,
  signals: { env: { userAgent: string; languages: string[]; timezone: string } },
): Flag[] {
  const flags: Flag[] = [];
  const add = (id: string, weight: number, explain: string, detail: string) =>
    flags.push({ id, category: "consistency", weight, explain, detail });
  const ua = header(info, "user-agent");
  if (ua && ua !== signals.env.userAgent)
    add(
      "server-user-agent",
      0.8,
      "The User-Agent header differs from navigator.userAgent.",
      ua.slice(0, 80),
    );
  const lang = header(info, "accept-language").split(",")[0]?.split(";")[0]?.trim();
  const first = signals.env.languages[0];
  if (lang && first && lang.toLowerCase() !== first.toLowerCase())
    add(
      "server-language",
      0.3,
      "Accept-Language differs from navigator.languages.",
      `${lang} vs ${first}`,
    );
  const tz = info.network?.timezone;
  if (tz && signals.env.timezone && tz !== signals.env.timezone)
    add(
      "server-timezone",
      0.35,
      "The IP's time zone differs from the browser's (VPNs do this too).",
      `${tz} vs ${signals.env.timezone}`,
    );
  return flags;
}

/** Noisy-OR of flag weights, rounded: the same combination the browser rules use. */
export function combine(...weights: number[]): number {
  return Math.round((1 - weights.reduce((p, w) => p * (1 - w), 1)) * 1000) / 1000;
}
