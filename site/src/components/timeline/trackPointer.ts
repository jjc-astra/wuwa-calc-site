// Cursor position and marker snapping for Timeline tracks.
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

const SNAP_RADIUS_PX = 6;

export interface TrackPointer {
  // Design px.
  x: number;
  y: number;
  // Design px -> client px.
  toClient: (x: number, y: number) => { x: number; y: number };
}

export interface TrackMove {
  currentTarget: HTMLElement;
  clientX: number;
  clientY: number;
}

/** Cursor position in the track's design px. */
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

/** Nearest marker within the snap radius (2D), or -1. */
export function nearestMarker(markers: Array<{ xPx: number; yPx: number }>, pointer: TrackPointer): number {
  let nearest = -1;
  let nearestDist = SNAP_RADIUS_PX;
  markers.forEach((m, i) => {
    const dist = Math.hypot(m.xPx - pointer.x, m.yPx - pointer.y);
    if (dist <= nearestDist) { nearest = i; nearestDist = dist; }
  });
  return nearest;
}

/** Throttles a mousemove handler to once per frame. Call `cancel` on leave. */
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

/** Toggles `is-active` on the snapped marker via the DOM, avoiding re-renders. */
export function useActiveMarker() {
  const active = useRef<Element | null>(null);
  return useCallback((el: Element | null) => {
    if (el === active.current) return;
    active.current?.classList.remove('is-active');
    el?.classList.add('is-active');
    active.current = el;
  }, []);
}
