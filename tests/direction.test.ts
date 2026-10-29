import { describe, expect, test } from "bun:test";
import { analyzeTrajectory, judgeSlide, type PointerSample } from "../src/behavior/index";
import { score } from "../src/score/index";
import { realChrome } from "./fixtures";
import { humanProfiles } from "./profiles";

const sample = (x: number, y: number, t: number): PointerSample => ({
  x,
  y,
  t,
  trusted: true,
  coalesced: 2,
  pressure: 0.5,
  type: "pointermove",
});

/** A hand: speeds up, brakes into the target, overshoots it a little, corrects, wobbles. */
function hand(n = 40): PointerSample[] {
  const out: PointerSample[] = [];
  for (let i = 0; i <= n; i++) {
    const p = i / n;
    // Minimum-jerk profile aimed 8 % past the target, then brought back onto it.
    const s = 10 * p ** 3 - 15 * p ** 4 + 6 * p ** 5;
    const back = Math.max(0, (p - 0.85) / 0.15);
    out.push(
      sample(
        100 + 400 * (s * 1.08 - 0.08 * back),
        300 + Math.sin(i * 1.3) * 4 + (i % 5) * 0.8,
        i * 16 + (i % 3) * 3,
      ),
    );
  }
  return out;
}

/** A script: evenly spaced points on a straight line, at a constant pace. */
const linear = (n = 40) =>
  Array.from({ length: n + 1 }, (_, i) => sample(100 + (400 * i) / n, 300, i * 16));

/** A careful script: an eased curve, no wobble. It brakes, so this rule lets it through. */
const eased = (n = 40) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const p = i / n;
    return sample(100 + 400 * (1 - (1 - p) ** 3), 300 + 60 * Math.sin(Math.PI * p), i * 16);
  });

describe("how the pointer arrives", () => {
  test("a hand brakes, corrects and overshoots; a linear script does none of it", () => {
    const h = analyzeTrajectory(hand());
    expect(h.endSlowdown).toBeLessThan(0.6);
    expect(h.turnRate).toBeGreaterThan(0.02);
    expect(h.overshoot).toBe(1);
    const l = analyzeTrajectory(linear());
    expect(l.endSlowdown).toBeGreaterThan(0.95);
    expect(l.turnRate).toBe(0);
    expect(l.overshoot).toBe(0);
  });

  test("pointer-no-slowdown flags the linear script only, never the human profiles", () => {
    const flag = (moves: PointerSample[]) => {
      const t = analyzeTrajectory(moves);
      const behavior = {
        ...(humanProfiles()[0]?.behavior as NonNullable<
          ReturnType<typeof humanProfiles>[0]["behavior"]
        >),
        ...t,
        moves: moves.length,
      };
      return score({ signals: realChrome(), behavior }).flags.map((f) => f.id);
    };
    expect(flag(linear())).toContain("pointer-no-slowdown");
    expect(flag(hand())).not.toContain("pointer-no-slowdown");
    // Honest limit: a script that eases its curve brakes like a hand and passes this rule.
    expect(flag(eased())).not.toContain("pointer-no-slowdown");
    for (const p of humanProfiles())
      expect(
        score({ signals: p.signals, behavior: p.behavior }).flags.map((f) => f.id),
      ).not.toContain("pointer-no-slowdown");
  });

  test("the slider refuses a drag that arrives at full speed without a correction", () => {
    // Uneven steps fool the step check; the arrival, at the usual speed, still gives it away.
    const jerky = linear(30).map((s, i) => ({
      ...s,
      x: s.x + (i % 2 ? 3 : -3) * (i < 30 ? 1 : 0),
    }));
    expect(analyzeTrajectory(jerky).stepCv).toBeGreaterThan(0.2);
    const judged = judgeSlide(jerky, true);
    expect(judged.passed).toBe(false);
    expect(judgeSlide(hand(30), true).passed).toBe(true);
  });
});
