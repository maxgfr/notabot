import { expect, test } from "@playwright/test";

test("the site and the script tag work from GitHub Pages", async ({ page, request }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto("/notabot/");
  await expect(page.locator("#pp-engine")).not.toHaveText("…");
  await page.locator("notabot-check button.seal").click();
  await expect
    .poll(
      () =>
        page.locator("notabot-check").evaluate((el) => (el as unknown as { state: string }).state),
      {
        timeout: 30_000,
      },
    )
    .toBe("bot");
  for (const path of [
    "/notabot/cdn/notabot.js",
    "/notabot/cdn/models.json",
    "/notabot/cdn/recommended.json",
    "/notabot/fr/",
  ]) {
    expect((await request.get(path)).ok(), path).toBe(true);
  }
  expect(problems).toEqual([]);
});
