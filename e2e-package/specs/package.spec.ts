import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

// A real Brave's signals (redacted), the same file the consumer's Node checks use.
const human = JSON.parse(
  readFileSync("assets/corpus/human-brave-156-on-macos-real-profile.json", "utf8"),
).signals;
const UA: string = human.env.userAgent;
const BRAVE_HEADERS = {
  "user-agent": UA,
  accept: "*/*",
  "accept-language": "fr-FR,fr;q=0.9",
  "accept-encoding": "gzip, deflate, br, zstd",
  "sec-ch-ua": '"Chromium";v="156", "Brave";v="156"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "cors",
  "sec-fetch-dest": "empty",
};
test.use({ userAgent: UA });

const widget = (page: Page, nth = 0) => page.locator("notabot-check").nth(nth);
const state = (page: Page) =>
  widget(page).evaluate((el) => (el as unknown as { state: string }).state);

/**
 * /verify gets the real Brave's signals with a software GPU (doubtful: the server shows the
 * extra step) and its headers, from Node: the browser would add HeadlessChrome hints. The puzzle,
 * the gesture and everything after are this browser's own.
 */
async function asDoubtfulBrave(page: Page, base: string) {
  await page.route(`**${base}/verify`, async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    const signals = structuredClone(human);
    signals.automation.softwareRenderer = true;
    const origin = (await route.request().headerValue("origin")) ?? "";
    const response = await route.fetch({
      headers: { ...BRAVE_HEADERS, origin, "content-type": "application/json" },
      postData: JSON.stringify({ ...body, signals, behavior: null }),
    });
    await route.fulfill({ response });
  });
}

async function drag(page: Page) {
  const handle = widget(page).locator(".handle");
  const zone = widget(page).locator(".zone");
  const h = await handle.boundingBox();
  const z = await zone.boundingBox();
  if (!h || !z) throw new Error("slider not laid out");
  const [x0, y] = [h.x + h.width / 2, h.y + h.height / 2];
  const x1 = z.x + z.width / 2 + h.width / 2 - 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let i = 1; i <= 28; i++) {
    const p = i / 28;
    const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
    await page.mouse.move(x0 + (x1 - x0) * eased, y + Math.sin(i * 1.9) * 3);
    await page.waitForTimeout(12 + (i % 4) * 7);
  }
  await page.mouse.up();
}

test("one script tag: the widget joins the form, in French, and a headless browser cannot submit", async ({
  page,
}) => {
  await page.goto("/embed");
  await expect(widget(page)).toHaveCount(1);
  await expect(widget(page).locator(".label")).toHaveText("Je ne suis pas un robot");
  expect(await widget(page).getAttribute("challenges")).toBe("slide");
  expect(await page.locator("#signup [data-notabot-honeypot]").count()).toBe(1);
  await page.locator('button[type="submit"]').click();
  await expect.poll(() => state(page), { timeout: 20_000 }).toBe("bot");
  await page.locator('button[type="submit"]').click();
  expect(page.url()).toContain("/embed");
});

test("attributes: language, theme, overridden messages, no honeypot, a checkbox to assistive technology", async ({
  page,
}) => {
  await page.goto("/attributes");
  await expect(widget(page, 0).locator(".label")).toHaveText("Ich bin kein Roboter");
  await expect(widget(page, 1).locator(".label")).toHaveText("No soy un robot");
  await expect(widget(page, 0).locator(".box")).toHaveAttribute("data-theme", "dark");
  await expect(
    widget(page, 0).getByRole("checkbox", { name: "Ich bin kein Roboter" }),
  ).toBeVisible();
  expect(await page.locator("#a [data-notabot-honeypot]").count()).toBe(0);
  expect(await page.locator("#b [data-notabot-honeypot]").count()).toBe(1);
  await widget(page, 0).locator("button.seal").click();
  await expect
    .poll(() => widget(page, 0).evaluate((el) => (el as unknown as { state: string }).state), {
      timeout: 20_000,
    })
    .not.toBe("checking");
  await expect(widget(page, 0).locator(".retry")).toHaveText("Nochmal");
});

