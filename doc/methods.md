# How notabot tells people from bots

Every method notabot uses, in one place: what it reads, what each rule checks and why, how the
evidence adds up, what the extra step judges, what the server adds, and what was measured and left
out. Weights are the code's (`src/score/index.ts`, `src/middleware/request.ts`); `tests/doc.test.ts`
fails when a rule exists in the code and not here.

The principle throughout: a bot can lie about any single value; making every lie agree with every
other one, and with what the machine physically does, is what costs it. So notabot reads a lot,
cross-checks it, measures what cannot be renamed, and keeps a challenge for when doubt remains.

- [1. What the page reads](#1-what-the-page-reads)
- [2. The browser rules](#2-the-browser-rules)
- [3. How the evidence adds up](#3-how-the-evidence-adds-up)
- [4. Behaviour](#4-behaviour)
- [5. The extra step](#5-the-extra-step)
- [6. Proof of work and probes](#6-proof-of-work-and-probes)
- [7. The model and the local regression](#7-the-model-and-the-local-regression)
- [8. The server](#8-the-server)
- [9. Smart signals](#9-smart-signals)
- [10. Measured and left out](#10-measured-and-left-out)
- [11. How the methods are kept honest](#11-how-the-methods-are-kept-honest)

## 1. What the page reads

`collect()` (`src/signals/`) reads everything a page can, in parallel, each collector with a
2-second budget. A collector that fails or times out leaves its default and an entry in `errors`
(whose wording is itself evidence, see `browser-internals-exposed`).

| Collector                    | What it reads                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Environment (`env.ts`)       | user agent, `userAgentData` (brands, platform, high-entropy values), `platform`, `vendor`, `appVersion`, `oscpu`, languages, time zone and the offset its name implies, `Intl` locale, screen and window sizes, pixel ratio, cores, memory, touch points, connection, cookies, Do Not Track, Global Privacy Control, PDF viewer, storage quota, codecs, media queries, media devices, permissions, `eval.toString().length`, an engine-specific error message, and whether CSS media queries see the screen JavaScript reports |
| Automation (`automation.ts`) | `navigator.webdriver` and where it is defined, headless user agent and brands, globals and attributes left by Selenium, Playwright, Puppeteer, PhantomJS, Nightmare, Cypress (`cdc_`, `__playwright`…), `window.chrome`, plugins and whether they are a real `PluginArray`, the notification permission quirk, a zero outer window, empty languages, a software renderer, the engine claimed against the one observed                                                                                                          |
| Tampering (`tampering.ts`)   | 26 natives a stealth layer or a spoofing tool replaces (navigator and screen getters, canvas, WebGL, audio, permissions, `getBoundingClientRect`, `Date`, `Intl`, `Function.prototype.toString`), judged with a fresh iframe's own `toString` so a patched one cannot vouch for itself: source visible, a `prototype`, an own `toString`, a getter that accepts a foreign receiver                                                                                                                                             |
| Realms (`realms.ts`)         | the same questions (user agent, platform, `appVersion`, languages, cores, memory, `webdriver`, time zone, WebGL renderer) asked from a fresh iframe and a Web Worker, which page-level patches forget; and whether the fresh iframe has the `Intl` constructors its page has                                                                                                                                                                                                                                                   |
| Canvas (`hardware.ts`)       | a drawing of text, emoji and blended shapes, hashed, read twice (two different reads mean injected noise)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| WebGL                        | version, vendor, renderer (and the unmasked ones), shading language, max texture size, extension count, the hash of a rendered scene, and the milliseconds a costly shader takes (`renderMs`)                                                                                                                                                                                                                                                                                                                                  |
| WebGPU                       | the adapter's vendor and architecture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Audio                        | an oscillator through a compressor, rendered offline, hashed                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Fonts                        | 28 fonts, found by measuring text that falls back to a generic family otherwise                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Privacy                      | whether the origin-private file system opens (Firefox and Safari refuse it in private windows)                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## 2. The browser rules

Each rule has an id, a category and a weight: how likely a session that trips it alone is a bot.
The server re-runs these same rules on what the page posts.

### Automation tells

What automation leaves behind when nobody hid it.

| Rule                               | Weight | What it reads                                                                                               |
| ---------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| `webdriver`                        | 0.95   | `navigator.webdriver` is true.                                                                              |
| `headless-user-agent`              | 0.95   | The user agent names HeadlessChrome, PhantomJS or SlimerJS.                                                 |
| `headless-brand`                   | 0.9    | `userAgentData` lists a headless brand.                                                                     |
| `automation-globals`               | 0.95   | Globals or attributes left by Selenium, Playwright, Puppeteer, PhantomJS and the like.                      |
| `empty-languages`                  | 0.6    | `navigator.languages` is empty, as in some headless browsers.                                               |
| `outer-size-zero`                  | 0.6    | No outer window around the page, on a visible, non-prerendered tab only (a background tab has no size yet). |
| `no-plugins`                       | 0.3    | A desktop Chromium with no PDF plugin, which old headless builds did.                                       |
| `notification-permission-mismatch` | 0.5    | `Notification.permission` says denied while the Permissions API says prompt.                                |

### Lies and second opinions

What a stealth layer, or a browser patched at the source, gets wrong while hiding the tells.

| Rule                             | Weight | What it reads                                                                                                                                                                                                                                                                                |
| -------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webdriver-own-property`         | 0.8    | `webdriver` defined on `navigator` itself, not on `Navigator.prototype`: hidden by a script.                                                                                                                                                                                                 |
| `native-functions-replaced`      | 0.7    | Navigator getters or core functions that no longer look native.                                                                                                                                                                                                                              |
| `fingerprint-functions-replaced` | 0.2    | Canvas, WebGL, audio, screen or layout functions replaced: often a privacy extension, so weak.                                                                                                                                                                                               |
| `tostring-patched`               | 0.7    | `Function.prototype.toString` itself replaced, to make patched functions look native.                                                                                                                                                                                                        |
| `plugins-not-genuine`            | 0.6    | `navigator.plugins` or `mimeTypes` are not a real `PluginArray` / `MimeTypeArray`.                                                                                                                                                                                                           |
| `iframe-mismatch`                | 0.75   | A fresh iframe answers differently from the page: the page was patched, the new realm was not.                                                                                                                                                                                               |
| `worker-mismatch`                | 0.55   | A Web Worker answers differently from the page.                                                                                                                                                                                                                                              |
| `fresh-realm-incomplete`         | 0.8    | A fresh iframe lacks `Intl` constructors the page has. A realm is built by the engine itself; Camoufox (156) leaves a fresh iframe's `Intl` empty, which no stock browser does.                                                                                                              |
| `browser-internals-exposed`      | 0.7    | A collector failed with an error only Firefox's privileged code uses (Xray wrappers, `Components`, `cloneInto`). Camoufox's audio read does; no page API ever throws it. Below refusal alone: a badly written Firefox extension could leak the same words.                                   |
| `screen-media-mismatch`          | 0.3    | CSS media queries (`device-width`, `device-height`, `resolution`, a pixel of slack) see another screen than JavaScript. Weak, and Brave is set aside: it farbles the screen JavaScript reads, not CSS's.                                                                                     |
| `software-scene-gpu-name`        | 0.7    | WebGL names a graphics card but its scene hashes as SwiftShader draws it. SwiftShader's pixels do not depend on the machine (`ad1abc1d` in Chromium 148 and 156, macOS arm64, Linux arm64 and x86-64), so this is a renamed renderer. The list is fixed (`SOFTWARE_SCENES`), see section 10. |

### Consistency

Values that each look fine and contradict each other.

| Rule                    | Weight | What it reads                                                                                                                                                                                                                                                                       |
| ----------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine-mismatch`       | 0.8    | The user agent claims one engine, `eval.toString().length` reveals another (33 in V8, 37 in SpiderMonkey and JavaScriptCore).                                                                                                                                                       |
| `os-mismatch`           | 0.6    | The user agent, `platform`, `appVersion`, `oscpu`, `userAgentData` and the GPU (only renderers that name their system for sure: Direct3D, Apple chips, Mesa) name different systems. An iPad asking for the desktop site, and Android or ChromeOS on Linux, are not contradictions. |
| `fonts-os-mismatch`     | 0.5    | None of the claimed system's own fonts is installed and at least two of another system's are. Privacy settings that hide fonts leave the base ones or none, never another system's; Office's fonts on a Mac do not count against it.                                                |
| `ua-version-mismatch`   | 0.6    | `Chrome/N` in the user agent against the Chromium brand's version: an overridden user agent (Playwright's `userAgent` option keeps the real brands). Opera, Edge and Samsung name their own version beside Chromium's and pass.                                                     |
| `timezone-mismatch`     | 0.6    | The time zone's name and the clock's offset disagree: one of them was set.                                                                                                                                                                                                          |
| `mobile-without-touch`  | 0.6    | A phone user agent on a screen without touch.                                                                                                                                                                                                                                       |
| `language-mismatch`     | 0.3    | `navigator.language` is not the first of `navigator.languages`.                                                                                                                                                                                                                     |
| `chrome-object-missing` | 0.5    | A desktop Chrome user agent without `window.chrome`.                                                                                                                                                                                                                                |

### Hardware

What the machine is, and what it does.

| Rule                      | Weight | What it reads                                                                                                                                                                                   |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `software-renderer`       | 0.45   | WebGL on SwiftShader, llvmpipe or another software renderer: servers and headless runs, some VMs.                                                                                               |
| `software-speed-gpu-name` | 0.3    | WebGL names a card but the costly shader takes 50 ms or more. A GPU draws it in 0 to 2 ms, SwiftShader in 18 ms on ten cores and 64 to 77 ms on two. Phones are left out; weak and provisional. |
| `gpu-vendor-mismatch`     | 0.4    | WebGL and WebGPU name GPU makers one machine cannot pair (an Apple GPU and an NVIDIA one). Intel, AMD and NVIDIA pair on hybrid laptops and pass.                                               |
| `implausible-hardware`    | 0.3    | A core count or a memory size no real device reports.                                                                                                                                           |
| `canvas-noise`            | 0.1    | The same drawing reads back differently twice: noise injected, by a privacy tool or a spoofer.                                                                                                  |

### Behaviour

How the session moved and typed; see section 4 for the measures.

| Rule                  | Weight | What it reads                                                                                                      |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `untrusted-events`    | 0.7    | Events dispatched by a script (`isTrusted` false).                                                                 |
| `input-without-keys`  | 0.4    | Fields changed with no key pressed and nothing pasted.                                                             |
| `robotic-pointer`     | 0.6    | At least 10 moves, straightness above 0.995, even steps or a constant speed (cv below 0.05), almost no wobble.     |
| `pointer-no-slowdown` | 0.4    | At least 20 moves, strokes that end at full speed (above 0.85 of their average) and never correct their direction. |
| `robotic-typing`      | 0.5    | At least 10 keys, dwell and flight times both at a metronome's pace (cv below 0.05).                               |
| `no-coalesced-events` | 0.25   | Pointer events that carry no raw samples, as synthetic ones often do.                                              |
| `robotic-scroll`      | 0.3    | At least 8 scrolls at an even gap (cv below 0.05).                                                                 |
| `honeypot-filled`     | 0.7    | A field no person can see or reach was filled.                                                                     |

## 3. How the evidence adds up

- **Within a category** the strongest flag counts in full and each other one at a quarter: flags
  of one category tend to be one fact told twice (a headless user agent and a headless brand).
- **Across categories** the flags combine as independent evidence (noisy-OR).
- **No pointer, no verdict from behaviour:** without pointer data (a keyboard, a screen reader),
  behaviour flags are capped at 0.6, below refusal.
- **Thresholds:** below 0.35 the visitor is admitted, from 0.8 refused, in between they get the
  extra step. A single weak rule (0.3 and under) never challenges anyone alone.
- **Decided means decided:** at 0.95 and above, or 0.05 and below, the rules decide and no model is
  asked; a decisive rule (`webdriver`, automation globals) is never argued away.

## 4. Behaviour

`trackBehavior()` listens from the start (pointer, keys, paste, input, wheel, touch, focus) and
summarises the session without keeping what was typed:

- **Pointer path**, split into strokes at pauses: speed and its variation, acceleration,
  straightness (chord over path), angle entropy, jitter (the cross axis around the stroke's line),
  step variation (a script steps a line evenly whatever its clock does), turn rate (corrections
  sharper than 30°), end slowdown (a hand brakes into its target), overshoot (a hand passes its
  target and comes back), and tremor (how much the curvature jumps sample to sample: about a pixel
  or more for a hand, about 0.01 for any computed curve, however bent).
- **Raw samples:** `getCoalescedEvents` per event (real devices merge one or more).
- **Keys:** dwell (how long a key is held) and flight (between keys), and their variation.
- **Other:** clicks, scrolls and their cadence, focus changes, time to first interaction, pastes,
  inputs with no key before them, untrusted events, honeypot inputs.

## 5. The extra step

A visitor in doubt gets either a slider or three numbered targets to press in order, chosen and
signed by the server (two challenges cost a script twice), both playable from the keyboard.

- **Slider** (`judgeSlide`): it must land in the zone the server signed, from trusted events, with a
  pressure some browser reports (a drag at pressure 0 throughout, outside touch, was written by
  hand), at least 6 samples and 250 ms, uneven steps or a wobble, a tremor of at least 0.2 px (40
  real trackpad drags measured 0.49 to 5.5), and no arrival at full speed without a correction.
- **Targets** (`judgeTargets`): every target once, in order, by trusted events, within reach of
  each, a pointer that travelled to each one (a script or an agent jumps straight onto it), no gap
  under 120 ms, and a person's uneven pace.
- **Keyboard** (`judgeKeySlide`): trusted arrow keys with a person's uneven rhythm, or a held key
  that took a person's time.
- **On the server** (`/slide`): the gesture must fit the server's own clock (the step was shown
  after the token was issued, the gesture took its time, a person needs time to react); a gesture
  is refused when it was seen before (a recording plays once); a few attempts per token and per IP;
  a decisive "bot" from the signals is never overturned. With a model, it reads the gesture and the
  session's behaviour as numbers (`gestureFeatures`) and a confident "bot" turns a pass into a
  refusal, never the other way.

The extra step is friction, not proof: image and slider challenges are solved by machines.

## 6. Proof of work and probes

- **Proof of work** (`src/pow/`, ALTCHA-style): find a number whose hash meets the challenge, in a
  Web Worker. SHA-256 by default, PBKDF2 with `pow.algorithm: "auto"`. On the server it is a price,
  not a detection: a clean browser pays the base, a request with flags or close to its rate up to
  ten times more, and every price doubles past `pow.busyPerMinute`. Each puzzle is bound to a keyed
  hash of the client's IP and User-Agent, signed, single-use and expiring.
- **Probes** (`src/probes/`): each puzzle carries three questions drawn from its salt with the
  server's key: a `DOMMatrix` product, an `Intl` number format, a `CSS.supports` answer, a native
  getter's source, `TextEncoder` bytes. Data, never code, so a strict CSP holds; different for every
  puzzle, so there is no fixed check to study. The server checks the answers:

| Rule             | Weight | What it reads                                               |
| ---------------- | ------ | ----------------------------------------------------------- |
| `probe-mismatch` | 0.6    | The page answered as no real browser does.                  |
| `probes-missing` | 0.3    | The puzzle came with probes and the page posted no answers. |

## 7. The model and the local regression

- **What the model sees** (`src/llm/prompt.ts`): a closed list of at most 96 features, numbers,
  booleans and values from fixed lists, and the ids of the rules that tripped. Never a string the
  browser wrote (user agent, GPU name, fonts): a bot could write instructions in them.
- **What it is asked:** a fixed system prompt, a glossary of every rule generated from the code, two
  calibrated examples, reasons before the verdict, strict JSON (structured output where supported,
  parsed text otherwise), temperature 0, 4 seconds for all attempts.
- **How it counts:** blended with the rules in log-odds, weighted by its confidence (an unsure
  model moves nothing), rules weighing 0.7. It is not asked when the rules decided. A model
  confidently saying "bot" where the rules said human raises the verdict to the extra step.
  Identical questions are answered from a cache.
- **Local regression** (`classifyLocal`): a logistic regression trained by `bun run bench` on the
  labelled corpus, scored by leave-one-out. Free and deterministic, a second opinion, never the
  decision.

## 8. The server

`notabot/middleware` re-runs the browser rules on what the page posts, and adds what only the
server sees.

### The request

| Rule                             | Weight | What it reads                                                                                                                                                             |
| -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `missing-user-agent`             | 0.9    | No User-Agent header.                                                                                                                                                     |
| `http-library`                   | 0.95   | The User-Agent names an HTTP library, a scraper or a headless tool.                                                                                                       |
| `missing-accept-language`        | 0.5    | No Accept-Language.                                                                                                                                                       |
| `missing-accept`                 | 0.3    | No Accept.                                                                                                                                                                |
| `missing-accept-encoding`        | 0.35   | No Accept-Encoding.                                                                                                                                                       |
| `chromium-without-client-hints`  | 0.5    | A Chromium (90+) on a secure origin without `sec-ch-ua`.                                                                                                                  |
| `headless-client-hint`           | 0.9    | `sec-ch-ua` names HeadlessChrome.                                                                                                                                         |
| `client-hints-platform-mismatch` | 0.7    | `sec-ch-ua-platform` names another system than the User-Agent.                                                                                                            |
| `client-hints-version-mismatch`  | 0.6    | `sec-ch-ua` names another Chromium version than the User-Agent.                                                                                                           |
| `client-hints-mobile-mismatch`   | 0.5    | `sec-ch-ua-mobile` disagrees with the User-Agent about being a phone.                                                                                                     |
| `missing-fetch-metadata`         | 0.45   | A modern browser without `Sec-Fetch-*`.                                                                                                                                   |
| `http1-chromium`                 | 0.35   | A Chromium speaking HTTP/1.x, only when the protocol is the client's (Cloudflare's `request.cf`, or TLS Node terminates itself).                                          |
| `ja4-ua-mismatch`                | 0.7    | A browser User-Agent over a TLS handshake no current browser makes (below TLS 1.3, no server name, no HTTP/2 or 3 offered), from Cloudflare or a trusted proxy's `x-ja4`. |
| `http2-settings-not-chromium`    | 0.5    | A Chromium User-Agent whose HTTP/2 SETTINGS are not Chromium's (header table 65536, no push, a 6 MB window, a 256 KB header list).                                        |
| `http2-settings-not-firefox`     | 0.5    | A Firefox (115+) User-Agent whose SETTINGS are not Firefox's (header table 65536, a 128 KB window, 16 KB frames, as Firefox 157 and Camoufox sent them).                  |
| `hosting-network`                | 0.5    | The IP belongs to a hosting provider.                                                                                                                                     |

The request's JA4H is computed on every analysis (from Node's `rawHeaders`, in the order sent);
a proxy running p0f can pass its TCP guess as `network.tcpOs` for your own rules.

### The request against the page

| Rule                | Weight | What it reads                                                                       |
| ------------------- | ------ | ----------------------------------------------------------------------------------- |
| `server-user-agent` | 0.8    | The User-Agent header differs from `navigator.userAgent`.                           |
| `server-language`   | 0.3    | Accept-Language differs from `navigator.languages`.                                 |
| `server-timezone`   | 0.35   | The IP's time zone differs from the browser's (VPNs do this too).                   |
| `tor-exit`          | 0.3    | The IP is a Tor exit node, from the Tor Project's list (many Tor users are people). |
| `rate`              | 0.4    | More requests a minute from this IP than allowed (`ratePerMinute`).                 |

### At scale (`velocity`, off by default)

| Rule                   | Weight | What it reads                                                                            |
| ---------------------- | ------ | ---------------------------------------------------------------------------------------- |
| `fingerprint-velocity` | 0.5    | The same fingerprint (canvas, WebGL, audio, fonts) from more than 30 IPs in ten minutes. |
| `fingerprint-churn`    | 0.4    | More than six fingerprints from one IP in ten minutes.                                   |

Identical phones share a fingerprint and offices share an IP: tune both to your traffic.

### Tokens and endpoints

- **Signed tokens:** `/verify` re-scores and signs a token (HMAC) that expires, is bound to the
  User-Agent and IP it was issued to, and is accepted once by the gate and once by `/siteverify`.
- **Origins:** with `allowedOrigins`, a POST without an `Origin` is refused, and a refused origin
  gets no CORS header.
- **Replays:** a proof of work, a set of signals and a gesture each play once.
- **Limits:** bodies are size-capped and shape-checked before any rule reads them; `/challenge` and
  `/slide` are rate-limited.
- **Honeypot:** the gate flags a filled honeypot field in the form it protects.

### Agents that sign (Web Bot Auth)

A request signed per HTTP Message Signatures (Ed25519, tag `web-bot-auth`) is checked against the
key its operator publishes at `/.well-known/http-message-signatures-directory`. A valid signature
from an operator you list passes as a verified agent, its request-shape rules set aside (an agent
that signs is not passing for a browser); an unlisted operator, a bad, stale or replayable
signature is refused. Directories are fetched only for listed operators, over https, never an IP
literal or a local name, without redirects, within 3 s and 64 KB, cached for an hour.

## 9. Smart signals

`notabot/smart` computes, from the same readings, what fingerprinting services sell on top:

- **Visitor id:** a hash of the readings that stay put (browser major version, platform,
  languages, time zone, screen, cores, memory, WebGL, WebGPU, fonts, codecs, engine quirks, the
  canvas only when two reads agree, audio), with a confidence that drops under farbling,
  resistFingerprinting, a likely private session or missing prints. Keyed with your HMAC key on the
  server, so two sites never share one.
- **Private mode** (likely, unlikely, unknown; never held against anyone), **virtual machine** (a
  VM's or a software renderer), **privacy browser** (Brave, resistFingerprinting), **tampering**,
  and on the server **Tor**, **VPN** (the IP's time zone against the browser's), **hosting** and
  **velocity**. Sealed in the token and returned by `/siteverify`.

## 10. Measured and left out

What was tried and not shipped, or shipped differently, with the reason:

- **The real core count against `hardwareConcurrency`.** Workers running at once in a 40 ms window
  read 2.9 to 4.7 of ten cores on a Mac whose efficiency cores run slower, and 1.5 to 3 in Docker
  limited to two CPUs claiming ten or sixteen: too close to tell apart without challenging people.
- **A server learning software-rasterizer scenes from its traffic.** Anyone can post forged signals
  to `/verify`: a learning server could be taught that a real Mac's scene is software. A fixed list
  measured on known renderers cannot be poisoned.
- **DevTools detection:** its tricks are unreliable, and V8 broke the last one.
- **WebRTC IP leaks:** they need a third-party STUN server.
- **Lists of JA4 hashes:** the JA4 rule checks coherence with the format, not a list to keep up.
- **An OS classifier from canvas text rasterization:** it needs a real dataset first.
- **Mobile-app signals** (jailbreak, emulators): they need native code.

What does not get caught alone, plainly: a browser patched at the source that leaves no seam (once
Camoufox fixes its two, only the contradictions of its generated fingerprint remain), an AI agent
driving a real browser on a real GPU, and human solving farms. For those: the server's signals, a
price per attempt, and agents that sign their requests.

## 11. How the methods are kept honest

- **False positives are a test:** `tests/profiles.test.ts` runs every rule on people whose readings
  look odd for good reasons (keyboard only, a screen reader, a canvas-blocking extension, Brave,
  Safari, Firefox on a Mac, on Linux, with resistFingerprinting and with strict tracking protection,
  Chrome on Windows, an Android phone). CI fails if any of them is called a bot.
- **A benchmark of real automation:** `bun run capture` drives Playwright Chromium, Firefox,
  installed Chrome and Brave (with and without a stealth layer), Patchright, and Camoufox claiming
  macOS, Windows and Linux; `bun run bench` scores them with the rules, the regression and, with a
  key, a model. The README carries the table.
- **Thresholds come from measures:** the slider's tremor from 40 real drags, the GPU speed from
  real GPUs and SwiftShader on ten and two cores, the HTTP/2 SETTINGS from what Firefox, Chromium,
  WebKit and curl sent to `node:http2`, the SwiftShader scene from four platforms and two versions.
  Where the corpus is small, the README says so.
- **This document:** `tests/doc.test.ts` fails when a rule is added to the code and not described
  here.
