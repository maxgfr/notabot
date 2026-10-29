// A site that installed notabot from npm, and nothing else from this repository: Express gates a
// form and serves the widget from the package's own files, Hono gates on a second port, and a
// Fetch handler wrapped by protect() runs on a third. Started by scripts/package-e2e.ts.
import { serve } from "@hono/node-server";
import express from "express";
import { Hono } from "hono";
import { createNotabot, notabotExpress, notabotHono } from "notabot/middleware";
import { createChallenge } from "notabot/server";

const PORT = Number(process.env.PORT ?? 4500);
const KEY = "package-e2e-key";
const common = { hmacKey: KEY, siteSecret: "site-secret", maxnumber: 5000 };
// One instance per visible challenge, so each test knows which it gets (same key).
const slide = createNotabot({ ...common, basePath: "/notabot", visibleChallenges: ["slide"] });
const targets = createNotabot({ ...common, basePath: "/targets", visibleChallenges: ["targets"] });
const local = createNotabot({ ...common, basePath: "/local", local: true });

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${title}</title></head><body>${body}</body></html>`;

const app = express();
app.use(express.urlencoded({ extended: false }), express.json());
app.use("/cdn", express.static("node_modules/notabot/dist/cdn"));

// The one-line embed: every option from data-* on the script tag.
app.get("/embed", (_req, res) =>
  res.send(
    page(
      "embed",
      `<form id="signup" method="post" action="/signup"><input name="email" value="a@b.c">
<button type="submit">Sign up</button></form>
<script type="module" src="/cdn/notabot.js" data-form="#signup" data-challenge-url="/notabot/challenge"
  data-verify-url="/notabot/verify" data-challenges="slide" data-lang="fr"></script>`,
    ),
  ),
);

// The element with its attributes, in a form gated by the middleware.
app.get("/form", (req, res) => {
  const base = req.query.base === "targets" ? "/targets" : "/notabot";
  res.send(
    page(
      "form",
      `<form id="signup" method="post" action="/signup${base === "/targets" ? "?base=targets" : ""}">
<input name="email" value="a@b.c">
<notabot-check challenge-url="${base}/challenge" verify-url="${base}/verify"></notabot-check>
<button type="submit">Sign up</button></form>
<script type="module" src="/cdn/notabot.js" data-form="#signup"></script>`,
    ),
  );
});

app.get("/attributes", (_req, res) =>
  res.send(
    page(
      "attributes",
      `<form id="a"><notabot-check lang="de" theme="dark" no-honeypot data-msg-retry="Nochmal"></notabot-check></form>
<form id="b"><notabot-check lang="es"></notabot-check></form>
<script type="module" src="/cdn/notabot.js"></script>`,
    ),
  ),
);

// A puzzle that is already expired: the widget must say why, after one fresh try.
app.get("/expired/challenge", async (_req, res) =>
  res.json(await createChallenge({ hmacKey: KEY, maxnumber: 50, expiresInSeconds: -60 })),
);
app.get("/expired", (_req, res) =>
  res.send(
    page(
      "expired",
      `<notabot-check challenge-url="/expired/challenge" verify-url="/notabot/verify"></notabot-check>
<script type="module" src="/cdn/notabot.js"></script>`,
    ),
  ),
);

app.get("/local", (_req, res) =>
  res.send(
    page(
      "local",
      `<notabot-check challenge-url="/local/challenge" verify-url="/local/verify" local></notabot-check>
<script type="module" src="/cdn/notabot.js"></script>`,
    ),
  ),
);

// The backend: the gate, then siteverify for the sealed signals.
const gate = (nb) => notabotExpress(nb);
app.post("/signup", (req, res, next) =>
  gate(req.query.base === "targets" ? targets : slide)(req, res, next),
);
app.post("/signup", async (req, res) => {
  res.json({
    accepted: true,
    verdict: req.notabot.verdict,
    smart: req.notabot.claims?.smart ?? null,
  });
});
app.post("/backend/siteverify", async (req, res) => {
  const r = await fetch(`http://localhost:${PORT}/notabot/siteverify`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: "site-secret", response: req.body.token ?? "" }),
  });
  res.json(await r.json());
});

app.use(notabotExpress(slide, { routesOnly: true }));
app.use(notabotExpress(targets, { routesOnly: true }));
app.use(notabotExpress(local, { routesOnly: true }));
app.listen(PORT, () => console.log(`express ready http://localhost:${PORT}`));

// Hono, gating everything (no token required: the request alone is scored).
const hono = new Hono();
hono.use("*", notabotHono(createNotabot({ hmacKey: KEY, requireToken: false })));
hono.get("/", (c) => c.json({ ok: true, verdict: c.get("notabot").verdict }));
serve({ fetch: hono.fetch, port: PORT + 1 }, () => console.log("hono ready"));

// A bare Fetch handler wrapped by protect(), as in Next.js route handlers or Bun.serve.
const guarded = createNotabot({ ...common, basePath: "/notabot" });
serve(
  { fetch: guarded.protect(() => Response.json({ ok: true, message: "welcome" })), port: PORT + 2 },
  () => console.log("fetch ready"),
);
