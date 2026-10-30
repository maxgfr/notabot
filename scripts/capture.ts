// Records the benchmark's automated side: real browsers driven by Playwright, each the way a bot
// would run it, reading the site's signals and behaviour. `bun run build && bun scripts/capture.ts`
// writes assets/corpus/<id>.json (`bun scripts/capture.ts camoufox` captures only the runs whose
// id holds "camoufox"). Firefox comes from `bunx playwright install firefox`, Patchright's
// Chromium from `bunx patchright install chromium`, Camoufox from a Python that has it
// (`CAMOUFOX_PYTHON`, default `python3`, after `pip install camoufox && python -m camoufox fetch`);
// a run whose browser is missing fails alone. Human captures are added from the site's "download"
// button: `bun run bench --add notabot-signals.json --label human --source "my Firefox"`.
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { type Browser, chromium, firefox, type LaunchOptions, type Page } from "@playwright/test";
import type { NotabotSignals } from "../src/signals/types";
import { redact } from "./redact";

const PORT = 4319;
const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const LINUX_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const HIDE = ["--disable-blink-features=AutomationControlled"];

interface Run {
  id: string;
  source: string;
  /** What launches it. Default Playwright's Chromium. */
  driver?: "chromium" | "firefox" | "patchright" | "camoufox";
  launch: LaunchOptions;
  /** Camoufox's own options (`os`, `humanize`…), turned into launch options by its package. */
  camoufox?: Record<string, unknown>;
  userAgent?: string;
  /** Scripted pointer moves (ruler-straight) and typing, as a bot filling a form. */
  act: boolean;
  /** Inject {@link STEALTH} before the page's scripts. */
  stealth?: boolean;
}

const RUNS: Run[] = [
  { id: "headless-shell", source: "Playwright Chromium, headless shell", launch: {}, act: false },
  {
    id: "headless-new",
    source: "Playwright Chromium, new headless",
    launch: { channel: "chromium" },
    act: true,
  },
  {
    id: "stealth-linux-ua",
    source: "Chromium, AutomationControlled off, Linux user agent",
    launch: { args: HIDE },
    userAgent: LINUX_UA,
    act: true,
  },
  {
    id: "spoofed-windows-ua",
    source: "Chromium, AutomationControlled off, Windows user agent on another system",
    launch: { args: HIDE },
    userAgent: WINDOWS_UA,
    act: false,
  },
  {
    id: "chrome-automated",
    source: "Installed Google Chrome, driven by Playwright (headless)",
    launch: { channel: "chrome" },
    act: true,
  },
  {
    id: "brave-automated",
    source: "Installed Brave, driven by Playwright (headless)",
    launch: { executablePath: BRAVE, args: HIDE },
    act: false,
  },
  {
    id: "stealth-js-layer",
    source: "Chromium with a stealth layer injected at load (webdriver, plugins, chrome, brands)",
    launch: { args: HIDE },
    userAgent: LINUX_UA,
    stealth: true,
    act: true,
  },
  {
    id: "chrome-headed-hidden",
    source: "Installed Google Chrome, headed, AutomationControlled off: the hardest here",
    launch: { channel: "chrome", headless: false, args: HIDE },
    act: true,
  },
  {
    id: "firefox-automated",
    source: "Playwright Firefox, headless, nothing hidden",
    driver: "firefox",
    launch: {},
    act: true,
  },
  {
    id: "patchright-headed",
    source: "Patchright (Playwright patched against its CDP leaks), Chromium, headed",
    driver: "patchright",
    launch: { headless: false },
    act: true,
  },
  {
    id: "camoufox-macos",
    source: "Camoufox, headless, a generated macOS fingerprint on a Mac",
    driver: "camoufox",
    launch: {},
    camoufox: { headless: true, os: "macos" },
    act: true,
  },
  {
    id: "camoufox-windows",
    source: "Camoufox, headless, a generated Windows fingerprint on a Mac",
    driver: "camoufox",
    launch: {},
    camoufox: { headless: true, os: "windows" },
    act: true,
  },
  {
    id: "camoufox-linux",
    source: "Camoufox, headed, a generated Linux fingerprint on a Mac, its human-like cursor",
    driver: "camoufox",
    launch: {},
    camoufox: { headless: false, os: "linux", humanize: true },
    act: true,
  },
];

const CAMOUFOX_PYTHON = process.env.CAMOUFOX_PYTHON ?? "python3";

