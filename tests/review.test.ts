// Regression tests for the findings of the code review (issue #22).
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { PointerSample } from "../src/behavior/index";
import { attributesFromDataset } from "../src/embed";
import {
  bodyFields,
  clearTorExitList,
  createNotabot,
  infoFromRequest,
  torExitList,
} from "../src/middleware/index";
import { type Challenge, encodeSolution, search } from "../src/pow/index";
import { expectedAnswer } from "../src/probes/index";
import type { NotabotSignals } from "../src/signals/types";
import { chromeHeaders } from "./browser-headers";
import { realChrome } from "./fixtures";

const UA = realChrome().env.userAgent;
const IP = "203.0.113.40";
const HOSTING = { asOrganization: "Hetzner Online GmbH" };
type Nb = ReturnType<typeof createNotabot>;

async function verified(nb: Nb, signals: NotabotSignals, network: object | null = null) {
  const headers = chromeHeaders(UA);
  const c = (await (
    await nb.handle(new Request("https://site.dev/notabot/challenge", { headers }), { ip: IP })
  )?.json()) as Challenge;
  const res = await nb.handle(
    new Request("https://site.dev/notabot/verify", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        signals,
        solution: encodeSolution({ ...c, number: (await search(c)) as number, took: 1 }),
        probes: (c.probes ?? []).map(expectedAnswer),
      }),
    }),
    { ip: IP, ...(network ? { network } : {}) },
  );
  return (await (res as Response).json()) as Record<string, unknown>;
}

/** Moves the clock forward, as the time a person takes; back to the real one after each test. */
const later = (ms: number) => setSystemTime(new Date(Date.now() + ms));
afterEach(() => {
  setSystemTime();
});

const slide = async (nb: Nb, body: object) => {
  later(10_000);
  const res = await nb.handle(
    new Request("https://site.dev/notabot/slide", {
      method: "POST",
      headers: { ...chromeHeaders(UA), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { ip: IP },
  );
  return {
    status: (res as Response).status,
    body: (await (res as Response).json()) as Record<string, unknown>,
  };
};

function doubtful(): NotabotSignals {
  const s = realChrome();
  s.automation.softwareRenderer = true;
  return s;
}

/** A hand's drag ending at `endPercent` of a 300 px track at x = 100. */
function drag(endPercent: number): PointerSample[] {
  const end = 100 + (300 * endPercent) / 100;
  return Array.from({ length: 31 }, (_, i) => {
    const p = i / 30;
    const eased = p * p * (3 - 2 * p);
    return {
      x: 100 + (end - 100) * eased + (i === 30 ? 0 : Math.sin(i * 1.7) * 2),
      y: 200 + Math.sin(i * 0.9) * 3,
      t: i * 22 + (i % 3) * 5,
      trusted: true,
      coalesced: 2,
      pressure: 0.5,
      type: "pointermove",
    };
  });
}

describe("/slide settles only a signed doubt", () => {
  test("a human token, or a token /slide issued, cannot be slid into a new one", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 300, visibleChallenges: ["slide"] });
    const human = await verified(nb, realChrome());
    expect(human.verdict).toBe("human");
    const keys = { keyTimes: [0, 130, 330, 700], keysTrusted: true, position: 50, landed: true };
    expect((await slide(nb, { token: human.token, ...keys })).status).toBe(403);
    const unsure = await verified(nb, doubtful());
    const zone = unsure.zone as number;
    const passed = await slide(nb, {
      token: unsure.token,
      samples: drag(zone + 7),
      track: { left: 100, width: 300 },
    });
    expect(passed.body.passed).toBe(true);
    // The token /slide just issued carries no challenge: no chain of fresh tokens from it.
    expect((await slide(nb, { token: passed.body.token, ...keys })).status).toBe(403);
  });

  test("the page's own 'landed' counts for nothing: the server checks the zone it signed", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 300, visibleChallenges: ["slide"] });
    const unsure = await verified(nb, doubtful());
    const zone = unsure.zone as number;
    const outside = zone > 60 ? 10 : 95;
    const r = await slide(nb, {
      token: unsure.token,
      samples: drag(outside),
      track: { left: 100, width: 300 },
      landed: true,
    });
    expect(r.body.passed).toBe(false);
  });
});

describe("the gate counts a request flag once", () => {
  test("a visitor on a hosting network who passed the slider is accepted; a new flag still counts", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 300, visibleChallenges: ["slide"] });
    const unsure = await verified(nb, doubtful(), HOSTING);
    expect(unsure.flags).toContain("hosting-network");
    const zone = unsure.zone as number;
    const passed = await slide(nb, {
      token: unsure.token,
      samples: drag(zone + 7),
      track: { left: 100, width: 300 },
    });
    const gate = (headers: Record<string, string>) =>
      nb.verifyRequest(
        infoFromRequest(new Request("https://site.dev/signup", { method: "POST", headers }), {
          ip: IP,
          network: HOSTING,
        }),
        passed.body.token as string,
      );
    expect(await gate(chromeHeaders(UA))).toMatchObject({ ok: true, verdict: "human" });
  });

  test("a flag the gate sees for the first time is added to the token's score", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 300 });
    const human = await verified(nb, realChrome());
    const { accept: _, ...noAccept } = chromeHeaders(UA);
    const { "accept-language": __, ...bare } = noAccept;
    const decision = await nb.verifyRequest(
      infoFromRequest(new Request("https://site.dev/signup", { headers: bare }), { ip: IP }),
      human.token as string,
    );
    expect(decision.flags.map((f) => f.id)).toEqual(
      expect.arrayContaining(["missing-accept", "missing-accept-language"]),
    );
    expect(decision.ok).toBe(false);
  });
});

