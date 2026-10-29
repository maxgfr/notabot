/** One pointer position, as the page saw it. */
export interface PointerSample {
  x: number;
  y: number;
  t: number;
  trusted: boolean;
  /** Raw samples the browser merged into this event (`getCoalescedEvents`): 1+ for real devices. */
  coalesced: number;
  pressure: number;
  type: string;
}

export interface KeySample {
  down: number;
  up: number | null;
  trusted: boolean;
}

export interface BehaviorLog {
  start: number;
  pointer: PointerSample[];
  keys: KeySample[];
  clicks: number;
  scrolls: number;
  untrusted: number;
  /** `input` events with no key or paste just before: a value set by a script. */
  inputWithoutKeys: number;
  focusChanges: number;
  firstInteraction: number | null;
}

export interface Trajectory {
  samples: number;
  durationMs: number;
  speedMean: number;
  /** Coefficient of variation of speed: near 0 for scripted moves at constant speed. */
  speedCv: number;
  accelCv: number;
  /** Chord over path length, averaged over strokes: 1 is a ruler-straight line. */
  straightness: number;
  /** Entropy of the direction changes, from 0 (always the same turn) to 1. */
  angleEntropy: number;
  /** Spread of the cross axis around the stroke's line, in pixels. */
  jitter: number;
  /**
   * Coefficient of variation of the distance between samples: a script stepping a line moves
   * the same distance each time, whatever its clock does; a hand speeds up and slows down.
   */
  stepCv: number;
}

export interface BehaviorFeatures extends Trajectory {
  moves: number;
  clicks: number;
  keys: number;
  scrolls: number;
  untrusted: number;
  inputWithoutKeys: number;
  focusChanges: number;
  firstInteractionMs: number | null;
  coalescedMean: number | null;
  keyDwellMean: number | null;
  keyDwellCv: number | null;
  keyFlightCv: number | null;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function cv(values: number[]): number {
  const m = mean(values);
  if (!values.length || m === 0) return 0;
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance) / m;
}

const round = (n: number, digits = 3) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Splits samples into strokes at pauses longer than `gapMs`. */
function strokes(samples: PointerSample[], gapMs = 300): PointerSample[][] {
  const out: PointerSample[][] = [];
  let current: PointerSample[] = [];
  for (const s of samples) {
    const last = current[current.length - 1];
    if (last && s.t - last.t > gapMs) {
      out.push(current);
      current = [];
    }
    current.push(s);
  }
  if (current.length) out.push(current);
  return out.filter((s) => s.length >= 3);
}

/** Speed, acceleration, straightness, turning and jitter of a pointer path. */
export function analyzeTrajectory(samples: PointerSample[]): Trajectory {
  const empty: Trajectory = {
    samples: samples.length,
    durationMs: 0,
    speedMean: 0,
    speedCv: 0,
    accelCv: 0,
    straightness: 0,
    angleEntropy: 0,
    jitter: 0,
    stepCv: 0,
  };
  if (samples.length < 3) return empty;
  const speeds: number[] = [];
  const accels: number[] = [];
  const turns: number[] = [];
  const straight: number[] = [];
  const jitters: number[] = [];
  const steps: number[] = [];
  for (const stroke of strokes(samples)) {
    let path = 0;
    let prevSpeed: number | null = null;
    let prevAngle: number | null = null;
    for (let i = 1; i < stroke.length; i++) {
      const a = stroke[i - 1] as PointerSample;
      const b = stroke[i] as PointerSample;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const dt = Math.max(b.t - a.t, 1);
      path += d;
      if (d === 0) continue;
      steps.push(d);
      const speed = d / dt;
      speeds.push(speed);
      if (prevSpeed !== null) accels.push(Math.abs(speed - prevSpeed) / dt);
      prevSpeed = speed;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (prevAngle !== null) {
        let turn = angle - prevAngle;
        while (turn > Math.PI) turn -= 2 * Math.PI;
        while (turn < -Math.PI) turn += 2 * Math.PI;
        turns.push(turn);
      }
      prevAngle = angle;
    }
    const first = stroke[0] as PointerSample;
    const last = stroke[stroke.length - 1] as PointerSample;
    const chord = Math.hypot(last.x - first.x, last.y - first.y);
    if (path > 0) straight.push(chord / path);
    // Distance of each point to the first→last line.
    if (chord > 0) {
      const dists = stroke.map(
        (p) =>
          Math.abs(
            (last.y - first.y) * p.x -
              (last.x - first.x) * p.y +
              last.x * first.y -
              last.y * first.x,
          ) / chord,
      );
      jitters.push(Math.sqrt(mean(dists.map((d) => d * d))));
    }
  }
  const bins = new Array<number>(16).fill(0);
  for (const turn of turns) {
    const i = Math.min(15, Math.floor(((turn + Math.PI) / (2 * Math.PI)) * 16));
    bins[i] = (bins[i] ?? 0) + 1;
  }
  let entropy = 0;
  for (const count of bins) {
    if (!count) continue;
    const p = count / turns.length;
    entropy -= p * Math.log2(p);
  }
  const first = samples[0] as PointerSample;
  const last = samples[samples.length - 1] as PointerSample;
  return {
    samples: samples.length,
    durationMs: Math.round(last.t - first.t),
    speedMean: round(mean(speeds)),
    speedCv: round(cv(speeds)),
    accelCv: round(cv(accels)),
    straightness: round(mean(straight)),
    angleEntropy: round(turns.length ? entropy / 4 : 0),
    jitter: round(mean(jitters), 2),
    stepCv: round(cv(steps)),
  };
}

