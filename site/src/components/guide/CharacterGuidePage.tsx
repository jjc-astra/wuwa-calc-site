// src/components/guide/CharacterGuidePage.tsx
// Browses the submitted Rankings results for one character: pick a team and investment, then see
// its results, timeline, and sequence / weapon / echo comparisons.
import React, { useEffect, useMemo, useState } from 'react';
import { useRankingsStore, rotationTypeLabel } from '../../store/useRankingsStore';
import { RotationTypeBadge } from '../rankings/RankingRow';
import type { RankingEntry } from '../../store/useRankingsStore';
import { DataLoader } from '../../utils/DataLoader';
import { getCharacterThemeColor, tip } from '../../utils/Common';
import { IMAGE_FOLDERS } from '../../data/db';
import { guideHash } from '../../hooks/useHashRoute';
import { AvatarIcon } from '../common/AvatarIcon';
import { LibraryCard, LibrarySection, LibrarySearchInput, matchesLibrarySearch } from '../common/LibraryGrid';
import { IconSelect } from '../common/IconSelect';
import { Dropdown } from '../common/Dropdown';
import type { DropdownGroup } from '../common/Dropdown';
import { SegmentedToggle } from '../common/SegmentedToggle';
import type { RangeValue } from '../common/RangeSlider';
import { ResultsSourceContext } from '../results/ResultsSource';
import { DpsPanel } from '../results/DpsPanel';
import { DmgOverTimeChart } from '../results/DmgOverTimeChart';
import { TeamContributionPanel } from '../results/TeamContributionPanel';
import { SubstatWorthChart } from '../results/SubstatWorthChart';
import { RotationTimeline } from '../timeline/RotationTimeline';
import { GuideRankings } from './GuideRankings';
import { SequenceComparison, WeaponComparison, EchoComparison } from './GuideComparisons';
import {
  sequenceDefs, weaponDefs, echoDefs, echoSetDefs, rankEndpoints,
  MAX_SEQUENCE, MAX_RANK, groupTeams, defaultConfig, s0r1Config, configFromEntry, findGroupFor, jobForConfig, weaponOptionsFor
} from './guideModel';
import type { GuideConfig, GuideMetric, GuideScope, GuideTeamGroup } from './guideModel';
import { useGuideFullCalc, useGuideSummaries } from './useGuideCalc';


// Per-loop damage bars: the cumulative line mainly helps when comparing against a pinned rotation.
const GUIDE_DMG_CHART_DEFAULTS = { window: 'avgLoop', mode: 'dmg', chartType: 'bar' } as const;

interface CharacterGuidePageProps {
  character?: string;
}

export const CharacterGuidePage: React.FC<CharacterGuidePageProps> = ({ character }) => {
  const { status, entries, error, load } = useRankingsStore();

  useEffect(() => {
    load();
  }, [load]);

  const rankedCharacters = useMemo(() => {
    const names = new Set<string>();
    entries.forEach(e => e.team.forEach(s => { if (s.character) names.add(s.character); }));
    return names;
  }, [entries]);

  if (!character) return <GuideLibrary status={status} error={error} rankedCharacters={rankedCharacters} />;

  return (
    <div className="guide-page">
      <div className="guide-page-body">
        {status === 'error' && <div className="results-empty">Failed to load rankings: {error}</div>}
        {status !== 'ready' && status !== 'error' && <div className="results-empty">Loading rankings...</div>}
        {status === 'ready' && <GuideBody key={character} character={character} entries={entries} />}
      </div>
    </div>
  );
};

interface GuideLibraryProps {
  status: string;
  error: string | null;
  rankedCharacters: Set<string>;
}

