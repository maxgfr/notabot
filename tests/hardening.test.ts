import { describe, expect, test } from "bun:test";
import type { PointerSample } from "../src/behavior/index";
import {
  clientIp,
  createNotabot,
  infoFromNode,
  infoFromRequest,
  memoryStore,
  type NodeRequestLike,
  notabotExpress,
  type RedisLike,
  type ReplayStore,
  redisStore,
} from "../src/middleware/index";
import { type Challenge, encodeSolution, search } from "../src/pow/index";
import type { NotabotSignals } from "../src/signals/types";
import { chromeHeaders } from "./browser-headers";
import { realChrome } from "./fixtures";

const UA = realChrome().env.userAgent;
const IP = "203.0.113.7";
const req = (path: string, headers: Record<string, string>, init: RequestInit = {}) =>
  new Request(`https://site.dev${path}`, { ...init, headers });

type Nb = ReturnType<typeof createNotabot>;

async function solution(nb: Nb, headers = chromeHeaders(UA), ip: string | null = IP) {
  const c = (await (
    await nb.handle(req("/notabot/challenge", headers), { ip })
  )?.json()) as Challenge;
  return encodeSolution({ ...c, number: (await search(c)) as number, took: 1 });
}

async function post(
  nb: Nb,
  route: string,
  body: unknown,
  headers: Record<string, string> = chromeHeaders(UA),
  ip: string | null = IP,
) {
  const res = (await nb.handle(
    req(
      `/notabot/${route}`,
      { ...headers, "content-type": "application/json" },
      {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
    ),
    { ip },
  )) as Response;
  return {
    status: res.status,
    headers: res.headers,
    body: (await res.json()) as Record<string, unknown>,
  };
}

async function verified(nb: Nb, signals: NotabotSignals = realChrome()) {
  return post(nb, "verify", { signals, solution: await solution(nb) });
}

/** Signals that land between the thresholds: a software renderer on an otherwise real Chrome. */
function doubtful(): NotabotSignals {
  const s = realChrome();
  s.automation.softwareRenderer = true;
  return s;
}

/** A hand's drag along the track, ending at `endPercent` of a 300 px track starting at x = 100. */
function drag(endPercent: number): PointerSample[] {
  const samples: PointerSample[] = [];
  const end = 100 + (300 * endPercent) / 100;
  for (let i = 0; i <= 30; i++) {
    const p = i / 30;
    const eased = p * p * (3 - 2 * p);
    samples.push({
      x: 100 + (end - 100) * eased + (i === 30 ? 0 : Math.sin(i * 1.7) * 2),
      y: 200 + Math.sin(i * 0.9) * 3,
      t: i * 22 + (i % 3) * 5,
      trusted: true,
      coalesced: 2,
      pressure: 0.5,
      type: "pointermove",
    });
  }
  return samples;
}

function robotDrag(endPercent: number): PointerSample[] {
  const end = 100 + (300 * endPercent) / 100;
  return Array.from({ length: 30 }, (_, i) => ({
    x: 100 + ((end - 100) * i) / 29,
    y: 200,
    t: i * 16,
    trusted: true,
    coalesced: 1,
    pressure: 0,
    type: "pointermove",
  }));
}

describe("trusted client IP", () => {
  test("forwarding headers are ignored unless a proxy is trusted", () => {
    const forged = req("/", {
      "cf-connecting-ip": "1.1.1.1",
      "x-forwarded-for": "2.2.2.2, 3.3.3.3",
    });
    expect(infoFromRequest(forged).ip).toBeNull();
    expect(clientIp(forged, "cloudflare")).toBe("1.1.1.1");
    expect(clientIp(forged, "x-forwarded-for")).toBe("3.3.3.3");
    // Cloudflare itself sets request.cf and overwrites cf-connecting-ip.
    const onWorker = Object.assign(forged.clone(), { cf: { asn: 1 } });
    expect(infoFromRequest(onWorker).ip).toBe("1.1.1.1");
    expect(infoFromRequest(forged, {}, { getIp: () => "4.4.4.4" }).ip).toBe("4.4.4.4");
    const node: NodeRequestLike = {
      headers: { "x-forwarded-for": "2.2.2.2" },
      socket: { remoteAddress: "10.0.0.1" },
    };
    expect(infoFromNode(node).ip).toBe("10.0.0.1");
    expect(infoFromNode(node, "x-forwarded-for").ip).toBe("2.2.2.2");
  });

  test("a token bound to an IP is refused when the IP is unknown", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500 });
    const { body } = await verified(nb);
    const unknown = infoFromRequest(req("/x", chromeHeaders(UA)));
    expect((await nb.verifyRequest(unknown, body.token as string)).reason).toBe("token-mismatch");
    const known = infoFromRequest(req("/x", chromeHeaders(UA)), { ip: IP });
    expect((await nb.verifyRequest(known, body.token as string)).ok).toBe(true);
  });
});

