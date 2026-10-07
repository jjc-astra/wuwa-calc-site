// Timing math (actionDuration, freezeTime, damage timeframes, hit scheduling, combo windows)
// runs on a fixed 60fps integer-frame grid, not float seconds -- avoids drift/rounding error.
// Cooldowns and buff/effect lifetimes are the exception and stay in seconds -- see
// TimelineEngine.ts's _processGameTimeDecay for where the two domains cross.
// User-facing time is always seconds, converted only at render via formatFramesAsSeconds.
//
// Frames is a branded number, not a class: TimelineEngine.ts does native +/-/* on time
// fields, and a class would force those into method calls. Branding keeps that arithmetic
// legal while blocking an unconverted seconds-number from being assigned into a Frames slot.
export type Frames = number & { readonly __frameBrand: unique symbol };

export const FPS = 60;

// Trust-cast for a value already known to be whole frames (e.g. JSON already migrated).
// Does not round -- use roundFrames if the value might be fractional.
export function toFrames(n: number): Frames {
  return n as Frames;
}

// Rounds a frames-domain, possibly-fractional value (DSL math output, hit-time interpolation)
// to the nearest whole frame.
export function roundFrames(n: number): Frames {
  return Math.round(n) as Frames;
}

export function secondsToFrames(seconds: number): Frames {
  return Math.round(seconds * FPS) as Frames;
}

export function framesToSeconds(frames: Frames): number {
  return frames / FPS;
}

/**
 * Each hit's frame offset from its move's start. The first and last hits sit at `start` and `end`
 * (a single hit at `end`); `overrides` pin the hits in between, from the second (overrides[0] is
 * hit 2), so it never holds the first or last; every other hit is spread evenly
 * between the nearest pinned hits either side. With `end` not after `start`, unpinned hits all
 * land at `end`.
 */
export function hitFrameOffsets(hitCount: number, start: number, end: number, overrides: ReadonlyArray<number | null | undefined> = []): Frames[] {
  if (hitCount <= 0) return [];
  const pinned = (i: number): number | undefined => (i > 0 && i < hitCount - 1 ? overrides[i - 1] ?? undefined : undefined);
  if (hitCount === 1 || end <= start) {
    return Array.from({ length: hitCount }, (_, i) => roundFrames(pinned(i) ?? end));
  }
  // Index -> frame of every fixed hit, in index order.
  const anchors: Array<[number, number]> = [[0, start]];
  for (let i = 1; i < hitCount - 1; i++) {
    const frame = pinned(i);
    if (frame !== undefined) anchors.push([i, frame]);
  }
  anchors.push([hitCount - 1, end]);
  const offsets: Frames[] = [];
  for (let a = 0; a < anchors.length - 1; a++) {
    const [fromIdx, fromFrame] = anchors[a];
    const [toIdx, toFrame] = anchors[a + 1];
    for (let i = fromIdx; i < toIdx; i++) offsets.push(roundFrames(fromFrame + (toFrame - fromFrame) * ((i - fromIdx) / (toIdx - fromIdx))));
  }
  offsets.push(roundFrames(end));
  return offsets;
}

/** Seconds with an explicit sign, to two places: "+1.47s", "-0.50s", "0.00s". */
export const formatSignedSeconds = (seconds: number): string => `${seconds > 0 ? '+' : ''}${seconds.toFixed(2)}s`;

/** Frames as display seconds ("1.47s"). Every UI seconds string goes through here or formatSignedSeconds. */
export function formatFramesAsSeconds(frames: Frames, decimals = 2): string {
  return `${framesToSeconds(frames).toFixed(decimals)}s`;
}

// Mechanics Builder's shared timing-input parser. Accepts "30f" (frames), "0.5s" (seconds), a
// bare number (native unit, keeps existing JSON like `"cooldown": 25` unchanged), or a DSL
// expression ("@Default.SwapTime", "10 + ...") which passes through unchanged.
// Returns a plain number in the field's canonical unit, or the original string if unparsed.
export function parseTimeInput(raw: string, nativeUnit: 'frames' | 'seconds'): number | string {
  const trimmed = raw.trim();
  if (trimmed === '') return raw;

  // DSL passthrough: '@' pointer, or an operator after char 1 (so a leading '-' isn't mistaken for an expression).
  if (/@/.test(trimmed) || /[+\-*/](?!$)/.test(trimmed.slice(1))) return raw;

  const match = /^(-?\d+(?:\.\d+)?)\s*(f|s)?$/i.exec(trimmed);
  if (!match) return raw;

  const value = parseFloat(match[1]);
  const suffix = match[2]?.toLowerCase();

  if (suffix === 'f') return nativeUnit === 'frames' ? Math.round(value) : value / FPS;
  if (suffix === 's') return nativeUnit === 'seconds' ? value : Math.round(value * FPS);
  return value; // bare number: native unit, unchanged
}
