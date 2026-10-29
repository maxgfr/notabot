import {
  type BehaviorTracker,
  judgeKeySlide,
  judgeSlide,
  type PointerSample,
  trackBehavior,
} from "../behavior/index";
import { type CheckResult, check, type Step, unsignedToken } from "../index";
import type { LlmSettings } from "../llm/index";
import { THRESHOLDS, verdictOf } from "../score/index";
import { type Lang, langOf, MESSAGES, type MessageKey } from "./i18n";
import { STYLES } from "./styles";

export type State = "idle" | "checking" | "challenge" | "human" | "bot" | "error";

export interface VerdictDetail {
  verdict: "human" | "bot";
  bot: number;
  token: string;
  signed: boolean;
  /** Whether the slider had to be passed. */
  challenged: boolean;
  result: CheckResult;
}

// Behavior is recorded from the moment the script loads, not from the click.
let tracker: BehaviorTracker | null = null;
export function sharedTracker(): BehaviorTracker {
  tracker ??= trackBehavior(document);
  return tracker;
}

const Base = (typeof HTMLElement !== "undefined" ? HTMLElement : class {}) as typeof HTMLElement;
const MAX_SLIDES = 3;
let sheet: CSSStyleSheet | null = null;

/**
 * `<notabot-check>`: the checkbox, the proof-of-work behind it and, when the signals are
 * ambiguous, a slider. Attributes: mode (auto | click), challenge-url, verify-url, endpoint,
 * model, name, form, lang, theme (auto | light | dark), rules-weight.
 */
export class NotabotCheck extends Base {
  static observedAttributes = ["lang", "theme"];
  #root: ShadowRoot | null = null;
  #state: State = "idle";
  #step: Step | null = null;
  #result: CheckResult | null = null;
  #token = "";
  #bot: number | null = null;
  #slides = 0;
  #running: AbortController | null = null;
  /** A model to ask, set from script (a proxy's settings, or a visitor's saved ones). */
  llm: LlmSettings | null = null;

  get state(): State {
    return this.#state;
  }
  get result(): CheckResult | null {
    return this.#result;
  }
  get token(): string {
    return this.#token;
  }

