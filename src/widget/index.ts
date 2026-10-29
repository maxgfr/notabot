import { NotabotCheck } from "./element";

/** Registers `<notabot-check>` once. A no-op outside a browser (SSR). */
export function defineNotabot(tag = "notabot-check"): void {
  if (typeof customElements === "undefined" || customElements.get(tag)) return;
  customElements.define(
    tag,
    tag === "notabot-check" ? NotabotCheck : class extends NotabotCheck {},
  );
}

export interface MountOptions {
  /** Where to put the widget: an element, or a selector. Default: before the form's submit button. */
  target?: Element | string;
  /** Form whose submissions carry the token (a selector); the widget then sits inside it. */
  form?: string;
  attributes?: Record<string, string>;
}

/** Adds a `<notabot-check>` to the page and returns it. */
export function mountNotabot(options: MountOptions = {}): NotabotCheck {
  defineNotabot();
  const widget = document.createElement("notabot-check") as NotabotCheck;
  for (const [k, v] of Object.entries(options.attributes ?? {})) widget.setAttribute(k, v);
  if (options.form) widget.setAttribute("form", options.form);
  const target =
    typeof options.target === "string" ? document.querySelector(options.target) : options.target;
  const form = options.form ? document.querySelector(options.form) : null;
  const submit = form?.querySelector('[type="submit"], button:not([type])');
  if (target) target.append(widget);
  else if (submit) submit.before(widget);
  else if (form) form.append(widget);
  else document.body.append(widget);
  return widget;
}

/**
 * Holds back a form's submission until the widget says human: a submit before that runs the
 * check (or shows the slider) instead. A submit that goes through spends the token, so the
 * widget checks again right after, for the next one. The server must still check the token.
 */
export function guardForm(form: HTMLFormElement, widget: NotabotCheck): () => void {
  const onSubmit = (e: SubmitEvent) => {
    if (widget.state === "human") {
      // After every submit listener has read the form: a fetch() handler posts this token.
      setTimeout(() => widget.refresh(), 0);
      return;
    }
    e.preventDefault();
    if (widget.state === "idle" || widget.state === "error") void widget.run();
  };
  form.addEventListener("submit", onSubmit);
  return () => form.removeEventListener("submit", onSubmit);
}

export { NotabotCheck, type State, type VerdictDetail } from "./element";
export { MESSAGES, type Messages, registerMessages } from "./i18n";