describe("smaller findings", () => {
  test("siteverify answers for a token issued to a page whose origin is 'null'", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 300, siteSecret: "s" });
    const headers = chromeHeaders(UA, { origin: "null" });
    const c = (await (
      await nb.handle(new Request("https://site.dev/notabot/challenge", { headers }), { ip: IP })
    )?.json()) as Challenge;
    const issued = (await (
      await nb.handle(
        new Request("https://site.dev/notabot/verify", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            signals: realChrome(),
            solution: encodeSolution({ ...c, number: (await search(c)) as number, took: 1 }),
            probes: (c.probes ?? []).map(expectedAnswer),
          }),
        }),
        { ip: IP },
      )
    )?.json()) as { token: string };
    const res = (await nb.handle(
      new Request("https://site.dev/notabot/siteverify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: "s", response: issued.token }),
      }),
    )) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, hostname: null });
  });

  test("switches on the script tag: present turns them on, 'false' leaves them off", () => {
    expect(attributesFromDataset({ local: "", noHoneypot: "true" }, "https://a.dev/")).toEqual({
      local: "",
      "no-honeypot": "",
    });
    expect(attributesFromDataset({ local: "false" }, "https://a.dev/")).toEqual({});
  });

  test("the gate reads a body once and no further than the cap", async () => {
    const big = new Request("https://site.dev/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ "notabot-token": "t", pad: "x".repeat(300_000) }),
    });
    expect(await bodyFields(big, 1024)).toEqual({});
    const form = new Request("https://site.dev/x", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "notabot-token=t&notabot-token-hp=spam",
    });
    expect(await bodyFields(form)).toEqual({ "notabot-token": "t", "notabot-token-hp": "spam" });
  });

  test("the Tor list: one fetch for requests arriving together, none again soon after a failure", async () => {
    clearTorExitList();
    let calls = 0;
    const exits = torExitList({
      fetch: (async () => {
        calls++;
        await Bun.sleep(30);
        throw new Error("unreachable");
      }) as unknown as typeof fetch,
    });
    await Promise.all([exits(), exits(), exits()]);
    expect(calls).toBe(1);
    await exits();
    expect(calls).toBe(1);
    clearTorExitList();
  });

  test("an upload larger than the endpoints' cap still carries its token to the gate", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 300 });
    const human = await verified(nb, realChrome());
    const form = new FormData();
    form.set("file", new Blob(["x".repeat(2_000_000)]), "photo.jpg");
    form.set("notabot-token", human.token as string);
    const res = await nb.protect(() => new Response("stored"))(
      new Request("https://site.dev/upload", {
        method: "POST",
        headers: chromeHeaders(UA),
        body: form,
      }),
      // protect() reads the IP the platform gives; here none, so a token bound to an IP is
      // refused as a mismatch, never as missing: the token was found in a 2 MB body.
    );
    expect(((await res.json()) as { reason: string }).reason).not.toBe("missing-token");
  });

  test("the rate is not sealed as already counted: the gate still applies it", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 300, ratePerMinute: 1, singleUse: false });
    await nb.analyzeRequest(
      infoFromRequest(new Request("https://site.dev/", { headers: chromeHeaders(UA) }), { ip: IP }),
    );
    const human = await verified(nb, realChrome());
    expect(human.flags).toContain("rate");
    const decision = await nb.verifyRequest(
      infoFromRequest(new Request("https://site.dev/x", { headers: chromeHeaders(UA) }), {
        ip: IP,
      }),
      human.token as string,
    );
    expect(decision.flags.map((f) => f.id)).toContain("rate");
  });

  test("the gate's decision lists the flags its score counted", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 300 });
    const human = await verified(nb, realChrome(), HOSTING);
    expect(human.flags).toContain("hosting-network");
    const decision = await nb.verifyRequest(
      infoFromRequest(new Request("https://site.dev/x", { headers: chromeHeaders(UA) }), {
        ip: IP,
        network: HOSTING,
      }),
      human.token as string,
    );
    expect(decision.flags.map((f) => f.id)).not.toContain("hosting-network");
  });

  test("Tor loaders keep their own lists: one failing does not blind another", async () => {
    clearTorExitList();
    const failing = torExitList({
      maxAgeMs: 600_000,
      fetch: (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
    });
    const working = torExitList({
      fetch: (async () => new Response("198.51.100.9\n")) as unknown as typeof fetch,
    });
    await failing();
    expect((await working()).has("198.51.100.9")).toBe(true);
    clearTorExitList();
  });
});
