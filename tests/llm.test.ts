import { afterAll, describe, expect, test } from "bun:test";
import { classify, classifyLocal, type LlmSettings, trainLocal } from "../src/llm/index";
import { toFeatures } from "../src/llm/prompt";
import { createNotabot } from "../src/middleware/index";
import { type Challenge, encodeSolution, search } from "../src/pow/index";
import { expectedAnswer } from "../src/probes/index";
import { score } from "../src/score/index";
import { chromeHeaders } from "./browser-headers";
import { headlessChromium, realChrome } from "./fixtures";
import { humanProfiles } from "./profiles";

/** An OpenAI-compatible server whose behaviour each test sets. */
let respond: (body: Record<string, unknown>) => Response | Promise<Response> = () =>
  new Response(null, { status: 500 });
const requests: Record<string, unknown>[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = (await req.json()) as Record<string, unknown>;
    requests.push(body);
    return respond(body);
  },
});
afterAll(() => server.stop());

const completion = (content: string) =>
  Response.json({
    id: "x",
    object: "chat.completion",
    created: 1,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });

const openai = (model: string): LlmSettings => ({
  apiKey: "sk-test",
  model,
  providerId: "openai",
  providerNpm: "@ai-sdk/openai",
  providerApi: `http://localhost:${server.port}/v1`,
});

describe("classify", () => {
  test("asks for the verdict's schema where the provider supports it", async () => {
    requests.length = 0;
    respond = () => completion('{"reasons":["webdriver"],"verdict":"bot","confidence":0.9}');
    const result = await classify(openai("structured"), { webdriver: true });
    expect(result).toMatchObject({ structured: true, cached: false });
    expect(result.verdict).toEqual({ verdict: "bot", confidence: 0.9, reasons: ["webdriver"] });
    expect(requests[0]?.response_format).toMatchObject({ type: "json_schema" });
  });

  test("falls back to text, reasoning dropped, when the schema is refused", async () => {
    requests.length = 0;
    respond = (body) =>
      body.response_format
        ? Response.json({ error: { message: "response_format unsupported" } }, { status: 400 })
        : completion(
            '<think>{"verdict":"human"}</think>{"reasons":["iframe disagrees"],"verdict":"bot","confidence":0.7}',
          );
    const result = await classify(openai("text-only"), { iframe_mismatches: 1 });
    expect(result.structured).toBe(false);
    expect(result.verdict?.verdict).toBe("bot");
    expect(requests).toHaveLength(2);
  });

  test("an identical question is answered from the cache", async () => {
    requests.length = 0;
    respond = () => completion('{"reasons":[],"verdict":"human","confidence":0.6}');
    await classify(openai("cached"), { cores: 8 });
    const again = await classify(openai("cached"), { cores: 8 });
    expect(again.cached).toBe(true);
    expect(requests).toHaveLength(1);
  });

  test("gives up after the timeout", async () => {
    respond = async () => {
      await Bun.sleep(1500);
      return completion('{"verdict":"human"}');
    };
    await expect(classify(openai("slow"), { cores: 2 }, { timeoutMs: 200 })).rejects.toThrow();
  });
});

