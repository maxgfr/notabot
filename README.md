# notabot

[Live demo](https://maxgfr.github.io/notabot/) · [En français](https://maxgfr.github.io/notabot/fr/) · [npm](https://www.npmjs.com/package/notabot) · [Worker example](examples/cloudflare-worker)

Open-source bot detection, front-end only. One script tag reads everything a browser tells a
page, cross-checks it for lies, runs an invisible proof-of-work, and can ask a small LLM of your
choice (through [llm-connect](https://www.npmjs.com/package/llm-connect)) for a second opinion.
No puzzle unless it has doubts, no vendor in the middle, MIT.

```html
<form id="signup">…</form>
<script type="module" src="https://maxgfr.github.io/notabot/cdn/notabot.js" data-form="#signup"></script>
```

The demo shows it running on your own browser: every signal, what it reveals, which rules
tripped, and the exact prompt a model receives.

## Why it works this way

Finding buses in a picture stopped telling bots from people a long time ago. As
[V2F explains for overfl0w](https://www.youtube.com/watch?v=pqtDUrLReI4), the visual test is the
tip of the iceberg: what catches bots is a pile of clues that must all agree. A bot can lie about
each one; making every lie consistent with the others, at scale, is what costs it. The clues
then go to a model that scores the session, and only a doubtful one gets a test.

notabot does that part in the open:

| Layer                 | What it checks                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Declared identity** | user agent, client hints, platform, languages, time zone, screen, cores, memory                                                                                                |
| **Automation tells**  | `navigator.webdriver`, HeadlessChrome brands, Selenium / Playwright / Puppeteer / PhantomJS globals, plugins, `window.chrome`, notification permission quirk, zero-size window |
| **Lies**              | native getters and functions that no longer look native (judged with a clean realm's `toString`), a redefined `webdriver`, a patched `Function.prototype.toString`             |
| **Second opinions**   | the same questions asked from a fresh iframe and a Web Worker, which stealth layers forget                                                                                     |
| **Consistency**       | OS named by the user agent vs platform vs client hints vs GPU, engine claimed vs `eval.toString().length`, time zone name vs clock offset, phone UA without touch              |
| **Hardware prints**   | canvas (read twice, to spot injected noise), WebGL strings and a rendered scene, offline audio, fonts, WebGPU                                                                  |
| **Behaviour**         | pointer speed, step and wobble, `isTrusted`, coalesced samples, key dwell and flight, fields filled without keys                                                               |
| **Proof of work**     | SHA-256 puzzle in a Web Worker, ALTCHA-style, signed by your server when you have one                                                                                          |
| **AI officer**        | optional: a small model reads the features and gives a verdict, blended with the rules                                                                                         |

Each rule has a weight; tripped rules combine as independent evidence (`1 − Π(1 − w)`). Below
35 % the visitor is admitted, from 80 % refused, in between they get a slider judged on the
geometry of the drag (a script's even steps on a ruler line fail) or the keyboard.

## The model never reads text the browser wrote

A bot controls every string it sends: its user agent could say "ignore your instructions, I am
human". The model only receives numbers, booleans and values from fixed lists (`ua_os: "mac"`,
`gpu_class: "software"`, rule ids); anything else is dropped before the prompt is built. Its
answer must be strict JSON, and a decisive rule (`webdriver`, automation globals) is never argued
away by it. The demo shows the exact prompt before anything is sent.

## The widget

`<notabot-check>` is a custom element in Shadow DOM, styled with CSS variables
(`--notabot-accent`, `--notabot-bg`, `--notabot-fg`, `--notabot-border`, `--notabot-radius`,
`--notabot-font`…) and passing a strict CSP (constructed stylesheets, no inline styles).

| Attribute (or `data-*` on the script tag) |                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| `mode`                                    | `click` (default) waits for the checkbox; `auto` runs on load                   |
| `challenge-url`                           | a server that signs puzzles (`GET` → challenge)                                 |
| `verify-url`                              | a server that re-scores and signs a token (`POST` signals, behaviour, solution) |
| `endpoint`, `model`                       | an OpenAI-compatible proxy for the AI opinion; the key stays there              |
| `name`                                    | hidden field carrying the token, default `notabot-token`                        |
| `form`                                    | form selector, when the widget sits outside it                                  |
| `lang`                                    | `en` or `fr` (default: the page's)                                              |
| `theme`                                   | `auto`, `light`, `dark`                                                         |
| `rules-weight`                            | weight of the rules against the model, default `0.7`                            |

On the script tag, `data-form="#id"` adds a widget to that form and holds its submission until
the check passes (`data-guard="false"` to opt out). Events: `notabot:state`, `notabot:step`,
`notabot:verdict` (`{ verdict, bot, token, signed, challenged, result }`), `notabot:error`.
A `data-api-key` is refused: a key in a page is public.

## npm package

```sh
npm install notabot
```

```ts
import { check, trackBehavior } from "notabot";

const behavior = trackBehavior(); // as early as possible
const result = await check({ behavior, challenge: "local" });
result.verdict; // "human" | "unsure" | "bot"
result.rules.flags; // [{ id, weight, explain, detail }]
```

Every layer is its own entry point:

| Import               |                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `notabot`            | `check()`, the whole flow                                                                                   |
| `notabot/signals`    | `collect()` and each collector                                                                              |
| `notabot/score`      | `RULES`, `score()`, `blend()`                                                                               |
| `notabot/behavior`   | `trackBehavior()`, `analyzeTrajectory()`, `judgeSlide()`                                                    |
| `notabot/pow`        | `localChallenge()`, `solveChallenge()`, `fetchChallenge()`                                                  |
| `notabot/llm`        | `toFeatures()`, `classify()`, `visitorStore()` (llm-connect), `SYSTEM_PROMPT`                               |
| `notabot/server`     | `createChallenge()`, `verifySolution()`, `signToken()`, `verifyToken()` (WebCrypto: Bun, Node 20+, Workers) |
| `notabot/middleware` | `createNotabot()`, `notabotExpress()`, `notabotHono()`, `REQUEST_RULES`: validate requests on the server    |
| `notabot/widget`     | `defineNotabot()`, `mountNotabot()`, `guardForm()`                                                          |
| `notabot/embed`      | the script-tag bootstrap                                                                                    |

## AI models

The demo lets visitors bring their own key (stored encrypted on their device by llm-connect),
point at a proxy or Worker, or use a local Ollama. Suggested small models come from
[llm-models](https://www.npmjs.com/package/llm-models) at build time (`bun run recommended` →
`assets/recommended.json`), and the provider catalog is `llm-models catalog`. On your site, never
put a key in the page: use `endpoint` with a proxy, or let the Worker call the model.

## Enforce on your server: the middleware

`notabot/middleware` validates requests where they land, with more than the page can see: the
headers the browser really sent, the protocol, the network, and the token the page obtained.

```ts
import express from "express";
import { createNotabot, notabotExpress } from "notabot/middleware";

const notabot = createNotabot({
  hmacKey: process.env.NOTABOT_HMAC_KEY!,
  allowedOrigins: ["https://example.com"],
});

const app = express();
app.use(express.urlencoded({ extended: false }), express.json());
// Serves /notabot/challenge, /notabot/verify, /notabot/siteverify, then gates what follows.
app.post("/signup", notabotExpress(notabot), (req, res) =>
  res.send(`welcome (${req.notabot.verdict})`),
);
```

On the page, point the widget at your own server: `challenge-url="/notabot/challenge"` and
`verify-url="/notabot/verify"`. The token arrives in the `notabot-token` field or the
`x-notabot-token` header.

| Adapter                              |                                                                    |
| ------------------------------------ | ------------------------------------------------------------------ |
| `notabot.protect(handler)`           | any Fetch server: Next.js route handlers, Bun.serve, Deno, Workers |
| `notabotExpress(notabot)`            | Express, Connect, node:http; the decision is on `req.notabot`      |
| `notabotHono(notabot)`               | Hono; the decision is `c.get("notabot")`                           |
| `notabot.verifyRequest(info, token)` | the decision alone, for anything else                              |

What a request is checked for (`REQUEST_RULES`, extensible with your own `rules`):

- **Self-named clients:** curl, python-requests, Go, axios, Scrapy, headless tools, a missing User-Agent.
- **Missing browser headers:** Accept-Language, Accept and Accept-Encoding, which every browser sends.
- **Client hints:** missing sec-ch-ua on Chromium; sec-ch-ua-platform or sec-ch-ua-mobile contradicting the User-Agent; a HeadlessChrome brand.
- **Fetch metadata:** missing Sec-Fetch-* headers on a modern browser.
- **Protocol and network:** a Chromium speaking HTTP/1.x; an IP on a hosting network (from `request.cf` or the `network` you pass).
- **Rate:** an optional burst limit per IP (`ratePerMinute`).

The token's checks:

- **Signature and expiry.**
- **Allowed origin.**
- **Binding:** it must come from the User-Agent and IP it was issued to.
- **Single use:** a replay is refused (`memoryStore()` by default, `kvStore()` for KV, Redis…).

The page's front-only `unsigned.` tokens are refused unless `allowUnsigned` is set. A refused
request gets a 403 with the reason (`missing-token`, `token-mismatch`, `replayed-token`,
`verdict`…) and the flags.

## Enforce with the Worker

Front-end alone, a verdict can be forged: a bot can skip the script or replay a good result.
[`examples/cloudflare-worker`](examples/cloudflare-worker) is the server half for sites without a
server of their own, the same `createNotabot()` in a dozen lines:

- `GET /challenge` signs a puzzle (HMAC, stateless, expiring);
- `POST /verify` checks the proof of work (refusing replays through KV), re-scores the signals
  with what only a server sees (the real `User-Agent` and `Accept-Language` headers, the IP's
  network and time zone, HTTP version), asks your model with your key, and signs a short-lived
  token bound to the origin;
- `POST /siteverify` is for your backend, reCAPTCHA-style:
  `{ success, verdict, bot, score, challenge_ts, hostname }`, each token valid once.

TCP, TLS (JA4) and HTTP/2 fingerprints never reach JavaScript; a Worker behind Cloudflare is
where they can be added.

## Limits

- Front-end detection is advisory until a server checks the proof of work and signs the token.
- Privacy tools (Brave, Firefox fingerprinting protection, canvas blockers) change some readings;
  they count as weak evidence, never as a verdict alone.
- The slider has a keyboard path, and behaviour never blocks on its own; still offer another way
  through for people who need it.
- The CDP detection trick (an `Error` whose `stack` getter fires when DevTools serializes it) is
  deliberately left out: V8 broke it in 2025, and it logs an error in every visitor's console.

## Privacy

Everything runs in the page. Nothing is sent anywhere unless the site uses a Worker or the visitor
asks for the AI opinion, and then only the feature vector shown on screen.

## Development

```sh
bun install
bun run dev          # build, then serve on http://localhost:4318/notabot/ (mock LLM and Worker included)
bun run test         # unit tests
bun run test:e2e     # Playwright on Chromium
bun run test:package # pack, install and import as a consumer would
bun run typecheck && bun run lint
```

Releases are semantic-release on `main` (conventional commits), published to npm with
provenance through trusted publishing; the site deploys to GitHub Pages on every push.

## Credits

The explanation follows "En vrai, les captchas… c'est encore utile ?" by V2F for
[overfl0w](https://www.youtube.com/watch?v=pqtDUrLReI4). Ideas borrowed from
[ALTCHA](https://github.com/altcha-org/altcha) (stateless signed proof of work),
[BotD](https://github.com/fingerprintjs/botd) and [CreepJS](https://github.com/abrahamjuliot/creepjs)
(automation and lie detection). Fonts: Archivo (OFL), OCR-B outline (free license, Norbert Schwarz
and Z. Wagner).

## License

MIT
