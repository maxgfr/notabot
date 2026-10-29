// Tor exit nodes, from the Tor Project's own bulk list: the one IP reputation source that is
// public, maintained by the network itself, and free. Optional: pass `torExits: torExitList()`.

/** The Tor Project's list of exit node addresses, one per line. */
export const TOR_EXIT_LIST_URL = "https://check.torproject.org/torbulkexitlist";

let cached: { at: number; ips: ReadonlySet<string> } | null = null;

/**
 * A loader for the exit list, fetched at most once an hour (kept on failure). Give it to
 * `createNotabot({ torExits: torExitList() })`.
 */
export function torExitList(
  options: { fetch?: typeof fetch; maxAgeMs?: number } = {},
): () => Promise<ReadonlySet<string>> {
  const get = options.fetch ?? fetch;
  const maxAge = options.maxAgeMs ?? 3_600_000;
  return async () => {
    if (cached && Date.now() - cached.at < maxAge) return cached.ips;
    try {
      const res = await get(TOR_EXIT_LIST_URL, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const text = await res.text();
        const ips = new Set(
          text
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("#") && l.length <= 45),
        );
        cached = { at: Date.now(), ips };
      }
    } catch {}
    return cached?.ips ?? new Set();
  };
}

/** Forgets the cached list (tests). */
export function clearTorExitList(): void {
  cached = null;
}
