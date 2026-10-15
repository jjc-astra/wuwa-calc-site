// Layout for the Timeline's effect rows (buffs, System hits, trackers), from row.timelineEvents.
import { elementColorOf, getCharacterThemeColor } from '../../utils/Common';
import { DataLoader } from '../../utils/DataLoader';
import { isTimelineTracker, timelineBuffInfo, timelineCooldownInfo } from '../../logic/TimelineEngine';
import { loopEndIndexOf } from '../../logic/rotationRows';
import { SYSTEM_NAMESPACE } from '../../utils/MechanicKey';
import { compressedTimeToPx, computeTotalDurationFrames, isInstantSystemRow, isSystemHit, stackDots } from './timelineLayout';
import type { TimeCompression } from './timelineLayout';
import { slotSets } from '../../utils/TeamUtils';
import { evaluatedBuffValue } from '../../logic/CombatCalculator';
import type { TeamSlot } from '../../types';

export const SECTION_ROW_HEIGHT_PX = 24;
export const EFFECT_ROW_HEIGHT_PX = 24;
export const EFFECT_BAR_INSET_PX = 4;
// Sync with .timeline-effect-point-label.
const POINT_LABEL_CHAR_PX = 5.5;
const EFFECT_BAR_HEIGHT_PX = EFFECT_ROW_HEIGHT_PX - 1 - EFFECT_BAR_INSET_PX * 2;
const SYSTEM_COLOR = '#8a8a8a';
const TRACKER_COLOR = '#dca54c';

/** One buff's state between two changes. */
export interface EffectInfo {
  name: string;
  provider?: string;
  target?: string;
  appliesTo?: string;
  stat?: string;
  value?: string | number;
  label?: string;
  maxStacks: number;
  permanent: boolean;
  source?: string;
  sourceOwner?: string;
}

export type EffectSourceKind = 'character' | 'weapon' | 'echo' | 'set' | 'system';

/** A unit's effect sub-groups after its character effects. */
export const UNIT_EFFECT_GROUPS: Array<{ id: string; kinds: EffectSourceKind[]; title: string }> = [
  { id: 'weapon', kinds: ['weapon'], title: 'Weapon' },
  { id: 'set', kinds: ['echo', 'set'], title: 'Echo Sets' }
];

/** A stack/charge change within a bar, or a tracker value. */
export interface EffectPoint {
  frames: number;
  xPx: number;
  yPx: number;
  value: number;
  // Seconds left, if finite.
  remaining?: number;
}

export interface EffectBar {
  startFrames: number;
  endFrames: number;
  xPx: number;
  widthPx: number;
  info: EffectInfo;
  points: EffectPoint[];
  // DSL value as evaluated per hit, in time order.
  values?: Array<{ frames: number; value: string | number }>;
}

const isDslValue = (value: unknown): boolean => typeof value === 'string' && value.includes('@');

/** A bar's value at `frames`, from the latest hit's evaluation (else the expression). */
export function barValueAt(bar: EffectBar, frames: number): string | number | undefined {
  if (!isDslValue(bar.info.value) || !bar.values?.length) return bar.info.value;
  let at = bar.values[0];
  for (const v of bar.values) {
    if (v.frames > frames) break;
    at = v;
  }
  return at.value;
}

export interface EffectHit {
  frames: number;
  xPx: number;
  yPx: number;
  total: number;
  moveName: string;
}

// An instant System move's clip, drawn in its hits row.
export interface EffectAction {
  xPx: number;
  row: any;
}

export type EffectLaneKind = 'buff' | 'cooldown' | 'tracker' | 'hits';

export interface EffectLane {
  id: string;
  // Name without its owner prefix; fullName keeps it.
  label: string;
  fullName: string;
  color: string;
  kind: EffectLaneKind;
  bars: EffectBar[];
  hits: EffectHit[];
  actions: EffectAction[];
  // Active the whole rotation with no gaps (hidden by the Permanent toggle).
  alwaysOn: boolean;
  sourceKind?: EffectSourceKind;
}

export interface EffectTimelineData {
  // Per unit: buffs, then cooldowns.
  unitLanes: Record<string, EffectLane[]>;
  enemy: EffectLane[];
  system: EffectLane[];
  trackers: EffectLane[];
}

const barCenterY = EFFECT_BAR_INSET_PX + EFFECT_BAR_HEIGHT_PX / 2;

// Every entity the team brings, by name.
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

// Strips the owner prefix ("Lumi_S6 Team ATK" -> "S6 Team ATK"). Longest names first.
function labelWithoutOwner(name: string, entityNames: string[]): string {
  const owner = entityNames.find(entity => name.startsWith(`${entity}_`) && name.length > entity.length + 1);
  return owner ? name.slice(owner.length + 1) : name;
}

const providerColor = (provider: string | undefined): string =>
  !provider || provider === SYSTEM_NAMESPACE ? SYSTEM_COLOR : getCharacterThemeColor(DataLoader.characterDB[provider]);

