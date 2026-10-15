// Timing runs on integer 60fps frames; cooldowns and buff lifetimes stay in seconds.
// UI shows seconds. Frames is a branded number so arithmetic still works.
export type Frames = number & { readonly __frameBrand: unique symbol };

export const FPS = 60;

// Casts without rounding; use roundFrames for fractional values.
export function toFrames(n: number): Frames {
  return n as Frames;
}

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
 * Hit frame offsets: first at `start`, last at `end`, middle hits pinned by `overrides`
 * (overrides[0] is hit 2) or spread evenly.
 */
export function hitFrameOffsets(hitCount: number, start: number, end: number, overrides: ReadonlyArray<number | null | undefined> = []): Frames[] {
  if (hitCount <= 0) return [];
  const pinned = (i: number): number | undefined => (i > 0 && i < hitCount - 1 ? overrides[i - 1] ?? undefined : undefined);
  if (hitCount === 1 || end <= start) {
    return Array.from({ length: hitCount }, (_, i) => roundFrames(pinned(i) ?? end));
  }
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

/** "+1.47s", "-0.50s", "0.00s" */
export const formatSignedSeconds = (seconds: number): string => `${seconds > 0 ? '+' : ''}${seconds.toFixed(2)}s`;

/** "1.47s" */
export function formatFramesAsSeconds(frames: Frames, decimals = 2): string {
  return `${framesToSeconds(frames).toFixed(decimals)}s`;
}

/** "2:00.00", "-0:03.20" */
export function formatFramesAsClock(frames: Frames): string {
  // Round first so 59.999s reads 1:00.00.
  const hundredths = Math.round(Math.abs(framesToSeconds(frames)) * 100);
  const minutes = Math.floor(hundredths / 6000);
  const seconds = ((hundredths % 6000) / 100).toFixed(2).padStart(5, '0');
  return `${frames < 0 ? '-' : ''}${minutes}:${seconds}`;
}

// Parses "30f", "0.5s", or a bare number (native unit). DSL passes through unchanged.
export function parseTimeInput(raw: string, nativeUnit: 'frames' | 'seconds'): number | string {
  const trimmed = raw.trim();
  if (trimmed === '') return raw;

  // DSL: '@' or an operator after the first char.
  if (/@/.test(trimmed) || /[+\-*/](?!$)/.test(trimmed.slice(1))) return raw;

  const match = /^(-?\d+(?:\.\d+)?)\s*(f|s)?$/i.exec(trimmed);
  if (!match) return raw;

  const value = parseFloat(match[1]);
  const suffix = match[2]?.toLowerCase();

  if (suffix === 'f') return nativeUnit === 'frames' ? Math.round(value) : value / FPS;
  if (suffix === 's') return nativeUnit === 'seconds' ? value : Math.round(value * FPS);
  return value;
}
