import type { NotabotSignals } from "../src/signals/types";

/**
 * What identifies the capturing machine without feeding a rule goes before a capture is
 * committed: fingerprint hashes, and font names (their count is kept).
 */
export function redact(signals: NotabotSignals): NotabotSignals {
  const h = signals.hardware;
  if (h.canvas) h.canvas = { ...h.canvas, hash: "redacted" };
  if (h.audio) h.audio = { hash: "redacted", sum: 0 };
  if (h.webgl) h.webgl = { ...h.webgl, sceneHash: "redacted" };
  h.fonts = h.fonts.map((_, i) => `font-${i + 1}`);
  return signals;
}
