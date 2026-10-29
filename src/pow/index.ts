import type { Probe } from "../probes/index";
import { base64urlEncode, pbkdf2Hex, randomHex, sha256Hex } from "./crypto";

/** SHA-256 (one round a try, the default) or PBKDF2-SHA-256 (`cost` rounds a try). */
export type PowAlgorithm = "SHA-256" | "PBKDF2";

/**
 * A proof-of-work puzzle, in the spirit of ALTCHA: find the number n ≤ maxnumber such that
 * hash(salt + n) = challenge. The server signs `challenge` so it cannot be made up. It is a cost
 * imposed on each attempt (rate limiting), not a detection: a bot with time pays it too.
 */
export interface Challenge {
  algorithm: PowAlgorithm;
  challenge: string;
  maxnumber: number;
  /** PBKDF2 iterations per try; absent for SHA-256. */
  cost?: number;
  /** Random hex, then `?expires=<unix seconds>` when the challenge expires. */
  salt: string;
  /** HMAC-SHA256 of `challenge` by the server; empty for a local (demo) challenge. */
  signature: string;
  /** Questions for the page to answer with the puzzle, drawn from the salt by the server. */
  probes?: Probe[];
}

export interface Solution {
  algorithm: PowAlgorithm;
  cost?: number;
  challenge: string;
  number: number;
  salt: string;
  signature: string;
  /** Milliseconds the solver took. */
  took: number;
}

export const DEFAULT_MAX_NUMBER = 50_000;

/** The hash a try computes: SHA-256, or PBKDF2 with `cost` iterations. */
export function powHash(algorithm: PowAlgorithm, text: string, cost = 0): Promise<string> {
  return algorithm === "PBKDF2" ? pbkdf2Hex(text, Math.max(1, cost)) : sha256Hex(text);
}

/** What the server's HMAC covers: the challenge, and for PBKDF2 its cost, so it cannot be lowered. */
export function signedPart(c: {
  algorithm: PowAlgorithm;
  challenge: string;
  cost?: number | undefined;
}): string {
  return c.algorithm === "PBKDF2" ? `PBKDF2:${c.cost ?? 0}:${c.challenge}` : c.challenge;
}

/** Seconds since the epoch at which a salt stops being valid, or null. */
export function expiresOf(salt: string): number | null {
  const m = /[?&]expires=(\d+)/.exec(salt);
  return m ? Number(m[1]) : null;
}

/** A puzzle made in the page, unsigned: it measures the cost, it proves nothing to a server. */
export async function localChallenge(
  options: { maxnumber?: number; expiresInSeconds?: number } = {},
): Promise<Challenge> {
  const maxnumber = options.maxnumber ?? DEFAULT_MAX_NUMBER;
  const expires = Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? 600);
  const salt = `${randomHex(12)}?expires=${expires}`;
  const secret = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  const number = secret % (maxnumber + 1);
  return {
    algorithm: "SHA-256",
    challenge: await sha256Hex(salt + number),
    maxnumber,
    salt,
    signature: "",
  };
}

/** Searches 0…maxnumber, `batch` hashes at a time. Exported for workers and tests. */
export async function search(
  challenge: Pick<Challenge, "challenge" | "salt" | "maxnumber"> &
    Partial<Pick<Challenge, "algorithm" | "cost">>,
  options: { batch?: number; signal?: AbortSignal; onProgress?: (n: number) => void } = {},
): Promise<number | null> {
  const algorithm = challenge.algorithm ?? "SHA-256";
  const batch = options.batch ?? (algorithm === "PBKDF2" ? 4 : 64);
  for (let start = 0; start <= challenge.maxnumber; start += batch) {
    if (options.signal?.aborted) return null;
    const end = Math.min(start + batch - 1, challenge.maxnumber);
    const hashes = await Promise.all(
      Array.from({ length: end - start + 1 }, (_, i) =>
        powHash(algorithm, challenge.salt + (start + i), challenge.cost),
      ),
    );
    const hit = hashes.indexOf(challenge.challenge);
    if (hit >= 0) return start + hit;
    if (options.onProgress && (start / batch) % 32 === 0) options.onProgress(start);
  }
  return null;
}

