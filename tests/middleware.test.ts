import { describe, expect, test } from "bun:test";
import {
  createNotabot,
  type Decision,
  infoFromNode,
  infoFromRequest,
  memoryStore,
  type NodeRequestLike,
  notabotExpress,
  notabotHono,
  requestFlags,
} from "../src/middleware/index";
import { type Challenge, encodeSolution, search } from "../src/pow/index";
import { chromeHeaders } from "./browser-headers";
import { headlessChromium, realChrome } from "./fixtures";

const UA = realChrome().env.userAgent;
const req = (path: string, headers: Record<string, string>, init: RequestInit = {}) =>
  new Request(`https://site.dev${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string>) },
  });
const ids = (flags: { id: string }[]) => flags.map((f) => f.id);

/** Runs the page's side against `nb`: puzzle, solve, post signals, get a token. */
async function obtainToken(
  nb: ReturnType<typeof createNotabot>,
  headers: Record<string, string>,
  ip = "203.0.113.7",
) {
  const challenge = (await (
    await nb.handle(req("/notabot/challenge", headers), { ip })
  )?.json()) as Challenge;
  const number = (await search(challenge)) as number;
  const solution = encodeSolution({ ...challenge, number, took: 1 });
  const res = await nb.handle(
    req("/notabot/verify", headers, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signals: realChrome(), solution }),
    }),
    { ip },
  );
  return (await res?.json()) as { token: string; verdict: string; flags: string[] };
}

describe("request analysis", () => {
  test("a real Chrome request raises nothing", () => {
    expect(requestFlags(infoFromRequest(req("/", chromeHeaders(UA))))).toEqual([]);
  });

  test("HTTP libraries name themselves", () => {
    for (const ua of [
      "curl/8.7.1",
      "python-requests/2.32.3",
      "Go-http-client/2.0",
      "axios/1.7.2",
      "Scrapy/2.11",
    ]) {
      expect(ids(requestFlags(infoFromRequest(req("/", { "user-agent": ua }))))).toContain(
        "http-library",
      );
    }
    expect(ids(requestFlags(infoFromRequest(req("/", {}))))).toContain("missing-user-agent");
  });

  test("a Chrome user agent replayed by a script, without the headers Chrome sends", () => {
    const flags = ids(requestFlags(infoFromRequest(req("/", { "user-agent": UA }))));
    expect(flags).toEqual(
      expect.arrayContaining([
        "missing-accept-language",
        "missing-accept",
        "missing-accept-encoding",
        "chromium-without-client-hints",
        "missing-fetch-metadata",
      ]),
    );
  });

  test("client hints that contradict the user agent", () => {
    const flags = ids(
      requestFlags(
        infoFromRequest(
          req(
            "/",
            chromeHeaders(UA, {
              "sec-ch-ua-platform": '"Windows"',
              "sec-ch-ua-mobile": "?1",
              "sec-ch-ua": '"HeadlessChrome";v="142"',
            }),
          ),
        ),
      ),
    );
    expect(flags).toEqual(
      expect.arrayContaining([
        "client-hints-platform-mismatch",
        "client-hints-mobile-mismatch",
        "headless-client-hint",
      ]),
    );
  });

  test("a User-Agent overridden without its sec-ch-ua", () => {
    const flagsOf = (secChUa: string) =>
      ids(requestFlags(infoFromRequest(req("/", chromeHeaders(UA, { "sec-ch-ua": secChUa })))));
    const v = /Chrome\/(\d+)/.exec(UA)?.[1];
    expect(flagsOf(`"Chromium";v="${Number(v) + 14}", "Not_A Brand";v="99"`)).toContain(
      "client-hints-version-mismatch",
    );
    expect(flagsOf(`"Chromium";v="${v}", "Google Chrome";v="${v}"`)).not.toContain(
      "client-hints-version-mismatch",
    );
  });

  test("protocol and network, when the platform reports them", () => {
    const info = infoFromRequest(req("/", chromeHeaders(UA)), {
      httpVersion: "1.1",
      network: { asOrganization: "Amazon.com, Inc." },
    });
    expect(ids(requestFlags(info))).toEqual(["http1-chromium", "hosting-network"]);
  });
});

describe("token lifecycle", () => {
  test("a human gets a token that opens a protected request once, from the same browser only", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500 });
    const headers = chromeHeaders(UA);
    const issued = await obtainToken(nb, headers);
    expect(issued.verdict).toBe("human");
    const info = infoFromRequest(req("/signup", headers), { ip: "203.0.113.7" });
    const first = await nb.verifyRequest(info, issued.token);
    expect(first).toMatchObject({ ok: true, reason: "accepted", verdict: "human" });
    expect((await nb.verifyRequest(info, issued.token)).reason).toBe("replayed-token");
  });

  test("a token is bound to its user agent and IP", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500 });
    const issued = await obtainToken(nb, chromeHeaders(UA));
    const otherUa = infoFromRequest(req("/x", chromeHeaders(UA.replace("142", "141"))), {
      ip: "203.0.113.7",
    });
    expect((await nb.verifyRequest(otherUa, issued.token)).reason).toBe("token-mismatch");
    const otherIp = infoFromRequest(req("/x", chromeHeaders(UA)), { ip: "198.51.100.9" });
    expect((await nb.verifyRequest(otherIp, issued.token)).reason).toBe("token-mismatch");
  });

  test("a headless browser's submission is signed as a bot, and the gate refuses it", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500 });
    const challenge = (await (
      await nb.handle(req("/notabot/challenge", { "user-agent": "python-requests/2.32" }))
    )?.json()) as Challenge;
    const solution = encodeSolution({
      ...challenge,
      number: (await search(challenge)) as number,
      took: 1,
    });
    const res = await nb.handle(
      req(
        "/notabot/verify",
        { "user-agent": "python-requests/2.32", "content-type": "application/json" },
        {
          method: "POST",
          body: JSON.stringify({ signals: headlessChromium(), solution }),
        },
      ),
    );
    const body = (await res?.json()) as { token: string; verdict: string; flags: string[] };
    expect(body.verdict).toBe("bot");
    expect(body.flags).toEqual(
      expect.arrayContaining(["webdriver", "http-library", "server-user-agent"]),
    );
    const decision = await nb.verifyRequest(
      infoFromRequest(req("/x", { "user-agent": "python-requests/2.32" })),
      body.token,
    );
    expect(decision).toMatchObject({ ok: false, reason: "verdict", verdict: "bot" });
  });

  test("missing, forged, expired and unsigned tokens", async () => {
    const nb = createNotabot({ hmacKey: "k" });
    const info = infoFromRequest(req("/x", chromeHeaders(UA)));
    expect((await nb.verifyRequest(info, null)).reason).toBe("missing-token");
    expect((await nb.verifyRequest(info, "abc.def")).reason).toBe("bad-token");
    const unsignedAt = (iat: number) =>
      `unsigned.${btoa(JSON.stringify({ v: 1, verdict: "human", bot: 0.1, iat })).replace(/=+$/, "")}`;
    const unsigned = unsignedAt(Math.floor(Date.now() / 1000));
    expect((await nb.verifyRequest(info, unsigned)).reason).toBe("unsigned-token");
    const dev = createNotabot({ hmacKey: "k", allowUnsigned: true });
    expect(await dev.verifyRequest(info, unsigned)).toMatchObject({ ok: true, verdict: "human" });
    expect((await dev.verifyRequest(info, unsignedAt(1))).reason).toBe("expired-token");
    const shortLived = createNotabot({ hmacKey: "k", tokenTtl: -10, maxnumber: 1500 });
    const issued = await obtainToken(shortLived, chromeHeaders(UA));
    expect((await shortLived.verifyRequest(info, issued.token)).reason).toBe("expired-token");
  });

  test("without a required token, the request is scored alone", async () => {
    const nb = createNotabot({ hmacKey: "k", requireToken: false });
    expect((await nb.verifyRequest(infoFromRequest(req("/", chromeHeaders(UA))))).ok).toBe(true);
    expect(
      await nb.verifyRequest(infoFromRequest(req("/", { "user-agent": "curl/8" }))),
    ).toMatchObject({ ok: false, verdict: "bot" });
  });

  test("origins outside the allow-list are refused", async () => {
    const nb = createNotabot({
      hmacKey: "k",
      allowedOrigins: ["https://site.dev"],
      requireToken: false,
    });
    const evil = infoFromRequest(req("/", chromeHeaders(UA, { origin: "https://evil.dev" })));
    expect((await nb.verifyRequest(evil)).reason).toBe("wrong-origin");
  });

  test("a burst from one IP is flagged", async () => {
    const nb = createNotabot({
      hmacKey: "k",
      requireToken: false,
      ratePerMinute: 3,
      store: memoryStore(),
    });
    const info = infoFromRequest(req("/", chromeHeaders(UA)), { ip: "192.0.2.1" });
    for (let i = 0; i < 3; i++)
      expect(ids((await nb.analyzeRequest(info)).flags)).not.toContain("rate");
    expect(ids((await nb.analyzeRequest(info)).flags)).toContain("rate");
  });
});

describe("adapters", () => {
  test("protect() wraps a Fetch handler and serves the endpoints", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500 });
    const handler = nb.protect(() => new Response("welcome"));
    const refused = await handler(req("/signup", chromeHeaders(UA)));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "notabot", reason: "missing-token" });
    expect((await handler(req("/notabot/challenge", chromeHeaders(UA)))).status).toBe(200);
    const { token } = await obtainToken(nb, chromeHeaders(UA), "");
    const form = new FormData();
    form.set("notabot-token", token);
    const ok = await handler(req("/signup", chromeHeaders(UA), { method: "POST", body: form }));
    expect(await ok.text()).toBe("welcome");
  });

  test("Express: endpoints, gate and req.notabot", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500 });
    const middleware = notabotExpress(nb);
    const run = (r: NodeRequestLike) =>
      new Promise<{ status: number; body: string; next: boolean }>((resolve) => {
        const res = {
          statusCode: 200,
          headers: {} as Record<string, string>,
          setHeader(n: string, v: string) {
            this.headers[n] = v;
          },
          end(body?: string | Uint8Array) {
            resolve({
              status: this.statusCode,
              body: typeof body === "string" ? body : new TextDecoder().decode(body),
              next: false,
            });
          },
        };
        void middleware(r, res, () => resolve({ status: 0, body: "", next: true }));
      });
    const headers = { ...chromeHeaders(UA), host: "site.dev" };
    const challenge = await run({
      method: "GET",
      url: "/notabot/challenge",
      headers,
      protocol: "https",
    });
    expect(challenge.status).toBe(200);
    expect(JSON.parse(challenge.body).algorithm).toBe("SHA-256");
    const blocked = await run({
      method: "POST",
      url: "/signup",
      headers,
      protocol: "https",
      body: {},
    });
    expect(blocked.status).toBe(403);
    const { token } = await obtainToken(nb, chromeHeaders(UA), "203.0.113.7");
    const request: NodeRequestLike = {
      method: "POST",
      url: "/signup",
      headers,
      protocol: "https",
      ip: "203.0.113.7",
      body: { "notabot-token": token },
    };
    expect((await run(request)).next).toBe(true);
    expect((request.notabot as Decision).verdict).toBe("human");
    expect(infoFromNode(request).url).toBe("https://site.dev/signup");
  });

  test("Hono: the decision lands in the context", async () => {
    const nb = createNotabot({ hmacKey: "k", requireToken: false });
    const middleware = notabotHono(nb);
    let stored: Decision | null = null;
    const context = (r: Request) => ({
      req: { raw: r, header: (n: string) => r.headers.get(n) ?? undefined },
      set: (_: "notabot", v: Decision) => {
        stored = v;
      },
    });
    let reached = false;
    expect(
      await middleware(context(req("/", chromeHeaders(UA))), async () => {
        reached = true;
      }),
    ).toBeUndefined();
    expect(reached).toBe(true);
    expect(stored).toMatchObject({ ok: true });
    const refused = await middleware(context(req("/", { "user-agent": "curl/8" })), async () => {});
    expect(refused?.status).toBe(403);
  });
});
