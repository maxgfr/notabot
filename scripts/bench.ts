// The honest benchmark: rules alone, a local logistic regression and (optionally) a model, on
// the labelled corpus: captured automated browsers (assets/corpus, see scripts/capture.ts) and
// the human profiles (tests/profiles.ts), plus any capture added with --add.
//
//   bun run bench                         print the table
//   bun run bench --write                 also retrain the regression and update the README
//   bun run bench --add f.json --label human --source "Firefox 131 on Linux"
//
// A model joins with NOTABOT_LLM_ENDPOINT (OpenAI-compatible), NOTABOT_LLM_API_KEY and
// NOTABOT_LLM_MODEL. The regression is scored by leave-one-out: never on a sample it saw.
import { readdirSync } from "node:fs";
import type { BehaviorFeatures } from "../src/behavior/index";
import { type LocalModel, predictLocal, trainLocal } from "../src/llm/local";
import {
  botProbabilityOf,
  buildPrompt,
  chatRequests,
  type Features,
  parseVerdict,
  toFeatures,
} from "../src/llm/prompt";
import { isSignals } from "../src/middleware/schema";
import { blend, score, THRESHOLDS } from "../src/score/index";
import type { NotabotSignals } from "../src/signals/types";
import { humanProfiles } from "../tests/profiles";
import { redact } from "./redact";

interface Sample {
  id: string;
  label: "human" | "bot";
  source: string;
  signals: NotabotSignals;
  behavior: BehaviorFeatures | null;
}

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const add = arg("--add");
if (add) {
  const raw = await Bun.file(add).json();
  const signals = raw.signals ?? raw;
  if (!isSignals(signals)) throw new Error(`${add}: not notabot signals`);
  const label = arg("--label");
  if (label !== "human" && label !== "bot") throw new Error("--label human|bot");
  const source = arg("--source") ?? add;
  const id = `${label}-${source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)}`;
  await Bun.write(
    `assets/corpus/${id}.json`,
    `${JSON.stringify({ id, label, source, signals: redact(signals), behavior: raw.behavior ?? null }, null, 1)}\n`,
  );
  console.log(`added assets/corpus/${id}.json`);
  process.exit(0);
}

const captured: Sample[] = await Promise.all(
  readdirSync("assets/corpus")
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => Bun.file(`assets/corpus/${f}`).json() as Promise<Sample>),
);
const samples: Sample[] = [
  ...humanProfiles().map((p) => ({
    id: p.id,
    label: "human" as const,
    source: `profile: ${p.note}`,
    signals: p.signals,
    behavior: p.behavior,
  })),
  ...captured,
];
const featuresOf = (s: Sample): Features =>
  toFeatures(s.signals, score({ signals: s.signals, behavior: s.behavior }), s.behavior);

type Call = "human" | "unsure" | "bot";
const call = (p: number): Call =>
  p >= THRESHOLDS.bot ? "bot" : p >= THRESHOLDS.unsure ? "unsure" : "human";

const rules = samples.map((s) => score({ signals: s.signals, behavior: s.behavior }).bot);
// Leave-one-out: each sample is predicted by a regression trained on all the others.
const local = samples.map((s, i) => {
  const model = trainLocal(
    samples
      .filter((_, j) => j !== i)
      .map((o) => ({ features: featuresOf(o), bot: o.label === "bot" })),
  );
  return predictLocal(model, featuresOf(s));
});

