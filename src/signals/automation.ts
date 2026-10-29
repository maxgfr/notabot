import type { AutomationSignals, EnvSignals, WebGLInfo } from "./types";
import { engineOfEvalLength, engineOfUserAgent } from "./util";

/** Globals that Selenium, Playwright, Puppeteer, PhantomJS, Nightmare or Cypress leave behind. */
const AUTOMATION_GLOBALS = [
  "__playwright",
  "__pwInitScripts",
  "__playwright__binding__",
  "__puppeteer_evaluation_script__",
  "_phantom",
  "callPhantom",
  "__nightmare",
  "domAutomation",
  "domAutomationController",
  "_selenium",
  "calledSelenium",
  "_Selenium_IDE_Recorder",
  "__webdriver_script_fn",
  "__driver_evaluate",
  "__webdriver_evaluate",
  "__selenium_evaluate",
  "__fxdriver_evaluate",
  "__driver_unwrapped",
  "__webdriver_unwrapped",
  "__selenium_unwrapped",
  "__fxdriver_unwrapped",
  "__lastWatirAlert",
  "Cypress",
];

const DOCUMENT_ATTRIBUTES = ["webdriver", "selenium", "driver"];

export function automationGlobals(win: Window = window): string[] {
  const found = AUTOMATION_GLOBALS.filter((name) => name in win);
  for (const key of Object.keys(win)) if (/^\$?cdc_|_Selenium|^\$wdc_/.test(key)) found.push(key);
  for (const key of Object.keys(win.document))
    if (/^\$?cdc_|^\$wdc_|selenium|webdriver/i.test(key)) found.push(`document.${key}`);
  const root = win.document.documentElement;
  for (const attr of DOCUMENT_ATTRIBUTES) if (root.hasAttribute(attr)) found.push(`html[${attr}]`);
  return [...new Set(found)];
}

const SOFTWARE_RENDERER =
  /SwiftShader|llvmpipe|softpipe|Software Rasterizer|Microsoft Basic Render/i;

/** The classic tells of an automated or headless browser. */
export async function collectAutomation(
  env: EnvSignals,
  webgl: WebGLInfo | null,
): Promise<AutomationSignals> {
  const nav = navigator;
  const ua = nav.userAgent;
  const claimed = engineOfUserAgent(ua);
  let notificationMismatch = false;
  try {
    if (typeof Notification !== "undefined" && nav.permissions?.query) {
      const status = await nav.permissions.query({ name: "notifications" });
      notificationMismatch = Notification.permission === "denied" && status.state === "prompt";
    }
  } catch {}
  const renderer = `${webgl?.unmaskedRenderer ?? ""} ${webgl?.renderer ?? ""}`;
  return {
    webdriver: typeof nav.webdriver === "boolean" ? nav.webdriver : null,
    webdriverOwnProperty: Object.getOwnPropertyDescriptor(nav, "webdriver") !== undefined,
    headlessUserAgent: /HeadlessChrome|PhantomJS|SlimerJS/.test(ua),
    headlessBrand: (env.uaData?.brands ?? []).some((b) => /Headless/i.test(b)),
    chromeObjectMissing:
      claimed === "blink" && !/Android/.test(ua) && !("chrome" in window && window.chrome),
    plugins: nav.plugins?.length ?? 0,
    mimeTypes: nav.mimeTypes?.length ?? 0,
    pluginsGenuine:
      typeof PluginArray !== "undefined" &&
      nav.plugins instanceof PluginArray &&
      typeof MimeTypeArray !== "undefined" &&
      nav.mimeTypes instanceof MimeTypeArray,
    notificationPermissionMismatch: notificationMismatch,
    automationGlobals: automationGlobals(),
    outerSizeZero: outerWidth === 0 && outerHeight === 0,
    emptyLanguages: !nav.languages || nav.languages.length === 0,
    softwareRenderer: SOFTWARE_RENDERER.test(renderer),
    engineClaimed: claimed,
    engineObserved: engineOfEvalLength(env.evalLength),
  };
}

declare global {
  interface Window {
    chrome?: unknown;
  }
}
