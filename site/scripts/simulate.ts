// "Simulate a bot": presets that change a copy of the visitor's own signals the way a bot's would
// read, scored side by side with the real ones. score() is pure: nothing leaves the page.
import { type ScoreResult, score } from "../../src/score/index";
import type { NotabotSignals } from "../../src/signals/types";
import { el, lang, t } from "./common";

interface Preset {
  id: string;
  label: { en: string; fr: string };
  apply(s: NotabotSignals): void;
}

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

export const PRESETS: Preset[] = [
  {
    id: "webdriver",
    label: { en: "navigator.webdriver = true", fr: "navigator.webdriver = true" },
    apply: (s) => {
      s.automation.webdriver = true;
    },
  },
  {
    id: "headless-ua",
    label: { en: "HeadlessChrome user agent", fr: "User agent HeadlessChrome" },
    apply: (s) => {
      s.env.userAgent = s.env.userAgent.replace(/Chrome\//, "HeadlessChrome/");
      s.automation.headlessUserAgent = true;
    },
  },
  {
    id: "swiftshader",
    label: { en: "SwiftShader, a software GPU", fr: "SwiftShader, un GPU logiciel" },
    apply: (s) => {
      if (s.hardware.webgl)
        s.hardware.webgl.unmaskedRenderer =
          "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)";
      s.automation.softwareRenderer = true;
    },
  },
  {
    id: "iframe",
    label: { en: "A fresh iframe that disagrees", fr: "Une iframe neuve qui contredit" },
    apply: (s) => {
      s.iframe = {
        snapshot: { ...s.page, webdriver: true, languages: ["en-US"] },
        mismatches: ["webdriver", "languages"],
      };
    },
  },
  {
    id: "stealth",
    label: { en: "A stealth plugin's patches", fr: "Les retouches d'un plugin stealth" },
    apply: (s) => {
      s.automation.webdriverOwnProperty = true;
      s.tampering = {
        ...s.tampering,
        lies: [
          ...s.tampering.lies,
          "Navigator.webdriver: source visible",
          "Navigator.plugins: accepts a foreign receiver",
        ],
        toStringPatched: true,
      };
    },
  },
  {
    id: "windows-ua",
    label: { en: "A Windows user agent on this GPU", fr: "Un user agent Windows sur ce GPU" },
    apply: (s) => {
      s.env.userAgent = WINDOWS_UA;
      s.env.platform = "Win32";
      if (s.env.uaData) s.env.uaData = { ...s.env.uaData, platform: "Windows" };
      s.page = { ...s.page, userAgent: WINDOWS_UA, platform: "Win32" };
    },
  },
];

function line(name: string, r: ScoreResult): HTMLElement {
  const p = el("p", { class: "sim-score" });
  p.append(
    el("span", { class: "sim-name" }, name),
    el("strong", {}, `${Math.round(r.bot * 100)} %`),
    el("span", { class: `sim-verdict v-${r.verdict}` }, t(`stamp.${r.verdict}`)),
  );
  return p;
}

/** Wires the presets to the visitor's signals (read when a preset is pressed). */
export function mountSimulator(current: () => NotabotSignals | null): void {
  const presets = document.getElementById("simulate-presets");
  const out = document.getElementById("simulate-result");
  if (!presets || !out) return;
  const on = new Set<string>();
  const render = () => {
    const signals = current();
    if (!signals) return;
    const real = score({ signals, behavior: null });
    const copy = structuredClone(signals);
    for (const p of PRESETS) if (on.has(p.id)) p.apply(copy);
    const simulated = score({ signals: copy, behavior: null });
    const before = new Set(real.flags.map((f) => f.id));
    const raised = simulated.flags.filter((f) => !before.has(f.id));
    const list = el("ul", { class: "sim-raised" });
    for (const f of raised) {
      const li = el("li");
      li.append(el("code", {}, f.id), el("span", {}, ` ${f.detail}`));
      list.append(li);
    }
    out.replaceChildren(
      line(t("simulate.yours"), real),
      line(t("simulate.simulated"), simulated),
      on.size
        ? raised.length
          ? list
          : el("p", { class: "hint" }, t("simulate.nothingNew"))
        : el("p", { class: "hint" }, t("simulate.pick")),
    );
  };
  presets.replaceChildren(
    ...PRESETS.map((p) => {
      const b = el(
        "button",
        { type: "button", class: "chip", "aria-pressed": "false" },
        p.label[lang],
      );
      b.addEventListener("click", () => {
        if (on.has(p.id)) on.delete(p.id);
        else on.add(p.id);
        b.setAttribute("aria-pressed", String(on.has(p.id)));
        render();
      });
      return b;
    }),
  );
  render();
}
