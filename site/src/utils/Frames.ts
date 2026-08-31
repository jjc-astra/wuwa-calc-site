// src/utils/Frames.ts
// The engine's action/animation-timing math ("durations": actionDuration, freezeTime, damage
// timeframes, offsets, hit scheduling, combo windows) runs on a fixed 60fps integer-frame grid
// instead of floating-point seconds, so it can't accumulate the drift/rounding error continuous
// seconds math is prone to. Cooldowns and buff/effect lifetimes are a deliberate exception and
// stay in seconds (see TimelineEngine.ts's _processGameTimeDecay for the one place these two
// domains cross). Every user-facing time value is still shown in seconds -- conversion happens
// only at render time via formatFramesAsSeconds, never inside calculation logic.
//
// Frames is a branded number, not a wrapper object/class: TimelineEngine.ts does native
// +/-/*/comparisons on time fields throughout, and a real class would force all of that into
// method calls. Branding keeps existing arithmetic legal while TypeScript rejects assigning a
// bare seconds-number into a Frames slot without an explicit conversion.
export type Frames = number & { readonly __frameBrand: unique symbol };

export const FPS = 60;

// Trust-cast for a value already known to be a whole frame count (e.g. a JSON literal that's
// already been through the frame migration). Does not round -- use roundFrames if the value
// might be fractional.
export function toFrames(n: number): Frames {
  return n as Frames;
}

// Rounds an already-frames-domain but possibly-fractional value (DSL math output, hit-time
// interpolation) to the nearest whole frame.
export function roundFrames(n: number): Frames {
  return Math.round(n) as Frames;
}

export function secondsToFrames(seconds: number): Frames {
  return Math.round(seconds * FPS) as Frames;
}

export function framesToSeconds(frames: Frames): number {
  return frames / FPS;
}

// The one shared display formatter -- every seconds-string shown in the UI should go through
// this instead of an ad hoc `.toFixed(2)+'s'`.
export function formatFramesAsSeconds(frames: Frames, decimals = 2): string {
  return `${framesToSeconds(frames).toFixed(decimals)}s`;
}

// Mechanics Builder's shared timing-input parser. Accepts "30f" (frames), "0.5s" (seconds), a
// bare number (interpreted as the field's native unit -- keeps existing JSON like
// `"cooldown": 25` meaning unchanged), or a DSL expression ("@Default.SwapTime",
// "10 + (20 * @Self.BuffStacks(Clarity))"), which is returned completely unchanged so the
// existing DSL passthrough keeps working. Returns a plain number in the field's canonical
// unit, or the original string if it didn't parse as a plain literal.
export function parseTimeInput(raw: string, nativeUnit: 'frames' | 'seconds'): number | string {
  const trimmed = raw.trim();
  if (trimmed === '') return raw;

  // DSL passthrough: an '@' pointer, or an arithmetic operator after the first character
  // (so a leading '-' for a negative literal doesn't false-positive as an expression).
  if (/@/.test(trimmed) || /[+\-*/](?!$)/.test(trimmed.slice(1))) return raw;

  const match = /^(-?\d+(?:\.\d+)?)\s*(f|s)?$/i.exec(trimmed);
  if (!match) return raw;

  const value = parseFloat(match[1]);
  const suffix = match[2]?.toLowerCase();

  if (suffix === 'f') return nativeUnit === 'frames' ? Math.round(value) : value / FPS;
  if (suffix === 's') return nativeUnit === 'seconds' ? value : Math.round(value * FPS);
  return value; // bare number: native unit, unchanged
}
