/** Strings of the page's language, written by scripts/pages.ts into #i18n. */
const dict: Record<string, string> = JSON.parse(
  document.getElementById("i18n")?.textContent || "{}",
);

export const lang = (document.documentElement.lang || "en") as "en" | "fr";
/** Relative path from this page to the site root ("./" or "../"). */
export const root = document.body.dataset.root || "./";

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const raw = dict[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

export async function copyText(
  text: string,
  button: HTMLButtonElement,
  done: string,
): Promise<void> {
  const label = button.textContent ?? "";
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = done;
  } catch {
    return;
  }
  setTimeout(() => {
    button.textContent = label;
  }, 1600);
}

/** Copy buttons: `data-copy` names the element whose text they copy. */
export function wireCopyButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    button.addEventListener("click", () => {
      const source = document.getElementById(button.dataset.copy ?? "");
      if (source) void copyText(source.textContent ?? "", button, t("embed.copied"));
    });
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}
