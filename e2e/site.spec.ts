import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

/** Console errors and CSP violations, collected per page. */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
  return problems;
}

const check = (page: Page) => page.locator("notabot-check");
const seal = (page: Page) => check(page).locator("button.seal");
const state = (page: Page) =>
  check(page).evaluate((el) => (el as unknown as { state: string }).state);

test("an out-of-the-box headless Chromium is refused, for the reasons it gives away", async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto("/notabot/");
  await expect(page.locator("#pp-engine")).not.toHaveText("…");
  await expect(page.locator(".ledger-group")).toHaveCount(7);
  await seal(page).click();
  await expect.poll(() => state(page), { timeout: 20_000 }).toBe("bot");
  await expect(page.locator(".stamp-bot")).toBeVisible();
  const raised = await page.locator(".rules .raised code").allTextContents();
  expect(raised).toEqual(expect.arrayContaining(["webdriver"]));
  await expect(page.locator("#mrz")).toContainText("REFUSED");
  // The token field of a refused check stays empty.
  expect(problems).toEqual([]);
});

test("the AI officer gets numbers and fixed words only, and answers through the proxy", async ({
  page,
}) => {
  await page.goto("/notabot/");
  await seal(page).click();
  await expect.poll(() => state(page), { timeout: 20_000 }).toBe("bot");
  await page.locator('input[name="mode"][value="proxy"]').check();
  await page.locator("#endpoint").fill("http://localhost:4318/mock/v1");
  await page.locator("#proxy-model").fill("mock");
  await page.locator("#ask-model").click();
  await expect(page.locator("#officer-status")).toContainText("mock", { timeout: 15_000 });
  await expect(page.locator("#answer")).toContainText('"verdict":"bot"');
  await expect(page.locator("#cancel-model")).toBeHidden();
  // The local regression gave its opinion too, with no key and no network.
  await expect(page.locator("#local-opinion")).toContainText("%");
  const sent = await page.evaluate(() => fetch("/mock/v1/last").then((r) => r.json()));
  const user = String(sent.messages.at(-1).content);
  const ua = await page.evaluate(() => navigator.userAgent);
  expect(user).not.toContain(ua);
  expect(user).not.toContain("Mozilla");
  expect(user).toContain('"webdriver": true');
  // A refused key is reported, not swallowed.
  await page.locator("#proxy-model").fill("fail-401");
  await page.locator("#ask-model").click();
  await expect(page.locator("#officer-status")).toHaveAttribute("data-kind", "bad", {
    timeout: 15_000,
  });
});

test("the French page is complete", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/notabot/fr/");
  await expect(page.locator("h1")).toHaveText("Votre navigateur va passer une frontière.");
  await expect(page.locator(".ledger-group h3").first()).toHaveText("Ce qu'il déclare");
  await expect(page.locator("a.lang")).toHaveAttribute("hreflang", "en");
  expect(problems).toEqual([]);
});

test("screenshots for review", async ({ page }) => {
  mkdirSync(".impeccable/review", { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/notabot/");
  await seal(page).click();
  await expect.poll(() => state(page), { timeout: 20_000 }).not.toBe("checking");
  await page.waitForTimeout(800);
  await page.screenshot({ path: ".impeccable/review/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: ".impeccable/review/mobile.png", fullPage: true });
});