// Lists every character; ones without a ranked rotation are dimmed and can't be opened.
const GuideLibrary: React.FC<GuideLibraryProps> = ({ status, error, rankedCharacters }) => {
  const [search, setSearch] = useState('');
  const characters = Object.keys(DataLoader.characterDB).filter(name => matchesLibrarySearch(name, search));

  return (
    <div className="guide-page">
      <LibrarySearchInput value={search} onChange={setSearch} placeholder="Search Characters..." />
      <div className="guide-library-scroll">
        {status === 'error' && <div className="results-empty">Failed to load rankings: {error}</div>}
        {status !== 'ready' && status !== 'error' && <div className="results-empty">Loading rankings...</div>}
        {status === 'ready' && characters.length > 0 && (
          <LibrarySection title="Characters">
            {characters.map(name => {
              const isRanked = rankedCharacters.has(name);
              return (
                <LibraryCard
                  key={name}
                  itemName={name}
                  imgFolder={IMAGE_FOLDERS.CHARACTERS}
                  rarity={DataLoader.characterDB[name]?.rarity || 5}
                  dimmed={!isRanked}
                  dimmedTooltip="No ranked rotations yet"
                  onClick={() => { if (isRanked) window.location.hash = guideHash(name); }}
                />
              );
            })}
          </LibrarySection>
        )}
      </div>
    </div>
  );
};

interface GuideBodyProps {
  character: string;
  entries: RankingEntry[];
}