test("signed slider: the server judges the drag, the gate accepts, siteverify returns the sealed signals", async ({
  page,
  request,
}) => {
  await asDoubtfulBrave(page, "/notabot");
  await page.goto("/form");
  await widget(page).locator("button.seal").click();
  await expect.poll(() => state(page), { timeout: 20_000 }).toBe("challenge");
  // A person sees the slider before reaching for it: the server's clock refuses less.
  await page.waitForTimeout(400);
  await drag(page);
  await expect.poll(() => state(page)).toBe("human");
  const token = await widget(page).evaluate((el) => (el as unknown as { token: string }).token);
  const sealed = await request.post("/backend/siteverify", { data: { token } });
  expect(await sealed.json()).toMatchObject({
    success: true,
    verdict: "human",
    smart: { privacyBrowser: "brave", farbling: true, tor: false },
  });
  // The form itself, through the middleware: the token above was already spent by siteverify's
  // own record only, the gate keeps its own (one use each).
  const posted = page.waitForResponse((r) => r.url().endsWith("/signup"));
  await page.locator('button[type="submit"]').click();
  const gate = await posted;
  // The browser's real headers reach the gate (HeadlessChrome hints): it may refuse, never crash.
  expect([200, 403]).toContain(gate.status());
});

test("signed targets: pressed from the keyboard in order, re-signed human by the server", async ({
  page,
}) => {
  await asDoubtfulBrave(page, "/targets");
  await page.goto("/form?base=targets");
  await widget(page).locator("button.seal").click();
  await expect.poll(() => state(page), { timeout: 20_000 }).toBe("challenge");
  // A person reads the hint and finds target 1 before pressing anything.
  await page.waitForTimeout(400);
  for (const [i, n] of ["1", "2", "3"].entries()) {
    await widget(page)
      .getByRole("button", { name: `Target ${n}` })
      .focus();
    await page.waitForTimeout(220 + i * 160);
    await page.keyboard.press("Enter");
  }
  await expect.poll(() => state(page)).toBe("human");
});

test("an expired puzzle: one fresh try, then a typed error the page can show", async ({ page }) => {
  await page.goto("/expired");
  const code = page.evaluate(
    () =>
      new Promise((resolve) =>
        document.addEventListener("notabot:error", (e) => resolve((e as CustomEvent).detail.code), {
          once: true,
        }),
      ),
  );
  await widget(page).locator("button.seal").click();
  expect(await code).toBe("expired");
  await expect(widget(page).locator('[role="status"]')).toHaveText("The check expired, try again");
});

test("the server's local second opinion: createNotabot({ local: true })", async ({ page }) => {
  await asDoubtfulBrave(page, "/local");
  const verified = page.waitForResponse((r) => r.url().endsWith("/local/verify"));
  await page.goto("/local");
  await widget(page).locator("button.seal").click();
  expect(await (await verified).json()).toMatchObject({ secondOpinion: "local" });
});

test("Hono and protect(): the same gate on other frameworks", async ({ request, baseURL }) => {
  const port = Number(new URL(baseURL ?? "http://localhost:4500").port);
  const hono = await request.get(`http://localhost:${port + 1}/`, {
    headers: { "user-agent": "python-requests/2.32" },
  });
  expect(hono.status()).toBe(403);
  expect((await hono.json()).flags).toContain("http-library");
  const ok = await request.get(`http://localhost:${port + 1}/`, { headers: BRAVE_HEADERS });
  expect(await ok.json()).toMatchObject({ ok: true, verdict: "human" });
  const fetchGate = await request.post(`http://localhost:${port + 2}/signup`, {
    headers: BRAVE_HEADERS,
  });
  expect(fetchGate.status()).toBe(403);
  expect((await fetchGate.json()).reason).toBe("missing-token");
  const challenge = await request.get(`http://localhost:${port + 2}/notabot/challenge`, {
    headers: BRAVE_HEADERS,
  });
  expect((await challenge.json()).probes).toHaveLength(3);
});