// One open bar per buff/tracker; closing fixes its geometry.
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

  lane(id: string, init: () => Omit<EffectLane, 'id' | 'bars' | 'hits' | 'actions' | 'alwaysOn'> & { section: string }, frames: number) {
    let lane = this.lanes.get(id);
    if (!lane) {
      lane = { id, bars: [], hits: [], actions: [], alwaysOn: false, firstFrames: frames, ...init() };
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

  // `dropEmpty`: drop zero-length bars.
  end(laneId: string, frames: number, dropEmpty = false): void {
    const bar = this.open.get(laneId);
    if (!bar) return;
    this.open.delete(laneId);
    const lane = this.lanes.get(laneId)!;
    if ((dropEmpty || lane.kind === 'tracker') && frames <= bar.startFrames) {
      lane.bars.splice(lane.bars.indexOf(bar), 1);
      return;
    }
    bar.endFrames = Math.max(bar.startFrames, frames);
    bar.xPx = this.px(bar.startFrames);
    bar.widthPx = Math.max(2, this.px(bar.endFrames) - bar.xPx);
  }

  endAll(frames: number, dropEmpty = false): void {
    for (const id of [...this.open.keys()]) this.end(id, frames, dropEmpty);
  }
}

// True when bars cover start to `endFrames` with no gaps (ignoring the Ending Rotation gap).
function coversWholeRotation(bars: EffectBar[], endFrames: number, compression: TimeCompression | null): boolean {
  let reach = 0;
  for (const bar of [...bars].sort((a, b) => a.startFrames - b.startFrames)) {
    const acrossGap = !!compression && reach >= compression.gapStartFrames - 1 && bar.startFrames <= compression.gapEndFrames + 1;
    if (bar.startFrames > reach + 1 && !acrossGap) return false;
    reach = Math.max(reach, bar.endFrames);
  }
  return bars.length > 0 && reach >= endFrames - 1;
}

/** Effect rows: buffs by target, System hits, trackers. */
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
    const onWhat = section === 'system' && target && target !== 'Enemy' && !units.has(target) ? ` (${target})` : '';
    // No owner: treat as the character's own.
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

  // Restarts/reductions start a new bar; charge changes add points.
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
    trackerLane(name, frames);
    builder.start(id, frames, { name, maxStacks: 1, permanent: false }, value);
  };

  // `shown`: drops events inside the Ending Rotation gap.
  const applyEvents = (from: any[], shown: (t: number) => boolean = () => true) => {
    const events = from.flatMap(r => r?.timelineEvents || []).filter(ev => shown(ev.t));
    // Stable sort keeps same-time order.
    events.sort((a, b) => a.t - b.t);
    events.forEach(ev => {
      if (ev.kind === 'buff') applyBuffEvent(ev);
      else if (ev.kind === 'cooldown') applyCooldownEvent(ev);
      else if (ev.kind === 'tracker') applyTrackerValue(ev.name, ev.t, ev.value);
    });
  };

  // Close everything at the gap; resume from the first Ending Rotation row's snapshot.
  const loopEndIndex = loopEndIndexOf(rows);
  const endingStart = compression && loopEndIndex !== -1 ? loopEndIndex + 1 : rows.length;
  applyEvents(rows.slice(0, endingStart), compression && endingStart < rows.length ? t => t <= compression.gapStartFrames : undefined);
  if (compression && endingStart < rows.length) {
    builder.endAll(compression.gapStartFrames, true);
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
    applyEvents(rows.slice(endingStart), t => t >= compression.gapEndFrames);
  }
  const endFrames = computeTotalDurationFrames(rows);
  builder.endAll(endFrames);

  // System hits: one row per mechanic, in element color.
  rows.forEach(row => (row?.damageInstances || []).filter(isSystemHit).forEach((hit: any) => {
    const frames = hit.gameTime ?? row.gameTimeStart;
    const moveName = hit.moveName || hit.title || SYSTEM_NAMESPACE;
    const color = (hit.dmgTypeList || []).map(elementColorOf).find(Boolean) ?? SYSTEM_COLOR;
    const lane = builder.lane(`hits:${moveName}`, () => ({
      section: 'system', label: moveName, fullName: moveName, color, kind: 'hits' as const
    }), frames);
    lane.hits.push({ frames, xPx: compressedTimeToPx(frames, compression), yPx: 0, total: hit.total || 0, moveName });
  }));
  // Instant System moves join their hits' row.
  rows.filter(isInstantSystemRow).forEach(row => {
    const moveName = row.moveName || SYSTEM_NAMESPACE;
    const lane = builder.lane(`hits:${moveName}`, () => ({
      section: 'system', label: moveName, fullName: moveName, color: SYSTEM_COLOR, kind: 'hits' as const
    }), row.gameTimeStart);
    lane.actions.push({ xPx: compressedTimeToPx(row.gameTimeStart, compression), row });
  });

  // DSL buff values per hit.
  const dslLanes = [...builder.lanes.entries()].filter(([, lane]) => lane.kind === 'buff' && lane.bars.some(bar => isDslValue(bar.info.value)));
  if (dslLanes.length > 0) {
    const valuesByKey = new Map<string, Array<{ frames: number; value: string | number }>>(dslLanes.map(([key]) => [key, []]));
    rows.forEach(row => (row?.damageInstances || []).forEach((hit: any) => {
      Object.entries(hit.data?.activeBuffs || {}).forEach(([key, buff]: [string, any]) => {
        valuesByKey.get(key)?.push({ frames: hit.gameTime ?? row.gameTimeStart, value: buff.value });
      });
    }));
    // No hits: evaluate on the starting row's state.
    const rowAt = (frames: number) => rows.reduce((at, row) => (row?.unit && (row.gameTimeStart ?? 0) <= frames ? row : at), rows.find(row => row?.unit));
    dslLanes.forEach(([key, lane]) => {
      const values = valuesByKey.get(key)!.sort((a, b) => a.frames - b.frames);
      lane.bars.forEach(bar => {
        bar.values = values.filter(v => v.frames >= bar.startFrames && v.frames <= bar.endFrames);
        const state = isDslValue(bar.info.value) && bar.values.length === 0 ? rowAt(bar.startFrames) : null;
        if (state) bar.values = [{ frames: bar.startFrames, value: evaluatedBuffValue(bar.info as any, state, team) ?? bar.info.value! }];
      });
    });
  }

  const data: EffectTimelineData = { unitLanes: {}, enemy: [], system: [], trackers: [] };
  // Appearance order, cooldowns after buffs.
  [...builder.lanes.values()]
    .sort((a, b) => Number(a.kind === 'cooldown') - Number(b.kind === 'cooldown') || a.firstFrames - b.firstFrames)
    .filter(lane => lane.bars.length > 0 || lane.hits.length > 0 || lane.actions.length > 0)
    .forEach(({ section, ...lane }) => {
      const unchanging = lane.kind === 'buff'
        || (lane.kind === 'tracker' && new Set(lane.bars.map(bar => bar.points[0]?.value)).size === 1);
      lane.alwaysOn = unchanging && coversWholeRotation(lane.bars, endFrames, compression);
      if (lane.kind === 'hits') stackDots(lane.hits.sort((a, b) => a.xPx - b.xPx), EFFECT_BAR_INSET_PX, EFFECT_BAR_HEIGHT_PX);
      if (section.startsWith('unit:')) (data.unitLanes[section.slice(5)] ||= []).push(lane);
      else if (section === 'enemy') data.enemy.push(lane);
      else if (section === 'trackers') data.trackers.push(lane);
      else data.system.push(lane);
    });
  return data;
}

