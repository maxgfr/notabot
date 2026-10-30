import { describe, expect, test } from "bun:test";
import type { BehaviorFeatures } from "../src/behavior/index";
import { blend, claimedSystems, RULES, rulesDecided, score, verdictOf } from "../src/score/index";
import { headlessChromium, realChrome, stealth } from "./fixtures";

const ids = (s: ReturnType<typeof score>) => s.flags.map((f) => f.id);

describe("score", () => {
  test("a real Chrome is human with no flag", () => {
    const result = score({ signals: realChrome() });
    expect(result.flags).toEqual([]);
    expect(result.bot).toBe(0);
    expect(result.verdict).toBe("human");
    expect(result.checked.length).toBe(RULES.length);
  });

  test("headless Chromium is a bot, for several reasons", () => {
    const result = score({ signals: headlessChromium() });
    expect(result.verdict).toBe("bot");
    expect(ids(result)).toEqual(
      expect.arrayContaining([
        "webdriver",
        "headless-user-agent",
        "headless-brand",
        "software-renderer",
      ]),
    );
    expect(result.bot).toBeGreaterThan(0.99);
  });

  test("a stealth layer is caught by the iframe, the descriptor and toString", () => {
    const result = score({ signals: stealth() });
    expect(ids(result)).toEqual(
      expect.arrayContaining([
        "webdriver-own-property",
        "native-functions-replaced",
        "tostring-patched",
        "iframe-mismatch",
      ]),
    );
    expect(ids(result)).not.toContain("webdriver");
    expect(result.verdict).toBe("bot");
  });

  test("a privacy extension alone stays human", () => {
    const s = realChrome();
    s.tampering.lies = ["HTMLCanvasElement.toDataURL: source visible"];
    s.hardware.canvas = { hash: "x", stable: false };
    const result = score({ signals: s });
    expect(ids(result)).toEqual(["fingerprint-functions-replaced", "canvas-noise"]);
    expect(result.verdict).toBe("human");
  });

  test("a Windows user agent on a Mac GPU contradicts itself", () => {
    const s = realChrome();
    s.env.userAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
    expect(claimedSystems(s)).toMatchObject({
      userAgent: "windows",
      platform: "mac",
      webgl: "mac",
    });
    expect(ids(score({ signals: s }))).toContain("os-mismatch");
  });

  test("an iPad asking for the desktop site is not a contradiction", () => {
    const s = realChrome();
    s.env.uaData = null;
    s.hardware.webgl = {
      ...(s.hardware.webgl as NonNullable<typeof s.hardware.webgl>),
      unmaskedRenderer: "Apple GPU",
    };
    expect(ids(score({ signals: s }))).not.toContain("os-mismatch");
  });

  test("a Firefox user agent on V8 is an engine mismatch", () => {
    const s = realChrome();
    s.env.userAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.4; rv:144.0) Gecko/20100101 Firefox/144.0";
    s.automation.engineClaimed = "gecko";
    expect(ids(score({ signals: s }))).toContain("engine-mismatch");
  });

  test("a time zone overridden by name only", () => {
    const s = realChrome();
    s.env.timezone = "America/New_York";
    s.env.timezoneOffsetFromName = 300;
    expect(ids(score({ signals: s }))).toContain("timezone-mismatch");
  });

  test("behaviour: scripted events and robotic pointer", () => {
    const behavior = {
      moves: 40,
      straightness: 1,
      speedCv: 0.01,
      jitter: 0,
      untrusted: 3,
      inputWithoutKeys: 2,
      coalescedMean: 0,
    } as BehaviorFeatures;
    expect(ids(score({ signals: realChrome(), behavior }))).toEqual([
      "untrusted-events",
      "input-without-keys",
      "robotic-pointer",
      "no-coalesced-events",
    ]);
  });

  test("a rule that throws is skipped, not fatal", () => {
    const result = score({ signals: realChrome() }, [
      {
        id: "boom",
        category: "automation",
        weight: 1,
        explain: "",
        test: () => {
          throw new Error("x");
        },
      },
    ]);
    expect(result.flags).toEqual([]);
  });
});

describe("verdicts and blending", () => {
  test("thresholds", () => {
    expect(verdictOf(0.1)).toBe("human");
    expect(verdictOf(0.35)).toBe("unsure");
    expect(verdictOf(0.8)).toBe("bot");
  });
  test("the model moves an unsure score in log-odds but never argues away a decisive rule", () => {
    expect(blend(0.5, null)).toBe(0.5);
    expect(blend(0.5, 0)).toBeCloseTo(0.201, 3);
    expect(blend(0.5, 1)).toBeCloseTo(0.799, 3);
    // An unsure model (0.5) moves nothing; a decided rule set is never argued with.
    expect(blend(0.6, 0.5)).toBeCloseTo(0.6 ** 0.7 / (0.6 ** 0.7 + 0.4 ** 0.7), 3);
    expect(blend(0.99, 0)).toBe(0.99);
    expect(blend(0.02, 1)).toBe(0.02);
    expect(rulesDecided(0.96)).toBe(true);
    expect(rulesDecided(0.5)).toBe(false);
  });

  test("a confident model saying bot where the rules said human raises doubt", () => {
    expect(verdictOf(blend(0.1, 0.95))).toBe("unsure");
    expect(verdictOf(blend(0.1, 0.7))).toBe("human");
  });
});