/** The features of a session's log: what the LLM and the rules read, numbers only. */
export function behaviorFeatures(log: BehaviorLog, now = performance.now()): BehaviorFeatures {
  const moves = log.pointer.filter((p) => p.type === "pointermove" || p.type === "mousemove");
  const dwell = log.keys.filter((k) => k.up !== null).map((k) => (k.up as number) - k.down);
  const flights: number[] = [];
  for (let i = 1; i < log.keys.length; i++)
    flights.push((log.keys[i] as KeySample).down - (log.keys[i - 1] as KeySample).down);
  const coalesced = moves.map((m) => m.coalesced);
  return {
    ...analyzeTrajectory(moves),
    durationMs: Math.round(now - log.start),
    moves: moves.length,
    clicks: log.clicks,
    keys: log.keys.length,
    scrolls: log.scrolls,
    untrusted: log.untrusted,
    inputWithoutKeys: log.inputWithoutKeys,
    focusChanges: log.focusChanges,
    firstInteractionMs:
      log.firstInteraction === null ? null : Math.round(log.firstInteraction - log.start),
    coalescedMean: coalesced.length ? round(mean(coalesced), 2) : null,
    keyDwellMean: dwell.length ? Math.round(mean(dwell)) : null,
    keyDwellCv: dwell.length > 2 ? round(cv(dwell)) : null,
    keyFlightCv: flights.length > 2 ? round(cv(flights)) : null,
  };
}

export interface BehaviorTracker {
  readonly log: BehaviorLog;
  features(): BehaviorFeatures;
  stop(): void;
}

const MAX_SAMPLES = 2000;

