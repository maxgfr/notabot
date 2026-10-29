// Node-side checks of the installed package: everything a server does that has no browser part.
// Run by scripts/package-e2e.ts in the consumer directory; exits non-zero on the first failure.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http2 from "node:http2";
import { classifyLocal, toFeatures } from "notabot/llm";
import {
  clearTorExitList,
  createNotabot,
  infoFromNode,
  infoFromRequest,
  jwkThumbprint,
  kvStore,
  memoryStore,
  redisStore,
  requestFlags,
  torExitList,
} from "notabot/middleware";
import { encodeSolution, search } from "notabot/pow";
import { score } from "notabot/score";
import { identify, smartSignals } from "notabot/smart";

const human = JSON.parse(readFileSync("fixture-human.json", "utf8")).signals;
const UA = human.env.userAgent;
const headers = {
  "user-agent": UA,
  accept: "*/*",
  "accept-language": "fr-FR,fr;q=0.9",
  "accept-encoding": "gzip, deflate, br, zstd",
  "sec-ch-ua": '"Chromium";v="156", "Brave";v="156"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "cors",
  origin: "https://site.dev",
};
const checks = [];
const check = (name, run) => checks.push([name, run]);

async function verify(nb, signals, ip = "203.0.113.20", extra = {}) {
  const c = await (
    await nb.handle(new Request("https://site.dev/notabot/challenge", { headers }), { ip })
  ).json();
  const solution = encodeSolution({ ...c, number: await search(c), took: 1 });
  const res = await nb.handle(
    new Request("https://site.dev/notabot/verify", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ signals, solution }),
    }),
    { ip, ...extra },
  );
  return { status: res.status, body: await res.json() };
}

check("stores: memory, Redis-shaped and KV-shaped claim once and count", async () => {
  const data = new Map();
  const redis = redisStore({
    set: async (k, v, o) => {
      if (o.NX && data.has(k)) return null;
      data.set(k, v);
      return "OK";
    },
    incr: async (k) => {
      const n = Number(data.get(k) ?? 0) + 1;
      data.set(k, String(n));
      return n;
    },
    expire: async () => 1,
  });
  const kv = new Map();
  const kvs = kvStore({
    get: async (k) => kv.get(k) ?? null,
    put: async (k, v) => void kv.set(k, v),
  });
  for (const store of [memoryStore(), redis, kvs]) {
    assert.equal(await store.claim("x", 60), true);
    assert.equal(await store.claim("x", 60), false);
    assert.equal(await store.incr("n", 60), 1);
    assert.equal(await store.incr("n", 60), 2);
  }
});

check("request analysis: curl, a forged x-ja4 ignored, HTTP/2 SETTINGS read", async () => {
  const curl = requestFlags(
    infoFromRequest(new Request("https://a.dev/", { headers: { "user-agent": "curl/8" } })),
  );
  assert.ok(curl.some((f) => f.id === "http-library"));
  const forged = infoFromNode({
    headers: { ...headers, "x-ja4": "t12d0000h1_000000000000_000000000000" },
  });
  assert.equal(forged.ja4, null);
  const nb = createNotabot({ hmacKey: "k", requireToken: false });
  const server = http2.createServer(async (req, res) => {
    const a = await nb.analyzeRequest(infoFromNode(req));
    res.end(JSON.stringify(a.flags.map((f) => f.id)));
  });
  await new Promise((r) => server.listen(0, r));
  const client = http2.connect(`http://localhost:${server.address().port}`);
  const body = await new Promise((resolve) => {
    const s = client.request({ ":path": "/", ...headers });
    let d = "";
    s.on("data", (c) => {
      d += c;
    });
    s.on("end", () => resolve(d));
  });
  client.close();
  server.close();
  assert.ok(JSON.parse(body).includes("http2-settings-not-chromium"));
});

check("a real browser's signals: human, sealed signals, siteverify hands them over", async () => {
  const nb = createNotabot({ hmacKey: "k", maxnumber: 300, siteSecret: "s" });
  const { status, body } = await verify(nb, human);
  assert.equal(status, 200);
  assert.notEqual(body.verdict, "bot");
  assert.equal(body.smart.privacyBrowser, "brave");
  const sv = await nb.handle(
    new Request("https://site.dev/notabot/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: "s", response: body.token }),
    }),
  );
  assert.deepEqual((await sv.json()).smart, body.smart);
});

check("Tor exits, VPN time zone and the local second opinion on the server", async () => {
  clearTorExitList();
  const tor = torExitList({ fetch: async () => new Response("198.51.100.77\n") });
  const nb = createNotabot({ hmacKey: "k", maxnumber: 300, torExits: tor, local: true });
  const doubtful = structuredClone(human);
  doubtful.automation.softwareRenderer = true;
  const { body } = await verify(nb, doubtful, "198.51.100.77", {
    network: { timezone: "America/New_York" },
  });
  assert.ok(body.flags.includes("tor-exit"));
  assert.equal(body.smart.tor, true);
  assert.equal(body.smart.vpn, true);
  assert.equal(body.secondOpinion, "local");
});

check("Web Bot Auth: an allowed operator's signed agent passes, others are refused", async () => {
  const OP = "https://agent.example";
  const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const jwk = {
    kty: "OKP",
    crv: "Ed25519",
    x: (await crypto.subtle.exportKey("jwk", keys.publicKey)).x,
  };
  const keyid = await jwkThumbprint(jwk);
  const now = Math.floor(Date.now() / 1000);
  const params = `("@authority" "signature-agent");created=${now};expires=${now + 60};keyid="${keyid}";alg="ed25519";tag="web-bot-auth"`;
  const base = [
    `"@authority": site.dev`,
    `"signature-agent": "${OP}"`,
    `"@signature-params": ${params}`,
  ].join("\n");
  const sig = Buffer.from(
    await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(base)),
  ).toString("base64");
  const request = new Request("https://site.dev/api", {
    headers: {
      "user-agent": "Agent/1",
      "signature-agent": `"${OP}"`,
      "signature-input": `sig1=${params}`,
      signature: `sig1=:${sig}:`,
    },
  });
  const fetchDir = async () => Response.json({ keys: [jwk] });
  const allowed = createNotabot({ hmacKey: "k", agents: { allow: { [OP]: {} }, fetch: fetchDir } });
  assert.equal((await allowed.verifyRequest(infoFromRequest(request))).reason, "verified-agent");
  const nobody = createNotabot({ hmacKey: "k", agents: { allow: {}, fetch: fetchDir } });
  assert.equal((await nobody.verifyRequest(infoFromRequest(request))).reason, "agent-not-allowed");
});

check("client modules under Node: score, smart signals, visitor id, local regression", async () => {
  const r = score({ signals: human });
  assert.equal(r.verdict, "human");
  assert.equal(smartSignals(human).privacyBrowser, "brave");
  assert.match((await identify(human)).visitorId, /^[0-9a-f]{20}$/);
  assert.ok(classifyLocal(toFeatures(human, r)).bot < 0.5);
});

let failed = 0;
for (const [name, run] of checks) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e?.stack ?? e}`);
  }
}
if (failed) process.exit(1);
console.log(`node checks: ${checks.length} passed`);
