// src/components/guide/GuideComparisons.tsx
// Sequence / Weapon / Echo comparisons. Their jobs come from guideModel's *Defs() builders, so the
// page can run them all in one useGuideSummaries batch.
import React from 'react';
import { ComparisonTable } from './ComparisonTable';
import type { ComparisonRow } from './ComparisonTable';
import { RangeSlider } from '../common/RangeSlider';
import type { RangeValue } from '../common/RangeSlider';
import { IMAGE_FOLDERS } from '../../data/db';
import { metricValue, rankEndpoints } from './guideModel';
import type { GuideJob, GuideMetric, GuideScope, SequenceDef, WeaponDef, EchoDef, EchoSetDef } from './guideModel';
import type { GuideSummaries } from './useGuideCalc';

interface SectionProps {
  unit: string;
  metric: GuideMetric;
  scope: GuideScope;
  summaries: GuideSummaries;
}

// Nearest hundred (31,239 -> "31.2k"), to keep two rank columns narrow.
const formatShort = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

const scopeLabel = (scope: GuideScope) => (scope === 'team' ? 'Team' : 'Personal');

const rowValue = (summaries: GuideSummaries, job: GuideJob, unit: string, metric: GuideMetric, scope: GuideScope) => {
  const summary = summaries.get(job.key);
  return summary ? metricValue(summary, unit, metric, scope) : undefined;
};

// --- Sequences ----------------------------------------------------------------------------

export const SequenceComparison: React.FC<SectionProps & { defs: SequenceDef[]; selected: number; onSelect: (seq: number) => void }> = ({
  unit, metric, scope, summaries, defs, selected, onSelect
}) => {
  const baseJob = defs[0]?.job;
  const rows: ComparisonRow[] = defs.map(def => {
    const rotationChanged = def.job.entry.id !== baseJob?.entry.id;
    return {
      key: String(def.sequence),
      label: `S${def.sequence}`,
      values: [rowValue(summaries, def.job, unit, metric, scope)],
      tag: rotationChanged ? `S${def.rotationSequence} rotation` : undefined,
      tagTooltip: rotationChanged ? `Uses the rotation submitted for S${def.rotationSequence}, not the S0 one` : undefined,
      isSelected: def.sequence === selected,
      error: summaries.error(def.job.key)
    };
  });

  return (
    <div className="results-card guide-cmp-card">
      <div className="results-card-header"><span>Sequence Value ({scopeLabel(scope)})</span></div>
      <ComparisonTable
        columns={[{ label: scopeLabel(scope) }]}
        rows={rows}
        unitLabel={metric.toUpperCase()}
        baseline={baseJob ? rowValue(summaries, baseJob, unit, metric, scope) : undefined}
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
}> = ({ unit, metric, scope, summaries, defs, baselineJob, selectedWeapon, rankRange, onRankRangeChange, onSelect }) => {
  const ranks = rankEndpoints(rankRange);

  const rows: ComparisonRow[] = defs
    .map(def => ({
      key: def.weapon,
      label: def.weapon,
      icon: { name: def.weapon, folder: IMAGE_FOLDERS.WEAPONS, rect: true },
      values: def.jobs.map(({ job }) => rowValue(summaries, job, unit, metric, scope)),
      isSelected: def.weapon === selectedWeapon,
      error: def.jobs.map(({ job }) => summaries.error(job.key)).find(Boolean)
    }))
    // Best at the top rank first; rows still calculating sort last.
    .sort((a, b) => (b.values[b.values.length - 1] ?? -1) - (a.values[a.values.length - 1] ?? -1));

  return (
    <div className="results-card guide-cmp-card">
      <div className="results-card-header">
        <span>Weapon Comparison ({scopeLabel(scope)})</span>
      </div>
      <div className="guide-cmp-rank-range">
        <span>Ranks</span>
        <RangeSlider min={1} max={5} value={rankRange} onChange={onRankRangeChange} />
      </div>
      <ComparisonTable
        columns={ranks.map(rank => ({ label: `R${rank}` }))}
        rows={rows}
        unitLabel={metric.toUpperCase()}
        baseline={rowValue(summaries, baselineJob, unit, metric, scope)}
        onSelectRow={onSelect}
        formatValue={formatShort}
      />
    </div>
  );
};

// --- Echoes -------------------------------------------------------------------------------

export const EchoComparison: React.FC<SectionProps & { defs: EchoDef[]; setDefs: EchoSetDef[]; baselineJob: GuideJob }> = ({
  unit, metric, scope, summaries, defs, setDefs, baselineJob
}) => {
  const statRows: ComparisonRow[] = defs.map(def => ({
    key: def.variant.key,
    label: def.variant.label,
    values: [rowValue(summaries, def.job, unit, metric, scope)],
    isSelected: def.isCurrent,
    error: summaries.error(def.job.key)
  }));
  const setRows: ComparisonRow[] = setDefs.map(def => ({
    key: def.key,
    label: def.label,
    labelTooltip: def.detail,
    icon: def.mainSet ? { name: def.mainSet, folder: IMAGE_FOLDERS.ECHO_SETS } : undefined,
    values: [rowValue(summaries, def.job, unit, metric, scope)],
    isSelected: def.isCurrent,
    error: summaries.error(def.job.key)
  }));

  const table = (rows: ComparisonRow[]) => (
    <ComparisonTable
      columns={[{ label: scopeLabel(scope) }]}
      rows={rows}
      unitLabel={metric.toUpperCase()}
      baseline={rowValue(summaries, baselineJob, unit, metric, scope)}
    />
  );

  return (
    <div className="results-card guide-cmp-card">
      <div className="results-card-header"><span>Echo Build Comparison ({scopeLabel(scope)})</span></div>
      {setRows.length === 0 ? table(statRows) : (
        <div className="guide-pair">
          <div>
            <div className="guide-cmp-subheading">Main Stats</div>
            {table(statRows)}
          </div>
          <div>
            <div className="guide-cmp-subheading">Echo Sets</div>
            {table(setRows)}
          </div>
        </div>
      )}
    </div>
  );
};
