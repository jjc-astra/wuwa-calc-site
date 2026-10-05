// Layout for the Calculator Timeline's effect rows: buffs/debuffs, System hits and trackers, read
// off the engine's change log (TimelineEngine._logTimeline -> row.timelineEvents). Pure, no DOM.
import { elementColorOf, getCharacterThemeColor } from '../../utils/Common';
import { DataLoader } from '../../utils/DataLoader';
import { isTimelineTracker, timelineBuffInfo, timelineCooldownInfo } from '../../logic/TimelineEngine';
import { loopEndIndexOf } from '../../logic/rotationRows';
import { SYSTEM_NAMESPACE } from '../../utils/MechanicKey';
import { compressedTimeToPx, computeTotalDurationFrames, isSystemHit, stackDots } from './timelineLayout';
import type { TimeCompression } from './timelineLayout';
import { slotSets } from '../../utils/TeamUtils';
import type { TeamSlot } from '../../types';

export const SECTION_ROW_HEIGHT_PX = 24;
export const EFFECT_ROW_HEIGHT_PX = 24;
// A bar's gap from the top and bottom of its row.
export const EFFECT_BAR_INSET_PX = 4;
// The row less its 1px bottom border and both insets.
const EFFECT_BAR_HEIGHT_PX = EFFECT_ROW_HEIGHT_PX - 1 - EFFECT_BAR_INSET_PX * 2;
const SYSTEM_COLOR = '#8a8a8a';
const TRACKER_COLOR = '#dca54c';

/** What a bar is: one buff's state between two changes. */
export interface EffectInfo {
  name: string;
  provider?: string;
  // The unit (or Enemy) it landed on, and the selector it was applied with (@Team, @Next...).
  target?: string;
  appliesTo?: string;
  stat?: string;
  value?: string | number;
  label?: string;
  maxStacks: number;
  permanent: boolean;
  source?: string;
  // The entity it came from (a character, weapon, echo, echo set or System).
  sourceOwner?: string;
}

/** What kind of entity an effect came from; a unit's effects are grouped by it. */
export type EffectSourceKind = 'character' | 'weapon' | 'echo' | 'set' | 'system';

/** A unit's effect sub-groups, after its own (character) effects; the main echo's go with its sets'. */
export const UNIT_EFFECT_GROUPS: Array<{ id: string; kinds: EffectSourceKind[]; title: string }> = [
  { id: 'weapon', kinds: ['weapon'], title: 'Weapon' },
  { id: 'set', kinds: ['echo', 'set'], title: 'Echo Sets' }
];

/** A stack count (or charges in use) change inside a bar -- or a tracker's value; the first is the
 * bar's start. */
export interface EffectPoint {
  frames: number;
  xPx: number;
  yPx: number;
  value: number;
  // Seconds the buff/cooldown had left at this point, if it runs out at all.
  remaining?: number;
}

export interface EffectBar {
  startFrames: number;
  endFrames: number;
  xPx: number;
  widthPx: number;
  info: EffectInfo;
  points: EffectPoint[];
}

export interface EffectHit {
  frames: number;
  xPx: number;
  yPx: number;
  total: number;
  moveName: string;
}

export type EffectLaneKind = 'buff' | 'cooldown' | 'tracker' | 'hits';

export interface EffectLane {
  id: string;
  // The row's name, without its owner's prefix; fullName keeps it (the name's hover tooltip).
  label: string;
  fullName: string;
  color: string;
  kind: EffectLaneKind;
  bars: EffectBar[];
  hits: EffectHit[];
  // In effect the whole rotation, start to end with no gaps (hidden by the Permanent toggle) --
  // not just permanent-duration, which can still switch on and off.
  alwaysOn: boolean;
  // Buffs: what kind of entity it came from.
  sourceKind?: EffectSourceKind;
}

