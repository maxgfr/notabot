import { afterAll, describe, expect, test } from "bun:test";
import http2 from "node:http2";
import {
  clearAgentDirectories,
  createNotabot,
  directoryUrl,
  infoFromNode,
  infoFromRequest,
  ja4h,
  jwkThumbprint,
  type NodeRequestLike,
  parseJa4,
  requestFlags,
} from "../src/middleware/index";
import { type Challenge, encodeSolution, search, solveChallenge } from "../src/pow/index";
import { checkProbe, expectedAnswer, type Probe, probesFor } from "../src/probes/index";
import { createChallenge, verifySolution } from "../src/server/index";
import type { NotabotSignals } from "../src/signals/types";
import { chromeHeaders } from "./browser-headers";
import { realChrome } from "./fixtures";

const UA = realChrome().env.userAgent;
const ids = (flags: { id: string }[]) => flags.map((f) => f.id);
const req = (path: string, headers: Record<string, string>, init: RequestInit = {}) =>
  new Request(`https://site.dev${path}`, { ...init, headers });

describe("JA4, JA4H, HTTP/2", () => {
  test("JA4's readable part is parsed; a malformed one is not", () => {
    expect(parseJa4("t13d1516h2_8daaf6152771_e5627efa2ab1")).toEqual({
      protocol: "t",
      tls: "13",
      sni: "d",
      ciphers: 15,
      extensions: 16,
      alpn: "h2",
    });
    expect(parseJa4("not a ja4")).toBeNull();
  });

  test("a browser user agent over a non-browser TLS handshake, only from a trusted proxy", () => {
    const python = { ...chromeHeaders(UA), "x-ja4": "t13d1312h1_8daaf6152771_e5627efa2ab1" };
    // Anyone can send x-ja4: without a trusted proxy it is ignored.
    expect(ids(requestFlags(infoFromRequest(req("/", python))))).not.toContain("ja4-ua-mismatch");
    const trusted = infoFromRequest(req("/", python), {}, { trustProxy: "x-forwarded-for" });
    expect(ids(requestFlags(trusted))).toContain("ja4-ua-mismatch");
    for (const ja4 of [
      "t12d1516h2_8daaf6152771_e5627efa2ab1",
      "t13i1516h2_8daaf6152771_e5627efa2ab1",
    ])
      expect(ids(requestFlags({ ...trusted, ja4 }))).toContain("ja4-ua-mismatch");
    for (const ja4 of [
      "t13d1516h2_8daaf6152771_e5627efa2ab1",
      "q13d0312h3_55b375c5d22e_06cda9e17597",
    ])
      expect(ids(requestFlags({ ...trusted, ja4 }))).not.toContain("ja4-ua-mismatch");
    const node = infoFromNode({ headers: python }, "cloudflare");
    expect(node.ja4).toBe(python["x-ja4"]);
    expect(infoFromNode({ headers: python }).ja4).toBeNull();
  });

  test("HTTP/1.1 counts against a Chromium only when it is the client's protocol", () => {
    const headers = { ...chromeHeaders(UA), host: "site.dev" };
    // Plain HTTP, or a proxy forwarding HTTP/1.1: the last hop's protocol says nothing.
    const behindProxy = infoFromNode({ method: "GET", url: "/", headers, httpVersion: "1.1" });
    expect(behindProxy.httpVersion).toBeNull();
    expect(ids(requestFlags(behindProxy))).not.toContain("http1-chromium");
    // TLS Node terminates itself: that is the browser speaking HTTP/1.1.
    const direct = infoFromNode({
      method: "GET",
      url: "/",
      headers,
      httpVersion: "1.1",
      socket: { encrypted: true },
    });
    expect(ids(requestFlags(direct))).toContain("http1-chromium");
  });

  test("JA4H: its readable part, and the header order when the platform keeps it", async () => {
    const headers = new Headers({
      "user-agent": UA,
      accept: "*/*",
      "accept-language": "fr-FR,fr;q=0.9",
      cookie: "b=2; a=1",
      referer: "https://site.dev/",
    });
    const a = await ja4h({
      method: "GET",
      httpVersion: "2.0",
      headers,
      headerOrder: ["user-agent", "accept", "accept-language"],
    });
    expect(a).toMatch(/^ge20cr03frfr_[0-9a-f]{12}_[0-9a-f]{12}_[0-9a-f]{12}$/);
    const b = await ja4h({
      method: "GET",
      httpVersion: "2.0",
      headers,
      headerOrder: ["accept", "user-agent", "accept-language"],
    });
    expect(b.split("_")[1]).not.toBe(a.split("_")[1]);
    expect(b.split("_")[2]).toBe(a.split("_")[2]);
    const none = await ja4h({ method: "POST", headers: new Headers({ "user-agent": "curl/8" }) });
    expect(none).toMatch(/^po11nn010000_[0-9a-f]{12}_0{12}_0{12}$/);
  });

  test("node:http2: SETTINGS that are not Chromium's, from a client claiming Chrome", async () => {
    const nb = createNotabot({ hmacKey: "k", requireToken: false });
    const server = http2.createServer(async (request, response) => {
      const info = infoFromNode(request as unknown as NodeRequestLike);
      const analysis = await nb.analyzeRequest(info);
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          flags: ids(analysis.flags),
          ja4h: analysis.ja4h,
          settings: info.http2Settings,
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    const client = http2.connect(`http://localhost:${port}`);
    const body = await new Promise<string>((resolve, reject) => {
      const stream = client.request({ ":path": "/", ...chromeHeaders(UA) });
      let data = "";
      stream.setEncoding("utf8");
      stream.on("data", (c) => {
        data += c;
      });
      stream.on("end", () => resolve(data));
      stream.on("error", reject);
    });
    client.close();
    server.close();
    const out = JSON.parse(body) as { flags: string[]; ja4h: string; settings: object };
    // Node's client sends its own SETTINGS, not Chromium's 6 MB window.
    expect(out.settings).toBeTruthy();
    expect(out.flags).toContain("http2-settings-not-chromium");
    expect(out.ja4h.startsWith("ge20")).toBe(true);
  });
});

describe("adaptive proof of work", () => {
  test("PBKDF2 puzzles solve and verify; their cost cannot be lowered", async () => {
    const c = await createChallenge({
      hmacKey: "k",
      maxnumber: 20,
      algorithm: "PBKDF2",
      cost: 200,
    });
    expect(c).toMatchObject({ algorithm: "PBKDF2", cost: 200 });
    const solution = await solveChallenge(c, { worker: false });
    expect(solution).not.toBeNull();
    expect((await verifySolution(solution as NonNullable<typeof solution>, "k")).ok).toBe(true);
    const cheaper = { ...(solution as NonNullable<typeof solution>), cost: 1 };
    expect(await verifySolution(cheaper, "k")).toEqual({ ok: false, reason: "bad-signature" });
  });

  test("a puzzle is bound to its client", async () => {
    const c = await createChallenge({ hmacKey: "k", maxnumber: 300, bind: "abc123" });
    const solution = encodeSolution({ ...c, number: (await search(c)) as number, took: 1 });
    expect((await verifySolution(solution, "k", Date.now(), { bind: "abc123" })).ok).toBe(true);
    expect(await verifySolution(solution, "k", Date.now(), { bind: "ffff00" })).toEqual({
      ok: false,
      reason: "wrong-client",
    });
  });

  test("a risky request pays more, in PBKDF2 with algorithm auto; a clean browser pays the base", async () => {
    const nb = createNotabot({ hmacKey: "k", pow: { base: 1000, algorithm: "auto" } });
    const get = async (headers: Record<string, string>) =>
      (await (await nb.handle(req("/notabot/challenge", headers)))?.json()) as Challenge;
    const clean = await get(chromeHeaders(UA));
    expect(clean).toMatchObject({ algorithm: "SHA-256", maxnumber: 1000 });
    expect(clean.probes).toHaveLength(3);
    const curl = await get({ "user-agent": "curl/8.7" });
    expect(curl.algorithm).toBe("PBKDF2");
    expect(curl.maxnumber * 100).toBeGreaterThan(5000);
  });
});

describe("fingerprint velocity", () => {
  test("one fingerprint from many IPs, many fingerprints from one IP", async () => {
    const nb = createNotabot({
      hmacKey: "k",
      maxnumber: 300,
      velocity: { ipsPerFingerprint: 3, fingerprintsPerIp: 2 },
    });
    const post = async (signals: NotabotSignals, ip: string) => {
      const headers = chromeHeaders(UA);
      const c = (await (
        await nb.handle(req("/notabot/challenge", headers), { ip })
      )?.json()) as Challenge;
      const solution = encodeSolution({ ...c, number: (await search(c)) as number, took: 1 });
      const res = await nb.handle(
        req(
          "/notabot/verify",
          { ...headers, "content-type": "application/json" },
          {
            method: "POST",
            body: JSON.stringify({
              signals,
              solution,
              probes: (c.probes ?? []).map(expectedAnswer),
            }),
          },
        ),
        { ip },
      );
      return ((await (res as Response).json()) as { flags: string[] }).flags;
    };
    const same = () => {
      const s = realChrome();
      s.durationMs = Math.random() * 1000; // not the same blob, the same browser
      return s;
    };
    for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3"])
      expect(await post(same(), ip)).not.toContain("fingerprint-velocity");
    expect(await post(same(), "198.51.100.4")).toContain("fingerprint-velocity");
    const other = (hash: string) => {
      const s = realChrome();
      s.hardware.canvas = { hash, stable: true };
      return s;
    };
    expect(await post(other("aa"), "203.0.113.50")).not.toContain("fingerprint-churn");
    expect(await post(other("bb"), "203.0.113.50")).not.toContain("fingerprint-churn");
    expect(await post(other("cc"), "203.0.113.50")).toContain("fingerprint-churn");
  });
});

describe("Web Bot Auth", () => {
  const OPERATOR = "https://agent.example";
  let keys: CryptoKeyPair;
  let jwk: { kty: string; crv: string; x: string };
  const directory = async (url: string | URL | Request) =>
    String(url) === `${OPERATOR}/.well-known/http-message-signatures-directory`
      ? Response.json({ keys: [jwk] })
      : new Response("no", { status: 404 });
  afterAll(() => clearAgentDirectories());

  async function signed(
    path: string,
    over: { created?: number; expires?: number; agent?: string; tamper?: boolean } = {},
  ) {
    keys ??= (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const exported = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
    jwk = { kty: "OKP", crv: "Ed25519", x: exported.x as string };
    const keyid = await jwkThumbprint(jwk);
    const now = Math.floor(Date.now() / 1000);
    const agent = `"${over.agent ?? OPERATOR}"`;
    const params = `("@authority" "signature-agent");created=${over.created ?? now};expires=${over.expires ?? now + 60};keyid="${keyid}";alg="ed25519";tag="web-bot-auth"`;
    const base = [
      `"@authority": site.dev`,
      `"signature-agent": ${agent}`,
      `"@signature-params": ${params}`,
    ].join("\n");
    const sig = new Uint8Array(
      await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(base)),
    );
    if (over.tamper) sig[0] = (sig[0] ?? 0) ^ 1;
    return req(path, {
      "user-agent": "AgentBot/1.0 python-requests/2.32",
      accept: "*/*",
      "accept-language": "en",
      "signature-agent": agent,
      "signature-input": `sig1=${params}`,
      signature: `sig1=:${btoa(String.fromCharCode(...sig))}:`,
    });
  }

  test("an allowed operator's signed agent passes; HTTP-library rules do not count against it", async () => {
    const nb = createNotabot({
      hmacKey: "k",
      agents: { allow: { [OPERATOR]: {} }, fetch: directory as typeof fetch },
    });
    const decision = await nb.verifyRequest(infoFromRequest(await signed("/api")));
    expect(decision).toMatchObject({
      ok: true,
      reason: "verified-agent",
      verifiedAgent: { operator: OPERATOR },
    });
    expect(ids(decision.flags)).not.toContain("http-library");
  });

  test("a tampered, expired, unknown-key or unlisted signature is refused", async () => {
    clearAgentDirectories();
    const nb = createNotabot({
      hmacKey: "k",
      agents: { allow: { [OPERATOR]: {} }, fetch: directory as typeof fetch },
    });
    const reason = async (r: Request) => (await nb.verifyRequest(infoFromRequest(r))).reason;
    expect(await reason(await signed("/a", { tamper: true }))).toBe("bad-agent-signature");
    expect(await reason(await signed("/a", { expires: 1 }))).toBe("bad-agent-signature");
    expect(await reason(await signed("/a", { agent: "https://other.example" }))).toBe(
      "agent-not-allowed",
    );
    const none = createNotabot({
      hmacKey: "k",
      agents: { allow: {}, fetch: directory as typeof fetch },
    });
    expect((await none.verifyRequest(infoFromRequest(await signed("/a")))).reason).toBe(
      "agent-not-allowed",
    );
  });

  test("an operator's rate", async () => {
    clearAgentDirectories();
    const nb = createNotabot({
      hmacKey: "k",
      agents: { allow: { [OPERATOR]: { ratePerMinute: 1 } }, fetch: directory as typeof fetch },
    });
    expect((await nb.verifyRequest(infoFromRequest(await signed("/a")))).ok).toBe(true);
    expect((await nb.verifyRequest(infoFromRequest(await signed("/b")))).reason).toBe("agent-rate");
  });

  test("key directories are never fetched inside the network", () => {
    expect(directoryUrl("https://agent.example")?.href).toBe(
      "https://agent.example/.well-known/http-message-signatures-directory",
    );
    for (const bad of [
      "http://agent.example",
      "https://127.0.0.1",
      "https://2130706433",
      "https://10.0.0.8",
      "https://192.168.1.1",
      "https://169.254.169.254",
      "https://[::1]",
      "https://localhost",
      "https://printer.local",
      "https://user:pw@agent.example",
      "not a url",
    ])
      expect(directoryUrl(bad)).toBeNull();
  });
});

describe("probes", () => {
  test("drawn from a seed: the same seed, the same probes; another seed, others", () => {
    expect(probesFor("seed-a")).toEqual(probesFor("seed-a"));
    expect(probesFor("seed-a")).not.toEqual(probesFor("seed-b"));
    expect(new Set(probesFor("seed-c").map((p) => p.kind)).size).toBe(3);
  });

  test("a real browser's answers pass, anything else fails", () => {
    const matrix: Probe = { kind: "matrix", a: [1, 2, 3, 4, 5, 6], b: [2, 0, 0, 2, 1, 1] };
    expect(checkProbe(matrix, "matrix(2, 4, 6, 8, 9, 12)")).toBe(true);
    expect(checkProbe(matrix, "matrix(1, 0, 0, 1, 0, 0)")).toBe(false);
    const native: Probe = { kind: "native", target: "Navigator", property: "webdriver" };
    expect(checkProbe(native, "function get webdriver() { [native code] }")).toBe(true);
    expect(checkProbe(native, "function webdriver() {\n    [native code]\n}")).toBe(true);
    expect(checkProbe(native, "() => false")).toBe(false);
    expect(checkProbe({ kind: "css", property: "display", value: "grid" }, "true")).toBe(true);
    expect(checkProbe({ kind: "css", property: "display", value: "grid" }, "error")).toBe(false);
    for (const p of probesFor("any")) expect(checkProbe(p, expectedAnswer(p))).toBe(true);
  });

  test("/verify flags wrong or missing answers", async () => {
    const nb = createNotabot({ hmacKey: "k", maxnumber: 300 });
    const post = async (answer: (c: Challenge) => unknown) => {
      const headers = chromeHeaders(UA);
      const c = (await (await nb.handle(req("/notabot/challenge", headers)))?.json()) as Challenge;
      const solution = encodeSolution({ ...c, number: (await search(c)) as number, took: 1 });
      const res = await nb.handle(
        req(
          "/notabot/verify",
          { ...headers, "content-type": "application/json" },
          {
            method: "POST",
            body: JSON.stringify({
              signals: { ...realChrome(), durationMs: Math.random() },
              solution,
              probes: answer(c),
            }),
          },
        ),
      );
      return ((await (res as Response).json()) as { flags: string[] }).flags;
    };
    expect(await post((c) => (c.probes ?? []).map(expectedAnswer))).toEqual([]);
    expect(await post((c) => (c.probes ?? []).map(() => "error"))).toContain("probe-mismatch");
    expect(await post(() => undefined)).toContain("probes-missing");
  });
});