describe("stores", () => {
  test("memoryStore counts in O(1), expires, and drops the oldest keys past its cap", async () => {
    const store = memoryStore({ max: 3 });
    expect(await store.incr?.("a", 60)).toBe(1);
    expect(await store.incr?.("a", 60)).toBe(2);
    expect(await store.incr?.("gone", -1)).toBe(1);
    expect(await store.incr?.("gone", 60)).toBe(1);
    expect(await store.claim("b", 60)).toBe(true);
    expect(await store.claim("b", 60)).toBe(false);
    await store.claim("c", 60);
    await store.claim("d", 60);
    // "a" was the least recently written: dropped.
    expect(await store.incr?.("a", 60)).toBe(1);
  });

  test("redisStore claims with SET NX EX and counts with INCR", async () => {
    const data = new Map<string, string>();
    const ttls = new Map<string, number>();
    const redis: RedisLike = {
      async set(k, v, o) {
        if (o.NX && data.has(k)) return null;
        data.set(k, v);
        ttls.set(k, o.EX);
        return "OK";
      },
      async incr(k) {
        const n = Number(data.get(k) ?? 0) + 1;
        data.set(k, String(n));
        return n;
      },
      async expire(k, s) {
        ttls.set(k, s);
        return 1;
      },
    };
    const store = redisStore(redis);
    expect(await store.claim("t", 30)).toBe(true);
    expect(await store.claim("t", 30)).toBe(false);
    expect(ttls.get("t")).toBe(30);
    expect(await store.incr?.("n", 120)).toBe(1);
    expect(await store.incr?.("n", 120)).toBe(2);
    expect(ttls.get("n")).toBe(120);
  });

  test("a token replayed concurrently opens the gate once", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500 });
    const { body } = await verified(nb);
    const info = infoFromRequest(req("/x", chromeHeaders(UA)), { ip: IP });
    const all = await Promise.all(
      Array.from({ length: 8 }, () => nb.verifyRequest(info, body.token as string)),
    );
    expect(all.filter((d) => d.ok)).toHaveLength(1);
  });

  test("a store without incr still rate-limits through claims", async () => {
    const plain = memoryStore();
    const legacy: ReplayStore = { claim: (k, t) => plain.claim(k, t) };
    const nb = createNotabot({
      hmacKey: "k",
      requireToken: false,
      ratePerMinute: 2,
      store: legacy,
    });
    const info = infoFromRequest(req("/", chromeHeaders(UA)), { ip: IP });
    const rate = async () => (await nb.analyzeRequest(info)).flags.some((f) => f.id === "rate");
    expect([await rate(), await rate(), await rate()]).toEqual([false, false, true]);
  });
});

describe("/verify", () => {
  test("malformed signals are a 400, never a 500", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500 });
    const bad = realChrome() as unknown as { env: Record<string, unknown> };
    bad.env.languages = "fr";
    for (const body of ["{", { signals: bad, solution: await solution(nb) }, { signals: {} }, null])
      expect((await post(nb, "verify", body)).status).toBe(400);
    const behavior = { signals: realChrome(), solution: await solution(nb), behavior: { x: "1" } };
    expect((await post(nb, "verify", behavior)).status).toBe(400);
  });

  test("a body past the cap is a 413; a store that throws is a JSON 500", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500, maxBodyBytes: 1024 });
    expect((await verified(nb)).status).toBe(413);
    const broken = createNotabot({
      hmacKey: "k",
      maxnumber: 1500,
      store: { claim: () => Promise.reject(new Error("down")) },
    });
    const res = await verified(broken);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal error" });
  });

  test("the same signals blob posted again and again is refused", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 500 });
    const signals = realChrome();
    for (let i = 0; i < 5; i++) expect((await verified(nb, signals)).status).toBe(200);
    expect(await verified(nb, signals)).toMatchObject({
      status: 429,
      body: { reason: "replayed" },
    });
  });

  test("returns the token's expiry, and the slider zone when unsure", async () => {
    const nb = createNotabot({
      hmacKey: "k",
      maxnumber: 1500,
      tokenTtl: 120,
      visibleChallenges: ["slide"],
    });
    const { body } = await verified(nb);
    expect(body.exp).toBeGreaterThan(Date.now() / 1000 + 100);
    expect(body.zone).toBeUndefined();
    const unsure = await verified(nb, doubtful());
    expect(unsure.body.verdict).toBe("unsure");
    expect(unsure.body.zone).toBeGreaterThanOrEqual(45);
  });

  test("/challenge answers 429 past the rate", async () => {
    const nb = createNotabot({ hmacKey: "k", ratePerMinute: 2 });
    const get = async () =>
      ((await nb.handle(req("/notabot/challenge", chromeHeaders(UA)), { ip: IP })) as Response)
        .status;
    expect([await get(), await get(), await get()]).toEqual([200, 200, 429]);
  });
});