export interface EffectTimelineData {
  // Buffs on each unit, then its cooldowns, keyed by unit name.
  unitLanes: Record<string, EffectLane[]>;
  enemy: EffectLane[];
  system: EffectLane[];
  trackers: EffectLane[];
}

const barCenterY = EFFECT_BAR_INSET_PX + EFFECT_BAR_HEIGHT_PX / 2;

// Every entity the team brings, by name: its characters, weapons, main echoes, echo sets, System.
function teamEntityKinds(team: TeamSlot[]): Map<string, EffectSourceKind> {
  const kinds = new Map<string, EffectSourceKind>([[SYSTEM_NAMESPACE, 'system']]);
  team.forEach(slot => {
    if (!slot.character) return;
    slotSets(slot).forEach(set => kinds.set(set, 'set'));
    if (slot.mainEcho) kinds.set(slot.mainEcho, 'echo');
    if (slot.weapon) kinds.set(slot.weapon, 'weapon');
    kinds.set(slot.character, 'character');
  });
  return kinds;
}

// An effect's name without its owner's prefix ("Lumi_S6 Team ATK" -> "S6 Team ATK"), for any
// entity the team brings. Longest names first, so one that's another's prefix can't cut short.
function labelWithoutOwner(name: string, entityNames: string[]): string {
  const owner = entityNames.find(entity => name.startsWith(`${entity}_`) && name.length > entity.length + 1);
  return owner ? name.slice(owner.length + 1) : name;
}

const providerColor = (provider: string | undefined): string =>
  !provider || provider === SYSTEM_NAMESPACE ? SYSTEM_COLOR : getCharacterThemeColor(DataLoader.characterDB[provider]);

// One open bar per buff key / tracker name; closing it fixes its px geometry.
class LaneBuilder {
  lanes = new Map<string, EffectLane & { section: string; firstFrames: number }>();
  private open = new Map<string, EffectBar>();
  private compression: TimeCompression | null;

  constructor(compression: TimeCompression | null) {
    this.compression = compression;
  }

  private px(frames: number): number {
    return compressedTimeToPx(frames, this.compression);
  }

  lane(id: string, init: () => Omit<EffectLane, 'id' | 'bars' | 'hits' | 'alwaysOn'> & { section: string }, frames: number) {
    let lane = this.lanes.get(id);
    if (!lane) {
      lane = { id, bars: [], hits: [], alwaysOn: false, firstFrames: frames, ...init() };
      this.lanes.set(id, lane);
    }
    return lane;
  }

  isOpen(id: string): boolean {
    return this.open.has(id);
  }

  start(laneId: string, frames: number, info: EffectInfo, value: number, remaining?: number): void {
    this.end(laneId, frames);
    const bar: EffectBar = { startFrames: frames, endFrames: frames, xPx: 0, widthPx: 0, info, points: [] };
    this.open.set(laneId, bar);
    this.point(laneId, frames, value, remaining);
    this.lanes.get(laneId)!.bars.push(bar);
  }

  point(laneId: string, frames: number, value: number, remaining?: number): void {
    const bar = this.open.get(laneId);
    if (bar) bar.points.push({ frames, xPx: this.px(frames), yPx: barCenterY, value, remaining });
  }

  end(laneId: string, frames: number): void {
    const bar = this.open.get(laneId);
    if (!bar) return;
    this.open.delete(laneId);
    bar.endFrames = Math.max(bar.startFrames, frames);
    bar.xPx = this.px(bar.startFrames);
    bar.widthPx = Math.max(2, this.px(bar.endFrames) - bar.xPx);
  }

  endAll(frames: number): void {
    for (const id of [...this.open.keys()]) this.end(id, frames);
  }
}

