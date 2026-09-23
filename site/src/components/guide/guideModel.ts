// src/components/guide/guideModel.ts
// The Character Guide has no data of its own: it groups the Rankings results that include a
// character and builds sequence / weapon / echo variants on top of them.
import { DataLoader } from '../../utils/DataLoader';
import { teamCharacters } from '../../utils/TeamUtils';
import { dpsFieldOf } from '../../data/dpsWindows';
import { costsForLayout, mainStatOptionsFor } from '../../data/db';
import { calculateEchoStatsForSlot } from '../../store/useRosterStore';
import type { RankingEntry } from '../../store/useRankingsStore';
import type { RotationSummary } from '../../logic/ResultsCalculator';
import type { TeamSlot } from '../../types';
import type { RangeValue } from '../common/RangeSlider';

export const MAX_SEQUENCE = 6;
export const MAX_RANK = 5;
const TWO_MIN_SECONDS = 120;

export const isFourStar = (character: string): boolean => DataLoader.characterDB[character]?.rarity === 4;

// --- Team groups ---------------------------------------------------------------------------

// One team composition + rotation style, submitted at one or more sequences.
export interface GuideTeamGroup {
  key: string;
  label: string;
  characters: string[];
  rotationType: RankingEntry['rotationType'];
  entries: RankingEntry[];
}

const groupKeyOf = (entry: RankingEntry): string =>
  `${entry.team.map(s => s.character || '').join('|')}#${entry.rotationType ?? 'unclassified'}`;

export function groupTeams(entries: RankingEntry[], character: string): GuideTeamGroup[] {
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
  // Best S0 DPS first -- the order the team selector lists them in.
  return Array.from(groups.values()).sort((a, b) => entryDps(pickS0Entry(b)) - entryDps(pickS0Entry(a)));
}

const entryDps = (entry: RankingEntry): number => entry.dpsStats[dpsFieldOf('twoMin')] ?? 0;

const slotCounts = (character: string | undefined): boolean => !!character && !isFourStar(character);

