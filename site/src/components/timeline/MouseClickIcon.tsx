// src/components/timeline/MouseClickIcon.tsx
// A mouse glyph with its left button filled solid -- stands in for writing out "Left Click" in
// the timeline's cramped input-flag pills. currentColor throughout, so it automatically picks
// up each flag's own per-unit theme color (set on the parent element), matching how every other
// icon in this app (src/components/common/icons.tsx) inherits color rather than hardcoding it.
import React from 'react';

export const MouseClickIcon: React.FC<{ size?: number }> = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Left Click">
    <rect x="6" y="4" width="12" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
    <path d="M6 10 L6 7 A3 3 0 0 1 9 4 L12 4 L12 10 Z" fill="currentColor" />
    <line x1="6" y1="10" x2="18" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
