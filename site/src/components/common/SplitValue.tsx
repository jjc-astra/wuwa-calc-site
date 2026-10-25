import React from 'react';

interface SplitValueProps {
  /** [tag, value] on each side. */
  left: [string, React.ReactNode];
  right: [string, React.ReactNode];
}

/** Two tagged values in one panel cell, e.g. GAME 0:42.18 | REAL 1:11.22. */
export const SplitValue: React.FC<SplitValueProps> = ({ left, right }) => (
  <span className="panel-info-split">
    <span><span className="panel-info-split-tag">{left[0]}</span>{left[1]}</span>
    <span><span className="panel-info-split-tag">{right[0]}</span>{right[1]}</span>
  </span>
);