/** Listens to pointer, key, scroll and focus events on `target` from now on (passive). */
export function trackBehavior(target: Document | HTMLElement = document): BehaviorTracker {
  const log: BehaviorLog = {
    start: performance.now(),
    pointer: [],
    keys: [],
    clicks: 0,
    scrolls: 0,
    untrusted: 0,
    inputWithoutKeys: 0,
    focusChanges: 0,
    firstInteraction: null,
  };
  let lastKeyOrPaste = Number.NEGATIVE_INFINITY;
  const pending = new Map<string, KeySample>();
  const seen = (e: Event) => {
    if (!e.isTrusted) log.untrusted++;
    if (log.firstInteraction === null) log.firstInteraction = performance.now();
  };
  const onPointer = (e: Event) => {
    const p = e as PointerEvent;
    seen(p);
    if (log.pointer.length >= MAX_SAMPLES) log.pointer.shift();
    log.pointer.push({
      x: p.clientX,
      y: p.clientY,
      t: p.timeStamp || performance.now(),
      trusted: p.isTrusted,
      coalesced: typeof p.getCoalescedEvents === "function" ? p.getCoalescedEvents().length : 1,
      pressure: p.pressure ?? 0,
      type: p.type,
    });
  };
  const onDown = (e: Event) => {
    seen(e);
    if (e.type === "pointerdown") log.clicks++;
  };
  const onKeyDown = (e: Event) => {
    const k = e as KeyboardEvent;
    seen(k);
    lastKeyOrPaste = performance.now();
    if (k.repeat) return;
    const sample: KeySample = { down: k.timeStamp, up: null, trusted: k.isTrusted };
    pending.set(k.code, sample);
    if (log.keys.length < MAX_SAMPLES) log.keys.push(sample);
  };
  const onKeyUp = (e: Event) => {
    const k = e as KeyboardEvent;
    const sample = pending.get(k.code);
    if (sample) sample.up = k.timeStamp;
    pending.delete(k.code);
  };
  const onPaste = () => {
    lastKeyOrPaste = performance.now();
  };
  const onInput = (e: Event) => {
    const type = (e as InputEvent).inputType ?? "";
    if (/^insertFromPaste|^insertFromDrop|^deleteBy|^historyU/.test(type)) return;
    if (performance.now() - lastKeyOrPaste > 1000) log.inputWithoutKeys++;
  };
  const onScroll = (e: Event) => {
    seen(e);
    log.scrolls++;
  };
  const onFocus = () => {
    log.focusChanges++;
  };
  const listeners: [EventTarget, string, EventListener][] = [
    [target, "pointermove", onPointer],
    [target, "pointerdown", onDown],
    [target, "keydown", onKeyDown],
    [target, "keyup", onKeyUp],
    [target, "paste", onPaste],
    [target, "input", onInput],
    [target, "wheel", onScroll],
    [target, "touchstart", onDown],
    [window, "focus", onFocus],
    [window, "blur", onFocus],
  ];
  for (const [t, type, fn] of listeners)
    t.addEventListener(type, fn, { passive: true, capture: true });
  return {
    log,
    features: () => behaviorFeatures(log),
    stop() {
      for (const [t, type, fn] of listeners) t.removeEventListener(type, fn, { capture: true });
    },
  };
}

export interface SlideResult {
  passed: boolean;
  reason: "ok" | "too-few-samples" | "too-fast" | "untrusted" | "robotic" | "missed-target";
  trajectory: Trajectory;
}

/**
 * Judges a drag of the slider challenge: it must land on the target and look like a hand did it
 * (speed that varies, a cross axis that wobbles, a few hundred milliseconds at least).
 */
export function judgeSlide(
  samples: PointerSample[],
  landed: boolean,
  options: { minSamples?: number; minDurationMs?: number } = {},
): SlideResult {
  const trajectory = analyzeTrajectory(samples);
  const fail = (reason: SlideResult["reason"]): SlideResult => ({
    passed: false,
    reason,
    trajectory,
  });
  if (!landed) return fail("missed-target");
  if (samples.some((s) => !s.trusted)) return fail("untrusted");
  if (samples.length < (options.minSamples ?? 6)) return fail("too-few-samples");
  if (trajectory.durationMs < (options.minDurationMs ?? 250)) return fail("too-fast");
  // Geometry, not timing: an automation clock adds jitter to the speed of a ruler-straight,
  // evenly stepped drag, but cannot make its steps uneven or its line wobble.
  const human = trajectory.stepCv > 0.2 || trajectory.jitter > 0.6;
  if (!human) return fail("robotic");
  return { passed: true, reason: "ok", trajectory };
}

/**
 * Judges the keyboard way through the slider (arrow keys), for people who do not use a pointer:
 * trusted key events, with the uneven rhythm of a person pressing them.
 */
export function judgeKeySlide(times: number[], trusted: boolean, landed: boolean): boolean {
  if (!landed || !trusted || times.length < 3) return false;
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i] as number) - (times[i - 1] as number));
  // Holding an arrow key repeats at a steady rate: accept it when it took a person's time.
  const span = (times[times.length - 1] as number) - (times[0] as number);
  return cv(gaps) > 0.08 || span > 400;
}
