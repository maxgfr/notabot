// The AI officer: model settings through llm-connect (the visitor's key, a proxy, or Ollama),
// the exact prompt shown before sending, and the answer blended with the rules.
import {
  botProbabilityOf,
  buildPrompt,
  classify,
  describeError,
  type Features,
  type LlmSettings,
  type LlmSettingsState,
  proxySettings,
  SYSTEM_PROMPT,
  testConnection,
  visitorStore,
} from "../../src/llm/index";
import { blend } from "../../src/score/index";
import { root, t } from "./common";

interface Recommended {
  provider: string;
  model: string;
  name: string;
}

type Mode = "key" | "proxy" | "local";

export interface OfficerContext {
  /** Features of the latest check, or null before any. */
  features(): Features | null;
  rulesBot(): number | null;
  onVerdict(bot: number, verdict: string): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function showPrompt(features: Features | null): void {
  $("prompt").textContent = features
    ? `system:\n${SYSTEM_PROMPT}\n\nuser:\n${buildPrompt(features)}`
    : t("officer.promptPending");
}

export function mountOfficer(ctx: OfficerContext): void {
  const form = $<HTMLFormElement>("officer-form");
  const status = $("officer-status");
  const provider = $<HTMLSelectElement>("provider");
  const model = $<HTMLInputElement>("model");
  const modelList = $<HTMLDataListElement>("model-list");
  const apiKey = $<HTMLInputElement>("api-key");
  const hint = $("recommended-hint");
  const store = visitorStore({
    catalogUrl: new URL(`${root}cdn/models.json`, location.href).href,
    storageKey: "notabot-site",
  });
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

  for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
    radio.addEventListener("change", () => {
      mode = radio.value as Mode;
      for (const panel of form.querySelectorAll<HTMLElement>(".mode-panel"))
        panel.hidden = panel.dataset.mode !== mode;
      say("");
    });
  }

  async function settings(): Promise<LlmSettings | null> {
    if (mode === "proxy")
      return proxySettings(
        $<HTMLInputElement>("endpoint").value.trim(),
        $<HTMLInputElement>("proxy-model").value.trim() || "default",
      );
    if (mode === "local")
      return proxySettings(
        $<HTMLInputElement>("local-endpoint").value.trim(),
        $<HTMLInputElement>("local-model").value.trim() || "llama3.2",
      );
    store.selectModel(model.value.trim());
    store.setApiKey(apiKey.value.trim());
    if (!store.getState().canSave) return null;
    store.setRememberKey(true);
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
    try {
      const result = await classify(s, features);
      $("answer").textContent = result.text || "—";
      if (!result.verdict) return say(t("officer.unreadable"), "bad");
      const bot = blend(ctx.rulesBot() ?? 0, botProbabilityOf(result.verdict));
      ctx.onVerdict(bot, result.verdict.verdict);
      say(
        t("officer.verdict", {
          model: name,
          verdict: t(`stamp.${result.verdict.verdict}`),
          c: Math.round(result.verdict.confidence * 100),
          ms: result.ms,
          p: Math.round(bot * 100),
        }),
        result.verdict.verdict === "bot" ? "bad" : "ok",
      );
    } catch (error) {
      say(describeError(error, s.apiKey).message, "bad");
    } finally {
      ask.disabled = false;
    }
  });
}
