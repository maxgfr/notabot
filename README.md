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

| Layer                 | What it checks                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Declared identity** | user agent, client hints, platform, languages, time zone, screen, cores, memory                                                                                                            |
| **Automation tells**  | `navigator.webdriver`, HeadlessChrome brands, Selenium / Playwright / Puppeteer / PhantomJS globals, plugins, `window.chrome`, notification permission quirk, zero-size window             |
| **Lies**              | native getters and functions that no longer look native (judged with a clean realm's `toString`), a redefined `webdriver`, a patched `Function.prototype.toString`                         |
| **Second opinions**   | the same questions asked from a fresh iframe and a Web Worker, which stealth layers forget                                                                                                 |
| **Consistency**       | OS named by the user agent vs platform vs client hints vs GPU, engine claimed vs `eval.toString().length`, time zone name vs clock offset, phone UA without touch                          |
| **Hardware prints**   | canvas (read twice, to spot injected noise), WebGL strings and a rendered scene, offline audio, fonts, WebGPU                                                                              |
| **Behaviour**         | pointer speed, step and wobble, how it arrives (slowing down, correcting, overshooting), `isTrusted`, coalesced samples, key dwell and flight, paste vs typing, scroll cadence, a honeypot |
| **Proof of work**     | SHA-256 puzzle in a Web Worker, ALTCHA-style, signed by your server when you have one                                                                                                      |
| **AI officer**        | optional: a small model reads the features and gives a verdict, blended with the rules                                                                                                     |

Each rule has a weight and a category. Flags of one category tend to fire together (a headless
user agent and a headless brand are one fact told twice), so within a category the strongest
counts in full and each other one at a quarter; categories then combine as independent evidence
(noisy-OR). Behaviour never decides alone when there is no pointer data (a keyboard, a screen
reader): its flags are capped below the bot threshold then. Below 35 % the visitor is admitted,
from 80 % refused, in between they get an extra step: a slider judged on the geometry of the drag,
or numbered targets to press in order, both playable from the keyboard. The thresholds come from
the benchmark: its human profiles stay at or below 28 %, the automated browsers the rules catch
start at 95 %.

**The extra step is friction, not proof.** It costs a script a little more and a person a few
seconds; it does not prove anyone human. Image and slider puzzles are solved by machines: free,
locally run models pass 92.6 % of real reCAPTCHA sessions ([Robot Visions](https://arxiv.org/pdf/2609.18518)),
and commercial solvers bypass challenges almost perfectly at negligible cost
([Broken Gates](https://arxiv.org/html/2607.18659v1); see also
[Halligan](https://www.usenix.org/system/files/usenixsecurity25-teoh.pdf), USENIX Security '25).

## What it catches, what it doesn't

Catches:

- **Stealth layers injected in JavaScript**: the natives they replace, the fresh iframes and
  workers they forget to patch ([FP-Inconsistent](https://arxiv.org/html/2406.07647v2) measures
  how evasive bots contradict themselves).
- **Headless browsers out of the box**: `webdriver`, HeadlessChrome brands, a software GPU,
  missing plugins.
- **Scripted HTTP clients**: self-named user agents, missing browser headers, and on the server a
  TLS handshake no browser makes.

Does not catch alone:

- **Browsers patched at the source** ([Camoufox](https://github.com/daijro/camoufox) and the
  like), where nothing in JavaScript looks replaced.
- **AI agents driving a real browser** on a real GPU: their signals are a person's
  ([FP-Agent](https://arxiv.org/abs/2605.01247)).
- **Human solving farms**, paid to pass any challenge
  ([Motoyama et al., USENIX Security 2010](https://www.usenix.org/legacy/event/sec10/tech/full_papers/Motoyama.pdf)).

For those, the server's signals (JA4, headers, fingerprint velocity, a price per attempt) and
agents that sign their requests (Web Bot Auth). The benchmark below shows the gap plainly: a
headed Chrome with its automation flags hidden passes every check here.

**False positives are tested.** `tests/profiles.test.ts` runs the rules on people whose readings
look odd for good reasons (keyboard only, a screen reader without a pointer, a canvas-blocking
extension, Brave, Safari, Firefox with `resistFingerprinting`, an Android phone): CI fails if any
of them is called a bot, with or without its behaviour.

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
| `no-honeypot`                             | do not add the invisible honeypot field to the form                              |
| `local`                                   | without a model, blend in the local regression as the second opinion             |
| `endpoint`, `model`                       | an OpenAI-compatible proxy for the AI opinion; the key stays there               |
| `name`                                    | hidden field carrying the token, default `notabot-token`                         |
| `form`                                    | form selector, when the widget sits outside it                                   |
| `lang`                                    | `en`, `fr`, `de`, `es`, or one you register (default: the page's)                |
| `theme`                                   | `auto`, `light`, `dark`                                                          |
| `rules-weight`                            | weight of the rules against the model, default `0.7`                             |

The widget is a checkbox to assistive technology (`role="checkbox"`, `aria-checked`), updated in
place so focus and its one live region survive every state. Its strings come in English, French,
German and Spanish (`lang`), and each can be replaced: `widget.messages = { label: "…" }`, a
`data-msg-<key>` attribute (`data-msg-label="…"`), or `registerMessages("it", { … })` for a
language of your own. In a form, it adds an invisible honeypot field (`<name>-hp`, out of the tab
order and hidden from assistive technology; `no-honeypot` to opt out): the tracker and the
middleware both flag it when a script fills it.

Every attribute works as `data-*` on the script tag too (`data-challenges="targets"`,
`data-slide-url`, `data-local="true"`, `data-no-honeypot="true"`…). On the script tag,
`data-form="#id"` adds a widget to that form and holds its submission until
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
| `notabot/smart`      | `identify()`, `smartSignals()`: visitor id and smart signals, in-house                                      |
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
  asks with the verdict's strict JSON Schema at temperature 0; a server that refuses either (recent
  Claude models refuse a temperature, Anthropic's compatible API accepts `json_schema` but not
  `json_object`) is asked again without it, then with the bare request; 1200 tokens at most (models
  that reason first need the room), 4 s for all attempts.
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
columns below come from `claude-haiku-5-5` through Anthropic's OpenAI-compatible API, asked with
the middleware's own requests ("model alone" asks it on every sample; "rules + model" is what
the middleware decides, which skips the model when the rules decided).

The scores below use the correlation-capped combination described above.

<!-- bench:start -->
| Classifier                          | Humans passed | Humans challenged | Humans refused | Bots refused | Bots challenged | Bots passed |
| ----------------------------------- | ------------- | ----------------- | -------------- | ------------ | --------------- | ----------- |
| Rules alone                         | 9/9           | 0                 | 0              | 7/8          | 1               | 0           |
| Logistic regression (leave-one-out) | 9/9           | 0                 | 0              | 5/8          | 1               | 2           |
| Model alone (claude-haiku-5-5)      | 9/9           | 0                 | 0              | 8/8          | 0               | 0           |
| Rules + model (claude-haiku-5-5)    | 9/9           | 0                 | 0              | 7/8          | 1               | 0           |

17 samples: 8 human profiles built from documented setups, 1 real browser captured by hand, 8 automated browsers captured by `scripts/capture.ts`. Bot probability per sample:

| Sample                                | Label | Rules | Regression | Model alone | Rules + model |
| ------------------------------------- | ----- | ----- | ---------- | ----------- | ------------- |
| chrome-mac                            | human | 0.00  | 0.07       | 0.05        | 0.00          |
| keyboard-only                         | human | 0.00  | 0.07       | 0.08        | 0.00          |
| screen-reader                         | human | 0.00  | 0.07       | 0.08        | 0.00          |
| privacy-extension                     | human | 0.28  | 0.05       | 0.10        | 0.21          |
| brave                                 | human | 0.00  | 0.05       | 0.05        | 0.00          |
| safari                                | human | 0.00  | 0.07       | 0.05        | 0.00          |
| firefox-rfp                           | human | 0.10  | 0.03       | 0.10        | 0.10          |
| android-chrome                        | human | 0.00  | 0.14       | 0.10        | 0.00          |
| brave-automated                       | bot   | 0.95  | 0.15       | 0.90        | 0.95          |
| chrome-automated                      | bot   | 0.99  | 0.97       | 0.98        | 0.99          |
| chrome-headed-hidden                  | bot   | 0.69  | 0.22       | 0.90        | 0.77          |
| headless-new                          | bot   | 0.99  | 0.99       | 0.98        | 0.99          |
| headless-shell                        | bot   | 0.99  | 1.00       | 0.99        | 0.99          |
| human-brave-156-on-macos-real-profile | human | 0.00  | 0.24       | 0.10        | 0.00          |
| spoofed-windows-ua                    | bot   | 0.98  | 0.75       | 0.97        | 0.98          |
| stealth-js-layer                      | bot   | 1.00  | 0.95       | 0.98        | 1.00          |
| stealth-linux-ua                      | bot   | 0.99  | 0.99       | 0.97        | 0.99          |
<!-- bench:end -->

Read it for what it is. The hardest sample, a headed Chrome with `AutomationControlled` off
that FingerprintJS's open-source BotD also calls "not a bot", has no automation trace at all: the
rules now give it the extra step only through its behaviour (a ruler-straight pointer in even
steps, keys at a metronome's pace, which `robotic-pointer` and `robotic-typing` read), and the
model, asked alone, refuses it. That is the model's job here: catching what the rules miss,
never overruling a decided rule. A bot that moves and types like a person would pass all of it.
The real Brave (farbled canvas, audio and core count, its own WebGL renderer name) raises no
rule. An AI agent driving that same Brave through a browser extension is called human too: the
slider refused its straight drag, and the targets now refuse clicks that jump onto each target.
The regression, trained on so few samples, is weaker than the rules it learned from; it ships as
`classifyLocal()`, a free, deterministic second opinion (`check({ local: true })`, the widget's
`local` attribute, `createNotabot({ local: true })` on the server, and the demo's
report), never as the decision.

## Smart signals, in-house

Commercial fingerprinting services keep their most useful outputs for paid plans: a visitor id
that holds across visits, and "smart signals" such as private mode, virtual machines or VPNs.
notabot computes them from the readings it already has, in the page or on your server, with
nothing sent anywhere (`notabot/smart`):

```ts
import { identify, smartSignals } from "notabot/smart";

const { visitorId, confidence } = await identify(signals); // 20 hex characters, 0 to 1
smartSignals(signals);
// { privacyBrowser: "brave" | "resist-fingerprinting" | null, farbling, privateMode,
//   virtualMachine, tampering: { detected, lies, realmMismatches } }
```

- **Visitor id:** a hash of the readings that stay put (browser major version, platform,
  languages, time zone, screen, cores, memory, WebGL, WebGPU, fonts, codecs, engine quirks, the
  canvas only when two reads agree, audio). No clock, no window size, no behaviour. The confidence
  drops when a privacy browser randomises readings (Brave farbles per session and per site, so its
  id changes per session, by design), under resistFingerprinting, in a likely private session, or
  when canvas, WebGL or audio are missing. On the server the id is keyed with your HMAC key: two
  sites never share one.
- **Private mode:** cautious evidence only (Firefox and Safari refusing the origin-private file
  system; a Chromium quota far below a normal profile's, Brave excepted since it caps every
  profile), reported as likely, unlikely or unknown, and never held against the visitor.
- **Virtual machine:** a VMware, VirtualBox, Parallels, Hyper-V, QEMU or software renderer.
- **Privacy browser:** Brave, or resistFingerprinting (Firefox's, which Tor Browser is built on:
  the two read alike from a page).
- **On the server:** a Tor exit node (`torExits: torExitList()`, the Tor Project's own list,
  fetched at most hourly; flagged `tor-exit`, weak), a VPN when the IP's time zone disagrees with
  the browser's (a country that disagrees is listed as evidence, not decided on: travellers do
  that), a hosting network, velocity.
- **Sealed results:** `/verify` seals all of it in the signed token (`smart`), and
  `/siteverify` returns it to your backend, as a commercial server API would.

Left out on purpose: DevTools detection (its tricks are unreliable and V8 broke the last one) and
the mobile-app signals (jailbreak, emulators, cloned apps), which need native code.

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
- **Protocol and network:** a Chromium speaking HTTP/1.x to you (only when the protocol is the client's: Cloudflare's `request.cf`, or TLS Node terminates itself; behind a proxy or on plain HTTP the last hop's protocol says nothing); an IP on a hosting network (from `request.cf` or the `network` you pass).
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
valid one passes as `verified-agent` (`decision.verifiedAgent.operator`), the request-shape
rules set aside (missing browser headers, an HTTP library, a hosting network: an agent that
signs is not passing for a browser); an operator not listed is refused (`agent-not-allowed`), as is a
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
declares "passed" by itself gets nothing signed; only a token `/verify` signed in doubt, with its
challenge, can be settled, once; the server checks the handle against the zone it signed, never
the page's word. Three attempts per token.

What it cannot do: the gesture itself is reported by the page. Pointer samples, key timestamps
and `isTrusted` are what the browser said, and a script that writes a plausible gesture by hand
passes the step. It still paid a proof of work for its token, and a score at the bot threshold or
above is never overturned: the step is friction for scripts that drive a real page, not a proof.

**The gate counts a request flag once.** The request flags `/verify` saw are sealed in the token
(`seen`) and already in its score; the gate adds only the flags it sees for the first time, so a
visitor on a VPN who just passed the slider is not refused for the same VPN again. The decision's
`flags` are the ones it counted; a rate or a filled honeypot always counts. To find the token in a
form or JSON body, `protect()` and the Hono adapter read the body once, up to `gateBodyBytes`
(16 MiB); a larger upload sends the token in the `x-notabot-token` header.

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
- The slider and the targets both have a keyboard path, and behaviour never decides alone without
  a pointer; the extra step is friction, so still offer another way through for people who need
  it.
- See [What it catches, what it doesn't](#what-it-catches-what-it-doesnt): source-patched
  browsers, AI agents in real browsers and human farms need the server's signals.
- The CDP detection trick (an `Error` whose `stack` getter fires when DevTools serializes it) is
  deliberately left out: V8 broke it in 2025, and it logs an error in every visitor's console.

## Privacy

Everything runs in the page. Nothing is sent anywhere unless the site uses a Worker or the visitor
asks for the AI opinion, and then only the feature vector shown on screen.

## The demo

The site reads your browser on arrival and keeps those signals: the check reuses them instead of
reading twice. The AI officer, with the AI SDK and the provider catalog behind it, loads when you
reach its section. "Simulate a bot" changes a copy of your signals the way a bot's would read
(webdriver, a HeadlessChrome user agent, SwiftShader, a contradicting iframe, a stealth plugin's
patches, a Windows user agent on your GPU) and scores both side by side, in the page. "What the
server would add" lists every rule only the middleware runs, tried on the headers the page can
know about your browser. The full report (verdict, flags, features, the exact prompt, the model's
answer, the local regression's opinion, signals and behaviour) downloads as JSON. The 850 KB
provider catalog is served by the site only; it is not in the npm package.

## Testing the package as a site installs it

`bun run test:package:e2e` packs notabot, installs the tarball with Express and Hono in a scratch
project, and runs a consumer app that imports nothing but `notabot` (`e2e-package/consumer`):
Node checks for what has no browser part (stores, request analysis, HTTP/2 SETTINGS, sealed
signals and siteverify, Tor, VPN, the local second opinion, Web Bot Auth), then Chromium against
the app (the one-line embed and its `data-*`, the element's attributes and languages, the signed
slider and targets, siteverify, a typed `expired` error, Hono and `protect()`). CI runs it on
every pull request; the production checks run it on the version on npm
(`test:package:e2e:published`).

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