describe("the server's model", () => {
  test("JSON mode, temperature 0, bounded tokens, and not asked when the rules decided", async () => {
    requests.length = 0;
    respond = () => completion('{"reasons":["software GPU"],"verdict":"bot","confidence":1}');
    const nb = createNotabot({
      hmacKey: "k",
      maxnumber: 500,
      llm: { endpoint: `http://localhost:${server.port}/v1`, model: "m" },
    });
    const post = async (signals: unknown) => {
      const c = (await (
        await nb.handle(
          new Request("https://site.dev/notabot/challenge", {
            headers: chromeHeaders(realChrome().env.userAgent),
          }),
          { ip: "203.0.113.9" },
        )
      )?.json()) as Challenge;
      const solution = encodeSolution({ ...c, number: (await search(c)) as number, took: 1 });
      const probes = (c.probes ?? []).map(expectedAnswer);
      const res = await nb.handle(
        new Request("https://site.dev/notabot/verify", {
          method: "POST",
          headers: {
            ...chromeHeaders(realChrome().env.userAgent),
            "content-type": "application/json",
          },
          body: JSON.stringify({ signals, solution, probes }),
        }),
        { ip: "203.0.113.9" },
      );
      return (await res?.json()) as { verdict: string; model: boolean };
    };
    // A clean Chrome: the rules decided, the model is not asked.
    expect(await post(realChrome())).toMatchObject({ verdict: "human", model: false });
    expect(requests).toHaveLength(0);
    // A software GPU alone (0.45): the model is asked, and its confident "bot" counts.
    const doubtful = realChrome();
    doubtful.automation.softwareRenderer = true;
    const answer = await post(doubtful);
    expect(answer.model).toBe(true);
    expect(requests[0]).toMatchObject({
      temperature: 0,
      max_tokens: 1200,
      response_format: { type: "json_schema", json_schema: { name: "verdict", strict: true } },
    });
    expect(answer.verdict).not.toBe("human");
  });
});

describe("the server's model on APIs that refuse parts of the request", () => {
  test("no temperature, then no response_format: it still answers", async () => {
    // What Anthropic's OpenAI-compatible API does with recent Claude models.
    requests.length = 0;
    respond = (body) =>
      body.temperature !== undefined
        ? Response.json({ error: { message: "temperature is deprecated" } }, { status: 400 })
        : (body.response_format as { type?: string } | undefined)?.type === "json_schema"
          ? completion('{"reasons":["software GPU"],"verdict":"bot","confidence":0.9}')
          : Response.json({ error: { message: "unexpected" } }, { status: 500 });
    const nb = createNotabot({
      hmacKey: "k",
      maxnumber: 300,
      llm: { endpoint: `http://localhost:${server.port}/v1`, model: "claude" },
    });
    const headers = chromeHeaders(realChrome().env.userAgent);
    const c = (await (
      await nb.handle(new Request("https://site.dev/notabot/challenge", { headers }), {
        ip: "203.0.113.10",
      })
    )?.json()) as Challenge;
    const doubtful = realChrome();
    doubtful.automation.softwareRenderer = true;
    const res = await nb.handle(
      new Request("https://site.dev/notabot/verify", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          signals: doubtful,
          solution: encodeSolution({ ...c, number: (await search(c)) as number, took: 1 }),
          probes: (c.probes ?? []).map(expectedAnswer),
        }),
      }),
      { ip: "203.0.113.10" },
    );
    expect(((await (res as Response).json()) as { model: boolean }).model).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.temperature).toBeUndefined();
  });
});

describe("local regression", () => {
  const samples = [
    ...humanProfiles().map((p) => ({
      features: toFeatures(
        p.signals,
        score({ signals: p.signals, behavior: p.behavior }),
        p.behavior,
      ),
      bot: false,
    })),
    ...[headlessChromium()].map((s) => ({
      features: toFeatures(s, score({ signals: s })),
      bot: true,
    })),
  ];

  test("training is deterministic and learns the obvious", () => {
    const a = trainLocal(samples);
    const b = trainLocal(samples);
    expect(a.weights).toEqual(b.weights);
    expect(a.trainedOn).toMatchObject({ humans: humanProfiles().length, bots: 1 });
    const bot = classifyLocal(samples.at(-1)?.features ?? {}, a);
    const human = classifyLocal(samples[0]?.features ?? {}, a);
    expect(bot.bot).toBeGreaterThan(human.bot);
    expect(bot.verdict.reasons.length).toBeGreaterThan(0);
  });

  test("the shipped weights load and answer without a key or a network", () => {
    const s = headlessChromium();
    const out = classifyLocal(toFeatures(s, score({ signals: s })));
    expect(out.bot).toBeGreaterThan(0.5);
    expect(["human", "unsure", "bot"]).toContain(out.verdict.verdict);
  });
});
