import { describe, expect, test } from "bun:test";
import {
  analyzeTrajectory,
  judgeSlide,
  MIN_TREMOR,
  type PointerSample,
} from "../src/behavior/index";
import drags from "./fixtures/real-drags.json";

/**
 * 40 real drags of the slider, on a MacBook trackpad in Brave, recorded with the widget's own
 * sampling: [x, y, t, coalesced] relative to the first sample (no screen layout, no clock).
 */
const real: PointerSample[][] = (drags as number[][][]).map((drag) =>
  drag.map(([x, y, t, coalesced]) => ({
    x: x as number,
    y: y as number,
    t: t as number,
    trusted: true,
    coalesced: coalesced as number,
    pressure: 0.5,
    type: "pointermove",
    pointerType: "mouse",
  })),
);

/** A script's drag: an eased curve with a bend, uneven steps, a real browser's pressure. */
function computed(n = 60): PointerSample[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const p = i / n;
    const e = 1 - (1 - p) ** 3;
    return {
      x: 300 * e,
      y: 25 * Math.sin(Math.PI * p),
      t: i * 16 + (i % 3) * 5,
      trusted: true,
      coalesced: 1,
      pressure: 0.5,
      type: "pointermove",
      pointerType: "mouse",
    };
  });
}

describe("calibration on real drags", () => {
  test("every real drag passes the rules", () => {
    expect(real.length).toBe(40);
    const refused = real
      .map((d, i) => ({ i, ...judgeSlide(d, true) }))
      .filter((r) => !r.passed)
      .map((r) => `${r.i}: ${r.reason}`);
    expect(refused).toEqual([]);
  });

  test("a hand trembles well above the threshold, a computed curve well below", () => {
    const tremors = real.map((d) => analyzeTrajectory(d).tremor as number);
    expect(Math.min(...tremors)).toBeGreaterThan(MIN_TREMOR * 2);
    expect(analyzeTrajectory(computed()).tremor).toBeLessThan(MIN_TREMOR / 5);
  });

  test("a computed curve with a browser's pressure and uneven steps is refused", () => {
    const judged = judgeSlide(computed(), true);
    expect(judged.passed).toBe(false);
    expect(judged.reason).toBe("robotic");
  });
});
