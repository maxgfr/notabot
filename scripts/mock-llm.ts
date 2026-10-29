// A fake OpenAI-compatible endpoint for local tests and e2e: answers a verdict that follows the
// features it was given, and keeps the last prompt at /mock/v1/last. Never used by the site.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

let last: unknown = null;

export async function mockLlm(req: Request, path: string): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (path.endsWith("/last")) return Response.json(last, { headers: CORS });
  if (path.endsWith("/models"))
    return Response.json(
      { object: "list", data: [{ id: "mock", object: "model" }] },
      { headers: CORS },
    );
  const body = (await req.json()) as {
    model?: string;
    stream?: boolean;
    messages?: { role: string; content: unknown }[];
  };
  last = body;
  if (body.model === "fail-401")
    return Response.json(
      { error: { message: "Incorrect API key provided.", code: "invalid_api_key" } },
      { status: 401, headers: CORS },
    );
  const user = JSON.stringify(body.messages?.at(-1)?.content ?? "");
  const bot = /\\"webdriver\\": true|\\"headless_user_agent\\": true/.test(user);
  const answer =
    body.model === "garbage"
      ? "I think this is a human, probably."
      : JSON.stringify({
          verdict: bot ? "bot" : "human",
          confidence: 0.8,
          reasons: bot ? ["webdriver is true"] : ["features consistent"],
        });
  return Response.json(
    {
      id: "mock-1",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: body.model ?? "mock",
      choices: [
        { index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    },
    { headers: CORS },
  );
}
