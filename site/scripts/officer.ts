// The AI officer: model settings through llm-connect (the visitor's key, a proxy, or Ollama), and
// the answer blended with the rules. Loaded when the visitor reaches the section, with the AI
// stack and the provider catalog behind it.
import {
  botProbabilityOf,
  classify,
  describeError,
  type Features,
  type LlmSettings,
  type LlmSettingsState,
  proxySettings,
  testConnection,
  visitorStore,
} from "../../src/llm/index";
import { blend, rulesDecided } from "../../src/score/index";
import { root, t } from "./common";

interface Recommended {
  provider: string;
  model: string;
  name: string;
}

type Mode = "key" | "proxy" | "local";

/** How long the visitor waits for an answer before the page gives up. */
const TIMEOUT_MS = 30_000;

export interface OfficerContext {
  /** Features of the latest check, or null before any. */
  features(): Features | null;
  rulesBot(): number | null;
  onVerdict(bot: number, verdict: string): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function mountOfficer(ctx: OfficerContext): void {
  const form = $<HTMLFormElement>("officer-form");
  const status = $("officer-status");
  const provider = $<HTMLSelectElement>("provider");
  const model = $<HTMLInputElement>("model");
  const modelList = $<HTMLDataListElement>("model-list");
  const apiKey = $<HTMLInputElement>("api-key");
  const remember = $<HTMLInputElement>("remember-key");
  const hint = $("recommended-hint");
  const cancel = $<HTMLButtonElement>("cancel-model");
  const store = visitorStore({
    catalogUrl: new URL(`${root}cdn/models.json`, location.href).href,
    storageKey: "notabot-site",
  });
  let running: AbortController | null = null;
  cancel.addEventListener("click", () =>
    running?.abort(new DOMException("cancelled", "AbortError")),
  );
  let recommended: Recommended[] = [];
  let mode: Mode = "key";
  let providersShown = -1;

  const say = (text: string, kind: "" | "ok" | "bad" = "") => {
    status.textContent = text;
    status.dataset.kind = kind;
  };

  fetch(`${root}cdn/recommended.json`)
    .then((r) => (r.ok ? r.json() : []))
    .then((list: Recommended[]) => {
      recommended = list;
      render(store.getState());
    })
    .catch(() => {});

  function render(state: LlmSettingsState) {
    const all = [...state.providers.recommended, ...state.providers.others];
    const current = state.draft.providerId;
    if (current && !all.some((p) => p.id === current))
      all.unshift({ id: current, name: current } as (typeof all)[number]);
    if (all.length !== providersShown) {
      providersShown = all.length;
      const options = all.map((p) => {
        const o = document.createElement("option");
        o.value = p.id;
        o.textContent = p.name;
        return o;
      });
      if (!options.length) {
        // No catalog yet (or none reachable): say so rather than show an empty list.
        const o = document.createElement("option");
        o.disabled = true;
        o.selected = true;
        o.textContent = t("officer.loadingProviders");
        options.push(o);
      }
      provider.replaceChildren(...options);
    }
    if (state.draft.providerId) provider.value = state.draft.providerId;
    if (document.activeElement !== model) model.value = state.draft.model;
    if (document.activeElement !== apiKey) apiKey.value = state.apiKey;
    remember.checked = state.draft.rememberKey;
    modelList.replaceChildren(
      ...state.models.slice(0, 300).map((m) => {
        const o = document.createElement("option");
        o.value = m.id;
        o.label = m.name;
        return o;
      }),
    );
    const picks = recommended.filter((r) => r.provider === state.draft.providerId);
    model.placeholder = picks[0]?.model ?? "";
    hint.textContent = picks.length
      ? t("officer.recommended", { list: picks.map((p) => p.model).join(", ") })
      : recommended.length
        ? t("officer.recommended", {
            list: recommended.map((p) => `${p.provider}/${p.model}`).join(", "),
          })
        : "";
  }

  store.subscribe(render);
  store.open();
  void store.load();

  provider.addEventListener("change", () => {
    store.selectProvider(provider.value);
    const pick = recommended.find((r) => r.provider === provider.value);
    if (pick) store.selectModel(pick.model);
  });
  model.addEventListener("change", () => store.selectModel(model.value.trim()));
  apiKey.addEventListener("input", () => store.setApiKey(apiKey.value.trim()));

  const showMode = (value: string) => {
    mode = value as Mode;
    for (const panel of form.querySelectorAll<HTMLElement>(".mode-panel"))
      panel.hidden = panel.dataset.mode !== mode;
  };
  for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
    radio.addEventListener("change", () => {
      showMode(radio.value);
      say("");
    });
  }
  // This module loads late: a choice made before it arrived still counts.
  showMode(form.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value ?? "key");

  async function settings(): Promise<LlmSettings | null> {
    if (mode === "proxy")
      return proxySettings(
        $<HTMLInputElement>("endpoint").value.trim(),
        $<HTMLInputElement>("proxy-model").value.trim() || "default",
      );
    if (mode === "local")
      return proxySettings(
        $<HTMLInputElement>("local-endpoint").value.trim(),
        $<HTMLInputElement>("local-model").value.trim() || "gemma3:4b",
      );
    store.selectModel(model.value.trim());
    store.setApiKey(apiKey.value.trim());
    if (!store.getState().canSave) return null;
    // Kept for the page only, unless the visitor asked to remember it.
    store.setRememberKey(remember.checked);
    const saved = await store.save();
    return saved.ok ? store.settings() : null;
  }

  $<HTMLButtonElement>("test-model").addEventListener("click", async () => {
    const s = await settings();
    if (!s) return say(t("officer.needModel"), "bad");
    say(t("officer.testing"));
    const result = await testConnection(s);
    say(result.ok ? t("officer.ok") : (result.message ?? result.reason), result.ok ? "ok" : "bad");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const features = ctx.features();
    if (!features) return say(t("officer.needCheck"), "bad");
    const s = await settings();
    if (!s) return say(t("officer.needModel"), "bad");
    const name = s.customModel ?? s.model;
    say(t("officer.asking", { model: name }));
    const ask = $<HTMLButtonElement>("ask-model");
    ask.disabled = true;
    cancel.hidden = false;
    running = new AbortController();
    try {
      const result = await classify(s, features, {
        signal: running.signal,
        timeoutMs: TIMEOUT_MS,
      });
      $("answer").textContent = result.text || "—";
      if (!result.verdict) return say(t("officer.unreadable"), "bad");
      const rulesBot = ctx.rulesBot() ?? 0;
      const bot = blend(rulesBot, botProbabilityOf(result.verdict));
      ctx.onVerdict(bot, result.verdict.verdict);
      const line = t("officer.verdict", {
        model: name,
        verdict: t(`stamp.${result.verdict.verdict}`),
        c: Math.round(result.verdict.confidence * 100),
        ms: result.ms,
        p: Math.round(bot * 100),
      });
      say(
        rulesDecided(rulesBot)
          ? `${t("officer.skipped", { p: Math.round(rulesBot * 100) })} ${line}`
          : line,
        result.verdict.verdict === "bot" ? "bad" : "ok",
      );
    } catch (error) {
      const reason = running.signal.reason as DOMException | undefined;
      if (reason?.name === "AbortError") say(t("officer.cancelled"));
      else if (error instanceof DOMException && error.name === "TimeoutError")
        say(t("officer.timeout", { s: TIMEOUT_MS / 1000 }), "bad");
      else say(describeError(error, s.apiKey).message, "bad");
    } finally {
      ask.disabled = false;
      cancel.hidden = true;
      running = null;
    }
  });
}
