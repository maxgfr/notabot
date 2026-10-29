import { base64urlEncode, randomHex, sha256Hex } from "./crypto";

/**
 * A proof-of-work puzzle, in the spirit of ALTCHA: find the number n ≤ maxnumber such that
 * SHA-256(salt + n) = challenge. The server signs `challenge` so it cannot be made up.
 */
export interface Challenge {
  algorithm: "SHA-256";
  challenge: string;
  maxnumber: number;
  /** Random hex, then `?expires=<unix seconds>` when the challenge expires. */
  salt: string;
  /** HMAC-SHA256 of `challenge` by the server; empty for a local (demo) challenge. */
  signature: string;
}

export interface Solution {
  algorithm: "SHA-256";
  challenge: string;
  number: number;
  salt: string;
  signature: string;
  /** Milliseconds the solver took. */
  took: number;
}

export const DEFAULT_MAX_NUMBER = 50_000;

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
  challenge: Pick<Challenge, "challenge" | "salt" | "maxnumber">,
  options: { batch?: number; signal?: AbortSignal; onProgress?: (n: number) => void } = {},
): Promise<number | null> {
  const batch = options.batch ?? 64;
  for (let start = 0; start <= challenge.maxnumber; start += batch) {
    if (options.signal?.aborted) return null;
    const end = Math.min(start + batch - 1, challenge.maxnumber);
    const hashes = await Promise.all(
      Array.from({ length: end - start + 1 }, (_, i) => sha256Hex(challenge.salt + (start + i))),
    );
    const hit = hashes.indexOf(challenge.challenge);
    if (hit >= 0) return start + hit;
    if (options.onProgress && start % (batch * 32) === 0) options.onProgress(start);
  }
  return null;
}

const WORKER_SOURCE = `
const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const enc = new TextEncoder();
onmessage = async (e) => {
  const { challenge, salt, maxnumber } = e.data;
  const batch = 64;
  for (let start = 0; start <= maxnumber; start += batch) {
    const end = Math.min(start + batch - 1, maxnumber);
    const jobs = [];
    for (let n = start; n <= end; n++) jobs.push(crypto.subtle.digest("SHA-256", enc.encode(salt + n)).then(hex));
    const hashes = await Promise.all(jobs);
    const hit = hashes.indexOf(challenge);
    if (hit >= 0) return postMessage({ number: start + hit });
    if (start % 4096 === 0) postMessage({ progress: start });
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
    body.algorithm !== "SHA-256" ||
    typeof body.challenge !== "string" ||
    typeof body.salt !== "string" ||
    typeof body.maxnumber !== "number"
  )
    throw new Error("notabot: malformed challenge");
  return { ...(body as Challenge), signature: body.signature ?? "" };
}

export { base64urlDecode, base64urlEncode, sha256Hex } from "./crypto";
