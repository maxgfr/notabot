import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

const check = (page: Page) => page.locator("notabot-check");
const state = (page: Page) =>
  check(page).evaluate((el) => (el as unknown as { state: string }).state);

test("simulate a bot: presets change a copy of the signals, scored side by side", async ({
  page,
}) => {
  await page.goto("/notabot/");
  const result = page.locator("#simulate-result");
  await expect(result).toContainText("%");
  const preset = page.getByRole("button", { name: "navigator.webdriver = true" });
  await preset.click();
  await expect(preset).toHaveAttribute("aria-pressed", "true");
  await expect(result.locator(".sim-score").nth(1)).toContainText("Refused");
});

test("what the server would add: every server rule, the server-only ones marked", async ({
  page,
}) => {
  await page.goto("/notabot/");
  const rules = page.locator("#server-rules li");
  await expect(rules.first()).toBeVisible();
  expect(await rules.count()).toBeGreaterThanOrEqual(20);
  await expect(
    page.locator("#server-rules li.server", { hasText: "ja4-ua-mismatch" }),
  ).toBeVisible();
});

test("the AI stack loads when the visitor reaches the officer, not before", async ({ page }) => {
  const catalog: string[] = [];
  page.on("request", (r) => {
    if (/models\.json|models\.dev|openrouter\.ai/.test(r.url())) catalog.push(r.url());
  });
  await page.goto("/notabot/");
  await expect(page.locator("#pp-engine")).not.toHaveText("…");
  await page.waitForTimeout(500);
  expect(catalog).toEqual([]);
  await page.locator("#officer").scrollIntoViewIfNeeded();
  await expect.poll(() => catalog.length, { timeout: 10_000 }).toBeGreaterThan(0);
});

test("the full report downloads as JSON: verdict, flags, features, prompt, signals", async ({
  page,
}) => {
  await page.goto("/notabot/");
  await check(page).locator("button.seal").click();
  await expect.poll(() => state(page), { timeout: 20_000 }).toBe("bot");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#download-report").click(),
  ]);
  const report = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(report).toMatchObject({ verdict: "bot" });
  expect(report.flags.map((f: { id: string }) => f.id)).toContain("webdriver");
  expect(report.features.webdriver).toBe(true);
  expect(report.prompt).toContain("system:");
  expect(report.signals.env.userAgent).toBeTruthy();
});

test("the widget is a checkbox to assistive technology, updated in place", async ({ page }) => {
  await page.goto("/notabot/");
  const seal = check(page).locator("button.seal");
  await expect(seal).toHaveAttribute("role", "checkbox");
  await expect(seal).toHaveAttribute("aria-checked", "false");
  await expect(check(page).getByRole("checkbox", { name: "I'm not a bot" })).toBeVisible();
  await check(page).evaluate((el) => {
    (el as unknown as { kept: unknown }).kept = el.shadowRoot?.querySelector('[role="status"]');
  });
  await seal.click();
  await expect.poll(() => state(page), { timeout: 20_000 }).toBe("bot");
  // The same live region throughout: screen readers keep hearing it.
  expect(
    await check(page).evaluate(
      (el) =>
        (el as unknown as { kept: unknown }).kept ===
        el.shadowRoot?.querySelector('[role="status"]'),
    ),
  ).toBe(true);
  // A failed slide keeps focus on the handle of the challenge rebuilt in place.
  await check(page).evaluate((el) => {
    el.setAttribute("challenges", "slide");
    (el as unknown as { challenge(): void }).challenge();
  });
  await check(page).locator(".handle").focus();
  await page.keyboard.press("Enter");
  await expect(check(page).locator(".hint")).toContainText("try again");
  expect(await check(page).evaluate((el) => el.shadowRoot?.activeElement?.className)).toBe(
    "handle",
  );
});

test("messages can be overridden by attribute, and other languages are built in", async ({
  page,
}) => {
  await page.goto("/form.html");
  await expect(check(page)).toHaveCount(1);
  await check(page).evaluate((el) => {
    el.setAttribute("data-msg-label", "Human here");
    el.setAttribute("lang", "de");
  });
  await expect(check(page).locator(".label")).toHaveText("Human here");
  await expect(check(page).locator(".by")).toHaveText("notabot, Open Source");
});

test("smart signals, in-house: a visitor id and the browser's signals, on arrival", async ({
  page,
}) => {
  await page.goto("/notabot/");
  const smart = page.locator("#smart-signals");
  await expect(smart.locator("dd").first()).toHaveText(/^[0-9a-f]{20} · confidence \d+ %$/);
  // Headless Chromium draws with SwiftShader: a virtual machine's or a server's graphics.
  await expect(smart).toContainText("SwiftShader");
});
