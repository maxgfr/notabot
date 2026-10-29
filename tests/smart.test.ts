import { describe, expect, test } from "bun:test";
import { clearTorExitList, createNotabot, torExitList } from "../src/middleware/index";
import { type Challenge, encodeSolution, search } from "../src/pow/index";
import { expectedAnswer } from "../src/probes/index";
import type { NotabotSignals } from "../src/signals/types";
import { identify, smartSignals } from "../src/smart/index";
import { chromeHeaders } from "./browser-headers";
import { headlessChromium, realChrome } from "./fixtures";
import { humanProfiles } from "./profiles";

const profile = (id: string) => {
  const p = humanProfiles().find((x) => x.id === id);
  if (!p) throw new Error(id);
  return p.signals;
};

describe("visitor identification", () => {
  test("the same readings give the same id; the clock and the window do not count", async () => {
    const a = realChrome();
    const b = realChrome();
    b.collectedAt = "2030-01-01T00:00:00.000Z";
    b.durationMs = 999;
    b.env.window = { innerWidth: 800, innerHeight: 600, outerWidth: 800, outerHeight: 700 };
    const ia = await identify(a);
    expect(ia.visitorId).toMatch(/^[0-9a-f]{20}$/);
    expect((await identify(b)).visitorId).toBe(ia.visitorId);
    expect(ia.confidence).toBe(1);
    const other = realChrome();
    other.hardware.fonts = [...other.hardware.fonts, "Comic Sans MS"];
    expect((await identify(other)).visitorId).not.toBe(ia.visitorId);
  });

  test("a salt (the server's key) makes ids per site; randomised readings lower the confidence", async () => {
    const s = realChrome();
    expect((await identify(s, "site-a")).visitorId).not.toBe(
      (await identify(s, "site-b")).visitorId,
    );
    expect((await identify(profile("brave"))).confidence).toBeLessThan(0.7);
    expect((await identify(profile("firefox-rfp"))).confidence).toBeLessThan(0.5);
    // Canvas noise: the canvas is left out of the id rather than making it change every read.
    const noisy = realChrome();
    noisy.hardware.canvas = { hash: "differs-each-read", stable: false };
    expect((await identify(noisy)).components.canvas).toBeNull();
  });
});

describe("smart signals", () => {
  test("privacy browsers, virtual machines and tampering", () => {
    expect(smartSignals(profile("brave"))).toMatchObject({
      privacyBrowser: "brave",
      farbling: true,
    });
    expect(smartSignals(profile("firefox-rfp")).privacyBrowser).toBe("resist-fingerprinting");
    expect(smartSignals(realChrome())).toMatchObject({
      privacyBrowser: null,
      farbling: false,
      virtualMachine: false,
      tampering: { detected: false },
    });
    const vm = realChrome();
    if (vm.hardware.webgl) vm.hardware.webgl.unmaskedRenderer = "VMware SVGA 3D";
    expect(smartSignals(vm)).toMatchObject({ virtualMachine: true });
    expect(smartSignals(headlessChromium()).virtualMachine).toBe(true);
  });

  test("private mode: likely, unlikely or unknown, from cautious evidence", () => {
    expect(smartSignals(realChrome()).privateMode).toBe(false);
    const incognito = realChrome();
    incognito.env.storageQuotaMB = 1500;
    expect(smartSignals(incognito)).toMatchObject({ privateMode: true });
    // Brave caps every profile at 2 GB: not evidence there.
    const brave = profile("brave");
    brave.env.storageQuotaMB = 2048;
    expect(smartSignals(brave).privateMode).toBe(false);
    const firefoxPrivate: NotabotSignals = {
      ...profile("firefox-rfp"),
      privacy: { opfs: "error" },
    };
    expect(smartSignals(firefoxPrivate).privateMode).toBe(true);
  });
});

describe("sealed results", () => {
  const solved = async (nb: ReturnType<typeof createNotabot>, ip: string) => {
    const headers = chromeHeaders(realChrome().env.userAgent);
    const c = (await (
      await nb.handle(new Request("https://site.dev/notabot/challenge", { headers }), { ip })
    )?.json()) as Challenge;
    return {
      headers,
      solution: encodeSolution({ ...c, number: (await search(c)) as number, took: 1 }),
      probes: (c.probes ?? []).map(expectedAnswer),
    };
  };

  test("/verify seals the smart signals in the token; /siteverify hands them to the backend", async () => {
    clearTorExitList();
    const exits = torExitList({
      fetch: (async () => new Response("# exits\n198.51.100.66\n")) as unknown as typeof fetch,
    });
    const nb = createNotabot({ hmacKey: "k", maxnumber: 300, siteSecret: "s", torExits: exits });
    const ip = "198.51.100.66";
    const { headers, solution, probes } = await solved(nb, ip);
    const signals = realChrome();
    const res = await nb.handle(
      new Request("https://site.dev/notabot/verify", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ signals, solution, probes }),
      }),
      { ip, network: { timezone: "America/New_York", country: "US" } },
    );
    const body = (await res?.json()) as {
      token: string;
      flags: string[];
      smart: Record<string, unknown>;
    };
    expect(body.flags).toEqual(expect.arrayContaining(["tor-exit", "server-timezone"]));
    expect(body.smart).toMatchObject({
      tor: true,
      vpn: true,
      privacyBrowser: null,
      privateMode: false,
      virtualMachine: false,
      tampering: false,
    });
    // Keyed with the server's secret: not the id the page computes on its own.
    expect(body.smart.visitorId).not.toBe((await identify(signals)).visitorId);
    const verified = await nb.handle(
      new Request("https://site.dev/notabot/siteverify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: "s", response: body.token }),
      }),
    );
    expect(((await (verified as Response).json()) as { smart: unknown }).smart).toEqual(body.smart);
  });
});