async function askModel(features: Features): Promise<number | null> {
  const endpoint = process.env.NOTABOT_LLM_ENDPOINT;
  if (!endpoint) return null;
  const signal = AbortSignal.timeout(30_000);
  let res: Response | null = null;
  // The middleware's own requests: the schema first, then the forms other servers accept.
  for (const body of chatRequests(
    process.env.NOTABOT_LLM_MODEL ?? "default",
    buildPrompt(features),
  )) {
    res = await fetch(`${endpoint.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.NOTABOT_LLM_API_KEY
          ? { authorization: `Bearer ${process.env.NOTABOT_LLM_API_KEY}` }
          : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
    if (res.status !== 400) break;
    await res.arrayBuffer().catch(() => {});
  }
  if (!res?.ok) return null;
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const verdict = parseVerdict(body.choices?.[0]?.message?.content ?? "");
  return verdict ? botProbabilityOf(verdict) : null;
}

// Every sample is asked, even when the rules decided: "model alone" measures the model, "rules +
// model" what the middleware decides (it skips the model when the rules decided).
const modelAlone = process.env.NOTABOT_LLM_ENDPOINT
  ? await Promise.all(samples.map((s) => askModel(featuresOf(s)).catch(() => null)))
  : null;
const withModel = modelAlone
  ? modelAlone.map((m, i) => (m === null ? null : blend(rules[i] as number, m)))
  : null;

function summary(name: string, probs: (number | null)[]) {
  const count = (label: Sample["label"], c: Call) =>
    samples.filter(
      (s, i) => s.label === label && probs[i] != null && call(probs[i] as number) === c,
    ).length;
  const humans = samples.filter((s) => s.label === "human").length;
  const bots = samples.length - humans;
  return `| ${name} | ${count("human", "human")}/${humans} | ${count("human", "unsure")} | ${count("human", "bot")} | ${count("bot", "bot")}/${bots} | ${count("bot", "unsure")} | ${count("bot", "human")} |`;
}

const table = [
  "| Classifier | Humans passed | Humans challenged | Humans refused | Bots refused | Bots challenged | Bots passed |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  summary("Rules alone", rules),
  summary("Logistic regression (leave-one-out)", local),
  ...(modelAlone && withModel
    ? [
        summary(`Model alone (${process.env.NOTABOT_LLM_MODEL ?? "default"})`, modelAlone),
        summary(`Rules + model (${process.env.NOTABOT_LLM_MODEL ?? "default"})`, withModel),
      ]
    : []),
].join("\n");

const detail = samples
  .map(
    (s, i) =>
      `| ${s.id} | ${s.label} | ${(rules[i] as number).toFixed(2)} | ${(local[i] as number).toFixed(2)} |${modelAlone && withModel ? ` ${modelAlone[i]?.toFixed(2) ?? "—"} | ${withModel[i]?.toFixed(2) ?? "—"} |` : ""}`,
  )
  .join("\n");

const profiles = humanProfiles().length;
const realHumans = captured.filter((s) => s.label === "human").length;
const bots = samples.filter((s) => s.label === "bot").length;
const report = `${table}

${samples.length} samples: ${profiles} human profiles built from documented setups, ${realHumans} real browser${realHumans === 1 ? "" : "s"} captured by hand, ${bots} automated browsers captured by \`scripts/capture.ts\`. Bot probability per sample:

| Sample | Label | Rules | Regression |${withModel ? " Model alone | Rules + model |" : ""}
| --- | --- | --- | --- |${withModel ? " --- | --- |" : ""}
${detail}`;

console.log(report);

if (args.includes("--write")) {
  const model: LocalModel = trainLocal(
    samples.map((s) => ({ features: featuresOf(s), bot: s.label === "bot" })),
  );
  // Only the inputs that learned something: the rest weigh zero anyway.
  const kept = model.inputs.map((_, i) => i).filter((i) => model.weights[i] !== 0);
  const compact: LocalModel = {
    ...model,
    inputs: kept.map((i) => model.inputs[i] as string),
    weights: kept.map((i) => model.weights[i] as number),
  };
  await Bun.write("assets/logreg.json", `${JSON.stringify(compact, null, 1)}\n`);
  await Bun.write(
    "src/llm/weights.ts",
    `// Generated by \`bun run bench --write\`: the local regression's weights. Do not edit.\nimport type { LocalModel } from "./local";\n\nexport const LOCAL_MODEL: LocalModel = ${JSON.stringify(compact, null, 1)};\n`,
  );
  const readme = await Bun.file("README.md").text();
  const start = "<!-- bench:start -->";
  const end = "<!-- bench:end -->";
  if (readme.includes(start)) {
    await Bun.write(
      "README.md",
      readme.replace(new RegExp(`${start}[\\s\\S]*?${end}`), `${start}\n${report}\n${end}`),
    );
  }
  console.log("\nwrote assets/logreg.json, src/llm/weights.ts and the README table");
}
