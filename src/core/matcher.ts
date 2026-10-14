/**
 * Voice tracker: aligns streaming recognizer hypotheses against the script's speech
 * tokens and decides, with hysteresis, where the reader is.
 *
 * Each update re-aligns the tail of (recent finalized words + current utterance) against
 * a window around the current position using local (Smith-Waterman style) alignment.
 * Small forward moves need little evidence; skips and backward moves need several
 * matched words from the *current* utterance, which stops repeated phrases and stray
 * words from yanking the position around. Silence never moves the position.
 */
import { normalizeText } from "./tokens";

export interface RecognitionResult {
  /** Increments every time recognition (re)starts; older sessions are ignored. */
  session: number;
  /** Increments per result within a session; stale or out-of-order results are dropped. */
  seq: number;
  /** Full hypothesis for the current utterance (partial) or its final text. */
  text: string;
  final: boolean;
}

export type Tolerance = "strict" | "balanced" | "lenient";
export type TrackerStatus = "idle" | "tracking" | "uncertain" | "lost" | "paused";

export interface TrackerState {
  /** Index of the next token to be spoken, 0..tokens.length. */
  position: number;
  status: TrackerStatus;
  /** Smoothed share of recently heard words that matched the script, 0..1. */
  confidence: number;
}

export interface TrackerOptions {
  tolerance?: Tolerance;
  backWindow?: number;
  forwardWindow?: number;
}

export interface Tracker {
  readonly state: TrackerState;
  update(result: RecognitionResult): TrackerState;
  setPosition(position: number): TrackerState;
  pause(): TrackerState;
  resume(): TrackerState;
  reset(): TrackerState;
}

const TOLERANCE = {
  strict: { fuzzy: 0.85, minScore: 4, jumpMatches: 5 },
  balanced: { fuzzy: 0.75, minScore: 3, jumpMatches: 4 },
  lenient: { fuzzy: 0.65, minScore: 2, jumpMatches: 3 },
} as const;

const HISTORY_WORDS = 12;
const TAIL_WORDS = 16;
const FREE_STEP = 2; // forward moves this small need one exact match
const MAX_STEP = 8; // forward moves beyond this count as skips
const LOST_AFTER = 6; // consecutive unexplained updates before a global search
const GAP = -1;
const TAIL_PENALTY = 0.5;
const CONFIDENCE_FLOOR = 0.45;

export function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length]! / Math.max(a.length, b.length);
}

interface Alignment {
  /** Token index just after the last matched script word. */
  end: number;
  score: number;
  /** Matched words (weak matches count half) from the current utterance only. */
  currentMatches: number;
  /** Hypothesis index of the first matched word. */
  startHyp: number;
}

