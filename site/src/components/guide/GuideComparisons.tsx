// Sequence, Weapon and Echo comparisons.
import React from 'react';
import { ComparisonTable } from './ComparisonTable';
import type { ComparisonRow } from './ComparisonTable';
import { RangeSlider } from '../common/RangeSlider';
import { IconSelect } from '../common/IconSelect';
import { SegmentedToggle } from '../common/SegmentedToggle';
import type { RangeValue } from '../common/RangeSlider';
import { IMAGE_FOLDERS } from '../../data/db';
import { metricValue, rankEndpoints, weaponsForUnit } from './guideModel';
import { selectableOptions } from '../../utils/selectableContent';
import type { GuideJob, GuideMeasure, GuideScope, SequenceDef, WeaponDef, EchoDef, EchoSetDef, EchoBuild, EchoCompare } from './guideModel';
import type { GuideSummaries } from './useGuideCalc';

interface SectionProps {
  unit: string;
  measure: GuideMeasure;
  summaries: GuideSummaries;
}

// 31,239 -> "31.2k"
const formatShort = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

const scopeLabel = (scope: GuideScope) => (scope === 'team' ? 'Team' : 'Personal');

const rowValue = (summaries: GuideSummaries, job: GuideJob, unit: string, measure: GuideMeasure) => {
  const summary = summaries.get(job.key);
  return summary ? metricValue(summary, unit, measure) : undefined;
};

// --- Sequences ----------------------------------------------------------------------------

export const SequenceComparison: React.FC<SectionProps & { defs: SequenceDef[]; selected: number; onSelect: (seq: number) => void }> = ({
  unit, measure, summaries, defs, selected, onSelect
}) => {
  const s0Job = defs[0]?.job;
  const baselineJob = defs.find(def => def.sequence === selected)?.job;
  const rows: ComparisonRow[] = defs.map(def => {
    const rotationChanged = def.job.entry.id !== s0Job?.entry.id;
    return {
      key: String(def.sequence),
      label: `S${def.sequence}`,
      values: [rowValue(summaries, def.job, unit, measure)],
      tag: rotationChanged ? `S${def.rotationSequence} rotation` : undefined,
      tagTooltip: rotationChanged ? `Uses the rotation submitted for S${def.rotationSequence}, not the S0 one` : undefined,
      isSelected: def.sequence === selected,
      error: summaries.error(def.job.key)
    };
  });

  return (
    <div className="results-card guide-cmp-card">
      <div className="results-card-header"><span>Sequence Value ({scopeLabel(measure.scope)})</span></div>
      <ComparisonTable
        columns={[{ label: scopeLabel(measure.scope) }]}
        rows={rows}
        unitLabel={measure.metric.toUpperCase()}
        baseline={baselineJob ? rowValue(summaries, baselineJob, unit, measure) : undefined}
        onSelectRow={key => onSelect(Number(key))}
      />
    </div>
  );
};

// --- Weapons ------------------------------------------------------------------------------

export const WeaponComparison: React.FC<SectionProps & {
  defs: WeaponDef[];
  baselineJob: GuideJob;
  selectedWeapon: string;
  rankRange: RangeValue;
  onRankRangeChange: (range: RangeValue) => void;
  onSelect: (weapon: string) => void;
  onAdd: (weapon: string) => void;
  onRemove: (weapon: string) => void;
}> = ({ unit, measure, summaries, defs, baselineJob, selectedWeapon, rankRange, onRankRangeChange, onSelect, onAdd, onRemove }) => {
  const ranks = rankEndpoints(rankRange);
  const addOptions = selectableOptions('weapon', weaponsForUnit(unit)).map(opt =>
    defs.some(d => d.weapon === opt.value) ? { ...opt, disabled: true, disabledTooltip: 'Already in the comparison' } : opt
  );

  const rows: ComparisonRow[] = defs
    .map(def => ({
      key: def.weapon,
      label: def.weapon,
      icon: { name: def.weapon, folder: IMAGE_FOLDERS.WEAPONS, rect: true },
      values: def.jobs.map(({ job }) => rowValue(summaries, job, unit, measure)),
      tag: def.isR0 ? 'R0' : undefined,
      tagTooltip: def.isR0 ? `${unit}'s default non-signature weapon` : undefined,
      isSelected: def.weapon === selectedWeapon,
      removable: def.removable,
      error: def.jobs.map(({ job }) => summaries.error(job.key)).find(Boolean)
    }))
    // Best at top rank first; pending last.
    .sort((a, b) => (b.values[b.values.length - 1] ?? -1) - (a.values[a.values.length - 1] ?? -1));

  return (
    <div className="results-card guide-cmp-card">
      <div className="results-card-header">
        <span>Weapon Comparison ({scopeLabel(measure.scope)})</span>
      </div>
      <div className="guide-cmp-controls">
        <div className="guide-cmp-rank-range">
          <span className="form-label caps-label">Ranks</span>
          <RangeSlider min={1} max={5} value={rankRange} onChange={onRankRangeChange} />
        </div>
        <div className="guide-cmp-add mech-add-row">
          <span className="form-label caps-label">Add Weapon</span>
          <IconSelect
            value=""
            options={addOptions}
            onChange={onAdd}
            iconFolder={IMAGE_FOLDERS.WEAPONS}
            iconShape="rect"
            placeholder="Weapon"
            className="base-btn mech-add-icon-btn"
            triggerContent="+"
            triggerTooltip="Add a weapon to compare"
          />
        </div>
      </div>
      <ComparisonTable
        columns={ranks.map(rank => ({ label: `R${rank}` }))}
        rows={rows}
        unitLabel={measure.metric.toUpperCase()}
        baseline={rowValue(summaries, baselineJob, unit, measure)}
        onSelectRow={onSelect}
        onRemoveRow={onRemove}
        formatValue={formatShort}
      />
    </div>
  );
};