const GuideBody: React.FC<GuideBodyProps> = ({ character, entries }) => {
  const groups = useMemo(() => groupTeams(entries, character), [entries, character]);
  const defaultCfg = useMemo(() => defaultConfig(groups), [groups]);
  const [picked, setPicked] = useState<GuideConfig | null>(null);
  const [rankRange, setRankRange] = useState<RangeValue>({ min: 1, max: MAX_RANK });
  const [metric, setMetric] = useState<GuideMetric>('dps');
  const [scope, setScope] = useState<GuideScope>('team');

  const config = picked && groups.some(g => g.key === picked.groupKey) ? picked : defaultCfg;
  const group = config ? groups.find(g => g.key === config.groupKey) : undefined;
  const defaultGroup = defaultCfg ? groups.find(g => g.key === defaultCfg.groupKey) : undefined;

  const unitIdx = group ? group.entries[0].team.findIndex(s => s.character === character) : -1;
  const selectedJob = useMemo(() => (group && config ? jobForConfig(group, config) : null), [group, config]);
  const defaultJob = useMemo(() => (defaultGroup && defaultCfg ? jobForConfig(defaultGroup, defaultCfg) : null), [defaultGroup, defaultCfg]);

  const seqDefs = useMemo(() => (group && config ? sequenceDefs(group, config, unitIdx) : []), [group, config, unitIdx]);
  const weapDefs = useMemo(
    () => (group && config ? weaponDefs(group, config, unitIdx, character, rankEndpoints(rankRange)) : []),
    [group, config, unitIdx, character, rankRange]
  );
  const echoDefList = useMemo(
    () => (group && config && selectedJob ? echoDefs(group, config, unitIdx, selectedJob) : []),
    [group, config, unitIdx, selectedJob]
  );
  const setDefList = useMemo(
    () => (group && config && selectedJob ? echoSetDefs(group, config, unitIdx, selectedJob) : []),
    [group, config, unitIdx, selectedJob]
  );

  // Listed in dispatch priority order.
  const allJobs = useMemo(() => [
    ...(selectedJob ? [selectedJob] : []),
    ...(defaultJob ? [defaultJob] : []),
    ...seqDefs.map(d => d.job),
    ...echoDefList.map(d => d.job),
    ...setDefList.map(d => d.job),
    ...weapDefs.flatMap(d => d.jobs.map(j => j.job))
  ], [selectedJob, defaultJob, seqDefs, echoDefList, setDefList, weapDefs]);

  // Must come before useGuideSummaries -- see useGuideFullCalc.
  const full = useGuideFullCalc(selectedJob);
  const summaries = useGuideSummaries(allJobs);

  if (!group || !config || !selectedJob || unitIdx < 0) {
    return <div className="results-empty">No ranked rotations include {character} yet.</div>;
  }

  const updateSlot = (slotIdx: number, patch: Partial<GuideConfig['slots'][number]>) =>
    setPicked({ ...config, slots: config.slots.map((s, i) => (i === slotIdx ? { ...s, ...patch } : s)) });

  const showEntry = (entry: RankingEntry) => {
    const entryGroup = findGroupFor(groups, entry);
    if (entryGroup) setPicked(configFromEntry(entryGroup, entry));
    document.querySelector('.guide-page-body')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const themeColor = getCharacterThemeColor(DataLoader.characterDB[character]);
  const isStale = full.status === 'loading';

  return (
    <>
      <div className="guide-hero" style={{ '--char-theme-raw': themeColor } as React.CSSProperties}>
        <AvatarIcon name={character} folder={IMAGE_FOLDERS.CHARACTERS} className="avatar-lg" />
        <div className="guide-hero-text">
          <h2>{character}</h2>
          <span className="text-dim">
            {DataLoader.characterDB[character]?.element} · {DataLoader.characterDB[character]?.weaponType} · {groups.length} ranked team{groups.length === 1 ? '' : 's'}
          </span>
        </div>
        {summaries.pending > 0 && (
          <span className="guide-progress">Calculating {summaries.total - summaries.pending} / {summaries.total}</span>
        )}
      </div>

      {full.status === 'error' && <div className="results-empty">Calculation failed: {full.error}</div>}
      {!full.results && full.status === 'loading' && <div className="results-empty">Calculating rotation...</div>}

      {/* Left: the selected config and its results. Right: the comparisons. */}
      <ResultsSourceContext.Provider value={{ results: full.results, team: full.team, isStale, pinned: null, allowPin: false, scope, dmgChartDefaults: GUIDE_DMG_CHART_DEFAULTS }}>
        <div className={`guide-columns ${isStale ? 'is-stale' : ''}`}>
          <div className="guide-column">
            <GuideConfigPanel
              groups={groups}
              group={group}
              config={config}
              isDefault={!picked || JSON.stringify(picked) === JSON.stringify(defaultCfg)}
              onGroupChange={g => setPicked(s0r1Config(g))}
              onSlotChange={updateSlot}
              onReset={() => setPicked(null)}
            />
            <div className="guide-column-header">
              <div className="panel-header-main">Results</div>
            </div>
            {full.results && (
              <>
                <div className="guide-pair">
                  <DpsPanel />
                  <TeamContributionPanel />
                </div>
                <DmgOverTimeChart />
              </>
            )}
          </div>

          <div className="guide-column">
            <div className="guide-column-header">
              <div className="panel-header-main">Comparisons</div>
              <SegmentedToggle
                ariaLabel="Comparison scope"
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'personal', label: 'Personal', tooltip: "This unit's own damage" },
                  { value: 'team', label: 'Team', tooltip: "The whole team's damage" }
                ]}
              />
              <SegmentedToggle
                ariaLabel="Comparison metric"
                value={metric}
                onChange={setMetric}
                options={[
                  { value: 'dps', label: 'DPS', tooltip: 'Damage per second over the 2-minute window' },
                  { value: 'dpr', label: 'DPR', tooltip: 'Damage per rotation (the average loop)' }
                ]}
              />
            </div>
            <div className="guide-pair-weighted">
              <SequenceComparison
                unit={character}
                metric={metric}
                scope={scope}
                summaries={summaries}
                defs={seqDefs}
                selected={config.slots[unitIdx].sequence}
                onSelect={sequence => updateSlot(unitIdx, { sequence })}
              />
              <WeaponComparison
                unit={character}
                metric={metric}
                scope={scope}
                summaries={summaries}
                defs={weapDefs}
                baselineJob={selectedJob}
                selectedWeapon={config.slots[unitIdx].weapon}
                rankRange={rankRange}
                onRankRangeChange={setRankRange}
                onSelect={weapon => updateSlot(unitIdx, { weapon })}
              />
            </div>
            {full.results && <SubstatWorthChart />}
            <EchoComparison
              unit={character}
              metric={metric}
              scope={scope}
              summaries={summaries}
              defs={echoDefList}
              setDefs={setDefList}
              baselineJob={selectedJob}
              onSelectEcho={echo => updateSlot(unitIdx, { echo })}
              onSelectSet={setSignature => updateSlot(unitIdx, { setSignature })}
            />
          </div>
        </div>
      </ResultsSourceContext.Provider>

      {full.results && (
        <div className="guide-section">
          <div className="panel-header-main">Timeline</div>
          <div className={`results-card guide-timeline-card ${isStale ? 'is-stale' : ''}`}>
            <RotationTimeline evaluatedRows={full.evaluatedRows} team={full.team} loopStartIndex={full.loopStartIndex} />
          </div>
        </div>
      )}

      <GuideRankings
        unit={character}
        entries={entries}
        baseline={defaultJob ? summaries.get(defaultJob.key) : undefined}
        onShowInGuide={showEntry}
      />
    </>
  );
};

