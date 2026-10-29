// Packs notabot as npm would publish it (or, with --published, takes the version on the
// registry), installs it in a scratch project and checks what a consumer gets: Node imports of
// every entry point (the browser ones must import on a server without touching the DOM), the
// server half working end to end, and the types under `nodenext` and `bundler`.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";

const published = process.argv.includes("--published");
const root = resolve(import.meta.dir, "..");
// The version a release just tagged (NOTABOT_VERSION, from `git describe` in CI): checked once
// the registry serves it, so a check right after a release never tests the previous version.
const wanted = process.env.NOTABOT_VERSION?.replace(/^v/, "");
if (published && wanted) {
  for (let i = 0; ; i++) {
    const seen = (await $`npm view notabot@${wanted} version`.nothrow().quiet().text()).trim();
    if (seen === wanted) break;
    if (i >= 30) throw new Error(`notabot@${wanted} is not on the registry after 10 minutes`);
    await Bun.sleep(20_000);
  }
}
const dir = await mkdtemp(join(tmpdir(), "notabot-package-"));
try {
  const source = published
    ? `notabot@${wanted ?? "latest"}`
    : join(dir, (await $`npm pack --silent --pack-destination ${dir}`.cwd(root).text()).trim());
  await Bun.write(
    join(dir, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }),
  );
  await $`npm install --silent --no-audit --no-fund ${source} typescript@7`.cwd(dir);
  if (published) {
    const version = (await $`npm ls notabot --json`.cwd(dir).json()).dependencies.notabot.version;
    console.log(`checking notabot@${version} from the registry`);
  }

  await Bun.write(
    join(dir, "run.mjs"),
    `import { score, RULES } from "notabot";
import { createChallenge, verifySolution, signToken, verifyToken } from "notabot/server";
import { search, encodeSolution } from "notabot/pow";
import { analyzeTrajectory } from "notabot/behavior";
import { parseVerdict, sanitizeFeatures, proxySettings } from "notabot/llm";
import { fnv1a } from "notabot/signals";
import { identify, smartSignals } from "notabot/smart";
// Browser entry points must import on a server (SSR) without touching the DOM.
await import("notabot/widget");
await import("notabot/embed");
const c = await createChallenge({ hmacKey: "k", maxnumber: 500 });
const number = await search(c);
const ok = await verifySolution(encodeSolution({ ...c, number, took: 1 }), "k");
if (!ok.ok) throw new Error("pow: " + JSON.stringify(ok));
const token = await signToken({ verdict: "human", bot: 0.1 }, "k");
if (!(await verifyToken(token, "k")).ok) throw new Error("token");
if (RULES.length < 20 || typeof score !== "function") throw new Error("score");
if (analyzeTrajectory([]).samples !== 0) throw new Error("behavior");
if (parseVerdict('{"verdict":"bot","confidence":1}')?.verdict !== "bot") throw new Error("llm");
if (sanitizeFeatures({ x: "free text" }).x !== undefined) throw new Error("sanitize");
if (!proxySettings("https://x.dev/v1")) throw new Error("proxy");
if (fnv1a("a").length !== 8) throw new Error("signals");
if (typeof identify !== "function" || typeof smartSignals !== "function") throw new Error("smart");
const { createNotabot, infoFromNode } = await import("notabot/middleware");
const nb = createNotabot({ hmacKey: "k", maxnumber: 500 });
const curl = await nb.verifyRequest(infoFromNode({ method: "GET", url: "/", headers: { host: "a.dev", "user-agent": "curl/8" } }));
if (curl.ok || curl.reason !== "missing-token") throw new Error("middleware: " + JSON.stringify(curl));
const gated = await nb.protect(() => new Response("in"))(new Request("https://a.dev/notabot/challenge"));
if ((await gated.json()).algorithm !== "SHA-256") throw new Error("middleware routes");
console.log("node imports ok");
`,
  );
  await $`node run.mjs`.cwd(dir);

  // The server half must not drag the AI stack in: follow the middleware's imports.
  const lib = join(dir, "node_modules/notabot/dist/lib");
  const seen = new Set<string>();
  const heavy: string[] = [];
  const walk = async (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = await Bun.file(file).text();
    for (const [, spec] of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      if (!spec) continue;
      if (spec.startsWith(".")) await walk(resolve(join(file, ".."), spec));
      else if (/^(ai|llm-connect|llm-models|@ai-sdk\/)/.test(spec)) heavy.push(`${file}: ${spec}`);
    }
  };
  await walk(join(lib, "middleware/index.js"));
  if (heavy.length)
    throw new Error(`notabot/middleware imports the AI stack:\n${heavy.join("\n")}`);
  console.log(`middleware imports no AI package (${seen.size} files)`);

  await Bun.write(
    join(dir, "types.ts"),
    `import { check, collect, score, trackBehavior, type CheckResult, type NotabotSignals, type ScoreResult, type Verdict } from "notabot";
import { claimedSystems, blend, type Rule } from "notabot/score";
import { judgeSlide, type BehaviorFeatures } from "notabot/behavior";
import { solveChallenge, type Challenge, type Solution } from "notabot/pow";
import { classify, toFeatures, visitorStore, type Features, type ModelVerdict } from "notabot/llm";
import { createChallenge, verifyToken, type TokenClaims } from "notabot/server";
import { defineNotabot, mountNotabot, guardForm, type NotabotCheck, type VerdictDetail } from "notabot/widget";
import { attributesFromDataset } from "notabot/embed";
import { collectEnv, snapshotOf, type RealmSnapshot } from "notabot/signals";
import { createNotabot, notabotExpress, notabotHono, kvStore, type Decision, type RequestRule } from "notabot/middleware";
const rule: RequestRule = { id: "x", weight: 0.1, explain: "", test: (i) => i.ja4 ?? null };
export const nb = createNotabot({ hmacKey: "k", rules: [rule] });
export const mw = [notabotExpress(nb), notabotHono(nb), kvStore];
export type D = Decision;
const verdict: Verdict = "human";
export const all = [check, collect, score, trackBehavior, claimedSystems, blend, judgeSlide, solveChallenge, classify, toFeatures, visitorStore, createChallenge, verifyToken, defineNotabot, mountNotabot, guardForm, attributesFromDataset, collectEnv, snapshotOf, verdict];
export type T = [CheckResult, NotabotSignals, ScoreResult, Rule, BehaviorFeatures, Challenge, Solution, Features, ModelVerdict, TokenClaims, NotabotCheck, VerdictDetail, RealmSnapshot];
`,
  );
  const common = [
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--lib",
    "es2023,dom,dom.iterable",
    "types.ts",
  ];
  await $`npx tsc --module nodenext --moduleResolution nodenext ${common}`.cwd(dir);
  await $`npx tsc --module preserve --moduleResolution bundler ${common}`.cwd(dir);
  console.log("types ok (nodenext, bundler)");
} finally {
  await rm(dir, { recursive: true, force: true });
}