describe("origins", () => {
  test("with an allow-list, a POST without Origin is refused and a foreign origin gets no CORS", async () => {
    const nb = createNotabot({
      hmacKey: "k",
      maxnumber: 1500,
      allowedOrigins: ["https://site.dev"],
    });
    const { origin: _, ...noOrigin } = chromeHeaders(UA);
    const sol = await solution(nb);
    expect(
      (await post(nb, "verify", { signals: realChrome(), solution: sol }, noOrigin)).status,
    ).toBe(403);
    const evil = await post(
      nb,
      "verify",
      { signals: realChrome(), solution: sol },
      chromeHeaders(UA, { origin: "https://evil.dev" }),
    );
    expect(evil.status).toBe(403);
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    expect((await verified(nb)).headers.get("access-control-allow-origin")).toBe(
      "https://site.dev",
    );
  });
});

describe("/siteverify", () => {
  const siteverify = async (nb: Nb, fields: Record<string, string>) =>
    (await (
      await nb.handle(
        req(
          "/notabot/siteverify",
          { "content-type": "application/x-www-form-urlencoded" },
          {
            method: "POST",
            body: new URLSearchParams(fields).toString(),
          },
        ),
      )
    )?.json()) as { success: boolean; "error-codes"?: string[] };

  test("checks remoteip and useragent, and its replay key is its own", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500, siteSecret: "s" });
    const { body } = await verified(nb);
    const token = body.token as string;
    expect(
      await siteverify(nb, { secret: "s", response: token, remoteip: "198.51.100.1" }),
    ).toMatchObject({
      success: false,
      "error-codes": ["token-mismatch"],
    });
    expect(
      await siteverify(nb, { secret: "s", response: token, useragent: "curl/8" }),
    ).toMatchObject({
      "error-codes": ["token-mismatch"],
    });
    expect(
      await siteverify(nb, { secret: "s", response: token, remoteip: IP, useragent: UA }),
    ).toMatchObject({ success: true });
    expect(await siteverify(nb, { secret: "s", response: token })).toMatchObject({
      "error-codes": ["timeout-or-duplicate"],
    });
    // The gate keeps its own record: siteverify did not use the token up for it.
    const info = infoFromRequest(req("/x", chromeHeaders(UA)), { ip: IP });
    expect((await nb.verifyRequest(info, token)).ok).toBe(true);
  });

  test("singleUse: false lets a token be checked until it expires", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500, singleUse: false });
    const { body } = await verified(nb);
    const response = body.token as string;
    expect((await siteverify(nb, { response })).success).toBe(true);
    expect((await siteverify(nb, { response })).success).toBe(true);
  });

  test("Express: a form body a parser already read still reaches siteverify", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500, siteSecret: "s" });
    const { body } = await verified(nb);
    const middleware = notabotExpress(nb, { routesOnly: true });
    const out = await new Promise<string>((resolve) => {
      void middleware(
        {
          method: "POST",
          url: "/notabot/siteverify",
          headers: {
            host: "site.dev",
            "content-type": "application/x-www-form-urlencoded",
            "content-length": "999",
          },
          body: { secret: "s", response: body.token },
        },
        {
          statusCode: 200,
          setHeader() {},
          end(b) {
            resolve(typeof b === "string" ? b : new TextDecoder().decode(b));
          },
        },
        () => resolve("next"),
      );
    });
    expect(JSON.parse(out)).toMatchObject({ success: true, verdict: "human" });
  });
});

