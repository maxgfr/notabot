// Framework adapters. No framework is a dependency: they take the minimal shapes they read.
import type { Decision, Notabot } from "./index";
import { infoFromRequest, refusal, tokenFromRequest } from "./index";
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
    if (v === undefined) continue;
    headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  return headers;
}

function nodeUrl(req: NodeRequestLike, headers: Headers): string {
  const proto = req.protocol ?? (req.socket?.encrypted ? "https" : "http");
  return `${proto}://${headers.get("host") ?? "localhost"}${req.originalUrl ?? req.url ?? "/"}`;
}

/** RequestInfo of a Node request (Express, Connect, Fastify's raw request, node:http). */
export function infoFromNode(req: NodeRequestLike): RequestInfo {
  const headers = nodeHeaders(req.headers);
  return {
    method: req.method ?? "GET",
    url: nodeUrl(req, headers),
    headers,
    ip: req.ip ?? req.socket?.remoteAddress ?? null,
    httpVersion: req.httpVersion ?? null,
    network: null,
    ja4: headers.get("x-ja4"),
  };
}

async function readBody(req: NodeRequestLike): Promise<string | undefined> {
  if (req.body !== undefined) {
    if (typeof req.body === "string") return req.body;
    if (req.body instanceof Uint8Array) return new TextDecoder().decode(req.body);
    return JSON.stringify(req.body);
  }
  if (!req.on) return undefined;
  const on = req.on.bind(req);
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = [];
    on("data", (c) =>
      chunks.push(typeof c === "string" ? new TextEncoder().encode(c) : (c as Uint8Array)),
    );
    on("end", () => {
      const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of chunks) {
        all.set(c, at);
        at += c.length;
      }
      resolve(new TextDecoder().decode(all));
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
  const body = req.body as Record<string, unknown> | undefined;
  return body && typeof body === "object" && typeof body[field] === "string"
    ? (body[field] as string)
    : null;
}

export interface ExpressOptions {
  /** Only serve the endpoints (challenge, verify, siteverify), never gate. */
  routesOnly?: boolean;
  /** What a refused request gets; default 403 JSON with the reason and flags. */
  onRefuse?: (decision: Decision, req: NodeRequestLike, res: NodeResponseLike) => void;
}

/**
 * Express / Connect middleware: serves `{basePath}/challenge|verify|siteverify`, then gates the
 * request (token + request analysis). The decision is on `req.notabot`. Put a body parser first
 * to read the token from form fields; the `x-notabot-token` header always works.
 */
export function notabotExpress(nb: Notabot, options: ExpressOptions = {}) {
  return async (req: NodeRequestLike, res: NodeResponseLike, next: (error?: unknown) => void) => {
    try {
      const info = infoFromNode(req);
      const path = new URL(info.url).pathname;
      if (path === nb.options.basePath || path.startsWith(`${nb.options.basePath}/`)) {
        const method = info.method.toUpperCase();
        const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);
        const request = new Request(info.url, {
          method,
          headers: info.headers,
          ...(body !== undefined ? { body } : {}),
        });
        const response = await nb.handle(request, {
          ip: info.ip ?? null,
          httpVersion: info.httpVersion ?? null,
        });
        if (response) return void (await send(res, response));
      }
      if (options.routesOnly) return next();
      const decision = await nb.verifyRequest(
        info,
        tokenFromNode(req, nb.options.tokenHeader, nb.options.tokenField),
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
      infoFromRequest(c.req.raw, extra),
      await tokenFromRequest(c.req.raw, nb.options.tokenHeader, nb.options.tokenField),
    );
    c.set("notabot", decision);
    if (!decision.ok) return refusal(decision);
    await next();
    return undefined;
  };
}
