import { expect, type Page, test } from "@playwright/test";

// A Chromium that hides the obvious automation flags, as a stealth setup would: no webdriver,
// no "HeadlessChrome" in the user agent. What remains (software GPU, quirks) is not decisive.
test.use({
  launchOptions: { args: ["--disable-blink-features=AutomationControlled"] },
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
});

const widget = (page: Page) => page.locator("notabot-check");
const state = (page: Page) =>
  widget(page).evaluate((el) => (el as unknown as { state: string }).state);

/** A hand-like drag: eases in and out, wobbles across the axis, uneven timing. */
async function drag(page: Page, fromX: number, toX: number, y: number) {
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  const steps = 28;
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
    await page.mouse.move(fromX + (toX - fromX) * eased, y + Math.sin(i * 1.9) * 3);
    await page.waitForTimeout(12 + (i % 4) * 7);
  }
  await page.mouse.up();
}

async function passSlider(page: Page) {
  const handle = widget(page).locator(".handle");
  const zone = widget(page).locator(".zone");
  await expect(handle).toBeVisible();
  const h = await handle.boundingBox();
  const z = await zone.boundingBox();
  if (!h || !z) throw new Error("slider not laid out");
  // The handle's left edge must land in the zone: aim its left edge at the zone's middle.
  await drag(page, h.x + h.width / 2, z.x + z.width / 2 + h.width / 2 - 2, h.y + h.height / 2);
}

test("one script tag guards a form: a stealth-patched headless browser gets no token", async ({
  page,
}) => {
  await page.goto("/form.html");
  await expect(widget(page)).toHaveCount(1);
  const token = page.locator('#signup input[type="hidden"][name="notabot-token"]');
  await expect(token).toHaveValue("");
  // Submitting early runs the check instead of sending the form.
  await page.locator('button[type="submit"]').click();
  await expect.poll(() => state(page), { timeout: 20_000 }).toBe("bot");
  const flags = await widget(page).evaluate((el) =>
    (el as unknown as { result: { rules: { flags: { id: string }[] } } }).result.rules.flags.map(
      (f) => f.id,
    ),
  );
  // webdriver is hidden and the user agent rewritten, yet the realm still contradicts itself.
  expect(flags).not.toContain("webdriver");
  // (os-mismatch shows up too when the runner is not Linux: the user agent here claims Linux.)
  expect(flags).toEqual(expect.arrayContaining(["headless-brand", "software-renderer"]));
  await page.locator('button[type="submit"]').click();
  expect(page.url()).toContain("/form.html");
  await expect(token).toHaveValue("");
});

async function openSlider(page: Page) {
  await page.goto("/notabot/");
  await widget(page).locator("button.seal").click();
  await expect.poll(() => state(page), { timeout: 20_000 }).not.toBe("checking");
  await widget(page).evaluate((el) => {
    el.setAttribute("challenges", "slide");
    (el as unknown as { challenge(): void }).challenge();
  });
  await expect.poll(() => state(page)).toBe("challenge");
}

test("the slider refuses a scripted straight drag and accepts a hand, which cannot overturn a decisive bot", async ({
  page,
}) => {
  await openSlider(page);
  const handle = widget(page).locator(".handle");
  const zone = widget(page).locator(".zone");
  const h = await handle.boundingBox();
  const z = await zone.boundingBox();
  if (!h || !z) throw new Error("slider not laid out");
  // A robot: even steps on a ruler line.
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(z.x + z.width / 2 + h.width / 2 - 2, h.y + h.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect(widget(page).locator(".hint")).toContainText("try again");
  expect(await state(page)).toBe("challenge");
  // A hand passes the slider; the signals still said bot, so the verdict stays bot.
  await passSlider(page);
  await expect.poll(() => state(page)).toBe("bot");
});

test("the keyboard way through the slider", async ({ page }) => {
  await openSlider(page);
  // Enter before reaching the zone: refused, and a new zone is drawn.
  await widget(page).locator(".handle").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(widget(page).locator(".hint")).toContainText("try again");
  const left = await widget(page)
    .locator(".zone")
    .evaluate((z) => Number.parseFloat((z as HTMLElement).style.left));
  await widget(page).locator(".handle").focus();
  const presses = Math.ceil((left + 5) / 2);
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(40 + (i % 3) * 25);
  }
  await page.keyboard.press("Enter");
  await expect.poll(() => state(page)).not.toBe("challenge");
});

test("with the Worker: a signed puzzle, a signed token, and siteverify", async ({
  page,
  request,
}) => {
  const verified = page.waitForResponse((r) => r.url().endsWith("/worker/verify"));
  await page.goto("/worker.html");
  await widget(page).locator("button.seal").click();
  // A real browser answers the puzzle's probes right: no probe flag.
  const flags = ((await (await verified).json()) as { flags: string[] }).flags;
  expect(flags).not.toContain("probe-mismatch");
  expect(flags).not.toContain("probes-missing");
  await expect.poll(() => state(page), { timeout: 20_000 }).not.toBe("checking");
  const result = await widget(page).evaluate((el) => {
    const r = (
      el as unknown as {
        result: { signed: boolean; token: string; solution: { signature: string } };
      }
    ).result;
    return { signed: r.signed, token: r.token, signature: r.solution.signature };
  });
  expect(result.signed).toBe(true);
  expect(result.signature).toMatch(/^[0-9a-f]{64}$/);
  const verify = await request.post("/worker/siteverify", {
    data: { secret: "dev-secret", response: result.token },
  });
  const body = await verify.json();
  expect(["human", "unsure", "bot"]).toContain(body.verdict);
  expect(body.hostname).toBe("localhost");
});

test("the middleware gates a route with the token a real browser obtained", async ({ page }) => {
  await page.goto("/worker.html");
  const call = (token: string | null) =>
    page.evaluate(async (t) => {
      const res = await fetch("/protected", {
        method: "POST",
        headers: t ? { "x-notabot-token": t } : {},
      });
      return { status: res.status, body: await res.json() };
    }, token);
  // No token: refused before anything else.
  expect(await call(null)).toMatchObject({ status: 403, body: { reason: "missing-token" } });
  await widget(page).locator("button.seal").click();
  await expect.poll(() => state(page), { timeout: 20_000 }).not.toBe("checking");
  const token = await widget(page).evaluate((el) => (el as unknown as { token: string }).token);
  // This stealth-patched headless browser was signed as a bot: the gate refuses it.
  const refused = await call(token);
  expect(refused.status).toBe(403);
  expect(refused.body.reason).toBe("verdict");
  // A forged token is refused as such.
  expect((await call(`${token.slice(0, -4)}0000`)).body.reason).toBe("bad-token");
});
