// The package end to end, as a site installs it: packs notabot (or, with --published, takes the
// registry's version, NOTABOT_VERSION or latest), installs it with Express and Hono in a scratch
// project, runs the Node checks there, starts the consumer app (e2e-package/consumer) and drives
// it with Chromium (e2e-package/specs). Nothing from src/ is imported by the consumer.
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";

const published = process.argv.includes("--published");
const root = resolve(import.meta.dir, "..");
const PORT = 4500;
const wanted = process.env.NOTABOT_VERSION?.replace(/^v/, "");
const dir = await mkdtemp(join(tmpdir(), "notabot-consumer-"));
let server: ReturnType<typeof Bun.spawn> | null = null;
try {
  const source = published
    ? `notabot@${wanted ?? "latest"}`
    : join(dir, (await $`npm pack --silent --pack-destination ${dir}`.cwd(root).text()).trim());
  await Bun.write(
    join(dir, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }),
  );
  await $`npm install --silent --no-audit --no-fund ${source} express@^5 hono@^4 @hono/node-server`.cwd(
    dir,
  );
  const version = (await $`npm ls notabot --json`.cwd(dir).json()).dependencies.notabot.version;
  console.log(`consumer: notabot@${version}`);
  await cp(join(root, "e2e-package/consumer"), dir, { recursive: true });
  // A real browser's signals (a Brave, redacted), for the checks that need a person.
  await cp(
    join(root, "assets/corpus/human-brave-156-on-macos-real-profile.json"),
    join(dir, "fixture-human.json"),
  );

  await $`node node-checks.mjs`.cwd(dir);

  server = Bun.spawn(["node", "server.mjs"], {
    cwd: dir,
    env: { ...process.env, PORT: String(PORT) },
    stdout: "inherit",
    stderr: "inherit",
  });
  for (let i = 0; ; i++) {
    const up = await Promise.all(
      [PORT, PORT + 1, PORT + 2].map((p) =>
        fetch(`http://localhost:${p}/`).then(
          () => true,
          () => false,
        ),
      ),
    );
    if (up.every(Boolean)) break;
    if (i > 50) throw new Error("the consumer app did not start");
    await Bun.sleep(200);
  }
  await $`bunx playwright test -c playwright.package.config.ts`.cwd(root).env({
    ...process.env,
    PACKAGE_BASE: `http://localhost:${PORT}`,
  });
} finally {
  server?.kill();
  await rm(dir, { recursive: true, force: true });
}
