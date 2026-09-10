// src/components/rankings/RankingFilterToolbar.tsx
import React from 'react';
import { RangeSlider } from '../common/RangeSlider';
import type { RangeValue } from '../common/RangeSlider';
import { ELEMENT_COLORS } from '../../utils/Common';
import { colorForLabel } from '../results/chartPalette';

// 6 elements + 5 castType categories only -- Intro/Outro/status dmgTypes rarely drive a team's
// *majority* damage, the filter's key (see useRankingsStore.ts's majorityDmgTypes).
export const RANKING_ELEMENTS = ['Spectro', 'Fusion', 'Glacio', 'Aero', 'Electro', 'Havoc'] as const;
export type RankingElement = typeof RANKING_ELEMENTS[number];
export const RANKING_DMG_CATEGORIES = ['Basic', 'Heavy', 'Skill', 'Liberation', 'Echo'] as const;
export type RankingDmgCategory = typeof RANKING_DMG_CATEGORIES[number];

export interface RankingFilters {
  // One range per team slot: [Main DPS, Sub DPS, Support] -- team[0..2].
  sequenceRanges: [RangeValue, RangeValue, RangeValue];
  rotationStyle: 'any' | 'linear' | 'quickswap';
  bestOnly: boolean;
  // Faceted-checkbox convention: all checked = no filtering, unchecking narrows, none checked =
  // nothing passes. Matched against each entry's *majority* element/category (majorityDmgTypes).
  elements: RankingElement[];
  dmgCategories: RankingDmgCategory[];
}

export const DEFAULT_RANKING_FILTERS: RankingFilters = {
  sequenceRanges: [
    { min: 0, max: 0 },
    { min: 0, max: 0 },
    { min: 0, max: 0 }
  ],
  rotationStyle: 'any',
  bestOnly: false,
  elements: [...RANKING_ELEMENTS],
  dmgCategories: [...RANKING_DMG_CATEGORIES]
};

const SLOT_LABELS = ['Main DPS', 'Sub DPS', 'Support'];

interface DmgTypeColumnProps<T extends string> {
  title: string;
  options: readonly T[];
  selected: T[];
  colorFor: (option: T) => string;
  onChange: (next: T[]) => void;
}

// One checkbox list (Element or Category) with Select All / Hide All -- shared so both columns
// stay in sync instead of drifting as separate hand-copied blocks.
function DmgTypeColumn<T extends string>({ title, options, selected, colorFor, onChange }: DmgTypeColumnProps<T>) {
  const toggle = (option: T) => {
    onChange(selected.includes(option) ? selected.filter(o => o !== option) : [...selected, option]);
  };

  return (
    <div className="ranking-dmgtype-col">
      <div className="ranking-dmgtype-col-header">
        <span className="ranking-dmgtype-col-title">{title}</span>
        <div className="segmented-toggle" role="group" aria-label={`${title}: select all or none`}>
          <button type="button" className="segmented-toggle-btn" onClick={() => onChange([...options])}>All</button>
          <button type="button" className="segmented-toggle-btn" onClick={() => onChange([])}>None</button>
        </div>
      </div>
      {options.map(option => (
        <label
          key={option}
          className="ranking-dmgtype-checkbox-row"
          style={{ '--tag-color': colorFor(option) } as React.CSSProperties}
        >
          {/* Same hidden-input + custom box pattern as Rotation Row's checkbox
              (.check-wrap/.check-visual) -- not absolutely positioned here, tinted per option
              instead of always --accent. */}
          <span className="ranking-dmgtype-check-wrap">
            <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
            <span className="ranking-dmgtype-check-visual" />
          </span>
          <span className="ranking-dmgtype-tag">{option}</span>
        </label>
      ))}
    </div>
  );
}

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
      <div className="panel-header-tiny">Sequence Filter</div>
      {SLOT_LABELS.map((label, i) => (
        <div key={label} className="ranking-seq-row">
          <span className="ranking-seq-row-label">{label}</span>
          <RangeSlider min={0} max={6} value={filters.sequenceRanges[i]} onChange={v => updateSeq(i, v)} />
        </div>
      ))}

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
      {/* Grouped with Rotation Type, not DMG Type -- both describe the rotation itself, applied
          last in RotationRankingsPage's filter order regardless of position here. */}
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

      <div className="panel-header-tiny">DMG Type</div>
      <div className="ranking-dmgtype-columns">
        <DmgTypeColumn
          title="Element"
          options={RANKING_ELEMENTS}
          selected={filters.elements}
          colorFor={el => ELEMENT_COLORS[el] || '#888888'}
          onChange={elements => onChange({ ...filters, elements })}
        />
        <DmgTypeColumn
          title="Category"
          options={RANKING_DMG_CATEGORIES}
          selected={filters.dmgCategories}
          colorFor={colorForLabel}
          onChange={dmgCategories => onChange({ ...filters, dmgCategories })}
        />
      </div>
    </div>
  );
};
