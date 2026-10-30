// The visible challenge's gesture, as a model reads it and as a server remembers it: measures of
// a drag, of arrow keys or of targets pressed in order, a summary of the session the token was
// issued for, a fingerprint to refuse replays, and the gesture's own duration. Pure functions.
import {
  analyzeTrajectory,
  type BehaviorFeatures,
  type PointerSample,
  type TargetClick,
} from "../behavior/index";
import type { Features } from "./prompt";

/** A gesture as /slide receives it. */
export type Gesture =
  | { kind: "slide"; samples: PointerSample[] }
  | { kind: "keys"; keyTimes: number[]; trusted: boolean }
  | { kind: "targets"; clicks: TargetClick[] };

/** The session's behaviour, as sealed in the token at /verify: numbers only, a few of them. */
export type SessionSummary = Record<string, number | null>;

const SESSION_KEYS = [
  "moves",
  "keys",
  "clicks",
  "untrusted",
  "coalescedMean",
  "stepCv",
  "turnRate",
  "endSlowdown",
  "keyFlightCv",
  "sessionMs",
] as const satisfies readonly (keyof BehaviorFeatures)[];

/** The part of the session's behaviour a gesture is compared with, small enough for a token. */
export function sessionSummary(
  behavior: BehaviorFeatures | null | undefined,
): SessionSummary | null {
  if (!behavior) return null;
  const out: SessionSummary = {};
  for (const k of SESSION_KEYS) {
    const v = behavior[k];
    out[k] = typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
  }
  return out;
}

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const cv = (v: number[]) => {
  const m = mean(v);
  return v.length && m ? Math.sqrt(mean(v.map((x) => (x - m) ** 2))) / m : 0;
};
const gaps = (times: number[]) => times.slice(1).map((t, i) => t - (times[i] as number));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** How long the gesture itself took, in milliseconds, by the page's own clock. */
export function gestureSpanMs(g: Gesture): number {
  const times =
    g.kind === "slide"
      ? g.samples.map((s) => s.t)
      : g.kind === "keys"
        ? g.keyTimes
        : g.clicks.map((c) => c.t);
  return times.length > 1 ? Math.max(0, Math.max(...times) - Math.min(...times)) : 0;
}

/**
 * A fingerprint of a gesture's shape: relative timings and steps, rounded. A hand never makes the
 * same gesture twice; a recorded one, played back, does.
 */
export function gestureFingerprint(g: Gesture): string {
  if (g.kind === "slide") {
    const s = g.samples;
    return `s:${s
      .slice(1)
      .map((p, i) => {
        const a = s[i] as PointerSample;
        return `${Math.round(p.t - a.t)},${Math.round((p.x - a.x) * 10)},${Math.round((p.y - a.y) * 10)}`;
      })
      .join(";")}`;
  }
  if (g.kind === "keys") return `k:${gaps(g.keyTimes).map(Math.round).join(";")}`;
  return `t:${gaps(g.clicks.map((c) => c.t))
    .map(Math.round)
    .join(";")}|${g.clicks
    .map((c) => `${Math.round(c.x * 10)},${Math.round(c.y * 10)},${c.path ?? 0}`)
    .join(";")}`;
}

