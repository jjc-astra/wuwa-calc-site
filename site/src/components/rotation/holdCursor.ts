// The active hold's forte cursor on a row, for the Forte cell and its sub panel.
import { DataLoader } from '../../utils/DataLoader';
import { MECHANICS_NOTATION } from '../../data/db';
import { CommonUtils } from '../../utils/Common';
import { forteKey, holdSlotNumber } from '../../utils/ResourceKeys';
import { forteMax } from '../../logic/resources';
import { rowGameEnd } from '../../logic/rotationRows';
import { framesToSeconds, toFrames } from '../../utils/Frames';

export interface HoldCursor {
  /** Forte pool the hold reads, e.g. forte1. */
  forteKey: string;
  mode: string;
  /** Where release would land at the row's end (clamp: the forte value). */
  cursor: number;
  /** Where it was at the row's start. */
  before: number;
  /** Progress over the row, signed: what it tried to move (pingpong reverses and loop wraps don't cancel it). */
  travel: number;
  /** The row's movement in straight legs, split where pingpong reverses or loop wraps. */
  legs: Array<{ from: number; to: number }>;
  max: number;
  /** Target window (window modes). */
  center: number;
  size: number;
  inWindow: boolean;
}

/** The unit's active hold cursor on `stateData`, or null when it isn't holding. */
export function holdCursorOf(unit: string, stateData: any): HoldCursor | null {
  const trackers = stateData?.trackers;
  const holdStart = trackers?.Hold_Start;
  if (!unit || trackers?.Hold_Unit !== unit || holdStart === undefined) return null;
  const d = MECHANICS_NOTATION.HOLD_DEFAULTS;
  const config: Record<string, any> = DataLoader.findHoldReleaseConfig(unit, trackers.Hold_Input) || {};
  const slot = holdSlotNumber(config.forteSlot || d.FORTE_SLOT);
  const key = forteKey(slot);
  const max = forteMax(DataLoader.characterDB[unit] || {}, slot);
  const mode: string = config.cursorMode || d.CURSOR_MODE;
  const speed = config.cursorSpeed ?? d.CURSOR_SPEED;
  // Clamp: the cursor is the forte value. Window modes: where release would land now.
  const accumulated = trackers.Cursor_Accumulated || 0;
  const progressAt = (frames: number) => accumulated + framesToSeconds(toFrames(Math.max(0, frames - holdStart))) * speed;
  const p0 = progressAt(stateData.gameTimeStart ?? holdStart);
  const p1 = progressAt(rowGameEnd(stateData));
  const center = trackers.Forte_Win_Center ?? parseFloat(d.WINDOW_CENTER);
  const size = trackers.Forte_Win_Size ?? parseFloat(d.WINDOW_SIZE);
  const isDone = (v: number) => CommonUtils.isHoldCursorDone(v, { mode, speed, maxVal: max, center, size });
  if (mode === 'clamp') {
    const value = stateData?.[key]?.[unit] || 0;
    return { forteKey: key, mode, cursor: value, before: value, travel: 0, legs: [], max, center, size, inWindow: isDone(value) };
  }
  const at = (progress: number) => CommonUtils.resolveHoldCursor(progress, mode, max);
  return {
    forteKey: key, mode, cursor: at(p1), before: at(p0), travel: p1 - p0, legs: cursorLegs(p0, p1, mode, max), max, center, size,
    inWindow: isDone(at(p1))
  };
}

// Straight legs between progress p0 and p1: a new one at each multiple of max (pingpong turns, loop wraps).
function cursorLegs(p0: number, p1: number, mode: string, max: number): Array<{ from: number; to: number }> {
  if (!(max > 0) || p0 === p1) return [];
  const dir = p1 > p0 ? 1 : -1;
  const legs: Array<{ from: number; to: number }> = [];
  let p = p0;
  while ((p1 - p) * dir > 1e-9 && legs.length < 64) {
    const next = dir > 0 ? (Math.floor(p / max + 1e-9) + 1) * max : (Math.ceil(p / max - 1e-9) - 1) * max;
    const end = dir > 0 ? Math.min(next, p1) : Math.max(next, p1);
    // Position along this leg, without the wrap/turn at its end.
    const mid = (p + end) / 2;
    const k = Math.floor(mid / max);
    const posAt = (q: number) => (mode === 'loop' || k % 2 === 0 ? q - k * max : (k + 1) * max - q);
    legs.push({ from: posAt(p), to: posAt(end) });
    p = end;
  }
  return legs;
}
