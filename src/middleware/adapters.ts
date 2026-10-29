// Framework adapters. No framework is a dependency: they take the minimal shapes they read.

import type { Http2Settings } from "./fingerprints";
import type { Decision, Notabot, TrustProxy } from "./index";
import { fieldFromRequest, refusal, tokenFromRequest } from "./index";
import type { RequestInfo } from "./request";

/** The parts of a Node / Express request the adapter reads. */
export interface NodeRequestLike {
  method?: string;
  url?: string;
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  httpVersion?: string;
  ip?: string;
  protocol?: string;
  body?: unknown;
  socket?: { remoteAddress?: string; encrypted?: boolean };
  /** Header names and values in the order received (node:http, node:http2). */
  rawHeaders?: string[];
  /** node:http2's compatibility request: the session holds the client's SETTINGS. */
  stream?: { session?: { remoteSettings?: Http2Settings } | undefined };
  on?(event: string, listener: (chunk?: unknown) => void): unknown;
  notabot?: Decision;
}

export interface NodeResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string | Uint8Array): unknown;
  headersSent?: boolean;
}

function nodeHeaders(raw: NodeRequestLike["headers"]): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(raw)) {
    // HTTP/2 pseudo-headers (:method, :path…) are not headers; :authority stands for Host.
    if (v === undefined || (k.startsWith(":") && k !== ":authority")) continue;
    const value = Array.isArray(v) ? v.join(", ") : v;
    if (k === ":authority") {
      if (!raw.host) headers.set("host", value);
    } else headers.set(k, value);
  }
  return headers;
}

function nodeUrl(req: NodeRequestLike, headers: Headers): string {
  const proto = req.protocol ?? (req.socket?.encrypted ? "https" : "http");
  return `${proto}://${headers.get("host") ?? "localhost"}${req.originalUrl ?? req.url ?? "/"}`;
}

/**
 * The client IP of a Node request: the header `trust` names when it is set, else `req.ip`
 * (Express computes it from its own `trust proxy` setting), else the socket's peer.
 */
export function nodeIp(req: NodeRequestLike, trust: TrustProxy = false): string | null {
  const header = (name: string) => {
    const v = req.headers[name];
    return Array.isArray(v) ? v.join(", ") : (v ?? "");
  };
  if (trust === "cloudflare") return header("cf-connecting-ip") || null;
  if (trust === "x-forwarded-for") {
    const hops = header("x-forwarded-for")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return hops[hops.length - 1] ?? null;
  }
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

/**
 * RequestInfo of a Node request (Express, Connect, Fastify's raw request, node:http, and
 * node:http2's compatibility API, whose session gives the client's SETTINGS). A JA4 header is
 * read only from a proxy `trust` vouches for: anyone can send `x-ja4`.
 */
export function infoFromNode(req: NodeRequestLike, trust: TrustProxy = false): RequestInfo {
  const headers = nodeHeaders(req.headers);
  const order = req.rawHeaders?.filter((_, i) => i % 2 === 0).map((n) => n.toLowerCase());
  const settings = req.stream?.session?.remoteSettings;
  return {
    method: req.method ?? "GET",
    url: nodeUrl(req, headers),
    headers,
    ip: nodeIp(req, trust),
    httpVersion: req.httpVersion ?? null,
    network: null,
    ja4: trust ? headers.get("x-ja4") : null,
    headerOrder: order?.length ? order : null,
    http2Settings: settings ? { ...settings } : null,
  };
}

/** A body as text with its content type, or "too-large" past the cap. */
type NodeBody = { text: string; type: string | null } | "too-large" | undefined;

/**
 * The body of a Node request. A body a parser already read is encoded again the way its
 * content type says (a form stays a form), since the stream is gone.
 */
async function readBody(req: NodeRequestLike, max: number): Promise<NodeBody> {
  const raw = req.headers["content-type"];
  const declared = typeof raw === "string" ? raw : null;
  const fits = (text: string, type = declared): NodeBody =>
    new TextEncoder().encode(text).byteLength > max ? "too-large" : { text, type };
  if (req.body !== undefined) {
    if (typeof req.body === "string") return fits(req.body);
    if (req.body instanceof Uint8Array)
      return req.body.byteLength > max
        ? "too-large"
        : { text: new TextDecoder().decode(req.body), type: declared };
    if (declared?.includes("application/x-www-form-urlencoded") && typeof req.body === "object") {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(req.body as Record<string, unknown>))
        if (typeof v === "string") form.set(k, v);
      return fits(form.toString());
    }
    return fits(JSON.stringify(req.body), "application/json");
  }
  if (Number(req.headers["content-length"] ?? 0) > max) return "too-large";
  if (!req.on) return undefined;
  const on = req.on.bind(req);
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let over = false;
    on("data", (c) => {
      if (over) return;
      const chunk = typeof c === "string" ? new TextEncoder().encode(c) : (c as Uint8Array);
      size += chunk.length;
      if (size > max) {
        over = true;
        chunks.length = 0;
        resolve("too-large");
        return;
      }
      chunks.push(chunk);
    });
    on("end", () => {
      if (over) return;
      const all = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        all.set(c, at);
        at += c.length;
      }
      resolve({ text: new TextDecoder().decode(all), type: declared });
    });
    on("error", () => resolve(undefined));
  });
}