describe("/slide", () => {
  const track = { left: 100, width: 300 };

  test("a hand's drag into the signed zone turns an unsure token into a human one", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500, visibleChallenges: ["slide"] });
    const { body } = await verified(nb, doubtful());
    const zone = body.zone as number;
    const info = infoFromRequest(req("/x", chromeHeaders(UA)), { ip: IP });
    expect((await nb.verifyRequest(info, body.token as string)).ok).toBe(false);
    const missed = await post(nb, "slide", {
      token: body.token,
      samples: drag(zone > 60 ? 20 : 95),
      track,
    });
    expect(missed.body).toMatchObject({ passed: false, attemptsLeft: 2 });
    const slid = await post(nb, "slide", { token: body.token, samples: drag(zone + 7), track });
    expect(slid.body).toMatchObject({ passed: true, verdict: "human" });
    expect((await nb.verifyRequest(info, slid.body.token as string)).ok).toBe(true);
    // The unsure token cannot be slid twice.
    expect(
      (await post(nb, "slide", { token: body.token, samples: drag(zone + 7), track })).status,
    ).toBe(403);
  });

  test("a ruler-straight drag fails, attempts run out, and the keyboard way works", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500, visibleChallenges: ["slide"] });
    const { body } = await verified(nb, doubtful());
    const zone = body.zone as number;
    for (let i = 0; i < 3; i++)
      expect(
        (await post(nb, "slide", { token: body.token, samples: robotDrag(zone + 7), track })).body
          .passed,
      ).toBe(false);
    expect(
      (await post(nb, "slide", { token: body.token, samples: drag(zone + 7), track })).status,
    ).toBe(429);
    const again = await verified(nb, doubtful());
    const keys = await post(nb, "slide", {
      token: again.body.token,
      keyTimes: [0, 130, 250, 420, 530, 700],
      keysTrusted: true,
      position: (again.body.zone as number) + 5,
    });
    expect(keys.body).toMatchObject({ passed: true, verdict: "human" });
  });

  test("never overturns a bot, and refuses another browser's token", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500, visibleChallenges: ["slide"] });
    const s = realChrome();
    s.automation.webdriver = true;
    const bot = await verified(nb, s);
    expect(bot.body.verdict).toBe("bot");
    expect(
      (await post(nb, "slide", { token: bot.body.token, samples: drag(60), track, landed: true }))
        .body,
    ).toMatchObject({
      passed: false,
      verdict: "bot",
    });
    const { body } = await verified(nb, doubtful());
    const other = await post(
      nb,
      "slide",
      { token: body.token, samples: drag((body.zone as number) + 7), track },
      chromeHeaders(UA.replace("142", "141")),
    );
    expect(other.status).toBe(403);
    expect((await post(nb, "slide", { token: body.token })).status).toBe(400);
  });

  test("targets: activated in order, on target, at a person's pace; a slide does not pass them", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500, visibleChallenges: ["targets"] });
    const { body } = await verified(nb, doubtful());
    const challenge = body.challenge as { kind: string; targets: [number, number][] };
    expect(challenge.kind).toBe("targets");
    expect(body.zone).toBeUndefined();
    const click = (i: number, t: number, over: Partial<Record<string, unknown>> = {}) => ({
      index: i,
      x: (challenge.targets[i] as [number, number])[0] + 2,
      y: (challenge.targets[i] as [number, number])[1] - 1,
      t,
      trusted: true,
      key: false,
      path: 14,
      ...over,
    });
    const slideInstead = await post(nb, "slide", {
      token: body.token,
      samples: drag(60),
      track,
      landed: true,
    });
    expect(slideInstead.body.passed).toBe(false);
    const wrongOrder = await post(nb, "slide", {
      token: body.token,
      clicks: [click(1, 0, { index: 0 }), click(0, 500, { index: 1 }), click(2, 1100)],
    });
    expect(wrongOrder.body.passed).toBe(false);
    const ok = await post(nb, "slide", {
      token: body.token,
      clicks: [click(0, 0), click(1, 640), click(2, 1150)],
    });
    expect(ok.body).toMatchObject({ passed: true, verdict: "human" });
  });

  test("targets: clicks that jump onto each target fail; a finger's taps pass", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500, visibleChallenges: ["targets"] });
    const taps = async (over: Record<string, unknown>) => {
      const { body } = await verified(nb, doubtful());
      const targets = (body.challenge as { targets: [number, number][] }).targets;
      const clicks = targets.map(([x, y], index) => ({
        index,
        x,
        y,
        t: [0, 2400, 5100][index] as number,
        trusted: true,
        key: false,
        ...over,
      }));
      return (await post(nb, "slide", { token: body.token, clicks })).body.passed;
    };
    // An agent's clicks: on target, in order, slowly, but jumping straight from one to the next.
    expect(await taps({ path: 1 })).toBe(false);
    expect(await taps({})).toBe(false);
    expect(await taps({ path: 1, touch: true })).toBe(true);
  });

  test("targets from the keyboard: the order counts, not the position", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 1500, visibleChallenges: ["targets"] });
    const { body } = await verified(nb, doubtful());
    const keys = [0, 1, 2].map((index, i) => ({
      index,
      x: 0,
      y: 0,
      t: [0, 480, 1300][i] as number,
      trusted: true,
      key: true,
    }));
    expect((await post(nb, "slide", { token: body.token, clicks: keys })).body.passed).toBe(true);
  });
});