/** True when a point's label fits before the next point or the bar's end. */
export function pointLabelFits(bar: EffectBar, index: number, label: string): boolean {
  const start = bar.points[index].xPx + (index > 0 ? 4 : 3);
  const end = bar.points[index + 1]?.xPx ?? bar.xPx + bar.widthPx;
  return end - start >= label.length * POINT_LABEL_CHAR_PX;
}

const sameEffect = (a: EffectInfo, b: EffectInfo) =>
  a.stat === b.stat && a.value === b.value && a.label === b.label && a.target === b.target;

// Span of `bar` through back-to-back refreshes.
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

/** Row ids a buff bar reached (hits that used it, else its target's casts). */
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
    const start = row.gameTimeStart ?? 0;
    if (start >= span.start && start < span.end) ids.add(row.id);
  });
  return [...ids];
}

/** Row ids that received a buff lane at all. */
export function rowsReceivingLane(rows: any[], lane: EffectLane): Set<string> {
  const ids = new Set<string>();
  if (lane.kind !== 'buff') return ids;
  rows.forEach(row => {
    if (row?.id && (row.damageInstances || []).some((hit: any) => hit.data?.activeBuffs?.[lane.id])) ids.add(row.id);
  });
  if (ids.size > 0) return ids;
  rows.forEach(row => {
    if (!row?.id || !row.unit) return;
    const start = row.gameTimeStart ?? 0;
    if (lane.bars.some(bar => (bar.info.target === 'Enemy' || row.unit === bar.info.target) && start >= bar.startFrames && start < bar.endFrames)) ids.add(row.id);
  });
  return ids;
}

// "Self" / "Team -> Sanhua" / "Next -> Lumi"
export function describeAppliesTo(info: EffectInfo): string {
  const selector = info.appliesTo;
  const target = info.target;
  if (!selector || !selector.startsWith('@')) return target === 'Enemy' ? 'Enemy' : (target || 'Unknown');
  const name = selector.slice(1).replace('TeamOthers', 'Team (others)');
  if (selector === '@Self' || selector === '@Enemy' || selector === '@Target') return name === 'Target' ? 'Enemy' : name;
  return target ? `${name} → ${target}` : name;
}