/** Camoufox's binary, preferences and fingerprint (in its env), as its Python package builds them. */
async function camoufoxLaunch(options: Record<string, unknown>): Promise<LaunchOptions> {
  const code =
    "import json,sys\nfrom camoufox.utils import launch_options\nprint(json.dumps(launch_options(**json.loads(sys.argv[1]))))";
  const proc = Bun.spawn([CAMOUFOX_PYTHON, "-c", code, JSON.stringify(options)], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0)
    throw new Error(
      `camoufox: ${(await new Response(proc.stderr).text()).trim().split("\n").pop()}`,
    );
  const o = JSON.parse(out.trim().split("\n").pop() ?? "{}");
  return {
    executablePath: o.executable_path,
    args: o.args,
    env: o.env,
    firefoxUserPrefs: o.firefox_user_prefs,
    headless: o.headless,
  };
}

async function launch(run: Run): Promise<Browser> {
  switch (run.driver) {
    case "firefox":
      return firefox.launch(run.launch);
    case "camoufox":
      return firefox.launch({ ...run.launch, ...(await camoufoxLaunch(run.camoufox ?? {})) });
    case "patchright": {
      const { chromium: patched } = await import("patchright");
      return (await patched.launch(run.launch)) as unknown as Browser;
    }
    default:
      return chromium.launch(run.launch);
  }
}

/** What puppeteer-extra-plugin-stealth-style layers do: redefine what the page reads. */
const STEALTH = () => {
  const nav = Navigator.prototype;
  Object.defineProperty(nav, "webdriver", { get: () => undefined, configurable: true });
  Object.defineProperty(nav, "languages", { get: () => ["en-US", "en"], configurable: true });
  Object.defineProperty(nav, "plugins", {
    get: () => [{ name: "PDF Viewer" }, { name: "Chrome PDF Viewer" }],
    configurable: true,
  });
  const data = (navigator as unknown as { userAgentData?: { brands: unknown[] } }).userAgentData;
  if (data)
    Object.defineProperty(data, "brands", {
      get: () => [
        { brand: "Chromium", version: "142" },
        { brand: "Google Chrome", version: "142" },
      ],
    });
  (window as unknown as { chrome: unknown }).chrome = { runtime: {} };
};

async function capture(page: Page, act: boolean) {
  await page.goto(`http://localhost:${PORT}/notabot/`);
  await page.evaluate(async () => {
    const m = await import("/notabot/cdn/notabot.mjs" as string);
    (window as unknown as { __nb: unknown }).__nb = { m, t: m.trackBehavior(document) };
  });
  if (act) {
    await page.mouse.move(40, 40);
    await page.mouse.move(600, 400, { steps: 25 });
    await page.mouse.click(600, 400);
    await page.keyboard.type("bot@example.com", { delay: 30 });
  }
  return page.evaluate(async () => {
    const { m, t } = (
      window as unknown as {
        __nb: { m: { collect(): Promise<unknown> }; t: { features(): unknown } };
      }
    ).__nb;
    return { signals: await m.collect(), behavior: t.features() };
  });
}

if (!existsSync("dist/site/cdn/notabot.mjs")) throw new Error("run `bun run build` first");
const server = Bun.spawn(["bun", "scripts/serve.ts"], {
  env: { ...process.env, PORT: String(PORT) },
  stdout: "ignore",
});
await Bun.sleep(800);
await mkdir("assets/corpus", { recursive: true });
try {
  const only = process.argv[2];
  for (const run of RUNS) {
    if (only && !run.id.includes(only)) continue;
    if (run.launch.executablePath && !existsSync(run.launch.executablePath)) continue;
    let browser: Browser | null = null;
    try {
      browser = await launch(run);
      const context = await browser.newContext(run.userAgent ? { userAgent: run.userAgent } : {});
      if (run.stealth) await context.addInitScript(STEALTH);
      const { signals, behavior } = await capture(await context.newPage(), run.act);
      await Bun.write(
        `assets/corpus/${run.id}.json`,
        `${JSON.stringify({ id: run.id, label: "bot", source: run.source, signals: redact(signals as NotabotSignals), behavior }, null, 1)}\n`,
      );
      console.log(`${run.id}: captured`);
    } catch (e) {
      console.warn(`${run.id}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    } finally {
      await browser?.close();
    }
  }
} finally {
  server.kill();
}
