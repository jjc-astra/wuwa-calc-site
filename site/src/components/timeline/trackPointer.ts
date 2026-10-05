// Pointer math shared by the Timeline's rows: where the cursor is on a track, and which marker
// (hit dot, stack change) it's close enough to snap to.
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

// How close (design px) the cursor must be to a marker to snap to it.
const SNAP_RADIUS_PX = 6;

export interface TrackPointer {
  // Cursor position in the track's own design px.
  x: number;
  y: number;
  // Design px -> client px, for anchoring a tooltip on a marker.
  toClient: (x: number, y: number) => { x: number; y: number };
}

/** A mouse move over a track: the track and the cursor's client position. */
export interface TrackMove {
  currentTarget: HTMLElement;
  clientX: number;
  clientY: number;
}

/** The cursor's position on the track handling `e` (the timeline is CSS-zoomed, so client px
 * aren't design px). */
export function trackPointer(e: TrackMove): TrackPointer {
  const track = e.currentTarget;
  const rect = track.getBoundingClientRect();
  const k = rect.width > 0 ? track.offsetWidth / rect.width : 1;
  return {
    x: (e.clientX - rect.left) * k,
    y: (e.clientY - rect.top) * k,
    toClient: (x, y) => ({ x: rect.left + x / k, y: rect.top + y / k })
  };
}

/** Index of the marker nearest the pointer in 2D (so a vertical stack snaps to the one the
 * cursor is level with), or -1 if none is within the snap radius. */
export function nearestMarker(markers: Array<{ xPx: number; yPx: number }>, pointer: TrackPointer): number {
  let nearest = -1;
  let nearestDist = SNAP_RADIUS_PX;
  markers.forEach((m, i) => {
    const dist = Math.hypot(m.xPx - pointer.x, m.yPx - pointer.y);
    if (dist <= nearestDist) { nearest = i; nearestDist = dist; }
  });
  return nearest;
}

/**
 * A track's mousemove handler, run at most once a frame with the latest move. Reading the track's
 * rect forces a layout of the whole page once the last move changed the tooltip, and a fast mouse
 * moves several times a frame. `cancel` drops a pending move (call it on leave).
 */
export function useFrameMove(handle: (move: TrackMove) => void) {
  const latest = useRef(handle);
  useLayoutEffect(() => { latest.current = handle; });
  const pending = useRef<TrackMove | null>(null);
  const frame = useRef(0);
  const cancel = useCallback(() => {
    cancelAnimationFrame(frame.current);
    pending.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  const onMove = useCallback((e: { currentTarget: HTMLElement; clientX: number; clientY: number }) => {
    const queued = pending.current !== null;
    pending.current = { currentTarget: e.currentTarget, clientX: e.clientX, clientY: e.clientY };
    if (queued) return;
    frame.current = requestAnimationFrame(() => {
      const move = pending.current;
      pending.current = null;
      if (move) latest.current(move);
    });
  }, []);
  return { onMove, cancel };
}

/**
 * Marks the marker element snapped to `is-active`, on the DOM rather than in state: re-rendering a
 * row (every dot in it) each time the snap changed made hovering stutter.
 */
export function useActiveMarker() {
  const active = useRef<Element | null>(null);
  return useCallback((el: Element | null) => {
    if (el === active.current) return;
    active.current?.classList.remove('is-active');
    el?.classList.add('is-active');
    active.current = el;
  }, []);
}