// Whether bars run from the start to `endFrames` with no gaps (a frame of slack each way). The
// Ending Rotation's compressed gap doesn't count: every bar is closed at it and reopened after.
function coversWholeRotation(bars: EffectBar[], endFrames: number, compression: TimeCompression | null): boolean {
  let reach = 0;
  for (const bar of [...bars].sort((a, b) => a.startFrames - b.startFrames)) {
    const acrossGap = !!compression && reach >= compression.gapStartFrames - 1 && bar.startFrames <= compression.gapEndFrames + 1;
    if (bar.startFrames > reach + 1 && !acrossGap) return false;
    reach = Math.max(reach, bar.endFrames);
  }
  return bars.length > 0 && reach >= endFrames - 1;
}

/** The effect rows for a Calculator Timeline: each buff by who it's on, System hits, trackers. */
export function buildEffectTimeline(rows: any[], team: TeamSlot[], compression: TimeCompression | null): EffectTimelineData {
  const units = new Set(team.map(s => s.character).filter(Boolean));
  const entityKinds = teamEntityKinds(team);
  const entityNames = [...entityKinds.keys()].sort((a, b) => b.length - a.length);
  const builder = new LaneBuilder(compression);
  const lastValue = new Map<string, number>();

  const buffLane = (key: string, info: EffectInfo, frames: number) => builder.lane(key, () => {
    const target = info.target ?? '';
    const section = target === 'Enemy' ? 'enemy'
      : info.provider === SYSTEM_NAMESPACE ? 'system'
      : units.has(target) ? `unit:${target}`
      : 'system';
    // Off in System Effects, a buff on something other than a unit or the enemy names what it's on.
    const onWhat = section === 'system' && target && target !== 'Enemy' && !units.has(target) ? ` (${target})` : '';
    // No owner on record (e.g. a buff picked back up at the Ending Rotation) reads as the character's own.
    const sourceKind = (info.sourceOwner && entityKinds.get(info.sourceOwner)) || 'character';
    return {
      section,
      label: labelWithoutOwner(info.name, entityNames) + onWhat,
      fullName: info.name + onWhat,
      color: providerColor(info.provider),
      kind: 'buff' as const,
      sourceKind
    };
  }, frames);

  const trackerLane = (name: string, frames: number) => builder.lane(`tracker:${name}`, () => ({
    section: 'trackers', label: labelWithoutOwner(name, entityNames), fullName: name, color: TRACKER_COLOR, kind: 'tracker' as const
  }), frames);

  const applyBuffEvent = (ev: any) => {
    if (ev.change === 'end') {
      builder.end(ev.key, ev.t);
      return;
    }
    const info: EffectInfo = ev.info;
    buffLane(ev.key, info, ev.t);
    const remaining = info.permanent ? undefined : ev.remaining;
    if (ev.change === 'stacks' && builder.isOpen(ev.key)) builder.point(ev.key, ev.t, ev.stacks, remaining);
    else builder.start(ev.key, ev.t, info, ev.stacks, remaining);
  };

  // A cooldown's bar runs while it's ticking; a restart or reduction starts a new one, and for a
  // charge-based move each change in charges in use is a point.
  const applyCooldownEvent = (ev: any) => {
    const id = `cd:${ev.key}`;
    if (ev.change === 'end') {
      builder.end(id, ev.t);
      return;
    }
    builder.lane(id, () => {
      const section = !ev.isSystem && units.has(ev.unit) ? `unit:${ev.unit}` : 'system';
      const label = section === 'system' && units.has(ev.unit) ? `${ev.name} CD (${ev.unit})` : `${ev.name} CD`;
      return {
        section,
        label,
        fullName: label,
        color: ev.isSystem ? SYSTEM_COLOR : providerColor(ev.unit),
        kind: 'cooldown' as const
      };
    }, ev.t);
    const charges = ev.charges ?? 1;
    const isChargeChange = ev.charges !== undefined && builder.isOpen(id);
    if (isChargeChange) builder.point(id, ev.t, charges, ev.remaining);
    else builder.start(id, ev.t, { name: ev.name, provider: ev.unit, maxStacks: ev.maxCharges || 1, permanent: false }, charges, ev.remaining);
  };

  const applyTrackerValue = (name: string, frames: number, value: number) => {
    const id = `tracker:${name}`;
    const prev = lastValue.get(name) ?? 0;
    lastValue.set(name, value);
    if (value === prev && builder.isOpen(id)) return;
    if (value === 0) {
      builder.end(id, frames);
      return;
    }
    // Each value is its own bar, labeled with it.
    trackerLane(name, frames);
    builder.start(id, frames, { name, maxStacks: 1, permanent: false }, value);
  };

  const applyEvents = (from: any[]) => {
    const events = from.flatMap(r => r?.timelineEvents || []);
    // Stable: same-time events keep the order they happened in.
    events.sort((a, b) => a.t - b.t);
    events.forEach(ev => {
      if (ev.kind === 'buff') applyBuffEvent(ev);
      else if (ev.kind === 'cooldown') applyCooldownEvent(ev);
      else if (ev.kind === 'tracker') applyTrackerValue(ev.name, ev.t, ev.value);
    });
  };

  // An Ending Rotation's rows come from a separate run, after loops that have no rows of their
  // own (the compressed gap): close everything at the gap, and pick its state back up from the
  // first Ending Rotation row's snapshot.
  const loopEndIndex = loopEndIndexOf(rows);
  const endingStart = compression && loopEndIndex !== -1 ? loopEndIndex + 1 : rows.length;
  applyEvents(rows.slice(0, endingStart));
  if (compression && endingStart < rows.length) {
    builder.endAll(compression.gapStartFrames);
    lastValue.clear();
    const snapshot = rows[endingStart]?.dropdownState;
    const at = compression.gapEndFrames;
    Object.entries(snapshot?.activeBuffs || {}).forEach(([key, buff]: [string, any]) => {
      const info = timelineBuffInfo(buff);
      buffLane(key, info, at);
      builder.start(key, at, info, buff.stacks || 0, info.permanent ? undefined : buff.duration);
    });
    const seedCooldown = (key: string, remaining: number, charges?: number) => {
      const unit = [...units].find(u => key.startsWith(`${u}_`)) ?? key.split('_')[0];
      applyCooldownEvent({ t: at, ...timelineCooldownInfo(key, unit, key.slice(unit.length + 1)), remaining, charges });
    };
    Object.entries(snapshot?.cooldowns || {}).forEach(([key, left]) => seedCooldown(key, Number(left)));
    Object.entries(snapshot?.chargeCooldowns || {}).forEach(([key, pending]) => {
      const list = pending as number[];
      if (list.length > 0) seedCooldown(key, Math.min(...list), list.length);
    });
    Object.entries(snapshot?.trackers || {}).forEach(([name, value]) => {
      const num = Number(value);
      if (isTimelineTracker(name) && !isNaN(num)) applyTrackerValue(name, at, num);
    });
    applyEvents(rows.slice(endingStart));
  }
  const endFrames = computeTotalDurationFrames(rows);
  builder.endAll(endFrames);

  // System hits: one row per mechanic, in its element's color.
  rows.forEach(row => (row?.damageInstances || []).filter(isSystemHit).forEach((hit: any) => {
    const frames = hit.gameTime ?? row.gameTimeStart;
    const moveName = hit.moveName || hit.title || SYSTEM_NAMESPACE;
    // "Glacio Chafe" -> Glacio's.
    const color = (hit.dmgTypeList || []).map(elementColorOf).find(Boolean) ?? SYSTEM_COLOR;
    const lane = builder.lane(`hits:${moveName}`, () => ({
      section: 'system', label: moveName, fullName: moveName, color, kind: 'hits' as const
    }), frames);
    lane.hits.push({ frames, xPx: compressedTimeToPx(frames, compression), yPx: 0, total: hit.total || 0, moveName });
  }));

  const data: EffectTimelineData = { unitLanes: {}, enemy: [], system: [], trackers: [] };
  // In order of appearance, a section's cooldowns after its buffs.
  [...builder.lanes.values()]
    .sort((a, b) => Number(a.kind === 'cooldown') - Number(b.kind === 'cooldown') || a.firstFrames - b.firstFrames)
    .forEach(({ section, ...lane }) => {
      lane.alwaysOn = lane.kind === 'buff' && coversWholeRotation(lane.bars, endFrames, compression);
      if (lane.kind === 'hits') stackDots(lane.hits.sort((a, b) => a.xPx - b.xPx), EFFECT_BAR_INSET_PX, EFFECT_BAR_HEIGHT_PX);
      if (section.startsWith('unit:')) (data.unitLanes[section.slice(5)] ||= []).push(lane);
      else if (section === 'enemy') data.enemy.push(lane);
      else if (section === 'trackers') data.trackers.push(lane);
      else data.system.push(lane);
    });
  return data;
}

