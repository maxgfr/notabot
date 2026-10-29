// Serves dist/site under /notabot/, as GitHub Pages does, plus examples/host at the root, a fake
// OpenAI-compatible endpoint at /mock/v1, the example Worker at /worker/ (key "dev"), and
// /protected, a route gated by notabot/middleware with the same key.
// PORT=4174 by default.
import { createNotabot } from "../src/middleware/index";
import { mockLlm } from "./mock-llm";

const port = Number(process.env.PORT ?? 4174);
const workerPath = "../examples/cloudflare-worker/worker.ts";
const worker = (await import(workerPath)).default as {
  fetch(req: Request, env: Record<string, string>): Promise<Response>;
};
const workerEnv = {
  NOTABOT_HMAC_KEY: "dev",
  NOTABOT_SITE_SECRET: "dev-secret",
  MAX_NUMBER: "20000",
  BASE_PATH: "/worker",
};

const guard = createNotabot({ hmacKey: "dev", basePath: "/worker" });
const protectedRoute = guard.protect(() => Response.json({ ok: true, message: "welcome" }));

const SITE_HEADERS = {
  "access-control-allow-origin": "*",
  "cache-control": "no-store",
};

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/mock/v1/")) return mockLlm(req, url.pathname);
    if (url.pathname.startsWith("/worker/")) return worker.fetch(req, workerEnv);
    if (url.pathname === "/protected") return protectedRoute(req);
    if (!url.pathname.startsWith("/notabot/")) {
      if (url.pathname === "/") return Response.redirect("/notabot/", 302);
      const file = Bun.file(`examples/host${url.pathname}`);
      if (await file.exists()) return new Response(file);
      return new Response("Not found", { status: 404 });
    }
    let path = `dist/site/${decodeURIComponent(url.pathname.slice("/notabot/".length))}`;
    if (path.endsWith("/")) path += "index.html";
    const file = Bun.file(path);
    if (await file.exists()) return new Response(file, { headers: SITE_HEADERS });
    return new Response("Not found", { status: 404 });
  },
});
console.log(`http://localhost:${port}/notabot/`);
