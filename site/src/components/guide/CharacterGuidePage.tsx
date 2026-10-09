// Browses the submitted Rankings results for one character: pick a team and investment, then see
// its results, timeline, and sequence / weapon / echo comparisons.
import React, { useEffect, useMemo, useState } from 'react';
import { RotationTypeBadge } from '../rankings/RankingRow';
import type { RankingEntry } from '../../store/useRankingsStore';
import { DataLoader } from '../../utils/DataLoader';
import { getCharacterThemeColor, tip } from '../../utils/Common';
import { IMAGE_FOLDERS, SIM_CONSTANTS } from '../../data/db';
import { guidePath } from '../../config/routes';
import { goTo } from '../../hooks/useRoute';
import { AvatarIcon } from '../common/AvatarIcon';
import { LibraryCard, LibrarySection, LibrarySearchInput, matchesLibrarySearch } from '../common/LibraryGrid';
import { IconSelect } from '../common/IconSelect';
import { Dropdown } from '../common/Dropdown';
import { SegmentedToggle } from '../common/SegmentedToggle';
import type { RangeValue } from '../common/RangeSlider';
import { ResultsSourceContext } from '../results/ResultsSource';
import { DpsPanel } from '../results/DpsPanel';
import { TeamContributionPanel } from '../results/TeamContributionPanel';
import { RotationTimePanel } from '../results/RotationTimePanel';
import { SubstatWorthChart } from '../results/SubstatWorthChart';
import { RotationTimeline } from '../timeline/RotationTimeline';
import { GuideRankings } from './GuideRankings';
import { EchoStatsPanel } from './EchoStatsPanel';
import { SequenceComparison, WeaponComparison, EchoComparison } from './GuideComparisons';
import {
  FULL_RANK_RANGE, groupTeams, defaultConfig, configFromEntry, findGroupFor, weaponsForUnit,
  guideView, isValidConfig, setBuildOptions, setSignatureOfJob
} from './guideModel';
import { useGuideSelectionStore } from '../../store/useGuideSelectionStore';
import { selectableOptions } from '../../utils/selectableContent';
import type { GuideSelection } from '../../store/useGuideSelectionStore';
import type { GuideConfig, GuideJob, GuideMetric, GuideScope, GuideTeamGroup, GuideEntry } from './guideModel';
import { useGuideFullCalc, useGuideSummaries, useGuideEntries, useGuideCache } from './useGuideCalc';
import { warmWorkerPool } from '../../workers/calcWorkerClient';
import { useRankedCharacters } from './useRankedCharacters';

interface CharacterGuidePageProps {
  character?: string;
}

