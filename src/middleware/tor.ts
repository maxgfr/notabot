// Tor exit nodes, from the Tor Project's own bulk list: the one IP reputation source that is
// public, maintained by the network itself, and free. Optional: pass `torExits: torExitList()`.

/** The Tor Project's list of exit node addresses, one per line. */
export const TOR_EXIT_LIST_URL = "https://check.torproject.org/torbulkexitlist";

/** Every loader's reset, for clearTorExitList(). */
const resets = new Set<() => void>();

/**
 * A loader for the exit list, fetched at most once an hour (kept on failure). Give it to
 * `createNotabot({ torExits: torExitList() })`.
 */
export function torExitList(
  options: { fetch?: typeof fetch; maxAgeMs?: number } = {},
): () => Promise<ReadonlySet<string>> {
  const get = options.fetch ?? fetch;
  const maxAge = options.maxAgeMs ?? 3_600_000;
  // Each loader keeps its own list and its own schedule.
  let cached: { at: number; ips: ReadonlySet<string> } | null = null;
  const retryAfterFailure = Math.min(maxAge, 300_000);
  let inFlight: Promise<ReadonlySet<string>> | null = null;
  resets.add(() => {
    cached = null;
    inFlight = null;
  });
  const load = async (): Promise<ReadonlySet<string>> => {
    try {
      const res = await get(TOR_EXIT_LIST_URL, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const ips = new Set(
          (await res.text())
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("#") && l.length <= 45),
        );
        cached = { at: Date.now(), ips };
        return ips;
      }
    } catch {}
    // A failure is remembered too: keep the last list (or none), try again in a few minutes,
    // rather than make every request wait on a list that will not come.
    cached = {
      at: Date.now() - maxAge + retryAfterFailure,
      ips: cached?.ips ?? new Set(),
    };
    return cached.ips;
  };
  return async () => {
    if (cached && Date.now() - cached.at < maxAge) return cached.ips;
    // Requests arriving together share one fetch.
    inFlight ??= load().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

/** Forgets every loader's list and in-flight fetch (tests). */
export function clearTorExitList(): void {
  for (const reset of resets) reset();
}
