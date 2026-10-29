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

| Attribute (or `data-*` on the script tag) |                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| `mode`                                    | `click` (default) waits for the checkbox; `auto` runs on load                    |
| `challenge-url`                           | a server that signs puzzles (`GET` → challenge)                                  |
| `verify-url`                              | a server that re-scores and signs a token (`POST` signals, behaviour, solution)  |
| `slide-url`                               | where the slider is judged in signed mode; default: `slide` next to `verify-url` |
| `challenges`                              | which visible challenges the page may draw: `slide`, `targets` (default both)    |
| `endpoint`, `model`                       | an OpenAI-compatible proxy for the AI opinion; the key stays there               |
| `name`                                    | hidden field carrying the token, default `notabot-token`                         |
| `form`                                    | form selector, when the widget sits outside it                                   |
| `lang`                                    | `en` or `fr` (default: the page's)                                               |
| `theme`                                   | `auto`, `light`, `dark`                                                          |
| `rules-weight`                            | weight of the rules against the model, default `0.7`                             |

On the script tag, `data-form="#id"` adds a widget to that form and holds its submission until
the check passes (`data-guard="false"` to opt out). Events: `notabot:state`, `notabot:step`,
`notabot:verdict` (`{ verdict, bot, token, signed, challenged, result }`), `notabot:error`
(`{ error, code }`: `expired`, `replayed`, `refused`, `rate-limited`, `malformed` or `network`).
With `verify-url`, the page asks no model of its own: the server does.
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

The demo lets visitors bring their own key (kept for the page only, or encrypted on their device
by llm-connect if they tick "remember"), point at a proxy or Worker, or use a local Ollama
(`OLLAMA_ORIGINS=https://maxgfr.github.io ollama serve`). Suggested small models come from
[llm-models](https://www.npmjs.com/package/llm-models) at build time (`bun run recommended` →
`assets/recommended.json`): no reasoning model, structured output (or tool calls) supported, at
most $1 per million input tokens; a provider with nothing that fits keeps its committed pick. On
your site, never put a key in the page: use `endpoint` with a proxy, or let the Worker call it.

What the model is shown, and how its answer is read:

- **A closed list of features**: numbers, booleans and values from fixed lists. A raw string the
  client controls (user agent, GPU name, fonts) never reaches the prompt, nor does a behaviour key
  the client invented; at most 96 features. On a server, four more: `hosting_asn`,
  `http_version`, `tz_matches_ip`, `ja4_matches_ua`.
- **A fixed system prompt**: a glossary of every rule (`id — explanation (weight)`) generated
  from the package's rules, two calibrated examples, `reasons` asked before `verdict`. The same
  prefix for every visitor, so providers can cache it. `has_interaction: false` replaces a
  behaviour block of zeros.
- **Structured output** where the provider supports it (the verdict's JSON Schema), else text read
  by `parseVerdict`, which drops `<think>` blocks and keeps the last valid object. The server
  asks in JSON mode, at temperature 0, for 300 tokens at most, and gives up after 4 s.
- **The blend** is in log-odds, weighted by the model's confidence (an unsure model moves
  nothing). The model is not asked when the rules decided (≥ 0.95 or ≤ 0.05). A model
  confidently saying "bot" where the rules said human raises the verdict to "unsure": the visitor
  gets the slider. Identical questions are answered from a cache.

`notabot/middleware` imports the prompt module only (`notabot/llm`'s `prompt`), never
llm-connect or the AI SDK: `bun run test:package` checks it.

### Benchmark

`bun run bench` scores the labelled corpus three ways: the rules alone, a logistic regression on
the same features (trained in TypeScript, no dependency, scored by leave-one-out so never on a
sample it saw), and, with `NOTABOT_LLM_ENDPOINT` / `NOTABOT_LLM_API_KEY` / `NOTABOT_LLM_MODEL`
set, the rules blended with a model. The corpus is small and is not real traffic: human profiles
written from documented setups (`tests/profiles.ts`: keyboard only, screen reader, privacy
extension, Brave, Safari, Firefox `resistFingerprinting`, Android), and automated browsers
captured by `bun run capture` (Playwright driving Chromium, installed Chrome and Brave, with and
without a stealth layer). Add your own browsers from the demo's download button:
`bun run bench --add notabot-signals.json --label human --source "Firefox on Linux"`. The model
column is absent below: no model was run for these numbers.

<!-- bench:start -->
| Classifier                          | Humans passed | Humans challenged | Humans refused | Bots refused | Bots challenged | Bots passed |
| ----------------------------------- | ------------- | ----------------- | -------------- | ------------ | --------------- | ----------- |
| Rules alone                         | 8/8           | 0                 | 0              | 7/8          | 0               | 1           |
| Logistic regression (leave-one-out) | 7/8           | 1                 | 0              | 5/8          | 2               | 1           |

16 samples: 8 human profiles built from documented setups, 8 automated browsers captured by `scripts/capture.ts`. Bot probability per sample:

| Sample               | Label | Rules | Regression |
| -------------------- | ----- | ----- | ---------- |
| chrome-mac           | human | 0.00  | 0.24       |
| keyboard-only        | human | 0.00  | 0.24       |
| screen-reader        | human | 0.00  | 0.24       |
| privacy-extension    | human | 0.28  | 0.14       |
| brave                | human | 0.00  | 0.16       |
| safari               | human | 0.00  | 0.24       |
| firefox-rfp          | human | 0.10  | 0.05       |
| android-chrome       | human | 0.00  | 0.39       |
| brave-automated      | bot   | 0.95  | 0.68       |
| chrome-automated     | bot   | 1.00  | 0.91       |
| chrome-headed-hidden | bot   | 0.00  | 0.06       |
| headless-new         | bot   | 1.00  | 0.91       |
| headless-shell       | bot   | 1.00  | 1.00       |
| spoofed-windows-ua   | bot   | 1.00  | 0.97       |
| stealth-js-layer     | bot   | 1.00  | 0.77       |
| stealth-linux-ua     | bot   | 1.00  | 0.90       |
<!-- bench:end -->

Read it for what it is: every automated browser but one carries a trace the rules know, and the
one that does not (a headed Chrome with `AutomationControlled` off) passes all three. The
regression trained on 16 samples is weaker than the rules it learned from; it ships as
`classifyLocal()`, a free, deterministic second opinion (`check({ local: true })`, and the demo's
report), never as the decision.

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
// Serves /notabot/challenge, /verify, /slide and /siteverify, then gates what follows.
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
- **Rate:** an optional burst limit per IP (`ratePerMinute`), which also caps `/challenge`.
- **TLS (JA4):** a browser User-Agent over a handshake no current browser makes (below TLS 1.3, no
  server name, no HTTP/2 or 3 offered by ALPN): `ja4-ua-mismatch`. The JA4 comes from Cloudflare's
  bot management (`request.cf.botManagement.ja4`) or, with `trustProxy`, from your proxy's
  `x-ja4` header; anyone can send that header, so it is ignored otherwise. A coherence rule from
  the [JA4 format](https://github.com/FoxIO-LLC/ja4/blob/main/technical_details/JA4.md), no list
  of hashes.
- **HTTP/2 SETTINGS:** served by `node:http2` (its compatibility API through `notabotExpress`),
  the client's SETTINGS are read from the session; a Chromium User-Agent whose SETTINGS are not
  Chromium's (header table 65536, no push, a 6 MB window, a 256 KB header list; sources in
  `REFERENCES`) raises `http2-settings-not-chromium`.
- **JA4H:** every analysis computes the request's [JA4H](https://github.com/FoxIO-LLC/ja4/blob/main/technical_details/JA4H.md)
  (returned by `analyzeRequest()` as `ja4h`, and on `info.ja4h` for your own rules): from Node's
  `rawHeaders`, in the order the client sent them; Fetch's Headers are sorted, so there it says
  less.
- **TCP:** no runtime sees the SYN packet; a proxy running p0f can pass its guess as
  `network.tcpOs` for your own rules.

**At scale** (`velocity`, off by default): the same browser fingerprint (canvas, WebGL, audio,
fonts) from more than 30 IPs in ten minutes raises `fingerprint-velocity`, more than six
fingerprints from one IP `fingerprint-churn`. Identical phones share a fingerprint and offices
share an IP: tune the thresholds to your traffic before relying on them.

**Agents that sign (Web Bot Auth).** With `agents: { allow: { "https://chatgpt.com": {
ratePerMinute: 60 } } }`, a request signed per [HTTP Message Signatures](https://www.rfc-editor.org/rfc/rfc9421)
(Ed25519, `Signature`, `Signature-Input`, `Signature-Agent`, tag `web-bot-auth`) is checked
against the key its operator publishes at `/.well-known/http-message-signatures-directory`. A
valid one passes as `verified-agent` (`decision.verifiedAgent.operator`), the hosting and
HTTP-library rules set aside; an operator not listed is refused (`agent-not-allowed`), as is a
bad or stale signature. Directories are fetched only for listed operators, over https, never an
IP literal or a local name, without redirects, within 3 s and 64 KB, cached for an hour.

**The proof of work is a price, not a detection.** `/challenge` prices each puzzle by risk: a
clean browser pays `pow.base` (`maxnumber`, 50 000 hashes on average / 2), a request with flags
or close to its rate up to ten times more, and with `pow.algorithm: "auto"` in PBKDF2 (ALTCHA
v2's costly hash, `pow.cost` rounds a try) rather than SHA-256. `pow.busyPerMinute` doubles
every price past that many puzzles a minute. Each puzzle is bound to a keyed hash of the
client's IP and User-Agent (`pow.bind: false` lifts it), so solved puzzles cannot be farmed out.
A bot with time pays and gets through to the rules: it slows abuse, it proves nothing.

**Probes.** Each puzzle carries three questions drawn from its salt (`DOMMatrix` products,
`Intl` number formats, `CSS.supports`, native getters' source, `TextEncoder` bytes): data, not
code, so a strict CSP holds. The page answers them with its own APIs and the server checks:
wrong answers raise `probe-mismatch`, none `probes-missing`. They change with every puzzle,
so there is no fixed check to study and fake.

**The visible challenge rotates.** A visitor in doubt gets either the slider or three numbered
targets to press in order (`visibleChallenges`, both by default), chosen and signed by the
server, judged again by `/slide`. Both work from the keyboard: arrow keys for the slider, Tab
and Enter for the targets (their tab order is shuffled).

The token's checks:

- **Signature and expiry.**
- **Allowed origin.** With `allowedOrigins`, a POST to `/verify` or `/slide` without an
  `Origin` header is refused, and a refused origin gets no `access-control-allow-origin`.
- **Binding:** it must come from the User-Agent and IP it was issued to. A token bound to an IP
  is refused when the request's IP is unknown.
- **Single use**, per use: the gate and `/siteverify` each accept a token once (`singleUse: false`
  lifts it).

The page's front-only `unsigned.` tokens are refused unless `allowUnsigned` is set, and expire
like the others. A refused request gets a 403 with the reason (`missing-token`,
`token-mismatch`, `replayed-token`, `verdict`…) and the flags.

**The client IP.** By default the middleware believes only the platform: Cloudflare's
`request.cf` (then `cf-connecting-ip`), the Node adapter's `req.ip` (Express derives it from its
own `trust proxy` setting), or an `ip` you pass. A forwarding header that no proxy of yours
overwrites is whatever the client wrote, so it is read only when you say so: `trustProxy:
"cloudflare"` (behind Cloudflare), `trustProxy: "x-forwarded-for"` (the last hop your proxy
appended), or your own `getIp(request)`.

**The store.** `memoryStore()` (the default) holds one process, at most 50 000 keys. Across
instances, use `redisStore(redis)`: `SET NX EX` and `INCR` make claims and counts atomic.
`kvStore(kv)` works over Cloudflare KV, best effort only: KV is eventually consistent, so two
requests in the same second can both pass. A custom store implements `claim(key, ttl)` and,
for O(1) rate counting, `incr(key, ttl)`.

**The endpoints** check the shape of what they are sent (400 for malformed signals), cap the
body (`maxBodyBytes`, 128 KiB), answer JSON even on an internal error, and refuse a signals blob
posted more than five times in ten minutes. Errors carry a `reason` the widget understands:
`expired`, `replayed`, `refused`, `rate-limited`, `malformed`.

**The slider in signed mode.** When `/verify` says `unsure`, it signs where the slider's zone
sits into the token. The widget posts the gesture to `POST /slide` (`{ token, samples, track }`,
or `{ token, keyTimes, position }` from the keyboard); the server judges it again and signs a new
`human` token only if the gesture passes and the score was below the bot threshold. A page that
declares "passed" by itself gets nothing signed. Three attempts per token.

**`/siteverify`** compares the secret in constant time and accepts reCAPTCHA's `remoteip`, plus
`useragent`, to check the binding from your backend.

## Enforce with the Worker

Front-end alone, a verdict can be forged: a bot can skip the script or replay a good result.
[`examples/cloudflare-worker`](examples/cloudflare-worker) is the server half for sites without a
server of their own, the same `createNotabot()` in a dozen lines:

- `GET /challenge` signs a puzzle (HMAC, stateless, expiring);
- `POST /verify` checks the proof of work (refusing replays through KV), re-scores the signals
  with what only a server sees (the real `User-Agent` and `Accept-Language` headers, the IP's
  network and time zone, HTTP version), asks your model with your key, and signs a short-lived
  token bound to the origin, with its expiry (`exp`);
- `POST /slide` judges the slider's gesture again and re-signs the token as human when it passes;
- `POST /siteverify` is for your backend, reCAPTCHA-style:
  `{ success, verdict, bot, score, challenge_ts, hostname }`, each token valid once.

The widget checks again 30 seconds before its token expires, and after each form submission
that spent it.

TCP, TLS (JA4) and HTTP/2 fingerprints never reach JavaScript: the middleware reads them where
the platform gives them (Cloudflare's `request.cf`, a trusted proxy, `node:http2`).

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