describe("values a fingerprint generator gets wrong", () => {
  const WINDOWS_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

  test("navigator.appVersion and oscpu name their system too", () => {
    const s = realChrome();
    s.env.appVersion = "5.0 (Windows)";
    s.env.oscpu = "Windows NT 10.0; Win64; x64";
    expect(claimedSystems(s)).toMatchObject({ appVersion: "windows", oscpu: "windows" });
    expect(ids(score({ signals: s }))).toContain("os-mismatch");
    s.env.appVersion = "5.0 (Macintosh)";
    s.env.oscpu = "Intel Mac OS X 10.15";
    expect(ids(score({ signals: s }))).not.toContain("os-mismatch");
  });

  test("a fresh iframe without Intl's constructors (Camoufox)", () => {
    const s = realChrome();
    if (!s.iframe) throw new Error("fixture");
    s.iframe.missing = ["Intl.DateTimeFormat", "Intl.NumberFormat"];
    const result = score({ signals: s });
    expect(ids(result)).toEqual(["fresh-realm-incomplete"]);
    expect(result.verdict).toBe("bot");
  });

  test("an error from the browser's privileged code, never from a page API", () => {
    const s = realChrome();
    s.errors = { audio: "Accessing TypedArray data over Xrays is slow, and forbidden" };
    const result = score({ signals: s });
    expect(ids(result)).toEqual(["browser-internals-exposed"]);
    expect(result.verdict).toBe("unsure");
    s.errors = { audio: "timeout", webgpu: "The operation is insecure." };
    expect(ids(score({ signals: s }))).toEqual([]);
  });

  test("fonts of another system than the user agent's", () => {
    const s = realChrome();
    s.env.userAgent = WINDOWS_UA;
    s.env.uaData = null;
    s.env.platform = "Win32";
    s.hardware.webgl = null;
    s.hardware.fonts = ["Arial", "Helvetica Neue", "Menlo", "Geneva"];
    expect(ids(score({ signals: s }))).toContain("fonts-os-mismatch");
    // Office's fonts on a Mac, a privacy setting hiding all but Arial: no contradiction.
    s.hardware.fonts = ["Arial", "Segoe UI", "Menlo", "Geneva"];
    expect(ids(score({ signals: s }))).not.toContain("fonts-os-mismatch");
    s.hardware.fonts = ["Arial"];
    expect(ids(score({ signals: s }))).not.toContain("fonts-os-mismatch");
  });

  test("a user agent overridden without its brands", () => {
    const s = realChrome();
    s.env.userAgent = s.env.userAgent.replace("Chrome/142", "Chrome/138");
    expect(ids(score({ signals: s }))).toEqual(["ua-version-mismatch"]);
    // Opera, Edge and Samsung name their own version beside Chromium's: Chrome/ still matches.
    s.env.userAgent = `${realChrome().env.userAgent} OPR/124.0.0.0`;
    s.env.uaData = {
      brands: ["Opera 124", "Chromium 142", "Not_A Brand 99"],
      mobile: false,
      platform: "macOS",
    };
    expect(ids(score({ signals: s }))).toEqual([]);
  });

  test("WebGL and WebGPU name makers one machine cannot have", () => {
    const s = realChrome();
    s.hardware.webgpu = { vendor: "nvidia", architecture: "ampere" };
    expect(ids(score({ signals: s }))).toContain("gpu-vendor-mismatch");
    // An Intel laptop with an NVIDIA card: each API may take another GPU.
    s.hardware.webgl = {
      ...(s.hardware.webgl as NonNullable<typeof s.hardware.webgl>),
      unmaskedVendor: "Google Inc. (Intel)",
      unmaskedRenderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    };
    expect(ids(score({ signals: s }))).not.toContain("gpu-vendor-mismatch");
  });

  test("CSS sees another screen than JavaScript", () => {
    const s = realChrome();
    s.env.screenMedia = { width: false, height: true, resolution: null };
    expect(ids(score({ signals: s }))).toEqual(["screen-media-mismatch"]);
    s.env.screenMedia = { width: true, height: true, resolution: null };
    expect(ids(score({ signals: s }))).toEqual([]);
    // Brave farbles JavaScript's screen and leaves CSS's: it does not count against Brave.
    s.env.screenMedia = { width: false, height: false, resolution: true };
    s.env.uaData = { brands: ["Brave 142", "Chromium 142"], mobile: false, platform: "macOS" };
    expect(ids(score({ signals: s }))).toEqual([]);
  });
});

describe("what a patch cannot rename", () => {
  const webgl = (s: ReturnType<typeof realChrome>) =>
    s.hardware.webgl as NonNullable<typeof s.hardware.webgl>;

  test("a graphics card's name on a software rasterizer's speed", () => {
    const s = realChrome();
    webgl(s).renderMs = 70;
    const result = score({ signals: s });
    expect(ids(result)).toEqual(["software-speed-gpu-name"]);
    // Weak alone: a slow card never gets the extra step from it.
    expect(result.verdict).toBe("human");
    webgl(s).renderMs = 0.7;
    expect(ids(score({ signals: s }))).toEqual([]);
  });

  test("a renderer that already names itself software, or a phone, is not counted twice", () => {
    const s = headlessChromium();
    webgl(s).renderMs = 70;
    expect(ids(score({ signals: s }))).not.toContain("software-speed-gpu-name");
    const phone = realChrome();
    phone.env.userAgent = `${phone.env.userAgent.replace("(Macintosh;", "(Linux; Android 14;")} Mobile`;
    webgl(phone).renderMs = 120;
    expect(ids(score({ signals: phone }))).not.toContain("software-speed-gpu-name");
  });
});
