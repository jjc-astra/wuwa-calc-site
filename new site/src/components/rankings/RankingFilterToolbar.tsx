// src/components/rankings/RankingFilterToolbar.tsx
import React from 'react';
import { RangeSlider } from '../common/RangeSlider';
import type { RangeValue } from '../common/RangeSlider';

export interface RankingFilters {
  // One range per team slot: [Main DPS, Sub DPS, Support] -- team[0..2].
  sequenceRanges: [RangeValue, RangeValue, RangeValue];
  rotationStyle: 'any' | 'linear' | 'quickswap';
  bestOnly: boolean;
}

export const DEFAULT_RANKING_FILTERS: RankingFilters = {
  sequenceRanges: [
    { min: 0, max: 0 },
    { min: 0, max: 0 },
    { min: 0, max: 0 }
  ],
  rotationStyle: 'any',
  bestOnly: false
};

const SLOT_LABELS = ['Main DPS', 'Sub DPS', 'Support'];

interface RankingFilterToolbarProps {
  filters: RankingFilters;
  onChange: (next: RankingFilters) => void;
}

export const RankingFilterToolbar: React.FC<RankingFilterToolbarProps> = ({ filters, onChange }) => {
  const updateSeq = (slotIdx: number, next: RangeValue) => {
    const ranges = [...filters.sequenceRanges] as RankingFilters['sequenceRanges'];
    ranges[slotIdx] = next;
    onChange({ ...filters, sequenceRanges: ranges });
  };

  return (
    <div className="ranking-toolbar">
      <div className="ranking-toolbar-col ranking-toolbar-seq-col">
        <div className="panel-header-tiny">Sequence Filter</div>
        <div className="ranking-seq-row-group">
          {SLOT_LABELS.map((label, i) => (
            <div key={label} className="ranking-seq-col">
              <span className="ranking-seq-row-label">{label}</span>
              <RangeSlider min={0} max={6} value={filters.sequenceRanges[i]} onChange={v => updateSeq(i, v)} />
            </div>
          ))}
        </div>
      </div>

      <div className="ranking-toolbar-divider" />

      <div className="ranking-toolbar-col ranking-toolbar-toggle-col">
        <div className="panel-header-tiny">Rotation Type</div>
        <div className="segmented-toggle" role="group" aria-label="Rotation style">
          {(['any', 'linear', 'quickswap'] as const).map(style => (
            <button
              key={style}
              type="button"
              className={`segmented-toggle-btn ${filters.rotationStyle === style ? 'is-active' : ''}`}
              onClick={() => onChange({ ...filters, rotationStyle: style })}
            >
              {style === 'any' ? 'Any' : style === 'linear' ? 'Linear' : 'Quickswap'}
            </button>
          ))}
        </div>

        {/* Applied last, after every other filter -- see RotationRankingsPage's filtering order. */}
        <div className="segmented-toggle" role="group" aria-label="Best rotation only">
          <button
            type="button"
            className={`segmented-toggle-btn ${!filters.bestOnly ? 'is-active' : ''}`}
            onClick={() => onChange({ ...filters, bestOnly: false })}
          >
            All
          </button>
          <button
            type="button"
            className={`segmented-toggle-btn ${filters.bestOnly ? 'is-active' : ''}`}
            onClick={() => onChange({ ...filters, bestOnly: true })}
          >
            Best Only
          </button>
        </div>
      </div>
    </div>
  );
};
