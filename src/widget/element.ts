import {
  type BehaviorTracker,
  judgeKeySlide,
  judgeSlide,
  judgeTargets,
  type PointerSample,
  randomTargets,
  type TargetClick,
  trackBehavior,
} from "../behavior/index";
import {
  type CheckResult,
  check,
  NotabotError,
  type NotabotErrorCode,
  type Step,
  slideUrlOf,
  submitSlide,
  unsignedToken,
  type VisibleChallenge,
} from "../index";
import type { LlmSettings } from "../llm/index";
import { THRESHOLDS, verdictOf } from "../score/index";
import type { NotabotSignals } from "../signals/types";
import { type Lang, langOf, MESSAGES, type MessageKey, type Messages } from "./i18n";
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
/** A gesture as /slide reads it: a drag, arrow keys, or target activations. */
type Gesture = Omit<Parameters<typeof submitSlide>[1], "token">;
const ERROR_MESSAGES: Record<NotabotErrorCode, MessageKey> = {
  expired: "errorExpired",
  replayed: "errorRefused",
  refused: "errorRefused",
  malformed: "error",
  "rate-limited": "errorRate",
  network: "errorNetwork",
};
let sheet: CSSStyleSheet | null = null;

/**
 * `<notabot-check>`: the checkbox, the proof-of-work behind it and, when the signals are
 * ambiguous, a slider or targets to press in order. Attributes: mode (auto | click),
 * challenge-url, verify-url, slide-url, endpoint, model, name, form, lang, theme (auto | light |
 * dark), rules-weight, challenges (slide, targets: which the page may draw).
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
  /** The challenge drawn in the page when no server signed one. */
  #local: VisibleChallenge | null = null;
  #running: AbortController | null = null;
  #error: NotabotErrorCode | null = null;
  /** Whether the visible challenge was shown in this check. */
  #challenged = false;
  #refreshTimer: ReturnType<typeof setTimeout> | undefined;
  /** A model to ask, set from script (a proxy's settings, or a visitor's saved ones). */
  llm: LlmSettings | null = null;
  /** Signals the page already collected, so the check does not read them again. */
  signals: NotabotSignals | null = null;

  get state(): State {
    return this.#state;
  }
  get result(): CheckResult | null {
    return this.#result;
  }
  get token(): string {
    return this.#token;
  }

  /** Strings that replace the built-in ones, by key (also `data-msg-<key>` attributes). */
  messages: Partial<Messages> = {};

  #lang(): Lang {
    return langOf(this.getAttribute("lang") || document.documentElement.lang);
  }
  #t(key: MessageKey): string {
    const attribute = this.dataset[`msg${key[0]?.toUpperCase()}${key.slice(1)}`];
    return this.messages[key] ?? attribute ?? MESSAGES[this.#lang()]?.[key] ?? MESSAGES.en[key];
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
    clearTimeout(this.#refreshTimer);
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
    this.#local = null;
    this.#challenged = false;
    this.#bot = null;
    this.#error = null;
    clearTimeout(this.#refreshTimer);
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
        ...(this.signals ? { signals: this.signals } : {}),
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
      this.#fail(e);
    }
    return this.#state;
  }

  #fail(e: unknown): void {
    this.#error = e instanceof NotabotError ? e.code : null;
    this.#set("error");
    this.dispatchEvent(
      new CustomEvent("notabot:error", {
        detail: { error: e instanceof Error ? e.message : String(e), code: this.#error },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Checks again when the token is about to expire, or was just spent: a signed token is good
   * for one use and a few minutes.
   */
  refresh(): void {
    if (this.#state !== "human" && this.#state !== "bot") return;
    void this.run();
  }

  #scheduleRefresh(): void {
    clearTimeout(this.#refreshTimer);
    const exp = this.#result?.expiresAt;
    if (!exp || this.#state !== "human") return;
    const wait = exp * 1000 - 30_000 - Date.now();
    this.#refreshTimer = setTimeout(() => this.refresh(), Math.max(1000, wait));
  }

  /** Back to the empty checkbox, the token cleared. */
  reset(): void {
    this.#running?.abort();
    clearTimeout(this.#refreshTimer);
    this.#result = null;
    this.#token = "";
    this.#slides = 0;
    this.#set("idle");
  }

  /** Shows the slider whatever the score said (the demo uses it). */
  challenge(): void {
    if (!this.#result) return;
    this.#slides = 0;
    this.#local = null;
    this.#set("challenge");
  }

  /**
   * Settles the check. `server` is the server's answer to a slide in signed mode: its token and
   * score replace the page's, which only a server can vouch for.
   */
  #finish(
    verdict: "human" | "bot",
    challenged: boolean,
    server?: { token: string; bot: number; exp?: number },
  ): void {
    const result = this.#result;
    if (!result) return;
    this.#challenged ||= challenged;
    let bot = server?.bot ?? result.bot;
    // The slider settles doubt; it never overturns a decisive "bot" from the signals.
    if (challenged && verdict === "human" && bot >= THRESHOLDS.bot) verdict = "bot";
    else if (challenged && verdict === "human") bot = Math.min(bot, 0.3);
    this.#bot = bot;
    if (server) {
      this.#token = server.token;
      if (server.exp) result.expiresAt = server.exp;
    } else if (!result.signed) this.#token = unsignedToken(verdictOf(bot), bot, result.solution);
    this.#set(verdict);
    this.#scheduleRefresh();
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
    if (!this.hasAttribute("no-honeypot") && !form.querySelector("[data-notabot-honeypot]"))
      form.append(honeypot(`${name}-hp`));
  }

  /** The parts built once and updated in place, so focus and the live region survive. */
  #parts: {
    box: HTMLDivElement;
    seal: HTMLButtonElement;
    label: HTMLSpanElement;
    status: HTMLSpanElement;
    retry: HTMLButtonElement;
    challenge: HTMLDivElement;
    details: HTMLDivElement;
    by: HTMLAnchorElement;
  } | null = null;
  /** Which challenge view is on screen (kind and attempt): rebuilt only when it changes. */
  #challengeShown: string | null = null;

  #build(root: ShadowRoot) {
    const box = el("div", { class: "box" });
    const label = el("span", { class: "label", id: "notabot-label" });
    // A checkbox to assistive technology: unchecked, checking (mixed), checked.
    const seal = el("button", {
      type: "button",
      class: "seal",
      role: "checkbox",
      "aria-labelledby": "notabot-label",
      "aria-describedby": "notabot-status",
    });
    seal.append(el("span", { class: "mark", "aria-hidden": "true" }));
    seal.addEventListener("click", () => void this.run());
    // One live region for the widget's life: replacing it would silence screen readers.
    const status = el("span", { class: "status", id: "notabot-status", role: "status" });
    const text = el("div", { class: "text" });
    text.append(label, status);
    const retry = el("button", { type: "button", class: "retry" });
    retry.addEventListener("click", () => void this.run());
    const row = el("div", { class: "row" });
    row.append(seal, text, retry);
    const challenge = el("div", { class: "challenge" });
    const details = el("div", { class: "detail-slot" });
    const by = el("a", {
      class: "by",
      href: "https://maxgfr.github.io/notabot/",
      target: "_blank",
      rel: "noopener",
    });
    box.append(row, challenge, details, by);
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
    return { box, seal, label, status, retry, challenge, details, by };
  }

  #render(): void {
    const root = this.#root;
    if (!root) return;
    this.#parts ??= this.#build(root);
    const p = this.#parts;
    const state = this.#state;
    const t = (k: MessageKey) => this.#t(k);
    p.box.dataset.state = state;
    p.box.dataset.theme = this.getAttribute("theme") ?? "auto";
    p.label.textContent = t("label");
    p.seal.setAttribute(
      "aria-checked",
      state === "human"
        ? "true"
        : state === "checking" || state === "challenge"
          ? "mixed"
          : "false",
    );
    p.seal.disabled = state === "checking" || state === "human" || state === "challenge";
    const status =
      state === "checking"
        ? t((this.#step && this.#step !== "done" ? this.#step : "signals") as MessageKey)
        : state === "idle"
          ? ""
          : state === "challenge"
            ? t("unsure")
            : state === "error" && this.#error
              ? t(ERROR_MESSAGES[this.#error])
              : t(state);
    if (p.status.textContent !== status) p.status.textContent = status;
    p.retry.textContent = t("retry");
    p.retry.hidden = state !== "bot" && state !== "error";
    p.by.textContent = t("by");
    // The challenge view is replaced only when a new one is due (another kind or attempt).
    const shown = state === "challenge" ? `${this.#visible().kind}:${this.#slides}` : null;
    if (shown !== this.#challengeShown) {
      this.#challengeShown = shown;
      p.challenge.replaceChildren(...(shown ? [this.#challengeView()] : []));
    }
    const result = this.#result;
    const open = p.details.querySelector("details")?.open ?? false;
    p.details.replaceChildren(...(result && state !== "checking" ? [this.#details(result)] : []));
    const details = p.details.querySelector("details");
    if (details) details.open = open;
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
    if (this.#challenged) details.append(el("p", { class: "note" }, this.#t("friction")));
    if (!result.signed) details.append(el("p", { class: "note" }, this.#t("unsigned")));
    return details;
  }

  /** After a gesture: human, another try, or bot once the tries run out. */
  #settle(passed: boolean): void {
    if (passed) {
      this.#finish("human", true);
      return;
    }
    this.#slides++;
    if (this.#slides >= MAX_SLIDES) {
      this.#finish("bot", true);
      return;
    }
    this.#render();
    this.#root?.querySelector<HTMLElement>(".handle, .target")?.focus();
  }

  /**
   * Settles a gesture. In signed mode the server judges it again and signs the result: the page's
   * own judgement would be one line of script away from "passed".
   */
  #judge(local: boolean, gesture: Gesture, busy: HTMLElement): void {
    const verifyUrl = this.getAttribute("verify-url");
    const slideUrl = this.getAttribute("slide-url") || (verifyUrl ? slideUrlOf(verifyUrl) : null);
    const token = this.#result?.signed ? this.#result.token : null;
    if (!slideUrl || !token) {
      this.#settle(local);
      return;
    }
    if (busy.getAttribute("aria-busy") === "true") return;
    busy.setAttribute("aria-busy", "true");
    submitSlide(slideUrl, { token, ...gesture }, this.#running?.signal)
      .then((answer) => {
        if (answer.passed && answer.token)
          return this.#finish("human", true, {
            token: answer.token,
            bot: answer.bot ?? 0.3,
            ...(answer.exp ? { exp: answer.exp } : {}),
          });
        if (answer.verdict === "bot") return this.#finish("bot", true);
        this.#settle(false);
      })
      .catch((e) => {
        if (!this.#running?.signal.aborted) this.#fail(e);
      });
  }

  /** The challenge shown: the server's choice when it signed one, else one at random. */
  #visible(): VisibleChallenge {
    const signed = this.#result?.visible;
    if (signed) return signed;
    // `challenges="slide"` or `"targets"` narrows the page's own draw; both by default.
    const kinds = (this.getAttribute("challenges") ?? "slide targets")
      .split(/[\s,]+/)
      .filter((k) => k === "slide" || k === "targets");
    const kind = kinds[Math.floor(Math.random() * kinds.length)] ?? "slide";
    this.#local ??=
      kind === "slide"
        ? { kind, zone: 45 + Math.random() * 38 }
        : { kind, targets: randomTargets() };
    return this.#local;
  }

  #challengeView(): HTMLElement {
    return this.#visible().kind === "targets" ? this.#targets() : this.#slider();
  }

  /** Numbered targets to activate in order, by pointer or keyboard (their tab order is shuffled). */
  #targets(): HTMLElement {
    const visible = this.#visible();
    const targets = visible.kind === "targets" ? visible.targets : randomTargets();
    const wrap = el("div", { class: "targets-wrap" });
    const hint = el(
      "p",
      { class: "hint", id: "notabot-targets-hint" },
      this.#slides ? this.#t("targetsRetry") : this.#t("targetsHint"),
    );
    const box = el("div", {
      class: "targets",
      role: "group",
      "aria-labelledby": "notabot-targets-hint",
    });
    const clicks: TargetClick[] = [];
    const order = targets.map((_, i) => i).sort(() => Math.random() - 0.5);
    for (const i of order) {
      const [x, y] = targets[i] as [number, number];
      const button = el(
        "button",
        {
          type: "button",
          class: "target",
          "aria-label": this.#t("targetLabel").replace("{n}", String(i + 1)),
          "aria-pressed": "false",
        },
        String(i + 1),
      );
      button.style.left = `${x}%`;
      button.style.top = `${y}%`;
      button.addEventListener("click", (e) => {
        if (button.getAttribute("aria-pressed") === "true") return;
        const r = box.getBoundingClientRect();
        // A click from Enter or Space has no pointer position (detail 0).
        const key = e.detail === 0;
        clicks.push({
          index: i,
          x: key ? x : ((e.clientX - r.left) / r.width) * 100,
          y: key ? y : ((e.clientY - r.top) / r.height) * 100,
          t: e.timeStamp,
          trusted: e.isTrusted,
          key,
        });
        button.setAttribute("aria-pressed", "true");
        if (clicks.length === targets.length)
          this.#judge(judgeTargets(clicks, targets), { clicks }, box);
      });
      box.append(button);
    }
    wrap.append(hint, box);
    return wrap;
  }

  #slider(): HTMLElement {
    const wrap = el("div", { class: "slide" });
    const hint = el(
      "p",
      { class: "hint" },
      this.#slides ? this.#t("slideRetry") : this.#t("slideHint"),
    );
    const track = el("div", { class: "track" });
    // Target zone somewhere in the right half, 14% wide; where the server put it, when it did.
    const visible = this.#visible();
    const zoneStart = visible.kind === "slide" ? visible.zone : 45 + Math.random() * 38;
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
    const judge = (local: boolean, gesture: Gesture) =>
      this.#judge(local, { ...gesture, landed: landed() }, handle);

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
      const r = track.getBoundingClientRect();
      judge(judgeSlide(samples, landed()).passed, {
        samples,
        track: { left: r.left, width: r.width },
      });
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
        const trusted = keysTrusted && e.isTrusted;
        const gesture = { keyTimes, keysTrusted: trusted, position: pos };
        keyTimes = [];
        keysTrusted = true;
        judge(judgeKeySlide(gesture.keyTimes, trusted, landed()), gesture);
      }
    });
    return wrap;
  }
}

/**
 * A field no person sees or reaches: off screen, out of the tab order, hidden from assistive
 * technology, autocomplete off. A script that fills every input fills it; the tracker and the
 * middleware both notice.
 */
function honeypot(name: string): HTMLInputElement {
  const trap = document.createElement("input");
  trap.type = "text";
  trap.name = name;
  trap.tabIndex = -1;
  trap.autocomplete = "off";
  trap.setAttribute("aria-hidden", "true");
  trap.dataset.notabotHoneypot = "";
  Object.assign(trap.style, {
    position: "absolute",
    left: "-10000px",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
  });
  return trap;
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