// --- Echoes -------------------------------------------------------------------------------

export const EchoComparison: React.FC<SectionProps & {
  defs: EchoDef[];
  setDefs: EchoSetDef[];
  baselineJob: GuideJob;
  compare: EchoCompare;
  onCompareChange: (compare: EchoCompare) => void;
  onSelectEcho: (build: EchoBuild) => void;
  onSelectSet: (signature: string) => void;
}> = ({ unit, measure, summaries, defs, setDefs, baselineJob, compare, onCompareChange, onSelectEcho, onSelectSet }) => {
  const statRows: ComparisonRow[] = defs.map(def => ({
    key: def.variant.key,
    label: def.variant.label,
    values: [rowValue(summaries, def.job, unit, measure)],
    isSelected: def.isCurrent,
    error: summaries.error(def.job.key)
  }));
  const setRows: ComparisonRow[] = setDefs.map(def => ({
    key: def.key,
    label: def.label,
    labelTooltip: def.detail,
    icon: def.mainSet ? { name: def.mainSet, folder: IMAGE_FOLDERS.ECHO_SETS } : undefined,
    values: [rowValue(summaries, def.job, unit, measure)],
    isSelected: def.isCurrent,
    error: summaries.error(def.job.key)
  }));

  const table = (rows: ComparisonRow[], onSelectRow: (key: string) => void) => (
    <ComparisonTable
      columns={[{ label: scopeLabel(measure.scope) }]}
      rows={rows}
      unitLabel={measure.metric.toUpperCase()}
      baseline={rowValue(summaries, baselineJob, unit, measure)}
      onSelectRow={onSelectRow}
    />
  );
  const selectEcho = (key: string) => {
    const def = defs.find(d => d.variant.key === key);
    if (def) onSelectEcho({ layout: def.variant.layout, mainStats: def.variant.mainStats });
  };
  const selectSet = (key: string) => {
    const def = setDefs.find(d => d.key === key);
    if (def) onSelectSet(def.signature);
  };

  return (
    <div className="results-card guide-cmp-card">
      <div className="results-card-header">
        <span>Echo Build Comparison ({scopeLabel(measure.scope)})</span>
        <div className="results-card-header-controls">
          <SegmentedToggle
            ariaLabel="Echo main stats compared"
            value={compare}
            onChange={onCompareChange}
            options={[
              { value: 'threeCost', label: '3-Cost', tooltip: 'Compare layouts and 3-cost main stats' },
              { value: 'fourCost', label: '4-Cost', tooltip: 'Compare the 4-cost main stat: Crit Rate, Crit DMG or the scaling stat' }
            ]}
          />
        </div>
      </div>
      {setRows.length === 0 ? table(statRows, selectEcho) : (
        <div className="guide-pair">
          <div>
            <div className="guide-cmp-subheading caps-label">Main Stats</div>
            {table(statRows, selectEcho)}
          </div>
          <div>
            <div className="guide-cmp-subheading caps-label">Echo Sets</div>
            {table(setRows, selectSet)}
          </div>
        </div>
      )}
    </div>
  );
};
