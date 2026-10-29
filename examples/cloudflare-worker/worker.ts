// The server half of notabot as a Cloudflare Worker, on top of notabot/middleware: it signs
// puzzles, checks solutions, re-scores the signals with what only a server sees (headers, IP
// network and time zone, HTTP version), asks a model with its own key, and signs a short-lived
// token for your backend.
//
//   GET  /challenge   → a signed proof-of-work puzzle
//   POST /verify      ← { signals, behavior, solution }  → { token, verdict, bot, flags }
//   POST /siteverify  ← { secret, response }  → { success, verdict, bot, ... }  (reCAPTCHA-like)
//
// Secrets: NOTABOT_HMAC_KEY (signs everything), NOTABOT_SITE_SECRET (your backend's).
// Optional: LLM_ENDPOINT (OpenAI-compatible base URL), LLM_API_KEY, LLM_MODEL,
// ALLOWED_ORIGINS (comma-separated), MAX_NUMBER, BASE_PATH, and a KV namespace NOTABOT_KV to
// refuse replays across isolates.
import { createNotabot, kvStore, type Notabot } from "notabot/middleware";

interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  NOTABOT_HMAC_KEY: string;
  NOTABOT_SITE_SECRET?: string;
  LLM_ENDPOINT?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  ALLOWED_ORIGINS?: string;
  MAX_NUMBER?: string;
  BASE_PATH?: string;
  NOTABOT_KV?: KV;
}

// One instance per isolate and environment, so its in-memory replay store lives across requests.
const instances = new WeakMap<object, Notabot>();

function notabot(env: Env): Notabot {
  let nb = instances.get(env);
  if (nb) return nb;
  const origins = (env.ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== "*");
  nb = createNotabot({
    hmacKey: env.NOTABOT_HMAC_KEY,
    basePath: env.BASE_PATH ?? "",
    allowedOrigins: origins,
    ...(env.NOTABOT_SITE_SECRET ? { siteSecret: env.NOTABOT_SITE_SECRET } : {}),
    ...(Number(env.MAX_NUMBER) ? { maxnumber: Number(env.MAX_NUMBER) } : {}),
    ...(env.NOTABOT_KV ? { store: kvStore(env.NOTABOT_KV) } : {}),
    ...(env.LLM_ENDPOINT
      ? {
          llm: {
            endpoint: env.LLM_ENDPOINT,
            ...(env.LLM_API_KEY ? { apiKey: env.LLM_API_KEY } : {}),
            ...(env.LLM_MODEL ? { model: env.LLM_MODEL } : {}),
          },
        }
      : {}),
  });
  instances.set(env, nb);
  return nb;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.NOTABOT_HMAC_KEY)
      return Response.json({ error: "NOTABOT_HMAC_KEY is not set" }, { status: 500 });
    return (
      (await notabot(env).handle(request)) ?? Response.json({ error: "not found" }, { status: 404 })
    );
  },
};