interface GuideConfigPanelProps {
  groups: GuideTeamGroup[];
  group: GuideTeamGroup;
  config: GuideConfig;
  isDefault: boolean;
  onGroupChange: (group: GuideTeamGroup) => void;
  onSlotChange: (slotIdx: number, patch: Partial<GuideConfig['slots'][number]>) => void;
  onReset: () => void;
}

const SEQUENCE_OPTIONS = Array.from({ length: MAX_SEQUENCE + 1 }, (_, s) => ({ value: String(s), label: `S${s}` }));
const RANK_OPTIONS = Array.from({ length: MAX_RANK }, (_, r) => ({ value: String(r + 1), label: `R${r + 1}` }));

const GuideConfigPanel: React.FC<GuideConfigPanelProps> = ({
  groups, group, config, isDefault, onGroupChange, onSlotChange, onReset
}) => {
  const teamOptions: DropdownGroup[] = (['linear', 'quickswap', null] as const)
    .map(type => ({
      label: rotationTypeLabel(type),
      options: groups.filter(g => g.rotationType === type).map(g => ({ value: g.key, label: g.label }))
    }))
    .filter(g => g.options.length > 0);

  const team = group.entries[0].team;

  return (
    <div className="results-card guide-config">
      <div className="results-card-header">
        <span>Team & Investment</span>
        <div className="results-card-header-controls">
          {isDefault
            ? <span className="guide-default-badge" {...tip('The best Linear team, every 5-star unit and weapon at S0R1')}>Default</span>
            : <button type="button" className="base-btn text-xs guide-reset-btn" onClick={onReset}>Reset</button>}
        </div>
      </div>

      <div className="guide-config-team">
        <Dropdown
          className="base-select text-xs guide-team-select"
          value={group.key}
          options={teamOptions}
          onChange={key => {
            const next = groups.find(g => g.key === key);
            if (next) onGroupChange(next);
          }}
        />
        <RotationTypeBadge type={group.rotationType} />
      </div>

      <div className="guide-config-slots">
        {team.map((slot, i) => {
          if (!slot.character) return null;
          const choice = config.slots[i];
          const themeColor = getCharacterThemeColor(DataLoader.characterDB[slot.character]);
          return (
            <div key={i} className="guide-config-slot" style={{ '--char-theme-raw': themeColor } as React.CSSProperties}>
              <AvatarIcon name={slot.character} folder={IMAGE_FOLDERS.CHARACTERS} className="avatar-sm" />
              <span className="guide-config-slot-name" {...tip(slot.character)}>{slot.character}</span>
              <Dropdown
                className="base-select text-xs guide-mini-select"
                value={String(choice.sequence)}
                options={SEQUENCE_OPTIONS}
                onChange={v => onSlotChange(i, { sequence: Number(v) })}
              />
              <div className="guide-config-slot-weapon">
                <AvatarIcon name={choice.weapon} folder={IMAGE_FOLDERS.WEAPONS} className="avatar-sm avatar-rect" />
                <IconSelect
                  value={choice.weapon}
                  options={weaponOptionsFor(slot.character).map(value => ({ value }))}
                  onChange={weapon => onSlotChange(i, { weapon })}
                  iconFolder={IMAGE_FOLDERS.WEAPONS}
                  iconShape="rect"
                  placeholder="Weapon"
                  className="base-select text-xs"
                />
              </div>
              <Dropdown
                className="base-select text-xs guide-mini-select"
                value={String(choice.rank)}
                options={RANK_OPTIONS}
                onChange={v => onSlotChange(i, { rank: Number(v) })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
