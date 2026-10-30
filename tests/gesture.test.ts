import { afterAll, afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { PointerSample } from "../src/behavior/index";
import { GESTURE_PROMPT, gestureFeatures, gestureFingerprint } from "../src/llm/gesture";
import { createNotabot } from "../src/middleware/index";
import { base64urlDecode } from "../src/pow/crypto";
import { type Challenge, encodeSolution, search } from "../src/pow/index";
import { expectedAnswer } from "../src/probes/index";
import type { NotabotSignals } from "../src/signals/types";
import { chromeHeaders } from "./browser-headers";
import { realChrome } from "./fixtures";

const UA = realChrome().env.userAgent;
const IP = "203.0.113.60";
const TRACK = { left: 100, width: 300 };
type Nb = ReturnType<typeof createNotabot>;

const later = (ms: number) => setSystemTime(new Date(Date.now() + ms));
afterEach(() => {
  setSystemTime();
});

/** A model server whose answer each test sets; it records which instructions it got. */
let answer: (system: string) => string = () => '{"reasons":[],"verdict":"human","confidence":0.9}';
const systems: string[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = (await req.json()) as { messages: { role: string; content: string }[] };
    const system = body.messages[0]?.content ?? "";
    systems.push(system);
    return Response.json({
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: answer(system) },
          finish_reason: "stop",
        },
      ],
    });
  },
});
afterAll(() => server.stop());

/** A Chrome with a software GPU (doubtful); each call a different collection, as a new visit. */
function doubtful(): NotabotSignals {
  const s = realChrome();
  s.automation.softwareRenderer = true;
  s.durationMs = Math.round(Math.random() * 1000);
  return s;
}

async function unsure(nb: Nb, ip = IP) {
  const headers = chromeHeaders(UA);
  const c = (await (
    await nb.handle(new Request("https://site.dev/notabot/challenge", { headers }), { ip })
  )?.json()) as Challenge;
  const res = await nb.handle(
    new Request("https://site.dev/notabot/verify", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        signals: doubtful(),
        behavior: null,
        solution: encodeSolution({ ...c, number: (await search(c)) as number, took: 1 }),
        probes: (c.probes ?? []).map(expectedAnswer),
      }),
    }),
    { ip },
  );
  return (await (res as Response).json()) as { token: string; zone: number; verdict: string };
}

async function slide(nb: Nb, body: object, ip = IP) {
  const res = (await nb.handle(
    new Request("https://site.dev/notabot/slide", {
      method: "POST",
      headers: { ...chromeHeaders(UA), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { ip },
  )) as Response;
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** A hand's drag, ending at `end` percent; `seed` makes each one a different gesture. */
function hand(end: number, seed = 1): PointerSample[] {
  const x1 = 100 + 3 * end;
  return Array.from({ length: 31 }, (_, i) => {
    const p = i / 30;
    const eased = p * p * (3 - 2 * p);
    return {
      x: 100 + (x1 - 100) * eased + (i === 30 ? 0 : Math.sin(i * 1.7 + seed) * 2),
      y: 200 + Math.sin(i * 0.9 + seed) * 3,
      t: i * 22 + ((i + seed) % 3) * 5,
      trusted: true,
      coalesced: 2,
      pressure: 0.5,
      type: "pointermove",
    };
  });
}

describe("the server's clock", () => {
  test("a gesture that arrives before a person could have made it is refused", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 300, visibleChallenges: ["slide"] });
    const u = await unsure(nb);
    // The drag lasts 660 ms by its own timestamps: posted at once, it cannot be a person's.
    expect(
      (await slide(nb, { token: u.token, samples: hand(u.zone + 7), track: TRACK })).body,
    ).toMatchObject({
      passed: false,
      why: "too-fast",
    });
    later(3000);
    expect(
      (await slide(nb, { token: u.token, samples: hand(u.zone + 7, 2), track: TRACK })).body.passed,
    ).toBe(true);
  });
});

describe("replays", () => {
  test("a recorded gesture plays once, even on another token", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 300, visibleChallenges: ["slide"] });
    const a = await unsure(nb);
    const b = await unsure(nb, "203.0.113.61");
    // Both zones must take the same drag end for the recording to fit both: aim inside each.
    later(3000);
    const recorded = hand(a.zone + 7, 3);
    expect((await slide(nb, { token: a.token, samples: recorded, track: TRACK })).body.passed).toBe(
      true,
    );
    const replay = await slide(
      nb,
      { token: b.token, samples: recorded, track: TRACK },
      "203.0.113.61",
    );
    expect(replay.body).toMatchObject({ passed: false, why: "replayed" });
  });

  test("the fingerprint follows the shape, not where on the page it was made", () => {
    const g = hand(60, 4);
    const moved = g.map((s) => ({ ...s, x: s.x + 50, y: s.y + 30, t: s.t + 1000 }));
    expect(gestureFingerprint({ kind: "slide", samples: g })).toBe(
      gestureFingerprint({ kind: "slide", samples: moved }),
    );
    expect(gestureFingerprint({ kind: "slide", samples: g })).not.toBe(
      gestureFingerprint({ kind: "slide", samples: hand(60, 5) }),
    );
  });
});

