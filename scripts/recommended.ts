// Writes assets/recommended.json: for each provider the demo suggests, the newest small, cheap
// model (llm-models' "fast" tier), the right size to score a feature vector. `bun run recommended`.
import { latestModels } from "llm-models";

const PROVIDERS: { id: string; filter?: string }[] = [
  { id: "openrouter" },
  { id: "groq" },
  { id: "openai" },
  { id: "anthropic" },
  { id: "google" },
  { id: "mistral", filter: "ministral" },
];

const out: { provider: string; model: string; name: string; costInput: number | null }[] = [];
for (const p of PROVIDERS) {
  try {
    const result = await latestModels({
      provider: p.id,
      ...(p.filter ? { filter: p.filter } : {}),
    });
    const pick = result?.picks.find((x) => x.tier === "haiku") ?? result?.picks.at(-1);
    if (!pick) continue;
    const model = pick.model as { id: string; name?: string; cost?: { input?: number } };
    // Catalog model ids are "provider/model"; the settings store wants the provider's own id.
    const id = model.id.startsWith(`${p.id}/`) ? model.id.slice(p.id.length + 1) : model.id;
    out.push({
      provider: p.id,
      model: id,
      name: model.name ?? id,
      costInput: model.cost?.input ?? null,
    });
  } catch (e) {
    console.warn(`${p.id}: ${e instanceof Error ? e.message : e}`);
  }
}
if (!out.length) throw new Error("no recommendation: keeping the committed file");
await Bun.write("assets/recommended.json", `${JSON.stringify(out, null, 2)}\n`);
console.log(out.map((m) => `${m.provider}: ${m.model}`).join("\n"));
