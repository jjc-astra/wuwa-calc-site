// src/utils/Frames.ts
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

// Shared display formatter -- every UI seconds-string should go through this, not an ad hoc `.toFixed(2)+'s'`.
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