export const CharacterGuidePage: React.FC<CharacterGuidePageProps> = ({ character }) => {
  const { status, entries, error, rankedCharacters } = useRankedCharacters();
  // From the library too: the workers load while a character is picked.
  useEffect(() => warmWorkerPool(), []);

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
                  onClick={() => { if (isRanked) goTo(guidePath(name)); }}
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

// Loads the runs the guide calculates from, then shows the guide.
const GuideBody: React.FC<GuideBodyProps> = ({ character, entries }) => {
  const guideEntries = useGuideEntries(entries, character);
  if (guideEntries.status === 'loading') return <div className="results-empty">Loading rotations...</div>;
  return <GuideContent character={character} entries={entries} guideEntries={guideEntries.entries} />;
};

interface GuideContentProps extends GuideBodyProps {
  guideEntries: GuideEntry[];
}

const GuideContent: React.FC<GuideContentProps> = ({ character, entries, guideEntries }) => {
  const groups = useMemo(() => groupTeams(guideEntries, character), [guideEntries, character]);
  const defaultCfg = useMemo(() => defaultConfig(groups), [groups]);
  // Reopens what was last selected for this character (see useGuideSelectionStore).
  const saved = useGuideSelectionStore(s => s.selections[character]);
  const setSelection = useGuideSelectionStore(s => s.setSelection);
  const [selection, setSelectionState] = useState<GuideSelection>(() => ({
    config: saved?.config && isValidConfig(saved.config, groups) ? saved.config : null,
    rankRange: saved?.rankRange ?? FULL_RANK_RANGE,
    addedWeapons: saved?.addedWeapons ?? [],
    showInputs: saved?.showInputs ?? true
  }));
  const updateSelection = (patch: Partial<GuideSelection>) => {
    const next = { ...selection, ...patch };
    setSelectionState(next);
    setSelection(character, next);
  };
  const { config: picked, rankRange } = selection;
  const addedWeapons = useMemo(() => selection.addedWeapons ?? [], [selection.addedWeapons]);
  const setPicked = (config: GuideConfig | null) => updateSelection({ config });
  const setRankRange = (range: RangeValue) => updateSelection({ rankRange: range });
  const showInputs = selection.showInputs ?? true;
  const setShowInputs = (show: boolean) => updateSelection({ showInputs: show });
  const [metric, setMetric] = useState<GuideMetric>('dps');
  const [scope, setScope] = useState<GuideScope>('team');

  const config = picked && groups.some(g => g.key === picked.groupKey) ? picked : defaultCfg;
  const group = config ? groups.find(g => g.key === config.groupKey) : undefined;
  const defaultGroup = defaultCfg ? groups.find(g => g.key === defaultCfg.groupKey) : undefined;

  const view = useMemo(
    () => (group && config ? guideView(group, config, character, rankRange, addedWeapons) : null),
    [group, config, character, rankRange, addedWeapons]
  );
  const defaultView = useMemo(
    () => (defaultGroup && defaultCfg ? guideView(defaultGroup, defaultCfg, character, FULL_RANK_RANGE, addedWeapons) : null),
    [defaultGroup, defaultCfg, character, addedWeapons]
  );
  const selectedJob = view?.selectedJob ?? null;
  const defaultJob = defaultView?.selectedJob ?? null;

  // The shown view first; the default view trails it (its Default job is also the Rankings
  // baseline), so the view every visit can open on always finishes and gets saved.
  const allJobs = useMemo(() => [...(view?.jobs ?? []), ...(defaultView?.jobs ?? [])], [view, defaultView]);

  const isDefaultConfig = !picked || JSON.stringify(picked) === JSON.stringify(defaultCfg);
  const cacheReady = useGuideCache(character, guideEntries, allJobs);

  // Must come before useGuideSummaries -- see useGuideFullCalc.
  const full = useGuideFullCalc(cacheReady ? selectedJob : null);
  const summaries = useGuideSummaries(cacheReady ? allJobs : []);

  if (!group || !config || !view || !selectedJob) {
    return <div className="results-empty">No ranked rotations include {character} yet.</div>;
  }
  const { unitIdx, seqDefs, weapDefs, echoDefList, setDefList } = view;

  const updateSlot = (slotIdx: number, patch: Partial<GuideConfig['slots'][number]>) =>
    setPicked({ ...config, slots: config.slots.map((s, i) => (i === slotIdx ? { ...s, ...patch } : s)) });

  const showEntry = (entry: RankingEntry) => {
    // Its loaded run carries the weapons and sets the config is read from.
    const guideEntry = guideEntries.find(e => e.id === entry.id);
    const entryGroup = findGroupFor(groups, entry);
    if (entryGroup && guideEntry) setPicked(configFromEntry(entryGroup, guideEntry));
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

      {/* Left: the selected config, its echoes and results. Right: the comparisons. */}
      <ResultsSourceContext.Provider value={{ results: full.results, team: full.team, isStale, pinned: null, allowPin: false, allowSubstatToggle: false, scope }}>
        <div className="guide-columns">
          <div className="guide-column">
            <GuideConfigPanel
              group={group}
              config={config}
              selectedJob={selectedJob}
              isDefault={isDefaultConfig}
              onSlotChange={updateSlot}
              onReset={() => setPicked(null)}
            />
            <EchoStatsPanel slot={selectedJob.team[unitIdx]} />
            <div className="guide-column-header">
              <div className="panel-header-main">Results</div>
            </div>
            {full.results && (
              <>
                <DpsPanel />
                <div className="guide-pair-weighted guide-pair-contribution">
                  <RotationTimePanel />
                  <TeamContributionPanel />
                </div>
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
                  { value: 'personal', label: 'Personal' },
                  { value: 'team', label: 'Team' }
                ]}
              />
              <SegmentedToggle
                ariaLabel="Comparison metric"
                value={metric}
                onChange={setMetric}
                options={[
                  { value: 'dps', label: 'DPS' },
                  { value: 'dpr', label: 'DPR' }
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
                onAdd={weapon => updateSelection({ addedWeapons: [...addedWeapons.filter(w => w !== weapon), weapon] })}
                onRemove={weapon => updateSelection({ addedWeapons: addedWeapons.filter(w => w !== weapon) })}
              />
            </div>
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
            {full.results && <SubstatWorthChart />}
          </div>
        </div>
      </ResultsSourceContext.Provider>

      {full.results && (
        <div className="guide-section">
          <div className="guide-column-header">
            <div className="panel-header-main">Timeline</div>
            <label className="toolbar-toggle-label">
              <input type="checkbox" checked={showInputs} onChange={e => setShowInputs(e.target.checked)} /> Show Inputs
            </label>
          </div>
          <div className={`results-card guide-timeline-card ${isStale ? 'is-stale' : ''}`}>
            <RotationTimeline
              evaluatedRows={full.evaluatedRows}
              team={full.team}
              loopStartIndex={full.loopStartIndex}
              showInputs={showInputs}
            />
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
  group: GuideTeamGroup;
  config: GuideConfig;
  // The submission the config runs, for the sets it shows.
  selectedJob: GuideJob;
  isDefault: boolean;
  onSlotChange: (slotIdx: number, patch: Partial<GuideConfig['slots'][number]>) => void;
  onReset: () => void;
}

const SEQUENCE_OPTIONS = Array.from({ length: SIM_CONSTANTS.MAX_SEQUENCE + 1 }, (_, s) => ({ value: String(s), label: `S${s}` }));
const RANK_OPTIONS = Array.from({ length: SIM_CONSTANTS.MAX_RANK }, (_, r) => ({ value: String(r + 1), label: `R${r + 1}` }));

// The selected team's investment. Other teams are picked from the Rankings below (Show in Guide).
const GuideConfigPanel: React.FC<GuideConfigPanelProps> = ({ group, config, selectedJob, isDefault, onSlotChange, onReset }) => {
  const team = group.entries[0].team;

  return (
    <div className="results-card guide-config">
      <div className="results-card-header">
        <span>Team Setup</span>
        <div className="results-card-header-controls">
          <RotationTypeBadge type={group.rotationType} />
          {isDefault
            ? <span className="guide-default-badge caps-tag pill-badge outline-badge">Default</span>
            : <button type="button" className="base-btn text-xs guide-reset-btn" onClick={onReset}>Reset</button>}
        </div>
      </div>

      <div className="guide-config-slots">
        {team.map((slot, i) => {
          if (!slot.character) return null;
          const choice = config.slots[i];
          const setOptions = setBuildOptions(group, i);
          const currentSet = setOptions.find(o => o.signature === setSignatureOfJob(selectedJob, i));
          const themeColor = getCharacterThemeColor(DataLoader.characterDB[slot.character]);
          return (
            <div key={i} className="guide-config-slot" style={{ '--char-theme-raw': themeColor } as React.CSSProperties}>
              <div className="guide-config-slot-unit">
                <AvatarIcon name={slot.character} folder={IMAGE_FOLDERS.CHARACTERS} className="avatar-sm" />
                <span className="guide-config-slot-name" {...tip(slot.character)}>{slot.character}</span>
                <Dropdown
                  className="base-select text-xs guide-mini-select"
                  value={String(choice.sequence)}
                  options={SEQUENCE_OPTIONS}
                  onChange={v => onSlotChange(i, { sequence: Number(v) })}
                />
              </div>
              <div className="guide-config-slot-weapon">
                <AvatarIcon name={choice.weapon} folder={IMAGE_FOLDERS.WEAPONS} className="avatar-sm avatar-rect" />
                <IconSelect
                  value={choice.weapon}
                  options={selectableOptions('weapon', weaponsForUnit(slot.character))}
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
              {/* Only the set builds this unit was submitted with on this team. */}
              <IconSelect
                value={currentSet?.signature ?? ''}
                options={setOptions.map(o => ({ value: o.signature, label: o.label, icon: o.mainSet }))}
                onChange={setSignature => onSlotChange(i, { setSignature })}
                iconFolder={IMAGE_FOLDERS.ECHO_SETS}
                iconShape="circle"
                placeholder="Echo Set"
                className="base-select guide-set-select"
                disabled={setOptions.length < 2}
                triggerContent={<AvatarIcon name={currentSet?.mainSet ?? ''} folder={IMAGE_FOLDERS.ECHO_SETS} className="avatar-sm" />}
                triggerTooltip={currentSet?.detail ?? 'Echo Set'}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