export function createTracker(words: readonly string[], options: TrackerOptions = {}): Tracker {
  const tol = TOLERANCE[options.tolerance ?? "balanced"];
  const backWindow = options.backWindow ?? 40;
  const forwardWindow = options.forwardWindow ?? 80;

  let state: TrackerState = { position: 0, status: "idle", confidence: 0 };
  let session = -1;
  let lastSeq = -1;
  let history: string[] = [];
  let current: string[] = [];
  let skipCurrent = 0; // words of the current utterance said before a manual reposition
  let missStreak = 0;

  // Fuzzy similarity is memoized: scripts reuse a limited vocabulary, and the whole-script
  // search after losing track would otherwise recompute it ~100k times per update.
  // Growth is capped by clearing the map; an LRU is overkill here.
  const fuzzyCache = new Map<string, boolean>();
  const fuzzy = (h: string, s: string): boolean => {
    const longer = Math.max(h.length, s.length);
    if (
      Math.min(h.length, s.length) < 3 ||
      Math.abs(h.length - s.length) > longer * (1 - tol.fuzzy)
    ) {
      return false; // edit distance is at least the length difference
    }
    const key = `${h}\u0001${s}`;
    let hit = fuzzyCache.get(key);
    if (hit === undefined) {
      if (fuzzyCache.size > 200_000) fuzzyCache.clear();
      hit = levenshteinRatio(h, s) >= tol.fuzzy;
      fuzzyCache.set(key, hit);
    }
    return hit;
  };

  const sim = (h: string, s: string, isLast: boolean): number => {
    if (h === s) return 2;
    if (isLast && h.length >= 3 && s.startsWith(h)) return 1; // word still being spoken
    return fuzzy(h, s) ? 1 : -1;
  };

  /** Best local alignment of `hyp` against words[lo, hi), biased toward the current position. */
  const align = (
    hyp: string[],
    currentFrom: number,
    lo: number,
    hi: number,
    global: boolean,
  ): Alignment | null => {
    const w = hi - lo;
    let prevScore = new Float64Array(w + 1);
    let prevStart = new Int32Array(w + 1).fill(-1);
    let prevCur = new Float64Array(w + 1);
    let best: Alignment | null = null;
    let bestAdjusted = -Infinity;

    for (let i = 1; i <= hyp.length; i++) {
      const score = new Float64Array(w + 1);
      const start = new Int32Array(w + 1).fill(-1);
      const cur = new Float64Array(w + 1);
      const h = hyp[i - 1]!;
      const isCurrent = i - 1 >= currentFrom;
      for (let j = 1; j <= w; j++) {
        const s = sim(h, words[lo + j - 1]!, i === hyp.length);
        const diag = prevScore[j - 1]! + s;
        const up = prevScore[j]! + GAP;
        const left = score[j - 1]! + GAP;
        let v = 0;
        if (diag > 0 && diag >= up && diag >= left) {
          v = diag;
          start[j] = prevStart[j - 1]! >= 0 ? prevStart[j - 1]! : i - 1;
          cur[j] = prevCur[j - 1]! + (s > 0 && isCurrent ? s / 2 : 0);
        } else if (up > 0 && up >= left) {
          v = up;
          start[j] = prevStart[j]!;
          cur[j] = prevCur[j]!;
        } else if (left > 0) {
          v = left;
          start[j] = start[j - 1]!;
          cur[j] = cur[j - 1]!;
        }
        score[j] = v;
        // Candidates must end on a word from the current utterance: history is context only.
        if (isCurrent && s > 0 && v === diag && v > 0) {
          const end = lo + j;
          const delta = end - state.position;
          const distance = global
            ? Math.abs(delta) * 0.001 // only a tie-breaker when searching everywhere
            : delta >= 0
              ? Math.max(0, delta - MAX_STEP) * 0.1
              : -delta * 0.2;
          const adjusted = v - (hyp.length - i) * TAIL_PENALTY - distance;
          if (adjusted > bestAdjusted) {
            bestAdjusted = adjusted;
            best = { end, score: v, currentMatches: cur[j]!, startHyp: start[j]! };
          }
        }
      }
      prevScore = score;
      prevStart = start;
      prevCur = cur;
    }
    return best;
  };

  const accepts = (a: Alignment, currentFrom: number): boolean => {
    if (a.currentMatches <= 0) return false;
    const delta = a.end - state.position;
    if (delta === 0) return true;
    if (delta > 0 && delta <= FREE_STEP) return a.score >= 2;
    if (delta > 0 && delta <= MAX_STEP) return a.score >= tol.minScore;
    if (delta > 0) return a.currentMatches >= tol.jumpMatches;
    // Going back (re-reading): evidence must come from what is being said now.
    return a.currentMatches >= tol.jumpMatches && a.startHyp >= currentFrom;
  };

  const evaluate = (grew: boolean) => {
    const spoken = current.slice(skipCurrent);
    if (spoken.length === 0) return;
    const hyp = [...history, ...spoken].slice(-TAIL_WORDS);
    const currentFrom = hyp.length - Math.min(spoken.length, hyp.length);
    const lost = state.status === "lost";
    const lo = lost ? 0 : Math.max(0, state.position - backWindow);
    const hi = lost ? words.length : Math.min(words.length, state.position + forwardWindow);
    const best = hi > lo ? align(hyp, currentFrom, lo, hi, lost) : null;
    const needed = lost ? tol.jumpMatches + 1 : 0;
    const ok = best !== null && accepts(best, currentFrom) && best.currentMatches >= needed;

    const heard = hyp.length - currentFrom;
    const instant = best && ok ? Math.min(1, best.currentMatches / heard) : 0;
    const confidence = state.confidence * 0.6 + instant * 0.4;
    if (ok) missStreak = 0;
    else if (grew) missStreak += 1;

    let status: TrackerStatus;
    if (missStreak >= LOST_AFTER) status = "lost";
    else if (lost && !ok) status = "lost";
    else status = confidence >= CONFIDENCE_FLOOR || ok ? "tracking" : "uncertain";
    if (ok && confidence < CONFIDENCE_FLOOR && !lost) status = "uncertain";

    // Tiny backward moves come from the recognizer revising a half-spoken word; hold position.
    const holdsPosition =
      !ok || (best!.end < state.position && state.position - best!.end <= FREE_STEP);
    state = { position: holdsPosition ? state.position : best!.end, status, confidence };
  };

  const clearSpeech = () => {
    history = [];
    current = [];
    skipCurrent = 0;
    missStreak = 0;
  };

  return {
    get state() {
      return state;
    },
    update(result) {
      if (result.session < session) return state;
      if (result.session > session) {
        session = result.session;
        lastSeq = -1;
        clearSpeech();
      }
      if (result.seq <= lastSeq) return state;
      lastSeq = result.seq;

      const before = current.length;
      current = normalizeText(result.text);
      if (state.status === "paused") {
        // Keep consuming so resume knows what was said while paused, but never move.
        if (result.final) current = [];
        return state;
      }
      if (state.status === "idle") state = { ...state, status: "tracking" };
      evaluate(current.length > before);
      if (result.final) {
        history = [...history, ...current.slice(skipCurrent)].slice(-HISTORY_WORDS);
        current = [];
        skipCurrent = 0;
      }
      return state;
    },
    setPosition(position) {
      history = [];
      skipCurrent = current.length;
      missStreak = 0;
      const clamped = Math.max(0, Math.min(words.length, Math.round(position)));
      const status =
        state.status === "paused" || state.status === "idle" ? state.status : "tracking";
      state = { position: clamped, status, confidence: 0.5 };
      return state;
    },
    pause() {
      if (state.status !== "paused") state = { ...state, status: "paused" };
      return state;
    },
    resume() {
      if (state.status === "paused") {
        // Speech heard while paused belongs to no position; start clean.
        skipCurrent = current.length;
        history = [];
        state = { ...state, status: "tracking" };
      }
      return state;
    },
    reset() {
      clearSpeech();
      state = { position: 0, status: "idle", confidence: 0 };
      return state;
    },
  };
}
