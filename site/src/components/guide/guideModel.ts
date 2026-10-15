// Character Guide: groups Rankings results for a character and builds sequence/weapon/echo variants.
import { DataLoader } from '../../utils/DataLoader';
import { isSelectableContent } from '../../utils/selectableContent';
import { slotSets, teamCharacters } from '../../utils/TeamUtils';
import { dpsFieldOf } from '../../data/dpsWindows';
import { SIM_CONSTANTS, STAT_NAME_MAP, costsForLayout, mainStatOptionsFor } from '../../data/db';
import { selfStatsReadBy } from '../../logic/MechanicOwners';
import { calculateEchoStatsForSlot } from '../../store/useRosterStore';
import type { RankingEntry } from '../../store/useRankingsStore';
import type { RankedRun } from '../../utils/DataLoader';
import type { RotationSummary, RosterSlot } from '../../types/results';
import type { TeamSlot } from '../../types';
import type { RangeValue } from '../common/RangeSlider';

const isFourStar = (character: string): boolean => DataLoader.characterDB[character]?.rarity === 4;

// --- Team groups ---------------------------------------------------------------------------

// A ranking entry with its run and full team loaded.
export type GuideEntry = RankingEntry & { run: RankedRun; team: TeamSlot[] };

// One team composition + rotation style, at one or more sequences.
export interface GuideTeamGroup {
  key: string;
  label: string;
  characters: string[];
  rotationType: RankingEntry['rotationType'];
  entries: GuideEntry[];
}

const groupKeyOf = (entry: RankingEntry): string =>
  `${entry.characters.join('|')}#${entry.rotationType ?? 'unclassified'}`;

