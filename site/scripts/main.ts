import type { CheckResult } from "../../src/index";
import { type Features, toFeatures } from "../../src/llm/index";
import { RULES, type ScoreResult, score } from "../../src/score/index";
import { collect } from "../../src/signals/index";
import type { NotabotSignals } from "../../src/signals/types";
import { sharedTracker } from "../../src/widget/element";
import { defineNotabot, type NotabotCheck, type VerdictDetail } from "../../src/widget/index";
import { GROUPS, RULES_FR } from "./catalog";
import { copyText, el, lang, t, wireCopyButtons } from "./common";
import { mountOfficer, showPrompt } from "./officer";
import { drawGuilloche, drawPortrait, fillPassport, stamp } from "./passport";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let signals: NotabotSignals | null = null;
let rules: ScoreResult | null = null;
let result: CheckResult | null = null;
let finalBot: number | null = null;
// The same recording the widget scores, started on arrival.
const tracker = sharedTracker();

function features(): Features | null {
  if (!signals || !rules) return null;
  const behavior = result?.behavior ?? tracker.features();
  return toFeatures(signals, rules, behavior);
}

function renderLedger(s: NotabotSignals, r: ScoreResult | null): void {
  const ledger = $("ledger");
  const raised = new Set(r?.flags.map((f) => f.id) ?? []);
  $("papers-took").textContent = t("papers.took", { ms: s.durationMs });
  const groups = GROUPS.map((g) => {
    const section = el("section", { class: "ledger-group", "aria-labelledby": `g-${g.id}` });
    section.append(
      el("h3", { id: `g-${g.id}` }, g.title[lang]),
      el("p", { class: "ledger-intro" }, g.intro[lang]),
    );
    const table = el("table");
    const body = el("tbody");
    for (const f of g.fields) {
      let value = "—";
      try {
        value = f.value(s) || "—";
      } catch {}
      const row = el("tr", { "data-privacy": f.privacy });
      const name = el("th", { scope: "row" });
      name.append(
        el("span", { class: "field" }, f.label[lang]),
        el("span", { class: "reveals" }, f.reveals[lang]),
      );
      const cell = el("td", { class: "value" });
      cell.append(el("span", {}, value));
      // A reading that feeds a raised rule is marked where it is read, not only in the report.
      const hits = (f.rules ?? []).filter((id) => raised.has(id));
      if (hits.length) {
        row.dataset.raised = "true";
        cell.append(el("span", { class: "raised-by" }, hits.map((id) => `<${id}`).join(" ")));
      }
      const privacy = el("td", { class: "privacy" });
      privacy.append(el("span", { class: `level level-${f.privacy}` }, t(`privacy.${f.privacy}`)));
      row.append(name, cell, privacy);
      body.append(row);
    }
    table.append(body);
    section.append(table);
    return section;
  });
  ledger.replaceChildren(...groups);
}

function renderReport(r: ScoreResult, bot: number): void {
  const tripped = new Map(r.flags.map((f) => [f.id, f]));
  $("report-total").textContent = r.flags.length
    ? t("report.total", { n: r.flags.length, total: RULES.length, p: Math.round(bot * 100) })
    : t("report.clean", { p: Math.round(bot * 100) });
  // Raised rules first, then the clear ones, each in the package's order.
  const ordered = [...RULES].sort((a, b) => Number(tripped.has(b.id)) - Number(tripped.has(a.id)));
  $("rules").replaceChildren(
    ...ordered.map((rule) => {
      const flag = tripped.get(rule.id);
      const li = el("li", { class: flag ? "raised" : "clear" });
      const head = el("p", { class: "rule-head" });
      head.append(
        el("code", {}, rule.id),
        el(
          "span",
          { class: "rule-state" },
          flag ? t("report.weight", { w: rule.weight }) : t("report.passed"),
        ),
      );
      li.append(
        head,
        el(
          "p",
          { class: "rule-explain" },
          lang === "fr" ? (RULES_FR[rule.id] ?? rule.explain) : rule.explain,
        ),
      );
      if (flag) li.append(el("p", { class: "rule-detail" }, flag.detail));
      return li;
    }),
  );
}

function press(kind: "human" | "unsure" | "bot" | "error"): void {
  stamp($("stamp-zone"), kind, t(`stamp.${kind}`), lang);
  $("passport").dataset.verdict = kind;
}

function onSteps(widget: NotabotCheck): void {
  const steps = [...$("checkpoints").querySelectorAll<HTMLLIElement>("li")];
  const order = ["signals", "rules", "pow", "model", "verify", "done"];
  const reached = new Set<string>();
  const mark = (step: string) => {
    reached.add(step);
    const at = order.indexOf(step);
    for (const li of steps) {
      const name = li.dataset.step ?? "";
      const i = order.indexOf(name);
      // A checkpoint the run skipped (no model configured) stays unlit.
      li.dataset.state = !reached.has(name) ? "" : i < at || step === "done" ? "done" : "now";
    }
  };
  widget.addEventListener("notabot:step", (e) =>
    mark((e as CustomEvent<{ step: string }>).detail.step),
  );
  widget.addEventListener("notabot:state", (e) => {
    const state = (e as CustomEvent<{ state: string }>).detail.state;
    if (state === "checking") {
      reached.clear();
      for (const li of steps) li.dataset.state = "";
      $("stamp-zone").replaceChildren();
      delete $("passport").dataset.verdict;
    }
    if (state === "challenge") press("unsure");
    if (state === "error") press("error");
    $("force-slider").hidden = state !== "human";
  });
  widget.addEventListener("notabot:verdict", (e) => {
    const d = (e as CustomEvent<VerdictDetail>).detail;
    result = d.result;
    signals = d.result.signals;
    rules = d.result.rules;
    finalBot = d.bot;
    press(d.verdict);
    fillPassport(signals, t(`stamp.${d.verdict}`));
    renderLedger(signals, rules);
    renderReport(rules, d.bot);
    showPrompt(features());
  });
}

async function start(): Promise<void> {
  drawGuilloche($("guilloche") as unknown as SVGSVGElement);
  drawPortrait($<HTMLCanvasElement>("portrait"));
  wireCopyButtons();
  defineNotabot();
  const widget = $("check") as NotabotCheck;
  onSteps(widget);
  $("force-slider").addEventListener("click", () => widget.challenge());

  // The papers are read on arrival, the verdict waits for the visitor.
  signals = await collect();
  rules = score({ signals, behavior: null });
  fillPassport(signals, null);
  renderLedger(signals, rules);
  showPrompt(features());

  $("copy-json").addEventListener("click", (e) => {
    if (signals)
      void copyText(
        JSON.stringify(signals, null, 2),
        e.currentTarget as HTMLButtonElement,
        t("papers.copied"),
      );
  });
  $("download-json").addEventListener("click", () => {
    if (!signals) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(signals, null, 2)], { type: "application/json" }),
    );
    a.download = "notabot-signals.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  mountOfficer({
    features,
    rulesBot: () => finalBot ?? rules?.bot ?? null,
    onVerdict: (bot) => {
      if (rules) renderReport(rules, bot);
    },
  });
}

void start();
