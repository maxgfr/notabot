// "What the server would add": every rule only the middleware runs, tried on the headers this page
// can know about its own browser (User-Agent, languages, client hints), and marked server-only when
// it needs what no page sees (TLS, HTTP/2, the IP's network, many requests).
import {
  CROSS_CHECK_RULES,
  crossCheckFlags,
  REQUEST_RULES,
  type RequestInfo,
  requestFlags,
} from "../../src/middleware/request";
import type { NotabotSignals } from "../../src/signals/types";
import { el, lang, t } from "./common";

/** Rules whose evidence never reaches a page. */
const SERVER_ONLY = new Set([
  "http1-chromium",
  "ja4-ua-mismatch",
  "http2-settings-not-chromium",
  "hosting-network",
  "server-timezone",
  "rate",
  "probe-mismatch",
  "probes-missing",
  "fingerprint-velocity",
  "fingerprint-churn",
]);

const FR: Record<string, string> = {
  "missing-user-agent": "Pas d'en-tête User-Agent : tout navigateur en envoie un.",
  "http-library": "Le User-Agent nomme une bibliothèque HTTP, un scraper ou un outil headless.",
  "missing-accept-language":
    "Pas d'Accept-Language : les navigateurs envoient toujours vos langues.",
  "missing-accept": "Pas d'en-tête Accept, que les navigateurs envoient toujours.",
  "missing-accept-encoding":
    "Pas d'Accept-Encoding : les navigateurs acceptent toujours la compression.",
  "chromium-without-client-hints":
    "Un Chromium sans les client hints sec-ch-ua qu'il envoie toujours.",
  "headless-client-hint": "Les marques sec-ch-ua nomment HeadlessChrome.",
  "client-hints-platform-mismatch": "sec-ch-ua-platform nomme un autre système que le User-Agent.",
  "client-hints-version-mismatch":
    "sec-ch-ua nomme une autre version de Chromium que le User-Agent.",
  "client-hints-mobile-mismatch": "sec-ch-ua-mobile contredit le User-Agent sur le mobile.",
  "missing-fetch-metadata": "Un navigateur moderne sans les en-têtes Sec-Fetch-*.",
  "http1-chromium": "Un Chromium en HTTP/1.x là où le vrai négocie HTTP/2 ou 3.",
  "ja4-ua-mismatch": "La poignée de main TLS (JA4) n'est pas celle d'un navigateur moderne.",
  "http2-settings-not-chromium": "Les SETTINGS HTTP/2 ne sont pas ceux de Chromium.",
  "hosting-network": "L'IP appartient à un hébergeur, pas à un fournisseur d'accès.",
  "server-user-agent": "L'en-tête User-Agent diffère de navigator.userAgent.",
  "server-language": "Accept-Language diffère de navigator.languages.",
  "server-timezone": "Le fuseau de l'IP diffère de celui du navigateur (les VPN aussi).",
  rate: "Plus de requêtes par minute depuis cette IP que permis.",
  "probe-mismatch": "Les sondes du puzzle ont reçu des réponses qu'aucun vrai navigateur ne donne.",
  "probes-missing": "Le puzzle portait des sondes et la page n'a rien répondu.",
  "fingerprint-velocity": "La même empreinte depuis beaucoup d'IP en peu de temps.",
  "fingerprint-churn": "Beaucoup d'empreintes depuis une même IP en peu de temps.",
};

/** The headers this browser would send with a same-origin fetch, as far as the page can tell. */
function knownHeaders(signals: NotabotSignals): Headers {
  const languages = signals.env.languages.length ? signals.env.languages : [signals.env.language];
  const headers = new Headers({
    "user-agent": navigator.userAgent,
    "accept-language": languages
      .map((l, i) => (i ? `${l};q=${(1 - i / 10).toFixed(1)}` : l))
      .join(","),
    // Not readable from a page, sent by every modern browser: assumed.
    accept: "*/*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
  });
  const data = (
    navigator as Navigator & {
      userAgentData?: {
        brands: { brand: string; version: string }[];
        mobile: boolean;
        platform: string;
      };
    }
  ).userAgentData;
  // Chromium sends client hints on secure origins, localhost included.
  if (data && (location.protocol === "https:" || /^(localhost|127\.)/.test(location.hostname))) {
    headers.set("sec-ch-ua", data.brands.map((b) => `"${b.brand}";v="${b.version}"`).join(", "));
    headers.set("sec-ch-ua-mobile", data.mobile ? "?1" : "?0");
    headers.set("sec-ch-ua-platform", `"${data.platform}"`);
  }
  return headers;
}

export function mountServerPanel(signals: NotabotSignals): void {
  const list = document.getElementById("server-rules");
  if (!list) return;
  const info: RequestInfo = {
    method: "POST",
    url: location.href,
    headers: knownHeaders(signals),
    ip: null,
    httpVersion: null,
    network: null,
  };
  const tripped = new Map(
    [...requestFlags(info), ...crossCheckFlags(info, signals)].map((f) => [f.id, f.detail]),
  );
  const stateOf = (id: string) =>
    SERVER_ONLY.has(id) ? "server" : tripped.has(id) ? "raised" : "clear";
  // As in the report: what would trip first, then what passes, then what needs the server.
  const order = { raised: 0, clear: 1, server: 2 };
  const rules = [...REQUEST_RULES, ...CROSS_CHECK_RULES].sort(
    (a, b) => order[stateOf(a.id)] - order[stateOf(b.id)],
  );
  list.replaceChildren(
    ...rules.map((r) => {
      const state = stateOf(r.id);
      const li = el("li", { class: `server-rule ${state}` });
      const head = el("p", { class: "rule-head" });
      head.append(
        el("code", {}, r.id),
        el("span", { class: "rule-state" }, t(`server.${state}`, { w: r.weight })),
      );
      li.append(
        head,
        el("p", { class: "rule-explain" }, lang === "fr" ? (FR[r.id] ?? r.explain) : r.explain),
      );
      const detail = tripped.get(r.id);
      if (state === "raised" && detail) li.append(el("p", { class: "rule-detail" }, detail));
      return li;
    }),
  );
}