// The same effect on both sides of a refresh: only its timer restarted.
const sameEffect = (a: EffectInfo, b: EffectInfo) =>
  a.stat === b.stat && a.value === b.value && a.label === b.label && a.target === b.target;

// The stretch `bar` belongs to, through refreshes: back-to-back bars of the same effect.
function refreshSpan(lane: EffectLane, bar: EffectBar): { start: number; end: number } {
  const bars = [...lane.bars].sort((a, b) => a.startFrames - b.startFrames);
  const i = bars.indexOf(bar);
  let first = i;
  let last = i;
  const joins = (a: EffectBar, b: EffectBar) => b.startFrames <= a.endFrames + 1 && sameEffect(a.info, b.info);
  while (first > 0 && joins(bars[first - 1], bars[first])) first--;
  while (last < bars.length - 1 && joins(bars[last], bars[last + 1])) last++;
  return { start: bars[first].startFrames, end: Math.max(...bars.slice(first, last + 1).map(b => b.endFrames)) };
}

/**
 * The rotation rows (ids, in order) a buff bar reached, through refreshes: those whose hits during
 * it used the buff. A buff no hit used (not a damage stat) falls back to its target's moves cast during
 * it -- anyone's, on the Enemy.
 */
export function rowsReceivingBar(rows: any[], lane: EffectLane, bar: EffectBar): string[] {
  if (lane.kind !== 'buff') return [];
  const ids = new Set<string>();
  const span = refreshSpan(lane, bar);
  const during = (frames: number) => frames >= span.start && frames <= span.end;
  rows.forEach(row => {
    if (row?.id && (row.damageInstances || []).some((hit: any) =>
      during(hit.gameTime ?? row.gameTimeStart) && hit.data?.activeBuffs?.[lane.id])) ids.add(row.id);
  });
  if (ids.size > 0) return [...ids];
  const target = bar.info.target;
  rows.forEach(row => {
    if (!row?.id || !row.unit || (target !== 'Enemy' && row.unit !== target)) return;
    // Cast while it was up -- a move's full animation can run on past the next move's start.
    const start = row.gameTimeStart ?? 0;
    if (start >= span.start && start < span.end) ids.add(row.id);
  });
  return [...ids];
}

// "Self" / "Team -> Sanhua" / "Next -> Lumi": the selector a buff was applied with, and where it
// landed when that isn't obvious from the selector.
export function describeAppliesTo(info: EffectInfo): string {
  const selector = info.appliesTo;
  const target = info.target;
  if (!selector || !selector.startsWith('@')) return target === 'Enemy' ? 'Enemy' : (target || 'Unknown');
  const name = selector.slice(1).replace('TeamOthers', 'Team (others)');
  if (selector === '@Self' || selector === '@Enemy' || selector === '@Target') return name === 'Target' ? 'Enemy' : name;
  return target ? `${name} → ${target}` : name;
}