describe("the model judges the gesture", () => {
  const withModel = () =>
    createNotabot({
      hmacKey: "k",
      maxnumber: 300,
      visibleChallenges: ["slide"],
      llm: { endpoint: `http://localhost:${server.port}/v1`, model: "m" },
    });

  test("a confident 'bot' turns a pass into a refusal, with the gesture's own instructions", async () => {
    systems.length = 0;
    // The page's own score: the rules decide nothing here, so only /slide asks about the gesture.
    answer = (system) =>
      system === GESTURE_PROMPT
        ? '{"reasons":["even steps"],"verdict":"bot","confidence":0.9}'
        : '{"reasons":[],"verdict":"unsure","confidence":0}';
    const nb = withModel();
    const u = await unsure(nb);
    later(3000);
    const r = await slide(nb, { token: u.token, samples: hand(u.zone + 7, 6), track: TRACK });
    expect(r.body).toMatchObject({ passed: false, why: "model" });
    expect(systems).toContain(GESTURE_PROMPT);
  });

  test("a model saying 'human' cannot rescue a gesture the rules refused", async () => {
    // Neutral on the page (the doubt stays), sure of a person on the gesture.
    answer = (system) =>
      system === GESTURE_PROMPT
        ? '{"reasons":[],"verdict":"human","confidence":1}'
        : '{"reasons":[],"verdict":"unsure","confidence":0}';
    const nb = withModel();
    const u = await unsure(nb);
    later(3000);
    const ruler = Array.from({ length: 30 }, (_, i) => ({
      x: 100 + i * 10,
      y: 200,
      t: i * 16,
      trusted: true,
      coalesced: 1,
      pressure: 0,
      type: "pointermove",
    }));
    expect((await slide(nb, { token: u.token, samples: ruler, track: TRACK })).body).toMatchObject({
      passed: false,
      why: "gesture",
    });
  });

  test("no answer from the model: the rules decide", async () => {
    const nb = createNotabot({
      hmacKey: "k",
      maxnumber: 300,
      visibleChallenges: ["slide"],
      llm: { endpoint: "http://localhost:9/v1", model: "m", timeoutMs: 300 },
    });
    const u = await unsure(nb);
    later(3000);
    expect(
      (await slide(nb, { token: u.token, samples: hand(u.zone + 7, 7), track: TRACK })).body.passed,
    ).toBe(true);
  });
});

describe("what the token and the model carry", () => {
  test("a token issued in doubt carries its time and the session; the model reads numbers only", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 300, visibleChallenges: ["slide"] });
    const u = await unsure(nb);
    const claims = JSON.parse(base64urlDecode(u.token.split(".")[0] as string));
    expect(typeof claims.ms).toBe("number");
    const f = gestureFeatures(
      { kind: "slide", samples: hand(60) },
      {
        moves: 40,
        keys: 0,
        clicks: 1,
        untrusted: 0,
        coalescedMean: 2,
        stepCv: 0.7,
        turnRate: 0.3,
        endSlowdown: 0.3,
        keyFlightCv: null,
        sessionMs: 9000,
      },
    );
    expect(f).toMatchObject({ gesture_kind: "slide", session_moves: 40, session_session_ms: 9000 });
    for (const [k, v] of Object.entries(f)) {
      expect(k).toMatch(/^(gesture|session)_/);
      if (k !== "gesture_kind") expect(["number", "boolean", "object"]).toContain(typeof v);
    }
  });

  test("twenty gestures a minute from one IP, then 429", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 300, visibleChallenges: ["slide"] });
    // All within one minute of the server's clock.
    setSystemTime(new Date(Math.floor(Date.now() / 60_000) * 60_000 + 1000));
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const u = await unsure(nb);
      for (let j = 0; j < 3; j++)
        statuses.push(
          (await slide(nb, { token: u.token, samples: hand(10, i * 10 + j), track: TRACK })).status,
        );
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
