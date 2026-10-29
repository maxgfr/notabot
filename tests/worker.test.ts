import { describe, expect, test } from "bun:test";
import worker from "../examples/cloudflare-worker/worker";
import type { Challenge } from "../src/pow/index";
import { encodeSolution, search } from "../src/pow/index";
import { chromeHeaders } from "./browser-headers";
import { headlessChromium, realChrome } from "./fixtures";

const env = { NOTABOT_HMAC_KEY: "k", NOTABOT_SITE_SECRET: "s", MAX_NUMBER: "1500" };
const call = (path: string, init?: RequestInit, headers: Record<string, string> = {}) =>
  worker.fetch(
    new Request(`https://w.dev${path}`, {
      ...init,
      headers: {
        origin: "https://site.dev",
        ...headers,
        ...(init?.headers as Record<string, string>),
      },
    }),
    env,
  );

async function solved(): Promise<string> {
  const c = (await (await call("/challenge")).json()) as Challenge;
  const number = (await search(c)) as number;
  return encodeSolution({
    algorithm: c.algorithm,
    challenge: c.challenge,
    salt: c.salt,
    signature: c.signature,
    number,
    took: 1,
  });
}

describe("example Cloudflare Worker", () => {
  test("a human passes, signs a token, and siteverify accepts it once", async () => {
    const signals = realChrome();
    const res = await call(
      "/verify",
      { method: "POST", body: JSON.stringify({ signals, solution: await solved() }) },
      chromeHeaders(signals.env.userAgent),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; verdict: string };
    expect(body.verdict).toBe("human");
    const check = (secret: string) =>
      call("/siteverify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret, response: body.token }),
      });
    expect(await (await check("wrong")).json()).toMatchObject({
      success: false,
      "error-codes": ["invalid-input-secret"],
    });
    expect(await (await check("s")).json()).toMatchObject({
      success: true,
      verdict: "human",
      hostname: "site.dev",
    });
    expect(await (await check("s")).json()).toMatchObject({
      success: false,
      "error-codes": ["timeout-or-duplicate"],
    });
  });

  test("a headless browser is refused, and a user agent header that differs is flagged", async () => {
    const signals = headlessChromium();
    const res = await call(
      "/verify",
      { method: "POST", body: JSON.stringify({ signals, solution: await solved() }) },
      { "user-agent": "python-requests/2.32" },
    );
    const body = (await res.json()) as { verdict: string; flags: string[] };
    expect(body.verdict).toBe("bot");
    expect(body.flags).toContain("server-user-agent");
  });

  test("a replayed or forged proof of work is refused", async () => {
    const solution = await solved();
    const post = () =>
      call("/verify", {
        method: "POST",
        body: JSON.stringify({ signals: realChrome(), solution }),
      });
    expect((await post()).status).toBe(200);
    const again = await post();
    expect(again.status).toBe(403);
    expect(await again.json()).toEqual({ error: "proof of work: replayed", reason: "replayed" });
    const forged = await call("/verify", {
      method: "POST",
      body: JSON.stringify({ signals: realChrome(), solution: `${solution.slice(0, -4)}AAAA` }),
    });
    expect(forged.status).toBe(403);
  });

  test("CORS follows ALLOWED_ORIGINS", async () => {
    const res = await worker.fetch(
      new Request("https://w.dev/challenge", { headers: { origin: "https://evil.dev" } }),
      { ...env, ALLOWED_ORIGINS: "https://site.dev" },
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
