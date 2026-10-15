import type React from 'react';

/**
 * Fixed-position style below `rect`, flipped above when there's more room.
 * Sets both sides of each offset pair so CSS defaults can't interfere.
 */
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
