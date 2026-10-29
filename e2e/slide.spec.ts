import { expect, type Page, test } from "@playwright/test";
import { chromeHeaders } from "../tests/browser-headers";
import { realChrome } from "../tests/fixtures";

const UA = realChrome().env.userAgent;
test.use({ userAgent: UA });

const widget = (page: Page) => page.locator("notabot-check");
const state = (page: Page) =>
  widget(page).evaluate((el) => (el as unknown as { state: string }).state);

/**
 * The server's verdict must be "unsure" for the slider to matter, whatever this runner's GPU
 * says: /verify gets a known Chrome's signals and headers (a software GPU, nothing else). The
 * drag, and its judgement by /slide, are the real browser's.
 */
async function doubtfulVerify(page: Page) {
  await page.route("**/worker/verify", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    const signals = realChrome();
    signals.automation.softwareRenderer = true;
    const origin = (await route.request().headerValue("origin")) ?? "";
    // Sent from Node, not the browser, which would add its own HeadlessChrome client hints.
    const response = await route.fetch({
      headers: { ...chromeHeaders(UA, { origin }), "content-type": "application/json" },
      postData: JSON.stringify({ ...body, signals, behavior: null }),
    });
    await route.fulfill({ response });
  });
}

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

test("signed mode: the server places the zone, judges the drag and signs a human token", async ({
  page,
  request,
}) => {
  await doubtfulVerify(page);
  const slides: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/worker/slide")) slides.push(r.postData() ?? "");
  });
  await page.goto("/worker.html");
  await widget(page).locator("button.seal").click();
  await expect.poll(() => state(page), { timeout: 20_000 }).toBe("challenge");
  const zone = await widget(page).evaluate(
    (el) => (el as unknown as { result: { zone: number } }).result.zone,
  );
  const left = await widget(page)
    .locator(".zone")
    .evaluate((z) => Number.parseFloat((z as HTMLElement).style.left));
  expect(left).toBe(zone);
  // A scripted straight drag: the server says no.
  const handle = widget(page).locator(".handle");
  const h = await handle.boundingBox();
  const z = await widget(page).locator(".zone").boundingBox();
  if (!h || !z) throw new Error("slider not laid out");
  const target = z.x + z.width / 2 + h.width / 2 - 2;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(target, h.y + h.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect(widget(page).locator(".hint")).toContainText("try again");
  expect(slides).toHaveLength(1);
  // A hand's drag: the server re-signs the token as human.
  const h2 = await widget(page).locator(".handle").boundingBox();
  if (!h2) throw new Error("slider not laid out");
  await drag(page, h2.x + h2.width / 2, target, h2.y + h2.height / 2);
  await expect.poll(() => state(page)).toBe("human");
  expect(slides).toHaveLength(2);
  const token = await widget(page).evaluate((el) => (el as unknown as { token: string }).token);
  const verify = await request.post("/worker/siteverify", {
    data: { secret: "dev-secret", response: token },
  });
  expect(await verify.json()).toMatchObject({ success: true, verdict: "human" });
});

test("signed mode: a page that calls the slider passed by itself gets nothing signed", async ({
  page,
}) => {
  await doubtfulVerify(page);
  await page.goto("/worker.html");
  await widget(page).locator("button.seal").click();
  await expect.poll(() => state(page), { timeout: 20_000 }).toBe("challenge");
  const unsure = await widget(page).evaluate((el) => (el as unknown as { token: string }).token);
  // What a script can do from the page: post a forged "landed" with a ruler-straight drag.
  const answer = await page.evaluate(async (token) => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      x: 100 + i * 10,
      y: 50,
      t: i * 16,
      trusted: true,
      coalesced: 1,
      pressure: 0,
      type: "pointermove",
    }));
    const res = await fetch("/worker/slide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, samples, track: { left: 0, width: 400 }, landed: true }),
    });
    return res.json();
  }, unsure);
  expect(answer).toMatchObject({ passed: false });
});
