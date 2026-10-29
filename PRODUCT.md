# Product

<!-- impeccable:product-schema 1 -->

Inferred from the owner's brief (the interview round timed out unanswered); items marked _(inferred)_ await confirmation.

## Platform

web

## Stack

Bun + TypeScript, vanilla DOM, HTML templates rendered per language by `scripts/pages.ts`, served from GitHub Pages; conventions copied from the owner's murmur project. Strict CSP.

## Users

- Developers and site owners who want to block bots on their own sites without handing visitor data to Google or Cloudflare, and who evaluate notabot by running it on their own browser first.
- Curious visitors who arrive from the V2F/overfl0w video "En vrai, les captchas… c'est encore utile ?" and want to see what a page can learn about them. _(inferred)_

## Product Purpose

notabot is an open-source (MIT), front-end-only bot detector: one script tag or an npm package collects every signal a browser exposes, cross-checks them for lies (automation flags, replaced native functions, a fresh iframe and a worker answering differently, OS/engine/time-zone contradictions, canvas/WebGL/audio, pointer and keyboard behaviour), runs an invisible proof-of-work, and asks a small LLM of the owner's choice (through llm-connect) for a verdict. The demo site shows a visitor all of this about their own browser, live. Success: a developer understands the mechanism in one visit and copies the snippet.

## Positioning

The verdict is explainable: every signal, every rule that tripped and the exact prompt sent to the model are shown, nothing is hidden behind a vendor score. Open source end to end, and the model is the owner's (their key, their Worker, or a local Ollama).

## Operating Context

Visitors open the page in their everyday browser, often with privacy extensions, sometimes in headless automation (the e2e suite). The site must work with no key configured; the AI verdict is optional and runs only on the visitor's action.

## Capabilities and Constraints

- Front-end only for now: any verdict made in the page can be forged. The site must say so plainly and point to the example Cloudflare Worker (`examples/cloudflare-worker`) for real enforcement.
- Network-level fingerprints (TCP, TLS/JA4, HTTP/2) are invisible to a page; the site names them as server-side only.
- The model only ever receives numbers, booleans and fixed enums, never raw client strings.
- English and French.

## Brand Commitments

Name: notabot. Author: maxgfr. Source video credited: V2F for overfl0w.

## Evidence on Hand

- The visitor's own live signals (the demo's real content).
- The video transcript (`[V1 mm:ss]` stamps) as the source of the explanation.
- No users, customers, benchmarks or detection-rate figures exist: none may be invented.

## Product Principles

1. Show, don't claim: the visitor's own browser is the demo.
2. Every verdict explains itself.
3. Honest about the limits of front-end detection.
4. Privacy first: nothing leaves the page unless the visitor asks for the AI verdict.

## Accessibility & Inclusion

The challenge must be passable with a keyboard and must never be the only reason to block. WCAG 2.2 AA for the site. _(inferred)_