const WORKER_SOURCE = `
const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const enc = new TextEncoder();
const pbkdf2 = async (text, iterations) => {
  const key = await crypto.subtle.importKey("raw", enc.encode(text), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode("notabot"), iterations }, key, 256);
};
onmessage = async (e) => {
  const { challenge, salt, maxnumber, algorithm, cost } = e.data;
  const slow = algorithm === "PBKDF2";
  const batch = slow ? 4 : 64;
  for (let start = 0; start <= maxnumber; start += batch) {
    const end = Math.min(start + batch - 1, maxnumber);
    const jobs = [];
    for (let n = start; n <= end; n++)
      jobs.push((slow ? pbkdf2(salt + n, cost) : crypto.subtle.digest("SHA-256", enc.encode(salt + n))).then(hex));
    const hashes = await Promise.all(jobs);
    const hit = hashes.indexOf(challenge);
    if (hit >= 0) return postMessage({ number: start + hit });
    if ((start / batch) % 64 === 0) postMessage({ progress: start });
  }
  postMessage({ number: null });
};`;

export interface SolveOptions {
  /** Solve in a Web Worker so the page stays responsive. Default true, falls back to the page. */
  worker?: boolean;
  signal?: AbortSignal;
  onProgress?: (tried: number, max: number) => void;
}

function solveInWorker(challenge: Challenge, options: SolveOptions): Promise<number | null> {
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  const worker = new Worker(url);
  return new Promise<number | null>((resolve, reject) => {
    const done = () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    };
    options.signal?.addEventListener("abort", () => {
      done();
      resolve(null);
    });
    worker.onmessage = (e: MessageEvent<{ number?: number | null; progress?: number }>) => {
      if (e.data.progress !== undefined) {
        options.onProgress?.(e.data.progress, challenge.maxnumber);
        return;
      }
      done();
      resolve(e.data.number ?? null);
    };
    worker.onerror = (e) => {
      done();
      reject(new Error(e.message || "worker failed"));
    };
    worker.postMessage({
      challenge: challenge.challenge,
      salt: challenge.salt,
      maxnumber: challenge.maxnumber,
      algorithm: challenge.algorithm,
      cost: challenge.cost ?? 0,
    });
  });
}

/** Finds the number, in a worker when possible. Null when there is none (or it was aborted). */
export async function solveChallenge(
  challenge: Challenge,
  options: SolveOptions = {},
): Promise<Solution | null> {
  const started = performance.now();
  let number: number | null = null;
  const canWork = options.worker !== false && typeof Worker !== "undefined";
  try {
    if (!canWork) throw new Error("no worker");
    number = await solveInWorker(challenge, options);
  } catch {
    const searchOptions: Parameters<typeof search>[1] = {};
    if (options.signal) searchOptions.signal = options.signal;
    if (options.onProgress) {
      const report = options.onProgress;
      searchOptions.onProgress = (n) => report(n, challenge.maxnumber);
    }
    number = await search(challenge, searchOptions);
  }
  if (number === null) return null;
  return {
    algorithm: challenge.algorithm,
    ...(challenge.cost !== undefined ? { cost: challenge.cost } : {}),
    challenge: challenge.challenge,
    number,
    salt: challenge.salt,
    signature: challenge.signature,
    took: Math.round(performance.now() - started),
  };
}

/** The solution as the string a form posts (base64url JSON), as ALTCHA does. */
export function encodeSolution(solution: Solution): string {
  return base64urlEncode(JSON.stringify(solution));
}

/** Fetches a signed challenge from a server (`GET url` answering a {@link Challenge}). */
export async function fetchChallenge(url: string, init?: RequestInit): Promise<Challenge> {
  const res = await fetch(url, { credentials: "omit", ...init });
  if (!res.ok) throw new Error(`notabot: challenge ${res.status}`);
  const body = (await res.json()) as Partial<Challenge>;
  if (
    (body.algorithm !== "SHA-256" && body.algorithm !== "PBKDF2") ||
    (body.algorithm === "PBKDF2" && typeof body.cost !== "number") ||
    typeof body.challenge !== "string" ||
    typeof body.salt !== "string" ||
    typeof body.maxnumber !== "number"
  )
    throw new Error("notabot: malformed challenge");
  const probes = Array.isArray(body.probes) ? body.probes.slice(0, 10) : undefined;
  return { ...(body as Challenge), signature: body.signature ?? "", ...(probes ? { probes } : {}) };
}

export { base64urlDecode, base64urlEncode, sha256Hex } from "./crypto";
