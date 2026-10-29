# notabot Worker

The server half of notabot: signed puzzles, server-side signals, your model with your key, and
a reCAPTCHA-style `siteverify` for your backend.

```sh
npm install
npx wrangler secret put NOTABOT_HMAC_KEY      # any long random string
npx wrangler secret put NOTABOT_SITE_SECRET   # what your backend sends to /siteverify
npx wrangler deploy
```

On the page:

```html
<notabot-check
  challenge-url="https://notabot.<you>.workers.dev/challenge"
  verify-url="https://notabot.<you>.workers.dev/verify"></notabot-check>
<script type="module" src="https://maxgfr.github.io/notabot/cdn/notabot.js"></script>
```

On your backend, before trusting the form:

```sh
curl -X POST https://notabot.<you>.workers.dev/siteverify \
  -H 'content-type: application/json' \
  -d '{"secret":"<NOTABOT_SITE_SECRET>","response":"<the notabot-token field>"}'
# → {"success":true,"verdict":"human","bot":0.04,"score":0.96,"challenge_ts":"…","hostname":"example.com"}
```

Optional: `LLM_ENDPOINT`, `LLM_MODEL` and the secret `LLM_API_KEY` (any OpenAI-compatible API,
e.g. OpenRouter or Groq) for the AI opinion; a KV namespace bound as `NOTABOT_KV` to refuse
replayed puzzles and tokens across isolates; `ALLOWED_ORIGINS` for CORS.

`bun scripts/serve.ts` in the repository runs this Worker locally at `/worker/` with the key
`dev`, which the e2e tests use.