async function send(res: NodeResponseLike, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  res.end(new Uint8Array(await response.arrayBuffer()));
}

function tokenFromNode(req: NodeRequestLike, header: string, field: string): string | null {
  const h = req.headers[header];
  if (typeof h === "string" && h) return h;
  return fieldFromNode(req, field);
}

/** A string field of a body a parser already read. */
function fieldFromNode(req: NodeRequestLike, field: string): string | null {
  const body = req.body as Record<string, unknown> | undefined;
  return body && typeof body === "object" && typeof body[field] === "string"
    ? (body[field] as string)
    : null;
}

export interface ExpressOptions {
  /** Only serve the endpoints (challenge, verify, slide, siteverify), never gate. */
  routesOnly?: boolean;
  /** What a refused request gets; default 403 JSON with the reason and flags. */
  onRefuse?: (decision: Decision, req: NodeRequestLike, res: NodeResponseLike) => void;
}

/**
 * Express / Connect middleware: serves `{basePath}/challenge|verify|slide|siteverify`, then gates the
 * request (token + request analysis). The decision is on `req.notabot`. Put a body parser first
 * to read the token from form fields; the `x-notabot-token` header always works.
 */
export function notabotExpress(nb: Notabot, options: ExpressOptions = {}) {
  return async (req: NodeRequestLike, res: NodeResponseLike, next: (error?: unknown) => void) => {
    try {
      const info = infoFromNode(req, nb.options.trustProxy);
      const path = new URL(info.url).pathname;
      if (path === nb.options.basePath || path.startsWith(`${nb.options.basePath}/`)) {
        const method = info.method.toUpperCase();
        const body =
          method === "GET" || method === "HEAD"
            ? undefined
            : await readBody(req, nb.options.maxBodyBytes);
        if (body === "too-large")
          return void (await send(
            res,
            Response.json({ error: "body too large", reason: "malformed" }, { status: 413 }),
          ));
        const headers = new Headers(info.headers);
        headers.delete("content-length");
        if (body?.type) headers.set("content-type", body.type);
        const request = new Request(info.url, {
          method,
          headers,
          ...(body !== undefined ? { body: body.text } : {}),
        });
        const response = await nb.handle(request, {
          ip: info.ip ?? null,
          httpVersion: info.httpVersion ?? null,
          ja4: info.ja4 ?? null,
          headerOrder: info.headerOrder ?? null,
          http2Settings: info.http2Settings ?? null,
        });
        if (response) return void (await send(res, response));
      }
      if (options.routesOnly) return next();
      const decision = await nb.verifyRequest(
        info,
        tokenFromNode(req, nb.options.tokenHeader, nb.options.tokenField),
        { honeypot: fieldFromNode(req, `${nb.options.tokenField}-hp`) },
      );
      req.notabot = decision;
      if (decision.ok) return next();
      if (options.onRefuse) return options.onRefuse(decision, req, res);
      await send(res, refusal(decision));
    } catch (error) {
      next(error);
    }
  };
}

/** The parts of a Hono context the adapter reads. */
export interface HonoContextLike {
  req: { raw: Request; header(name: string): string | undefined };
  set(key: "notabot", value: Decision): void;
}

/**
 * Hono middleware (Workers, Bun, Deno, Node): serves the endpoints, then gates; the decision is
 * `c.get("notabot")`.
 */
export function notabotHono(
  nb: Notabot,
  options: { routesOnly?: boolean; info?: (c: HonoContextLike) => Partial<RequestInfo> } = {},
) {
  return async (c: HonoContextLike, next: () => Promise<void>): Promise<Response | undefined> => {
    const extra = options.info?.(c) ?? {};
    const served = await nb.handle(c.req.raw, extra);
    if (served) return served;
    if (options.routesOnly) {
      await next();
      return undefined;
    }
    const decision = await nb.verifyRequest(
      nb.requestInfo(c.req.raw, extra),
      await tokenFromRequest(c.req.raw, nb.options.tokenHeader, nb.options.tokenField),
      { honeypot: await fieldFromRequest(c.req.raw, `${nb.options.tokenField}-hp`) },
    );
    c.set("notabot", decision);
    if (!decision.ok) return refusal(decision);
    await next();
    return undefined;
  };
}
