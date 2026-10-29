// Records the benchmark's automated side: real browsers driven by Playwright, each the way a bot
// would run it, reading the site's signals and behaviour. `bun run build && bun scripts/capture.ts`
// writes assets/corpus/<id>.json. Human captures are added from the site's "download" button:
// `bun run bench --add notabot-signals.json --label human --source "my Firefox"`.
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { type Browser, chromium, type LaunchOptions, type Page } from "@playwright/test";
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
  launch: LaunchOptions;
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
];

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
  for (const run of RUNS) {
    if (run.launch.executablePath && !existsSync(run.launch.executablePath)) continue;
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch(run.launch);
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
