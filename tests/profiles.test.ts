import { describe, expect, test } from "bun:test";
import { createNotabot, infoFromRequest } from "../src/middleware/index";
import { combineFlags, score, THRESHOLDS } from "../src/score/index";
import { chromeHeaders } from "./browser-headers";
import { headlessChromium, realChrome } from "./fixtures";
import { humanProfiles } from "./profiles";

describe("false-positive budget", () => {
  // Each of these is a person. Not one may be called a bot, with or without its behaviour.
  for (const profile of humanProfiles())
    test(`${profile.id}: ${profile.note}`, () => {
      for (const behavior of [profile.behavior, null]) {
        const result = score({ signals: profile.signals, behavior });
        expect(result.verdict).not.toBe("bot");
        expect(result.bot).toBeLessThan(THRESHOLDS.bot);
      }
    });

  test("even behaviour that looks scripted cannot make a keyboard user a bot", () => {
    const keyboard = humanProfiles().find((p) => p.id === "keyboard-only");
    if (!keyboard?.behavior) throw new Error("profile");
    const result = score({
      signals: keyboard.signals,
      behavior: { ...keyboard.behavior, untrusted: 3, inputWithoutKeys: 2, honeypot: 1 },
    });
    expect(result.flags.map((f) => f.id)).toEqual(
      expect.arrayContaining(["untrusted-events", "input-without-keys", "honeypot-filled"]),
    );
    expect(result.verdict).not.toBe("bot");
  });
});

describe("correlated evidence", () => {
  test("flags of one category count once, and a little more; categories add up", () => {
    // Two automation flags: 0.9 and 0.8 → 1 − 0.1 × (1 − 0.25 × 0.8) = 0.92, not 0.98.
    expect(
      combineFlags([
        { category: "automation", weight: 0.9 },
        { category: "automation", weight: 0.8 },
      ]),
    ).toBeCloseTo(0.92, 3);
    // Across categories they are independent evidence: 1 − 0.1 × 0.2 = 0.98.
    expect(
      combineFlags([
        { category: "automation", weight: 0.9 },
        { category: "hardware", weight: 0.8 },
      ]),
    ).toBeCloseTo(0.98, 3);
    expect(combineFlags([])).toBe(0);
  });

  test("an out-of-the-box headless browser is still refused", () => {
    expect(score({ signals: headlessChromium() }).verdict).toBe("bot");
  });
});

describe("behaviour", () => {
  test("a script's metronome scrolling and a filled honeypot", () => {
    const signals = realChrome();
    const base = humanProfiles()[0]?.behavior;
    if (!base) throw new Error("profile");
    const flags = score({
      signals,
      behavior: { ...base, scrolls: 12, scrollCv: 0.01, honeypot: 1 },
    }).flags.map((f) => f.id);
    expect(flags).toEqual(expect.arrayContaining(["robotic-scroll", "honeypot-filled"]));
    expect(
      score({ signals, behavior: { ...base, scrolls: 12, scrollCv: 0.6, pastes: 3 } }).flags,
    ).toEqual([]);
  });

  test("the middleware flags a form whose honeypot came back filled", async () => {
    const nb = createNotabot({ hmacKey: "k", requireToken: false });
    const form = new FormData();
    form.set("email", "a@b.c");
    form.set("notabot-token-hp", "https://spam.example");
    const filled = await nb
      .protect(() => new Response("in"))(
        new Request("https://site.dev/signup", {
          method: "POST",
          headers: chromeHeaders(realChrome().env.userAgent),
          body: form,
        }),
      )
      .then((r) => r.json() as Promise<{ flags: string[] }>);
    expect(filled.flags).toContain("honeypot-filled");
    const clean = await nb.verifyRequest(
      infoFromRequest(
        new Request("https://site.dev/", { headers: chromeHeaders(realChrome().env.userAgent) }),
      ),
      null,
      { honeypot: "" },
    );
    expect(clean.ok).toBe(true);
  });
});
