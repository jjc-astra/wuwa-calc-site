import type React from 'react';

/** Fixed-position style for a popup anchored to `rect` (its trigger's bounding box): below it, or
 * flipped above when there's too little room below and more above.
 *
 * `align: 'left'` (default) lines the popup's left edge up with the trigger's, for a <select>-style
 * trigger; 'right' lines up the right edge instead, for a narrow icon-only trigger pinned to a
 * row's right (e.g. a "..." menu), so it doesn't hang off.
 *
 * Every branch sets both members of each offset pair (top/bottom, left/right), never just one --
 * so this fully overrides a caller's CSS default (e.g. .pin-menu's own position:absolute;
 * top:...;right:0). Leaving one side unset lets top+bottom both apply at once, silently squashing
 * the computed height to zero -- the actual "menu won't open" bug. */
export function computePopupPosition(
  rect: DOMRect,
  { maxHeight, gap = 4, align = 'left' }: { maxHeight: number; gap?: number; align?: 'left' | 'right' }
): React.CSSProperties {
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const openUpward = spaceBelow < maxHeight && spaceAbove > spaceBelow;
  return {
    position: 'fixed',
    ...(align === 'right'
      ? { right: window.innerWidth - rect.right, left: 'auto', maxWidth: Math.max(rect.width, rect.right - 8) }
      : { left: rect.left, right: 'auto', minWidth: rect.width, maxWidth: Math.max(rect.width, window.innerWidth - rect.left - 8) }),
    ...(openUpward
      ? { bottom: window.innerHeight - rect.top + gap, top: 'auto', maxHeight: Math.min(maxHeight, spaceAbove - 8) }
      : { top: rect.bottom + gap, bottom: 'auto', maxHeight: Math.min(maxHeight, spaceBelow - 8) })
  };
}
