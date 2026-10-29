// Server-side half: sign puzzles, check solutions, sign and check the token a form posts.
// WebCrypto only, so it runs on Bun, Node 20+, Deno and Cloudflare Workers alike.
import {
  base64urlDecode,
  base64urlEncode,
  hmacHex,
  randomHex,
  safeEqual,
  sha256Hex,
} from "../pow/crypto";
import { type Challenge, DEFAULT_MAX_NUMBER, expiresOf, type Solution } from "../pow/index";
import type { Verdict } from "../score/index";

export interface CreateChallengeOptions {
  hmacKey: string;
  /** Upper bound of the search: the cost, on average maxnumber / 2 hashes. */
  maxnumber?: number;
  /** Default 600 seconds. */
  expiresInSeconds?: number;
}

export async function createChallenge(options: CreateChallengeOptions): Promise<Challenge> {
  const maxnumber = options.maxnumber ?? DEFAULT_MAX_NUMBER;
  const expires = Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? 600);
  const salt = `${randomHex(12)}?expires=${expires}`;
  const number = (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % (maxnumber + 1);
  const challenge = await sha256Hex(salt + number);
  return {
    algorithm: "SHA-256",
    challenge,
    maxnumber,
    salt,
    signature: await hmacHex(options.hmacKey, challenge),
  };
}

export type VerifyFailure = "malformed" | "expired" | "bad-signature" | "wrong-number";

/**
 * Checks a solution (the object, or the base64url string a form posted): not expired, signed by
 * this server, and the number hashes to the challenge. Replays are the caller's to refuse: store
 * `challenge` until it expires (KV, a Durable Object, a database).
 */
export async function verifySolution(
  payload: Solution | string,
  hmacKey: string,
  now = Date.now(),
): Promise<{ ok: true; solution: Solution } | { ok: false; reason: VerifyFailure }> {
  let solution: Solution;
  try {
    solution = typeof payload === "string" ? JSON.parse(base64urlDecode(payload)) : payload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    solution?.algorithm !== "SHA-256" ||
    typeof solution.challenge !== "string" ||
    typeof solution.salt !== "string" ||
    typeof solution.signature !== "string" ||
    !Number.isInteger(solution.number)
  )
    return { ok: false, reason: "malformed" };
  const expires = expiresOf(solution.salt);
  if (expires !== null && expires * 1000 < now) return { ok: false, reason: "expired" };
  const signature = await hmacHex(hmacKey, solution.challenge);
  if (!safeEqual(signature, solution.signature)) return { ok: false, reason: "bad-signature" };
  if ((await sha256Hex(solution.salt + solution.number)) !== solution.challenge)
    return { ok: false, reason: "wrong-number" };
  return { ok: true, solution };
}

export interface TokenClaims {
  v: 1;
  verdict: Verdict;
  /** Probability of a bot, 0 to 1, as the server scored it. */
  bot: number;
  /** Origin the check ran on. */
  origin?: string;
  /** Issued at, expires at: unix seconds. */
  iat: number;
  exp: number;
  /** Random id, to refuse a token used twice. */
  jti: string;
  /** Hash of the User-Agent the token was issued to (see notabot/middleware). */
  uah?: string;
  /** Keyed hash of the IP the token was issued to. */
  iph?: string;
}

/** A compact signed token, `base64url(claims).hex(HMAC)`, for the site's backend to check. */
export async function signToken(
  claims: Omit<TokenClaims, "v" | "iat" | "exp" | "jti"> & { ttlSeconds?: number },
  hmacKey: string,
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const { ttlSeconds, ...rest } = claims;
  const full: TokenClaims = {
    v: 1,
    ...rest,
    iat,
    exp: iat + (ttlSeconds ?? 300),
    jti: randomHex(8),
  };
  const body = base64urlEncode(JSON.stringify(full));
  return `${body}.${await hmacHex(hmacKey, body)}`;
}

export async function verifyToken(
  token: string,
  hmacKey: string,
  options: { origin?: string; now?: number } = {},
): Promise<
  | { ok: true; claims: TokenClaims }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" | "wrong-origin" }
> {
  const [body, signature] = token.split(".");
  if (!body || !signature) return { ok: false, reason: "malformed" };
  if (!safeEqual(await hmacHex(hmacKey, body), signature))
    return { ok: false, reason: "bad-signature" };
  let claims: TokenClaims;
  try {
    claims = JSON.parse(base64urlDecode(body));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (claims.exp * 1000 < (options.now ?? Date.now())) return { ok: false, reason: "expired" };
  if (options.origin && claims.origin !== options.origin)
    return { ok: false, reason: "wrong-origin" };
  return { ok: true, claims };
}
