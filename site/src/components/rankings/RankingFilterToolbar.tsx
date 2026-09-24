import React from 'react';
import { RangeSlider } from '../common/RangeSlider';
import type { RangeValue } from '../common/RangeSlider';
import { SegmentedToggle } from '../common/SegmentedToggle';
import { ELEMENT_COLORS } from '../../utils/Common';
import { colorForLabel } from '../results/chartPalette';
import { ELEMENTS } from '../../data/gameVocab';
import type { CastType, ElementName } from '../../data/gameVocab';

// 6 elements + 5 castType categories only -- Intro/Outro/status dmgTypes rarely drive a team's
// *majority* damage, the filter's key (see useRankingsStore.ts's majorityDmgTypes).
export type RankingElement = Exclude<ElementName, 'Physical'>;
export const RANKING_ELEMENTS: readonly RankingElement[] = ELEMENTS.filter((element): element is RankingElement => element !== 'Physical');
export const RANKING_DMG_CATEGORIES = ['Basic', 'Heavy', 'Skill', 'Liberation', 'Echo'] as const satisfies readonly CastType[];
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

// One checkbox list (Element or Category) with Select All / Hide All.
function DmgTypeColumn<T extends string>({ title, options, selected, colorFor, onChange }: DmgTypeColumnProps<T>) {
  const toggle = (option: T) => {
    onChange(selected.includes(option) ? selected.filter(o => o !== option) : [...selected, option]);
  };

  return (
    <div className="ranking-dmgtype-col">
      <div className="ranking-dmgtype-col-header">
        <span className="ranking-dmgtype-col-title caps-label">{title}</span>
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
          <span className="ranking-dmgtype-tag caps-tag pill-badge">{option}</span>
        </label>
      ))}
    </div>
  );
}

interface RankingFilterToolbarProps {
  filters: RankingFilters;
  onChange: (next: RankingFilters) => void;
}

// One range slider per team slot.
export const SequenceRangeFilters: React.FC<RankingFilterToolbarProps> = ({ filters, onChange }) => {
  const updateSeq = (slotIdx: number, next: RangeValue) => {
    const ranges = [...filters.sequenceRanges] as RankingFilters['sequenceRanges'];
    ranges[slotIdx] = next;
    onChange({ ...filters, sequenceRanges: ranges });
  };

  return (
    <>
      {SLOT_LABELS.map((label, i) => (
        <div key={label} className="ranking-seq-row">
          <span className="ranking-seq-row-label caps-label">{label}</span>
          <RangeSlider min={0} max={6} value={filters.sequenceRanges[i]} onChange={v => updateSeq(i, v)} />
        </div>
      ))}
    </>
  );
};

/** Rotation style filter: Any / Linear / Quickswap. */
export const RotationStyleToggle: React.FC<RankingFilterToolbarProps> = ({ filters, onChange }) => (
  <SegmentedToggle
    ariaLabel="Rotation style"
    value={filters.rotationStyle}
    onChange={rotationStyle => onChange({ ...filters, rotationStyle })}
    options={[
      { value: 'any', label: 'Any' },
      { value: 'linear', label: 'Linear' },
      { value: 'quickswap', label: 'Quickswap' }
    ]}
  />
);

/** The Rankings filters: slot sequences, rotation style, element and damage category. */
export const RankingFilterToolbar: React.FC<RankingFilterToolbarProps> = ({ filters, onChange }) => {
  return (
    <div className="ranking-toolbar">
      <div className="panel-header-tiny">Sequence Filter</div>
      <SequenceRangeFilters filters={filters} onChange={onChange} />

      <div className="panel-header-tiny">Rotation Type</div>
      <RotationStyleToggle filters={filters} onChange={onChange} />
      {/* Grouped with Rotation Type, not DMG Type -- both describe the rotation itself, applied
          last in RotationRankingsPage's filter order regardless of position here. */}
      <SegmentedToggle
        ariaLabel="Best rotation only"
        value={filters.bestOnly ? 'best' : 'all'}
        onChange={which => onChange({ ...filters, bestOnly: which === 'best' })}
        options={[
          { value: 'all', label: 'All' },
          { value: 'best', label: 'Best Only' }
        ]}
      />

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