export function groupTeams(entries: GuideEntry[], character: string): GuideTeamGroup[] {
  const groups = new Map<string, GuideTeamGroup>();
  for (const entry of entries) {
    if (!entry.team.some(s => s.character === character)) continue;
    const key = groupKeyOf(entry);
    let group = groups.get(key);
    if (!group) {
      const characters = teamCharacters(entry.team);
      group = { key, label: characters.join(' · '), characters, rotationType: entry.rotationType, entries: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  // Best S0 DPS first.
  return Array.from(groups.values()).sort((a, b) => entryDps(pickS0Entry(b)) - entryDps(pickS0Entry(a)));
}

const entryDps = (entry: RankingEntry): number => entry.dpsStats[dpsFieldOf('twoMin')] ?? 0;

const slotCounts = (character: string | undefined): boolean => !!character && !isFourStar(character);

// Highest-sequence submission not exceeding the selection (ties: higher DPS; fallback: lowest).
function pickRotationEntry(group: GuideTeamGroup, sequences: number[]): GuideEntry {
  const seqSum = (e: GuideEntry) => e.team.reduce((sum, s, i) => sum + (slotCounts(s.character) ? e.sequences[i] ?? 0 : 0), 0);
  const fits = group.entries.filter(e =>
    e.team.every((s, i) => !slotCounts(s.character) || (e.sequences[i] ?? 0) <= (sequences[i] ?? 0)));
  if (fits.length > 0) {
    return fits.reduce((best, e) => {
      const diff = seqSum(e) - seqSum(best);
      return diff > 0 || (diff === 0 && entryDps(e) > entryDps(best)) ? e : best;
    });
  }
  return group.entries.reduce((best, e) => {
    const diff = seqSum(e) - seqSum(best);
    return diff < 0 || (diff === 0 && entryDps(e) > entryDps(best)) ? e : best;
  });
}

const pickS0Entry = (group: GuideTeamGroup): GuideEntry => pickRotationEntry(group, []);

// --- Config (what the selectors pick) -----------------------------------------------------

export interface EchoBuild {
  layout: string;
  mainStats: string[];
}

export interface GuideSlotChoice {
  sequence: number;
  weapon: string;
  rank: number;
  // Replaces layout and main stats; substats stay.
  echo?: EchoBuild;
  setSignature?: string;
}

export interface GuideConfig {
  groupKey: string;
  // Indexed by team slot.
  slots: GuideSlotChoice[];
}

// S0R1 for 5-stars; 4-stars keep their submitted sequence and rank.
function s0r1Config(group: GuideTeamGroup): GuideConfig {
  const entry = pickS0Entry(group);
  return {
    groupKey: group.key,
    slots: entry.team.map(slot => ({
      sequence: slot.character && isFourStar(slot.character) ? Number(slot.sequence) || 0 : 0,
      weapon: slot.weapon,
      rank: DataLoader.weaponDB[slot.weapon]?.rarity === 5 ? 1 : Number(slot.rank) || 1
    }))
  };
}

// Best linear team at S0R1, else the best team.
export function defaultConfig(groups: GuideTeamGroup[]): GuideConfig | null {
  const group = groups.find(g => g.rotationType === 'linear') ?? groups[0];
  return group ? s0r1Config(group) : null;
}

// A ranking entry's own investment.
export const configFromEntry = (group: GuideTeamGroup, entry: GuideEntry): GuideConfig => ({
  groupKey: group.key,
  slots: entry.team.map(slot => ({
    sequence: Number(slot.sequence) || 0,
    weapon: slot.weapon,
    rank: Number(slot.rank) || 1,
    setSignature: slot.character ? setSignatureOf(slot) : undefined
  }))
});

export const findGroupFor = (groups: GuideTeamGroup[], entry: RankingEntry): GuideTeamGroup | undefined =>
  groups.find(g => g.key === groupKeyOf(entry));

// --- Calc jobs ----------------------------------------------------------------------------

export interface GuideJob {
  // Identifies the calc; identical teams share one run.
  key: string;
  entry: GuideEntry;
  team: TeamSlot[];
}

// An entry's team with the selection applied.
function buildTeam(entry: GuideEntry, slots: GuideSlotChoice[]): TeamSlot[] {
  return entry.run.team.map((slot, i) => {
    const choice = slots[i];
    if (!slot.character || !choice) return slot;
    const next = { ...slot, sequence: choice.sequence, weapon: choice.weapon, rank: choice.rank };
    return choice.echo ? applyEchoBuild(next, choice.echo) : next;
  });
}

function makeJob(entry: GuideEntry, team: TeamSlot[]): GuideJob {
  const fingerprint = team.map(s => [s.character, s.sequence, s.weapon, s.rank, s.layout, s.echoes.map(e => e.mainStat)]);
  return { key: `${entry.id}::${JSON.stringify(fingerprint)}`, entry, team };
}

// Set build key: sets plus main echo.
const setSignatureOf = (slot: RosterSlot): string =>
  [slot.mainSet, slot.subSet, slot.subSet2a, slot.subSet2b, slot.mainEcho].join('|');

function jobForConfig(group: GuideTeamGroup, config: GuideConfig): GuideJob {
  const withSets = group.entries.filter(e =>
    config.slots.every((s, i) => !s.setSignature || setSignatureOf(e.team[i]) === s.setSignature));
  const entry = pickRotationEntry({ ...group, entries: withSets.length > 0 ? withSets : group.entries }, config.slots.map(s => s.sequence));
  return makeJob(entry, buildTeam(entry, config.slots));
}

// --- Metrics ------------------------------------------------------------------------------

export type GuideMetric = 'dps' | 'dpr';
export type GuideScope = 'personal' | 'team';

// DPS: 2-minute window (personal: per own on-field time). DPR: Avg Loop damage per loop.
export function metricValue(summary: RotationSummary | undefined, unit: string, metric: GuideMetric, scope: GuideScope): number | null {
  if (!summary) return null;
  if (metric === 'dps') {
    if (scope === 'team') return summary.dpsStats.twoMinDps;
    const { team, fieldTime } = summary.contribution.twoMin;
    const seconds = fieldTime?.[unit] ?? 0;
    return seconds > 0 ? (team.find(s => s.label === unit)?.dmg ?? 0) / seconds : null;
  }
  if (summary.dpsStats.avgLoopDps === null) return null;
  const slices = summary.contribution.avgLoop.team;
  if (scope === 'team') return slices.reduce((sum, s) => sum + s.dmg, 0);
  return slices.find(s => s.label === unit)?.dmg ?? 0;
}

// --- Echo variants ------------------------------------------------------------------------

const SHORT_STAT: Record<string, string> = {
  'CR Rate': 'CR', 'CR DMG': 'CD', 'ATK %': 'ATK', 'HP %': 'HP', 'DEF %': 'DEF', 'ER %': 'ER', 'Healing Bonus': 'Heal'
};
const shortStat = (stat: string): string => SHORT_STAT[stat] ?? (stat.endsWith(' DMG') ? 'Ele' : stat);

export interface EchoVariant extends EchoBuild {
  key: string;
  label: string;
}

// 3-cost main stats the kit scales with. Needs mechanics loaded.
function kitScaledMainStats(character: string): string[] {
  const read = selfStatsReadBy(character);
  return mainStatOptionsFor(3).filter(stat => read.has(STAT_NAME_MAP[stat]));
}

// Standard echo builds:
// - 43311 with each 3-cost pair (element, scalar, kit stats)
// - 44111 with the other crit stat
// - 41111
function echoVariants(slot: TeamSlot): EchoVariant[] {
  const element = DataLoader.characterDB[slot.character]?.element;
  const elementStat = `${element} DMG`;
  const costs = costsForLayout(slot.layout);
  const scalar = slot.echoes.find((_, i) => costs[i] === 1)?.mainStat || 'ATK %';
  const first4 = slot.echoes[0]?.mainStat || 'CR DMG';
  const otherCrit = first4 === 'CR Rate' ? 'CR DMG' : 'CR Rate';
  const threeCost = [...new Set([elementStat, scalar, ...kitScaledMainStats(slot.character)])];

  const variants: Array<[string, string[]]> = [
    ...threeCost.flatMap((a, i) => threeCost.slice(i).map(b => ['4 3 3 1 1', [first4, a, b, scalar, scalar]] as [string, string[]])),
    ['4 4 1 1 1', [first4, otherCrit, scalar, scalar, scalar]],
    ['4 1 1 1 1', [first4, scalar, scalar, scalar, scalar]]
  ];

  const seen = new Set<string>();
  return variants
    .filter(([layout, mains]) => {
      // Skip stats this cost can't roll.
      const valid = costsForLayout(layout).every((cost, i) => mainStatOptionsFor(cost).includes(mains[i]));
      const key = `${layout}|${mains.join(',')}`;
      if (!valid || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(([layout, mains]) => {
      const pair = layout === '4 4 1 1 1' ? [mains[0], mains[1]] : [mains[1], mains[2]];
      return {
        key: `${layout}|${mains.join(',')}`,
        label: `${layout.replace(/ /g, '')} (${pair.map(shortStat).join('/')})`,
        layout,
        mainStats: mains
      };
    });
}

const echoVariantKeyOf = (slot: TeamSlot): string => `${slot.layout}|${slot.echoes.map(e => e.mainStat).join(',')}`;

// Swaps layout and main stats, keeping substats.
function applyEchoBuild(slot: TeamSlot, build: EchoBuild): TeamSlot {
  const next: TeamSlot = {
    ...slot,
    layout: build.layout,
    echoes: slot.echoes.map((echo, i) => ({ ...echo, mainStat: build.mainStats[i] }))
  };
  next.echoStats = calculateEchoStatsForSlot(next);
  return next;
}

// Every weapon of the unit's type.
export const weaponsForUnit = (character: string): string[] =>
  DataLoader.weaponsByType[DataLoader.characterDB[character]?.weaponType] || [];

// Calculable weapons only.
const weaponOptionsFor = (character: string): string[] =>
  weaponsForUnit(character).filter(w => isSelectableContent('weapon', w));

// --- Comparison rows ----------------------------------------------------------------------

const withSlot = (config: GuideConfig, unitIdx: number, patch: Partial<GuideConfig['slots'][number]>): GuideConfig => ({
  ...config,
  slots: config.slots.map((s, i) => (i === unitIdx ? { ...s, ...patch } : s))
});

export interface SequenceDef {
  sequence: number;
  job: GuideJob;
  // Sequence of the submitted rotation used.
  rotationSequence: number;
}

function sequenceDefs(group: GuideTeamGroup, config: GuideConfig, unitIdx: number): SequenceDef[] {
  return Array.from({ length: SIM_CONSTANTS.MAX_SEQUENCE + 1 }, (_, sequence) => {
    const job = jobForConfig(group, withSlot(config, unitIdx, { sequence }));
    return { sequence, job, rotationSequence: job.entry.sequences[unitIdx] ?? 0 };
  });
}

export interface WeaponDef {
  weapon: string;
  removable: boolean;
  jobs: Array<{ rank: number; job: GuideJob }>;
}

export const rankEndpoints = (range: RangeValue): number[] => (range.min === range.max ? [range.min] : [range.min, range.max]);

// Team's weapon, then added ones, then the selected one.
function weaponDefs(group: GuideTeamGroup, config: GuideConfig, unitIdx: number, unit: string, ranks: number[], added: string[]): WeaponDef[] {
  const base = s0r1Config(group).slots[unitIdx].weapon;
  const selected = config.slots[unitIdx].weapon;
  const options = new Set(weaponOptionsFor(unit));
  const weapons = [...new Set([base, ...added.filter(w => options.has(w)), selected])];
  return weapons.map(weapon => ({
    weapon,
    removable: weapon !== base && weapon !== selected,
    jobs: ranks.map(rank => ({ rank, job: jobForConfig(group, withSlot(config, unitIdx, { weapon, rank })) }))
  }));
}

export interface EchoDef {
  variant: EchoVariant;
  job: GuideJob;
  isCurrent: boolean;
}

function echoDefs(group: GuideTeamGroup, config: GuideConfig, unitIdx: number, selectedJob: GuideJob): EchoDef[] {
  const slot = selectedJob.team[unitIdx];
  const currentKey = echoVariantKeyOf(slot);
  const defs: EchoDef[] = echoVariants(slot).map(variant => ({
    variant,
    job: jobForConfig(group, withSlot(config, unitIdx, { echo: { layout: variant.layout, mainStats: variant.mainStats } })),
    isCurrent: variant.key === currentKey
  }));
  // Non-standard submitted build gets its own row.
  if (!defs.some(d => d.isCurrent)) {
    defs.unshift({
      variant: { key: currentKey, label: 'Submitted build', layout: slot.layout, mainStats: slot.echoes.map(e => e.mainStat) },
      job: selectedJob,
      isCurrent: true
    });
  }
  return defs;
}

// --- Echo set variants --------------------------------------------------------------------

const setNameOf = (slot: RosterSlot): string => slotSets(slot).join(' + ') || 'No set';

export interface SetBuildOption {
  signature: string;
  label: string;
  detail: string;
  mainSet: string;
}

// Submitted set builds for a slot, in order.
export function setBuildOptions(group: GuideTeamGroup, unitIdx: number): SetBuildOption[] {
  const bySignature = new Map<string, SetBuildOption>();
  for (const entry of group.entries) {
    const slot = entry.team[unitIdx];
    const signature = setSignatureOf(slot);
    if (bySignature.has(signature)) continue;
    const label = setNameOf(slot);
    bySignature.set(signature, { signature, label, detail: [label, slot.mainEcho].filter(Boolean).join(' · '), mainSet: slot.mainSet });
  }
  const options = Array.from(bySignature.values());
  const labelCounts = new Map<string, number>();
  options.forEach(o => labelCounts.set(o.label, (labelCounts.get(o.label) || 0) + 1));
  options.forEach(o => { if ((labelCounts.get(o.label) || 0) > 1) o.label = o.detail; });
  return options;
}

export const setSignatureOfJob = (job: GuideJob, unitIdx: number): string => setSignatureOf(job.team[unitIdx]);

export interface EchoSetDef extends SetBuildOption {
  key: string;
  job: GuideJob;
  isCurrent: boolean;
}

// One row per submitted set build; empty if only one.
function echoSetDefs(group: GuideTeamGroup, config: GuideConfig, unitIdx: number, selectedJob: GuideJob): EchoSetDef[] {
  const options = setBuildOptions(group, unitIdx);
  if (options.length < 2) return [];

  const currentSignature = setSignatureOfJob(selectedJob, unitIdx);
  return options
    .map(option => {
      const isCurrent = option.signature === currentSignature;
      const job = isCurrent ? selectedJob : jobForConfig(group, withSlot(config, unitIdx, { setSignature: option.signature }));
      return { ...option, key: `set:${option.signature}`, job, isCurrent };
    })
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
}

// --- Views --------------------------------------------------------------------------------

export const FULL_RANK_RANGE: RangeValue = { min: 1, max: SIM_CONSTANTS.MAX_RANK };

// A guide view: selected config and comparison rows.
export interface GuideView {
  unitIdx: number;
  selectedJob: GuideJob;
  seqDefs: SequenceDef[];
  weapDefs: WeaponDef[];
  echoDefList: EchoDef[];
  setDefList: EchoSetDef[];
  // All jobs, in priority order.
  jobs: GuideJob[];
}

// Null when the character isn't on the team.
export function guideView(
  group: GuideTeamGroup, config: GuideConfig, character: string, rankRange: RangeValue, addedWeapons: string[]
): GuideView | null {
  const unitIdx = group.entries[0].team.findIndex(s => s.character === character);
  if (unitIdx < 0) return null;
  const selectedJob = jobForConfig(group, config);
  const seqDefs = sequenceDefs(group, config, unitIdx);
  const weapDefs = weaponDefs(group, config, unitIdx, character, rankEndpoints(rankRange), addedWeapons);
  const echoDefList = echoDefs(group, config, unitIdx, selectedJob);
  const setDefList = echoSetDefs(group, config, unitIdx, selectedJob);
  return {
    unitIdx, selectedJob, seqDefs, weapDefs, echoDefList, setDefList,
    jobs: [
      selectedJob,
      ...seqDefs.map(d => d.job),
      ...echoDefList.map(d => d.job),
      ...setDefList.map(d => d.job),
      ...weapDefs.flatMap(d => d.jobs.map(j => j.job))
    ]
  };
}

export const isValidConfig = (config: GuideConfig, groups: GuideTeamGroup[]): boolean => {
  const group = groups.find(g => g.key === config.groupKey);
  return !!group && config.slots.length === group.entries[0].team.length;
};
