// Pointer math shared by the Timeline's rows: where the cursor is on a track, and which marker
// (hit dot, stack change) it's close enough to snap to.
import type React from 'react';

// How close (design px) the cursor must be to a marker to snap to it.
const SNAP_RADIUS_PX = 6;

export interface TrackPointer {
  // Cursor position in the track's own design px.
  x: number;
  y: number;
  // Design px -> client px, for anchoring a tooltip on a marker.
  toClient: (x: number, y: number) => { x: number; y: number };
}

/** The cursor's position on the track handling `e` (the timeline is CSS-zoomed, so client px
 * aren't design px). */
export function trackPointer(e: React.MouseEvent<HTMLElement>): TrackPointer {
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
