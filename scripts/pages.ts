// Renders the site's templates once per language: `{{key}}` comes from site/i18n/<lang>.json,
// `{{> name}}` from site/content/<lang>/<name>.html. English goes to the root, other
// languages to /<lang>/. Adding a language is adding a JSON file and its content folder.
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export const LANGS = ["en", "fr"] as const;
export const DEFAULT_LANG = "en";
const PAGES = ["index"];
const OUT = "site/_gen";

type Dict = Record<string, string>;

async function partial(lang: string, name: string): Promise<string> {
  const file = Bun.file(`site/content/${lang}/${name}.html`);
  if (!(await file.exists())) throw new Error(`missing partial ${lang}/${name}`);
  return file.text();
}

export async function render(
  template: string,
  lang: string,
  dict: Dict,
  depth: number,
): Promise<string> {
  const toSite = "../".repeat(depth + 1);
  const toRoot = "../".repeat(depth);
  const vars: Dict = {
    ...dict,
    lang,
    src: toSite,
    root: toRoot || "./",
    other: LANGS.filter((l) => l !== lang).join(","),
    "i18n-json": JSON.stringify(dict).replaceAll("<", "\\u003c"),
  };
  let out = template;
  for (const m of [...out.matchAll(/\{\{>\s*([\w-]+)\s*\}\}/g)]) {
    out = out.replace(m[0], await partial(lang, m[1] ?? ""));
  }
  out = out.replace(/\{\{\s*lang-url:(\w+)\s*\}\}/g, (_, l: string) =>
    l === DEFAULT_LANG ? toRoot || "./" : `${toRoot}${l}/`,
  );
  return out.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (all, key: string) => {
    if (!(key in vars)) throw new Error(`missing i18n key "${key}" for ${lang}`);
    return vars[key] ?? all;
  });
}

export async function generate(): Promise<string[]> {
  await rm(OUT, { recursive: true, force: true });
  const outputs: string[] = [];
  for (const lang of LANGS) {
    const dict = (await Bun.file(`site/i18n/${lang}.json`).json()) as Dict;
    const depth = lang === DEFAULT_LANG ? 0 : 1;
    for (const page of PAGES) {
      const template = await Bun.file(`site/${page}.html`).text();
      const html = await render(template, lang, dict, depth);
      const out = join(OUT, depth ? lang : "", `${page}.html`);
      await mkdir(dirname(out), { recursive: true });
      await Bun.write(out, html);
      outputs.push(out);
    }
  }
  return outputs;
}

if (import.meta.main) {
  const files = await generate();
  console.log(files.join("\n"));
}