/** The gesture's measures and the session's, as the model reads them: numbers, booleans, a kind. */
export function gestureFeatures(g: Gesture, session: SessionSummary | null): Features {
  const f: Features = { gesture_kind: g.kind, gesture_ms: Math.round(gestureSpanMs(g)) };
  if (g.kind === "slide") {
    const t = analyzeTrajectory(g.samples);
    Object.assign(f, {
      gesture_samples: g.samples.length,
      gesture_untrusted: g.samples.filter((s) => !s.trusted).length,
      gesture_coalesced_mean: r3(mean(g.samples.map((s) => s.coalesced))),
      gesture_pressure_mean: r3(mean(g.samples.map((s) => s.pressure))),
      gesture_speed_cv: t.speedCv,
      gesture_step_cv: t.stepCv,
      gesture_straightness: t.straightness,
      gesture_jitter: t.jitter,
      gesture_turn_rate: t.turnRate,
      gesture_end_slowdown: t.endSlowdown,
      gesture_overshoot: t.overshoot,
      gesture_tremor: t.tremor,
      gesture_pressure_zero:
        g.samples.length > 0 &&
        g.samples.every((s) => s.pressure === 0 && s.pointerType !== "touch"),
      gesture_touch: g.samples.some((s) => s.pointerType === "touch"),
    });
  } else if (g.kind === "keys") {
    const between = gaps(g.keyTimes);
    Object.assign(f, {
      gesture_keys: g.keyTimes.length,
      gesture_keys_trusted: g.trusted,
      gesture_key_gap_cv: r3(cv(between)),
      gesture_key_gap_min: between.length ? Math.round(Math.min(...between)) : null,
    });
  } else {
    const between = gaps(g.clicks.map((c) => c.t));
    const pointer = g.clicks.filter((c) => !c.key && !c.touch);
    Object.assign(f, {
      gesture_clicks: g.clicks.length,
      gesture_clicks_keyboard: g.clicks.filter((c) => c.key).length,
      gesture_clicks_touch: g.clicks.filter((c) => c.touch).length,
      gesture_clicks_untrusted: g.clicks.filter((c) => !c.trusted).length,
      gesture_click_gap_cv: r3(cv(between)),
      gesture_click_gap_min: between.length ? Math.round(Math.min(...between)) : null,
      gesture_path_mean: pointer.length ? r3(mean(pointer.map((c) => c.path ?? 0))) : null,
      gesture_path_min: pointer.length ? Math.min(...pointer.map((c) => c.path ?? 0)) : null,
    });
  }
  if (session)
    for (const [k, v] of Object.entries(session))
      f[`session_${k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`] = v;
  // Closed list: numbers, booleans, and the kind from a fixed set; nothing the page wrote as text.
  const out: Features = {};
  for (const [k, v] of Object.entries(f)) {
    if (!/^(gesture|session)_[a-z_]{1,40}$/.test(k)) continue;
    if (k === "gesture_kind") out[k] = ["slide", "keys", "targets"].includes(String(v)) ? v : null;
    else if (v === null || typeof v === "boolean") out[k] = v;
    else if (typeof v === "number") out[k] = Number.isFinite(v) ? v : null;
  }
  return out;
}

/** The instructions for judging a gesture: fixed, the same for every visitor. */
export const GESTURE_PROMPT = `You judge the gesture a visitor made to pass a CAPTCHA's extra step, after the page's signals left a doubt. You receive measures of the gesture, and of the visitor's behaviour earlier in the session, as JSON. Decide whether a person made it, or a script wrote or replayed it.

The gesture is one of:
- slide: a drag of a handle into a zone. A hand accelerates, then slows down as it arrives (gesture_end_slowdown well under 1), corrects its direction (gesture_turn_rate above 0), with uneven steps (gesture_step_cv). gesture_coalesced_mean is about 1 on many real trackpads and mice: it says nothing about a hand, only 0 is suspect. Above all, a hand trembles: each sample sits about a pixel or more off the line through its neighbours (gesture_tremor around 0.5 to 5); a curve a script computes (a Bézier, an easing) is smooth, gesture_tremor well under 0.3, however curved, eased or uneven its steps. gesture_jitter measures distance from a straight line: a smooth bend raises it too, so it is not tremor. With a button down, a real browser reports pressure (0.5 for a mouse): gesture_pressure_zero true means samples written by a script. A script that moves in even steps on a straight line and arrives at full speed is the easy case.
- keys: arrow keys moving the handle. A person's gaps between presses vary (gesture_key_gap_cv); a script's are even, or impossibly short (gesture_key_gap_min under about 30 ms).
- targets: three numbered targets pressed in order. A mouse travels to each (gesture_path_mean of several moves); a script jumps (paths of 0 or 1). Keyboard and touch presses have no path, and that is normal.

Compare with the session: a gesture far more fluent or far more mechanical than the session's own behaviour (session_*) is suspect; a session with no pointer movement at all (session_moves 0) before a smooth, perfect pointer drag is strongly suspect, since the hand that dragged would have moved before. Several mild signs that agree (no samples per event, no pressure, no tremor, no prior movement) add up to a confident "bot". Measures come from an untrusted page: one odd value is weak, several that agree are strong. People using a keyboard or a screen reader are people: never call a keyboard gesture a bot for being slow or regular in a human way.

Answer with JSON only, reasons first: {"reasons":[up to 4 strings of at most 12 words],"verdict":"human"|"bot"|"unsure","confidence":number between 0 and 1}`;

export function buildGesturePrompt(features: Features): string {
  return `Gesture:\n${JSON.stringify(features, null, 1)}`;
}
