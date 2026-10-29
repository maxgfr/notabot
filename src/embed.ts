import { defineNotabot, guardForm, mountNotabot, type NotabotCheck } from "./widget/index";

/** Data attributes of the script tag that become the widgets' default attributes. */
export const FORWARDED = [
  "mode",
  "challengeUrl",
  "verifyUrl",
  "endpoint",
  "model",
  "lang",
  "theme",
  "name",
  "rulesWeight",
] as const;

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** `data-challenge-url="…"` → `{ "challenge-url": "…" }`, URLs resolved against the page. */
export function attributesFromDataset(data: DOMStringMap, base: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of FORWARDED) {
    const value = data[key];
    if (!value) continue;
    out[kebab(key)] = /Url$|^endpoint$/.test(key) ? new URL(value, base).href : value;
  }
  // A key in the page can be read by anyone: refuse it, as murmur does.
  if (data.apiKey)
    console.error(
      "notabot: data-api-key is ignored: a key in the page is public. Put it behind a Worker (data-endpoint).",
    );
  return out;
}

/**
 * The one-line embed: `<script type="module" src=".../notabot.js" data-form="#signup"></script>`
 * registers `<notabot-check>`, gives every widget the script's attributes, and with `data-form`
 * adds a widget to that form and holds its submission until the check passes.
 */
function start(): void {
  const self = import.meta.url;
  const tag = [...document.querySelectorAll<HTMLScriptElement>("script[src]")].find(
    (s) => s.src === self && !s.dataset.notabotReady,
  );
  if (tag) tag.dataset.notabotReady = "true";
  const data = tag?.dataset ?? {};
  const attributes = attributesFromDataset(data, location.href);
  defineNotabot();
  const widgets = [...document.querySelectorAll<NotabotCheck>("notabot-check")];
  for (const w of widgets)
    for (const [k, v] of Object.entries(attributes)) if (!w.hasAttribute(k)) w.setAttribute(k, v);
  const formSelector = data.form;
  if (!formSelector) return;
  const form = document.querySelector<HTMLFormElement>(formSelector);
  if (!form) {
    console.error(`notabot: no form matches ${formSelector}`);
    return;
  }
  const widget =
    widgets.find((w) => w.closest("form") === form || w.getAttribute("form") === formSelector) ??
    mountNotabot({ form: formSelector, attributes });
  if (data.guard !== "false") guardForm(form, widget);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
