// Builds the npm library (dist/lib, dist/types), the CDN bundle (dist/cdn) and the GitHub Pages
// site (dist/site). `bun scripts/build.ts [lib|cdn|site]` builds one part.
import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { $ } from "bun";
import { generate } from "./pages";

const part = process.argv[2] ?? "all";

export const ENTRYPOINTS = [
  "src/index.ts",
  "src/signals/index.ts",
  "src/score/index.ts",
  "src/behavior/index.ts",
  "src/pow/index.ts",
  "src/llm/index.ts",
  "src/server/index.ts",
  "src/middleware/index.ts",
  "src/smart/index.ts",
  "src/widget/index.ts",
  "src/embed.ts",
];

async function lib() {
  await rm("dist/lib", { recursive: true, force: true });
  await rm("dist/types", { recursive: true, force: true });
  const res = await Bun.build({
    entrypoints: ENTRYPOINTS,
    root: "src",
    outdir: "dist/lib",
    target: "browser",
    format: "esm",
    splitting: true,
    packages: "external",
    naming: { entry: "[dir]/[name].js", chunk: "chunks/[name]-[hash].js" },
  });
  if (!res.success) throw new AggregateError(res.logs, "lib build failed");
  await $`bunx tsc -p tsconfig.build.json`;
  await fullySpecifyTypes("dist/types");
}

/**
 * tsc keeps extensionless relative specifiers in .d.ts files, which `moduleResolution: node16`
 * and `nodenext` consumers cannot follow: write them as `./x.js` or `./x/index.js`.
 */
async function fullySpecifyTypes(dir: string) {
  const files = await Array.fromAsync(new Bun.Glob("**/*.d.ts").scan(dir));
  for (const rel of files) {
    const path = `${dir}/${rel}`;
    const from = dirname(path);
    const text = await Bun.file(path).text();
    const out = text.replace(
      /(from\s+|import\()(["'])(\.{1,2}\/[^"']+)\2/g,
      (all, lead, q, spec) => {
        if (/\.(js|mjs|cjs|json)$/.test(spec)) return all;
        if (existsSync(join(from, `${spec}.d.ts`))) return `${lead}${q}${spec}.js${q}`;
        if (existsSync(join(from, spec, "index.d.ts"))) return `${lead}${q}${spec}/index.js${q}`;
        throw new Error(`${path}: cannot resolve ${spec}`);
      },
    );
    if (out !== text) await Bun.write(path, out);
  }
}

async function cdn() {
  await rm("dist/cdn", { recursive: true, force: true });
  const res = await Bun.build({
    entrypoints: ["src/embed.ts", "src/index.ts"],
    root: "src",
    outdir: "dist/cdn",
    target: "browser",
    format: "esm",
    splitting: true,
    minify: true,
    naming: { entry: "[name].js", chunk: "[name]-[hash].js" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!res.success) throw new AggregateError(res.logs, "cdn build failed");
  await Bun.write("dist/cdn/notabot.js", Bun.file("dist/cdn/embed.js"));
  await rm("dist/cdn/embed.js");
  await Bun.write("dist/cdn/notabot.mjs", Bun.file("dist/cdn/index.js"));
  await rm("dist/cdn/index.js");
  await cp("assets/recommended.json", "dist/cdn/recommended.json");
  for (const name of ["notabot.js", "notabot.mjs"]) {
    const entry = Bun.file(`dist/cdn/${name}`);
    const gz = Bun.gzipSync(new Uint8Array(await entry.arrayBuffer())).length;
    console.log(
      `cdn: ${name} ${(entry.size / 1024).toFixed(1)} KB, ${(gz / 1024).toFixed(1)} KB gzip`,
    );
  }
}

async function site() {
  await rm("dist/site", { recursive: true, force: true });
  const pages = await generate();
  const res = await Bun.build({
    entrypoints: pages,
    outdir: "dist/site",
    target: "browser",
    minify: true,
    root: "site/_gen",
    splitting: true,
    naming: {
      entry: "[dir]/[name].[ext]",
      chunk: "assets/[name]-[hash].[ext]",
      asset: "assets/[name]-[hash].[ext]",
    },
  });
  if (!res.success) throw new AggregateError(res.logs, "site build failed");
  await unInlineFonts("dist/site/assets");
  await cp("dist/cdn", "dist/site/cdn", { recursive: true });
  // The provider catalog (850 KB) is the demo's fallback: served by the site, not in the npm package.
  await cp("assets/models.json", "dist/site/cdn/models.json");
  await cp("site/static", "dist/site", { recursive: true });
  await Bun.write("dist/site/.nojekyll", "");
}

/**
 * Bun's CSS bundler inlines url() assets. A strict CSP (font-src 'self') refuses data: fonts,
 * and 250 KB of base64 would block the first paint: write each one back out as a file.
 */
async function unInlineFonts(dir: string) {
  for (const rel of await Array.fromAsync(new Bun.Glob("*.css").scan(dir))) {
    const path = `${dir}/${rel}`;
    const css = await Bun.file(path).text();
    const writes: Promise<number>[] = [];
    const out = css.replace(
      /url\(\s*["']?data:font\/(woff2|otf|ttf|woff);base64,([A-Za-z0-9+/=]+)["']?\s*\)/g,
      (_, ext: string, b64: string) => {
        const bytes = Buffer.from(b64, "base64");
        const name = `font-${new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 10)}.${ext}`;
        writes.push(Bun.write(`${dir}/${name}`, bytes));
        return `url("./${name}")`;
      },
    );
    await Promise.all(writes);
    if (out !== css) await Bun.write(path, out);
  }
}

if (import.meta.main) {
  await mkdir("dist", { recursive: true });
  if (part === "all" || part === "lib") await lib();
  if (part === "all" || part === "site" || part === "cdn") await cdn();
  if (part === "all" || part === "site") await site();
}