// The submission to run for the selected sequences: the highest-sequence one that doesn't exceed
// any 5-star member's selection, since a higher-sequence submission usually has its own rotation.
// Ties go to the higher DPS; if every submission is above the selection, the lowest one is used.
export function pickRotationEntry(group: GuideTeamGroup, sequences: number[]): RankingEntry {
  const seqSum = (e: RankingEntry) => e.team.reduce((sum, s, i) => sum + (slotCounts(s.character) ? e.sequences[i] ?? 0 : 0), 0);
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

const pickS0Entry = (group: GuideTeamGroup): RankingEntry => pickRotationEntry(group, [0, 0, 0]);

// --- Config (what the selectors pick) -----------------------------------------------------

export interface GuideSlotChoice {
  sequence: number;
  weapon: string;
  rank: number;
}

export interface GuideConfig {
  groupKey: string;
  // Indexed by team slot, same as the entries' `team`.
  slots: GuideSlotChoice[];
}

// S0R1 for every 5-star unit and weapon; 4-stars keep their submitted sequence and rank.
export function s0r1Config(group: GuideTeamGroup): GuideConfig {
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

// Default: the best linear team at S0R1, or the best team of any style if none is linear.
export function defaultConfig(groups: GuideTeamGroup[]): GuideConfig | null {
  const group = groups.find(g => g.rotationType === 'linear') ?? groups[0];
  return group ? s0r1Config(group) : null;
}

// A ranking entry's own investment, for jumping the selectors to a specific submission.
export const configFromEntry = (group: GuideTeamGroup, entry: RankingEntry): GuideConfig => ({
  groupKey: group.key,
  slots: entry.team.map(slot => ({ sequence: Number(slot.sequence) || 0, weapon: slot.weapon, rank: Number(slot.rank) || 1 }))
});

export const findGroupFor = (groups: GuideTeamGroup[], entry: RankingEntry): GuideTeamGroup | undefined =>
  groups.find(g => g.key === groupKeyOf(entry));

// --- Calc jobs ----------------------------------------------------------------------------

export interface GuideJob {
  // Identifies the calc, not the row -- two rows asking for the same team share one run.
  key: string;
  entry: RankingEntry;
  team: TeamSlot[];
}

export function buildTeam(entry: RankingEntry, slots: GuideSlotChoice[]): TeamSlot[] {
  return entry.team.map((slot, i) => {
    const choice = slots[i];
    if (!slot.character || !choice) return slot;
    return { ...slot, sequence: choice.sequence, weapon: choice.weapon, rank: choice.rank };
  });
}

export function makeJob(entry: RankingEntry, team: TeamSlot[]): GuideJob {
  const fingerprint = team.map(s => [s.character, s.sequence, s.weapon, s.rank, s.layout, s.echoes.map(e => e.mainStat)]);
  return { key: `${entry.id}::${JSON.stringify(fingerprint)}`, entry, team };
}

export function jobForConfig(group: GuideTeamGroup, config: GuideConfig): GuideJob {
  const entry = pickRotationEntry(group, config.slots.map(s => s.sequence));
  return makeJob(entry, buildTeam(entry, config.slots));
}

// --- Metrics ------------------------------------------------------------------------------

export type GuideMetric = 'dps' | 'dpr';
export type GuideScope = 'personal' | 'team';

// DPS = the 2-minute window. DPR = damage per rotation, the Avg Loop window's per-loop damage
// (null when the rotation has no loop).
export function metricValue(summary: RotationSummary | undefined, unit: string, metric: GuideMetric, scope: GuideScope): number | null {
  if (!summary) return null;
  if (metric === 'dps') {
    if (scope === 'team') return summary.dpsStats.twoMinDps;
    const slice = summary.contribution.twoMin.team.find(s => s.label === unit);
    return (slice?.dmg ?? 0) / TWO_MIN_SECONDS;
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

export interface EchoVariant {
  key: string;
  label: string;
  layout: string;
  mainStats: string[];
}

// 43311 with each 3-cost pair (Ele/Ele, Ele/scalar, scalar/scalar), and 44111 with the second
// 4-cost as the other crit stat or the scalar. The scalar (ATK/HP/DEF %) comes from the submitted
// 1-cost echoes; the first 4-cost keeps its submitted main stat.
export function echoVariants(slot: TeamSlot): EchoVariant[] {
  const element = DataLoader.characterDB[slot.character]?.element;
  const elementStat = `${element} DMG`;
  const costs = costsForLayout(slot.layout);
  const scalar = slot.echoes.find((_, i) => costs[i] === 1)?.mainStat || 'ATK %';
  const first4 = slot.echoes[0]?.mainStat || 'CR DMG';
  const otherCrit = first4 === 'CR Rate' ? 'CR DMG' : 'CR Rate';

  const variants: Array<[string, string[]]> = [
    ['4 3 3 1 1', [first4, elementStat, elementStat, scalar, scalar]],
    ['4 3 3 1 1', [first4, elementStat, scalar, scalar, scalar]],
    ['4 3 3 1 1', [first4, scalar, scalar, scalar, scalar]],
    ['4 4 1 1 1', [first4, otherCrit, scalar, scalar, scalar]],
    ['4 4 1 1 1', [first4, scalar, scalar, scalar, scalar]]
  ];

  const seen = new Set<string>();
  return variants
    .filter(([layout, mains]) => {
      // A stat this cost can't roll (e.g. an element with no 3-cost DMG option) isn't a real build.
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

export const echoVariantKeyOf = (slot: TeamSlot): string => `${slot.layout}|${slot.echoes.map(e => e.mainStat).join(',')}`;

// Swaps the layout and main stats but keeps every echo's substats where they were.
export function applyEchoVariant(slot: TeamSlot, variant: EchoVariant): TeamSlot {
  const next: TeamSlot = {
    ...slot,
    layout: variant.layout,
    echoes: slot.echoes.map((echo, i) => ({ ...echo, mainStat: variant.mainStats[i] }))
  };
  next.echoStats = calculateEchoStatsForSlot(next);
  return next;
}

// Weapons the unit can equip that have real mechanics (same gate as the Calculator's picker).
export function weaponOptionsFor(character: string): string[] {
  const type = DataLoader.characterDB[character]?.weaponType;
  return (DataLoader.weaponsByType[type] || []).filter(w => DataLoader.isContentImplemented('weapon', w));
}

// --- Comparison rows ----------------------------------------------------------------------

export const withSlot = (config: GuideConfig, unitIdx: number, patch: Partial<GuideConfig['slots'][number]>): GuideConfig => ({
  ...config,
  slots: config.slots.map((s, i) => (i === unitIdx ? { ...s, ...patch } : s))
});

export interface SequenceDef {
  sequence: number;
  job: GuideJob;
  // Sequence of the submitted rotation this row runs (differs from `sequence` below a breakpoint).
  rotationSequence: number;
}

export function sequenceDefs(group: GuideTeamGroup, config: GuideConfig, unitIdx: number): SequenceDef[] {
  return Array.from({ length: MAX_SEQUENCE + 1 }, (_, sequence) => {
    const job = jobForConfig(group, withSlot(config, unitIdx, { sequence }));
    return { sequence, job, rotationSequence: job.entry.sequences[unitIdx] ?? 0 };
  });
}

export interface WeaponDef {
  weapon: string;
  // One job per rank in the selected range's endpoints.
  jobs: Array<{ rank: number; job: GuideJob }>;
}

export const rankEndpoints = (range: RangeValue): number[] => (range.min === range.max ? [range.min] : [range.min, range.max]);

export function weaponDefs(group: GuideTeamGroup, config: GuideConfig, unitIdx: number, unit: string, ranks: number[]): WeaponDef[] {
  return weaponOptionsFor(unit).map(weapon => ({
    weapon,
    jobs: ranks.map(rank => ({ rank, job: jobForConfig(group, withSlot(config, unitIdx, { weapon, rank })) }))
  }));
}

export interface EchoDef {
  variant: EchoVariant;
  job: GuideJob;
  isCurrent: boolean;
}

export function echoDefs(selectedJob: GuideJob, unitIdx: number): EchoDef[] {
  const slot = selectedJob.team[unitIdx];
  const currentKey = echoVariantKeyOf(slot);
  const defs: EchoDef[] = echoVariants(slot).map(variant => ({
    variant,
    job: makeJob(selectedJob.entry, selectedJob.team.map((s, i) => (i === unitIdx ? applyEchoVariant(s, variant) : s))),
    isCurrent: variant.key === currentKey
  }));
  // The submitted build may not be one of the standard shapes -- keep it as its own row.
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

// A unit's set build: main set, its paired/extra sets and the main echo.
const setSignatureOf = (slot: TeamSlot): string =>
  [slot.mainSet, slot.subSet, slot.subSet2a, slot.subSet2b, slot.mainEcho].join('|');

const setNameOf = (slot: TeamSlot): string =>
  [slot.mainSet, slot.subSet, slot.subSet2a, slot.subSet2b].filter(Boolean).join(' + ') || 'No set';

export interface EchoSetDef {
  key: string;
  label: string;
  // Set + main echo, for the label's tooltip.
  detail: string;
  mainSet: string;
  job: GuideJob;
  isCurrent: boolean;
}

// One row per set build this team was submitted with, each run from its own submission (echoes
// and rotation) with the selected sequences and weapons applied. Empty for a single set build.
export function echoSetDefs(group: GuideTeamGroup, config: GuideConfig, unitIdx: number, selectedJob: GuideJob): EchoSetDef[] {
  const bySignature = new Map<string, RankingEntry[]>();
  for (const entry of group.entries) {
    const signature = setSignatureOf(entry.team[unitIdx]);
    bySignature.set(signature, [...(bySignature.get(signature) || []), entry]);
  }
  if (bySignature.size < 2) return [];

  const currentSignature = setSignatureOf(selectedJob.team[unitIdx]);
  const sequences = config.slots.map(s => s.sequence);
  const defs = Array.from(bySignature, ([signature, entries]) => {
    const isCurrent = signature === currentSignature;
    const entry = isCurrent ? selectedJob.entry : pickRotationEntry({ ...group, entries }, sequences);
    const job = isCurrent ? selectedJob : makeJob(entry, buildTeam(entry, config.slots));
    const slot = entry.team[unitIdx];
    return {
      key: `set:${signature}`,
      label: setNameOf(slot),
      detail: [setNameOf(slot), slot.mainEcho].filter(Boolean).join(' · '),
      mainSet: slot.mainSet,
      job,
      isCurrent
    };
  });

  // Name the main echo when two rows share a set.
  const labelCounts = new Map<string, number>();
  defs.forEach(d => labelCounts.set(d.label, (labelCounts.get(d.label) || 0) + 1));
  defs.forEach(d => { if ((labelCounts.get(d.label) || 0) > 1) d.label = d.detail; });

  return defs.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
}
