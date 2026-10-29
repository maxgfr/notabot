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

/** Dollars per million input tokens above which a model is too dear to score every visitor. */
const MAX_COST_INPUT = 1;

interface CatalogModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  cost?: { input?: number };
}

/**
 * Fit to score a feature vector: answers in a schema (structured output, or tool calls the SDK
 * uses for it), does not think aloud first (slow, and the verdict hides behind the reasoning),
 * and costs little.
 */
function fit(model: CatalogModel): boolean {
  if (model.reasoning === true) return false;
  if (model.structured_output === false) return false;
  if (model.structured_output !== true && model.tool_call !== true) return false;
  const cost = model.cost?.input;
  return cost === undefined || cost <= MAX_COST_INPUT;
}

// The committed catalog says which models reason and which call tools; the picks do not.
const catalog = (await Bun.file("assets/models.json").json()) as Record<
  string,
  { models?: Record<string, CatalogModel> }
>;
const described = (provider: string, model: CatalogModel): CatalogModel => {
  const id = model.id.startsWith(`${provider}/`) ? model.id.slice(provider.length + 1) : model.id;
  return { ...catalog[provider]?.models?.[id], ...model };
};

type Pick = { provider: string; model: string; name: string; costInput: number | null };
const committed = (await Bun.file("assets/recommended.json").json()) as Pick[];
const out: Pick[] = [];
for (const p of PROVIDERS) {
  try {
    const result = await latestModels({
      provider: p.id,
      ...(p.filter ? { filter: p.filter } : {}),
    });
    const picks = (result?.picks ?? []).filter((x) =>
      fit(described(p.id, x.model as CatalogModel)),
    );
    const pick = picks.find((x) => x.tier === "haiku") ?? picks.at(-1);
    if (!pick) {
      // Nothing fits today: keep the committed recommendation rather than drop the provider.
      const kept = committed.find((c) => c.provider === p.id);
      console.warn(`${p.id}: no small model fits${kept ? `, keeping ${kept.model}` : ""}`);
      if (kept) out.push(kept);
      continue;
    }
    const model = pick.model as CatalogModel;
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