  #lang(): Lang {
    return langOf(this.getAttribute("lang") || document.documentElement.lang);
  }
  #t(key: MessageKey): string {
    return MESSAGES[this.#lang()][key];
  }

  connectedCallback(): void {
    sharedTracker();
    if (!this.#root) {
      this.#root = this.attachShadow({ mode: "open" });
      this.#render();
    }
    this.#hiddenInput();
    if ((this.getAttribute("mode") ?? "click") === "auto" && this.#state === "idle") {
      const start = () => void this.run();
      if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 1500 });
      else setTimeout(start, 200);
    }
  }

  disconnectedCallback(): void {
    this.#running?.abort();
  }

  attributeChangedCallback(): void {
    if (this.#root) this.#render();
  }

  /** Starts (or restarts) the check. Resolves with the final state. */
  async run(): Promise<State> {
    if (this.#state === "checking") return this.#state;
    this.#running?.abort();
    const running = new AbortController();
    this.#running = running;
    this.#slides = 0;
    this.#bot = null;
    this.#set("checking");
    try {
      const endpoint = this.getAttribute("endpoint");
      let llm = this.llm;
      if (!llm && endpoint) {
        const { proxySettings } = await import("../llm/index");
        llm = proxySettings(endpoint, this.getAttribute("model") || "default");
      }
      const challengeUrl = this.getAttribute("challenge-url");
      const verifyUrl = this.getAttribute("verify-url");
      const weight = Number(this.getAttribute("rules-weight"));
      const result = await check({
        behavior: sharedTracker(),
        challenge: challengeUrl || "local",
        llm,
        ...(verifyUrl ? { verifyUrl } : {}),
        ...(Number.isFinite(weight) && this.hasAttribute("rules-weight")
          ? { rulesWeight: weight }
          : {}),
        signal: running.signal,
        onStep: (s) => {
          this.#step = s;
          this.#render();
          this.dispatchEvent(
            new CustomEvent("notabot:step", { detail: { step: s }, bubbles: true, composed: true }),
          );
        },
      });
      if (running.signal.aborted) return this.#state;
      this.#result = result;
      this.#token = result.token;
      if (result.verdict === "human") this.#finish("human", false);
      else if (result.verdict === "unsure") this.#set("challenge");
      else this.#finish("bot", false);
    } catch (e) {
      if (running.signal.aborted) return this.#state;
      this.#set("error");
      this.dispatchEvent(
        new CustomEvent("notabot:error", {
          detail: { error: e instanceof Error ? e.message : String(e) },
          bubbles: true,
          composed: true,
        }),
      );
    }
    return this.#state;
  }

  /** Back to the empty checkbox, the token cleared. */
  reset(): void {
    this.#running?.abort();
    this.#result = null;
    this.#token = "";
    this.#slides = 0;
    this.#set("idle");
  }

  /** Shows the slider whatever the score said (the demo uses it). */
  challenge(): void {
    if (!this.#result) return;
    this.#slides = 0;
    this.#set("challenge");
  }

  #finish(verdict: "human" | "bot", challenged: boolean): void {
    const result = this.#result;
    if (!result) return;
    let bot = result.bot;
    // The slider settles doubt; it never overturns a decisive "bot" from the signals.
    if (challenged && verdict === "human" && bot >= THRESHOLDS.bot) verdict = "bot";
    else if (challenged && verdict === "human") bot = Math.min(bot, 0.3);
    this.#bot = bot;
    if (!result.signed) this.#token = unsignedToken(verdictOf(bot), bot, result.solution);
    this.#set(verdict);
    const detail: VerdictDetail = {
      verdict,
      bot,
      token: this.#token,
      signed: result.signed,
      challenged,
      result,
    };
    this.dispatchEvent(
      new CustomEvent("notabot:verdict", { detail, bubbles: true, composed: true }),
    );
  }

  #set(state: State): void {
    this.#state = state;
    if (state !== "checking") this.#step = null;
    this.#render();
    this.#hiddenInput();
    this.dispatchEvent(
      new CustomEvent("notabot:state", { detail: { state }, bubbles: true, composed: true }),
    );
  }

  #form(): HTMLFormElement | null {
    const selector = this.getAttribute("form");
    if (selector) return document.querySelector<HTMLFormElement>(selector);
    return this.closest("form");
  }

  #hiddenInput(): void {
    const form = this.#form();
    if (!form) return;
    const name = this.getAttribute("name") || "notabot-token";
    let input = form.querySelector<HTMLInputElement>(
      `input[type="hidden"][name="${CSS.escape(name)}"]`,
    );
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      form.append(input);
    }
    input.value = this.#state === "human" ? this.#token : "";
  }

  #render(): void {
    const root = this.#root;
    if (!root) return;
    const theme = this.getAttribute("theme") ?? "auto";
    const state = this.#state;
    const t = (k: MessageKey) => this.#t(k);
    const status =
      state === "checking"
        ? t((this.#step && this.#step !== "done" ? this.#step : "signals") as MessageKey)
        : state === "idle"
          ? ""
          : state === "challenge"
            ? t("unsure")
            : t(state);
    root.replaceChildren();
    const box = el("div", { class: "box", "data-state": state, "data-theme": theme });
    const button = el("button", {
      type: "button",
      class: "seal",
      "aria-label": t("start"),
      "aria-pressed": String(state === "human"),
    });
    button.disabled = state === "checking" || state === "human" || state === "challenge";
    button.append(el("span", { class: "mark", "aria-hidden": "true" }));
    button.addEventListener("click", () => void this.run());
    const text = el("div", { class: "text" });
    text.append(el("span", { class: "label" }, t("label")));
    const live = el("span", { class: "status", role: "status", "aria-live": "polite" }, status);
    text.append(live);
    const row = el("div", { class: "row" });
    row.append(button, text);
    if (state === "bot" || state === "error") {
      const retry = el("button", { type: "button", class: "retry" }, t("retry"));
      retry.addEventListener("click", () => void this.run());
      row.append(retry);
    }
    box.append(row);
    if (state === "challenge") box.append(this.#slider());
    const result = this.#result;
    if (result && state !== "checking") box.append(this.#details(result));
    const foot = el(
      "a",
      {
        class: "by",
        href: "https://maxgfr.github.io/notabot/",
        target: "_blank",
        rel: "noopener",
      },
      t("by"),
    );
    box.append(foot);
    // A constructed stylesheet passes a strict CSP (style-src 'self'); <style> is the fallback.
    if (
      "adoptedStyleSheets" in root &&
      typeof CSSStyleSheet !== "undefined" &&
      "replaceSync" in CSSStyleSheet.prototype
    ) {
      sheet ??= new CSSStyleSheet();
      if (!sheet.cssRules.length) sheet.replaceSync(STYLES);
      root.adoptedStyleSheets = [sheet];
      root.append(box);
    } else {
      const style = document.createElement("style");
      style.textContent = STYLES;
      root.append(style, box);
    }
  }

  #details(result: CheckResult): HTMLElement {
    const details = el("details", { class: "details" });
    details.append(el("summary", {}, this.#t("details")));
    const dl = el("dl", {});
    const add = (k: string, v: string) => dl.append(el("dt", {}, k), el("dd", {}, v));
    add(this.#t("score"), `${Math.round((this.#bot ?? result.bot) * 100)} %`);
    add(this.#t("flags"), result.rules.flags.map((f) => f.id).join(", ") || "—");
    if (result.solution) add(this.#t("pow_took"), `${result.solution.took} ms`);
    details.append(dl);
    if (!result.signed) details.append(el("p", { class: "note" }, this.#t("unsigned")));
    return details;
  }

  #slider(): HTMLElement {
    const wrap = el("div", { class: "slide" });
    const hint = el(
      "p",
      { class: "hint" },
      this.#slides ? this.#t("slideRetry") : this.#t("slideHint"),
    );
    const track = el("div", { class: "track" });
    // Target zone somewhere in the right half, 14% wide.
    const zoneStart = 45 + Math.random() * 38;
    const zone = el("div", { class: "zone" });
    zone.style.left = `${zoneStart}%`;
    zone.style.width = "14%";
    const handle = el("div", {
      class: "handle",
      role: "slider",
      tabindex: "0",
      "aria-label": this.#t("slideLabel"),
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": "0",
    });
    track.append(zone, handle);
    wrap.append(hint, track);

    let pos = 0;
    const place = (p: number) => {
      pos = Math.min(100, Math.max(0, p));
      handle.style.left = `${pos}%`;
      handle.setAttribute("aria-valuenow", String(Math.round(pos)));
    };
    const landed = () => pos >= zoneStart && pos <= zoneStart + 14;
    const settle = (passed: boolean) => {
      if (passed) return this.#finish("human", true);
      this.#slides++;
      if (this.#slides >= MAX_SLIDES) return this.#finish("bot", true);
      this.#render();
      this.#root?.querySelector<HTMLElement>(".handle")?.focus();
    };

    let samples: PointerSample[] = [];
    let dragging = false;
    const toPercent = (clientX: number) => {
      const r = track.getBoundingClientRect();
      return ((clientX - r.left) / r.width) * 100;
    };
    handle.addEventListener("pointerdown", (e) => {
      dragging = true;
      samples = [];
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      samples.push({
        x: e.clientX,
        y: e.clientY,
        t: e.timeStamp,
        trusted: e.isTrusted,
        coalesced: events.length || 1,
        pressure: e.pressure,
        type: "pointermove",
      });
      place(toPercent(e.clientX));
    });
    const release = () => {
      if (!dragging) return;
      dragging = false;
      settle(judgeSlide(samples, landed()).passed);
    };
    handle.addEventListener("pointerup", release);
    handle.addEventListener("pointercancel", release);

    let keyTimes: number[] = [];
    let keysTrusted = true;
    handle.addEventListener("keydown", (e) => {
      const step =
        e.key === "ArrowRight" || e.key === "ArrowUp"
          ? 2
          : e.key === "ArrowLeft" || e.key === "ArrowDown"
            ? -2
            : 0;
      if (step) {
        e.preventDefault();
        keyTimes.push(e.timeStamp);
        keysTrusted &&= e.isTrusted;
        place(pos + step);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const passed = judgeKeySlide(keyTimes, keysTrusted && e.isTrusted, landed());
        keyTimes = [];
        keysTrusted = true;
        settle(passed);
      }
    });
    return wrap;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}
