// Server-side half: sign puzzles, check solutions, sign and check the token a form posts.
// WebCrypto only, so it runs on Bun, Node 20+, Deno and Cloudflare Workers alike.
import { base64urlDecode, base64urlEncode, hmacHex, randomHex, safeEqual } from "../pow/crypto";
import {
  type Challenge,
  DEFAULT_MAX_NUMBER,
  expiresOf,
  type PowAlgorithm,
  powHash,
  type Solution,
  signedPart,
} from "../pow/index";
import type { Verdict } from "../score/index";
import type { SealedSignals } from "../smart/index";

export interface CreateChallengeOptions {
  hmacKey: string;
  /** Upper bound of the search: the cost, on average maxnumber / 2 hashes. */
  maxnumber?: number;
  /** Default 600 seconds. */
  expiresInSeconds?: number;
  /** "SHA-256" (default, what every solver speaks) or "PBKDF2", `cost` rounds a try. */
  algorithm?: PowAlgorithm;
  /** PBKDF2 iterations per try. Default 5000. */
  cost?: number;
  /**
   * Ties the puzzle to a client (a keyed hash of its IP and User-Agent): a solution is refused
   * from anyone else, so solved puzzles cannot be farmed out and replayed.
   */
  bind?: string;
}

export async function createChallenge(options: CreateChallengeOptions): Promise<Challenge> {
  const maxnumber = options.maxnumber ?? DEFAULT_MAX_NUMBER;
  const algorithm = options.algorithm ?? "SHA-256";
  const cost = algorithm === "PBKDF2" ? (options.cost ?? 5000) : undefined;
  const expires = Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? 600);
  const salt = `${randomHex(12)}?expires=${expires}${options.bind ? `&bind=${options.bind}` : ""}`;
  const number = (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % (maxnumber + 1);
  const challenge = await powHash(algorithm, salt + number, cost);
  return {
    algorithm,
    challenge,
    maxnumber,
    ...(cost !== undefined ? { cost } : {}),
    salt,
    signature: await hmacHex(options.hmacKey, signedPart({ algorithm, challenge, cost })),
  };
}

export type VerifyFailure =
  | "malformed"
  | "expired"
  | "bad-signature"
  | "wrong-number"
  | "wrong-client";

/** The client a salt was bound to (`&bind=`), or null. */
export function bindOf(salt: string): string | null {
  return /[?&]bind=([0-9a-f]+)/.exec(salt)?.[1] ?? null;
}

/**
 * Checks a solution (the object, or the base64url string a form posted): not expired, signed by
 * this server, and the number hashes to the challenge. Replays are the caller's to refuse: store
 * `challenge` until it expires (KV, a Durable Object, a database).
 */
export async function verifySolution(
  payload: Solution | string,
  hmacKey: string,
  now = Date.now(),
  options: { bind?: string } = {},
): Promise<{ ok: true; solution: Solution } | { ok: false; reason: VerifyFailure }> {
  let solution: Solution;
  try {
    solution = typeof payload === "string" ? JSON.parse(base64urlDecode(payload)) : payload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    (solution?.algorithm !== "SHA-256" && solution?.algorithm !== "PBKDF2") ||
    (solution.algorithm === "PBKDF2" &&
      !(Number.isInteger(solution.cost) && (solution.cost as number) > 0)) ||
    typeof solution.challenge !== "string" ||
    typeof solution.salt !== "string" ||
    typeof solution.signature !== "string" ||
    !Number.isInteger(solution.number)
  )
    return { ok: false, reason: "malformed" };
  const expires = expiresOf(solution.salt);
  if (expires !== null && expires * 1000 < now) return { ok: false, reason: "expired" };
  const signature = await hmacHex(hmacKey, signedPart(solution));
  if (!safeEqual(signature, solution.signature)) return { ok: false, reason: "bad-signature" };
  const bound = bindOf(solution.salt);
  if (bound && options.bind !== undefined && bound !== options.bind)
    return { ok: false, reason: "wrong-client" };
  if (
    (await powHash(solution.algorithm, solution.salt + solution.number, solution.cost)) !==
    solution.challenge
  )
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
  /** Left edge of the slider's target zone, in percent, when the verdict was "unsure". */
  zone?: number;
  /** Or the targets to activate in order, as [x, y] percents of their box. */
  targets?: [number, number][];
  /** Smart signals sealed by the server (visitor id, private mode, VM, VPN, Tor…). */
  smart?: SealedSignals;
  /** When the token was issued, in milliseconds (tokens issued in doubt): /slide's clock. */
  ms?: number;
  /** The session's behaviour when the token was issued in doubt, for /slide's model. */
  session?: Record<string, number | null>;
  /** Request flags /verify already counted in `bot`: the gate adds only the ones it sees anew. */
  seen?: string[];
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
