import { DataLoader } from '../utils/DataLoader';
import { getMechanicOwners } from './MechanicOwners';
import {
  RESOURCE_KEYS, WAITABLE_RESOURCE_KEYS, addResource, readResource, readRequested, resourceCap, isEnemyResource,
  energyRegenMult, energyRegenPct, resourceLabel, resourceRequirement, capHitIndex, buildupRateMult
} from './resources';
import { beforeKey, deltaKey, forteKey, holdSlotNumber, lateDeltaKey, requestedDeltaKey } from '../utils/ResourceKeys';
import { backfillPools, cloneJson, dropdownSnapshot, hitState, inheritPools, plainCopy, ROW_LINK_KEYS } from './rowState';
import { toRunInput, timingLabel, splitLoopSegments, loopTiming } from './rotationRows';
import { asDslResult, castModifiers as castModifiersOf, scopedKey, eventModifier, isBuffEffect, isDslExpr, isPlaceholderProvider, modifierSet, readsSelfStats, rowStartEvents, ruleEventsMatch, sortedPrioritySteps, stacksAfterSpending, type RuleEvent } from './engineValues';
import { MechanicKey, SYSTEM_NAMESPACE } from '../utils/MechanicKey';
import { CommonUtils } from '../utils/Common';
import { teamCharacters } from '../utils/TeamUtils';
import { DSLParser } from './dsl/dslParser';
import { ContextManager } from './ContextManager';
import { markBuffsChanged } from './CombatCalculator';
import { EventManager, ALWAYS_SOURCE, ALWAYS_CHECK } from './EventManager';
import { calculateEchoStatsForSlot } from '../store/useRosterStore';
import { CHARACTER_DEFAULTS, ENEMY_DEFAULTS, GAME_DEFAULTS, MECHANICS_NOTATION } from '../data/db';
import type { Effect, MechanicNode, HoldConfig, MoveOrigin, EnemyStats } from '../types';
import { sortedStanceChanges } from '../utils/Stance';
import { type Frames, toFrames, roundFrames, secondsToFrames, framesToSeconds, formatFramesAsSeconds, frozenFramesWithin, hitFrameOffsets } from '../utils/Frames';

export interface QueuedHit {
  originRow: any;
  originActionId: string;
  originMoveData: MechanicNode;
  hitIndex: number;
  totalHits: number;
  hitMult: number | string;
  origin: MoveOrigin;
  hitModifiers: Set<string>;
  executeAt: Frames;
  isProc: boolean;
}

// Run mode:
// - full: everything (table, Results, Ending Rotation preview)
// - lean: timings, resources, messages only (loop analysis)
export type EngineMode = 'full' | 'lean';

// Max nested event depth before the chain is cut as a loop.
const MAX_EVENT_DEPTH = 32;
// Context for math that only reads @Default.
const DEFAULTS_ONLY_CTX = { default: GAME_DEFAULTS };
const defaultsOnlyCache = new Map<string, boolean>();
// True when the math reads only @Default values.
function readsOnlyDefaults(mathStr: string): boolean {
  let result = defaultsOnlyCache.get(mathStr);
  if (result === undefined) {
    const js = DSLParser._translatePointers(mathStr);
    result = /\bctx\b/.test(js) && !/\bctx\b(?!\.default\.)/.test(js);
    defaultsOnlyCache.set(mathStr, result);
  }
  return result;
}

const RUN_PROFILES: Record<EngineMode, { dropdownSnapshots: boolean; hitLog: boolean }> = {
  full: { dropdownSnapshots: true,  hitLog: true },
  lean: { dropdownSnapshots: false, hitLog: false }
};

// Engine-internal hold-cursor trackers.
const HOLD_BOOKKEEPING_TRACKERS = new Set(['Hold_Start', 'Hold_Unit', 'Hold_Input', 'Cursor_Pos', 'Cursor_Accumulated', 'Forte_Win_Center', 'Forte_Win_Size']);

/** True for authored trackers shown on the Timeline (not engine bookkeeping). */
export const isTimelineTracker = (name: string): boolean =>
  !name.startsWith('__sys_') && !name.endsWith('_Delta') && !HOLD_BOOKKEEPING_TRACKERS.has(name);

/** Timeline identity of a buff bar. */
export const timelineBuffInfo = (buff: Effect) => ({
  name: buff.name || '',
  provider: buff.provider,
  target: buff.target,
  appliesTo: buff.appliesTo,
  stat: buff.stat,
  value: buff.value,
  label: buff.label,
  maxStacks: Number(buff.maxStacks) || 1,
  permanent: (buff.maxDuration ?? 0) >= GAME_DEFAULTS.permanentDuration,
  source: buff.source,
  sourceOwner: buff.sourceOwner
});

/** Timeline info for a cooldown: owner, System flag, charges. */
export const timelineCooldownInfo = (key: string, unit: string, name: string) => ({
  key, unit, name,
  isSystem: unit === SYSTEM_NAMESPACE || !!DataLoader.mechanicsDB[MechanicKey.build(SYSTEM_NAMESPACE, name)],
  maxCharges: Number(DataLoader.mechanicsDB[key]?.maxCharges) || 1
});

// Number of hits that land: cast cut-off, or a proc's allowedHits.
const hitLimit = (hit: QueuedHit): number =>
  hit.isProc ? hit.originMoveData.allowedHits ?? Infinity : hit.originRow.allowedHits;

// Swap or Swap + Cancel (SwapCancel_<n>).
const isSwapTiming = (timing: unknown): boolean => timing === 'Swap' || String(timing ?? '').startsWith('SwapCancel_');

// Longest a row waits on queued hits to become castable (_computeCastWait).
const WAIT_HORIZON = secondsToFrames(3);

// Simulates a rotation row by row: timings, resources, buffs, events, hit queue.
const COOLDOWN_WARNING_TAIL = '(on cooldown).';
/** A cooldown wait warning: the move is just late, not impossible. */
export const isCooldownWarning = (msg: string): boolean => msg.endsWith(COOLDOWN_WARNING_TAIL);

export class TimelineEngineClass {
  damageQueue: QueuedHit[] = [];
  currentGlobalGameTime = 0;
  currentGlobalRealTime = 0;
  isRecalculating = false;
  lastSwapOutTime: Record<string, number> = {};
  _localBuffCache: Record<string, Effect> = {};
  _globalBuffCache: Record<string, Effect | null> = {};
  _enemyConfig: EnemyStats = ENEMY_DEFAULTS;
  _run = RUN_PROFILES.full;
  // Per-run cache of _getModifiedMoveData by actionId.
  _moveDataCache = new Map<string, MechanicNode | null>();
  // Nested events currently firing, outermost first.
  _eventChain: string[] = [];
  // Timeline change log state (_logTimeline).
  _buffWatch = new Map<string, { sig: string; stacks: number }>();
  _trackerWatch = new Map<string, number>();
  _refreshedBuffs = new Set<string>();
  _buffRanOutAt = new Map<string, number>();
  // While _computeCastWait's dry run lands hits: skips what it can't undo (other rows' bookkeeping, the Timeline log).
  _dryRun = false;
  // Compiled hitConditions per mechanic.
  _hitConditions = new WeakMap<MechanicNode, { _compiledRule?: any }>();
  // Last logged cooldown timers and their owners.
  _cooldownWatch = new Map<string, { remaining: number; until: number; at: number; charges?: number }>();
  _cooldownOwners = new Map<string, { unit: string; name: string }>();
  // Per row: Generated adjustments from hits credited to or away from it, and whether its window closed.
  _preCastOnField: string | undefined;
  _deltaCredits = new WeakMap<object, { adj: Record<string, number>; done: boolean }>();
  // Each resource measured per move: what it actually changed (pool) and what it tried to (uncapped).
  _deltaMeasures = RESOURCE_KEYS.flatMap(key => [
    { read: (state: any, unit: string) => readResource(state, key, unit), delta: deltaKey(key), late: lateDeltaKey(key) },
    { read: (state: any, unit: string) => readRequested(state, key, unit), delta: requestedDeltaKey(key), late: undefined as string | undefined }
  ]);

  recalculateState(
    activeRows: any[],
    team: any[] = [],
    options: { startEnergy?: boolean; startConcerto?: boolean; mode?: EngineMode } = {},
    enemyConfig: EnemyStats = ENEMY_DEFAULTS
  ): any[] {
    if (activeRows.length === 0) return [];

    this.isRecalculating = true;
    this._run = RUN_PROFILES[options.mode ?? 'full'];
    this._moveDataCache = new Map();
    this._enemyConfig = enemyConfig;
    this.damageQueue = [];
    this.currentGlobalGameTime = 0;
    this.currentGlobalRealTime = 0;
    this.lastSwapOutTime = {};
    this._localBuffCache = {};
    this._eventChain = [];
    this._buffWatch = new Map();
    this._trackerWatch = new Map();
    this._refreshedBuffs = new Set();
    this._buffRanOutAt = new Map();
    this._cooldownWatch = new Map();
    this._cooldownOwners = new Map();
    this._deltaCredits = new WeakMap();

    team.forEach(slot => {
      if (slot?.character) slot.echoStats = calculateEchoStatsForSlot(slot);
    });

    const activeTeam = this._setupEventBoard(team);
    let accumulatedTime = 0;
    let accumulatedGameTime = 0;
    const unitBusyUntil: Record<string, number> = {};
    // Latest row per unit (for motion stop pauses).
    const lastRowByUnit: Record<string, any> = {};
    // Longest-running off-field animation per unit, with its end in real frames.
    const animationByUnit: Record<string, { row: any; end: number }> = {};
    // Swap-back lockout per unit. Combat starts on slot 1.
    const swapBackReadyAt: Record<string, number> = {};

    // @Prev, @Next, @Self.PrevAction
    activeRows.forEach((row, i) => {
      row.arrayIndex = i;
      row.prevRow = i > 0 ? activeRows[i - 1] : null;
      row.nextRow = i < activeRows.length - 1 ? activeRows[i + 1] : null;
    });
    // @Self.NextAction: the unit's own next action, not necessarily the next row.
    const upcomingActions: Record<string, string> = {};
    for (let i = activeRows.length - 1; i >= 0; i--) {
      const row = activeRows[i];
      row.nextUnitActions = { ...upcomingActions };
      if (row.unit && row.action) upcomingActions[row.unit] = row.action;
    }

    for (let i = 0; i < activeRows.length; i++) {
      const currentData = activeRows[i];
      currentData.dropdownState = null;
      currentData.energyLog = [];
      currentData.timelineEvents = [];
      currentData.enemyLevel = enemyConfig.level;
      currentData.enemyRes = enemyConfig.res;
      const prevData = i > 0 ? activeRows[i - 1] : this._getDefaultData(team[0]?.character);
      // Until this row casts, the previous unit is still on field.
      this._preCastOnField = prevData.unit || undefined;

      if (!currentData.unit) {
        this._applyInheritance(currentData, prevData, accumulatedGameTime, team);
        currentData.timeStart = accumulatedTime;
        currentData.gameTimeStart = accumulatedGameTime;
        if (this._run.dropdownSnapshots) currentData.dropdownState = plainCopy(currentData, ROW_LINK_KEYS);
        continue;
      }

      currentData.damageInstances = [];
      currentData._pendingHits = [];
      // Clear stale errors from the last run.
      currentData._holdUnreachable = undefined;
      currentData._gaugesSettled = undefined;
      currentData.motionStopPauses = undefined;
      currentData.backOnFieldAt = undefined;

      // Set by the release lookahead; reused by cursor tracking below.
      let holdConfigCache: { config: HoldConfig; mode: string; speed: number; maxVal: number; center: number; size: number } | null = null;
      const holdWaitReasons: Array<{ label: string; valueFrames: Frames }> = [];

      const dbMove =
        this._getModifiedMoveData(currentData.action) ||
        ({ name: currentData.action } as MechanicNode);

      currentData.moveName = dbMove.name || currentData.action;
      // Simultaneous-only moves (some echoes) always cast in parallel.
      if (dbMove.simultaneous) currentData.timing = 'Simultaneous';
      currentData.castTypes = dbMove.castTypes || (currentData.action ? [currentData.action] : []);
      currentData.dmgTypes = dbMove.dmgTypes || [];
      // Timeline input-press flags only.
      currentData.input = dbMove.input;
      currentData.inputType = dbMove.inputType;

      this._applyInheritance(currentData, prevData, accumulatedGameTime, team);

      if (i === 0) {
        activeTeam.forEach(charName => {
          if (options.startEnergy) currentData.energy[charName] = resourceCap(charName, 'energy');
          if (options.startConcerto) currentData.concerto[charName] = resourceCap(charName, 'concerto');
        });
        this._primeCombatStart(currentData, team);
      }

      if (prevData.unit && prevData.unit !== currentData.unit) {
        // swapCooldown is in seconds; convert to frames.
        swapBackReadyAt[prevData.unit] = accumulatedTime + secondsToFrames(GAME_DEFAULTS.swapCooldown);
      }

      // Seconds. Multi-charge moves wait only when every charge is in use.
      const actualCdRemaining = ContextManager.cooldownRemaining(currentData, currentData.unit, currentData.moveName);
      const wCD = secondsToFrames(actualCdRemaining);
      let wBusy = 0;
      let busyUntil = unitBusyUntil[currentData.unit] || 0;
      const isOutroCast = !!dbMove.castTypes?.includes('Outro');
      // An Intro cuts the unit's off-field move short.
      const isIntroCast = !!dbMove.castTypes?.includes('Intro');
      const swappedOut = lastRowByUnit[currentData.unit];
      const introCutsSwappedOut = isIntroCast && !!swappedOut && busyUntil > accumulatedTime;
      // Swapback cancel: cut the off-field move at its cancel point, or now if past.
      const cutsSwappedOut = swappedOut?._swapCancelAt !== undefined && busyUntil > accumulatedTime && !isOutroCast && !isIntroCast;
      // Off-field motion stops: paused time on top of its own animation.
      const swappedOutPaused = swappedOut ? Math.max(0, busyUntil - (swappedOut.timeStart + swappedOut.animationCommitment)) : 0;
      if (cutsSwappedOut) {
        // They push the cancel point back too.
        busyUntil = Math.min(busyUntil, Math.max(accumulatedTime, swappedOut.timeStart + swappedOut._swapCancelAt + swappedOutPaused));
      }
      if (busyUntil > accumulatedTime && !isOutroCast && !isIntroCast) {
        wBusy = busyUntil - accumulatedTime;
      }

      let finalWaitTime = Math.max(wCD, wBusy);
      currentData.waitTime = finalWaitTime;
      currentData.cdWaitTime = wCD;
      // An Animation Lock is waited out back on field: hits landing in it are on-field hits, and the
      // swapped-out move finishes on field (game time it's back, for the Timeline).
      if (wBusy > 0 && wBusy >= wCD) {
        this._preCastOnField = currentData.unit;
        if (swappedOut) swappedOut.backOnFieldAt = accumulatedGameTime;
      }
      if (i > 0) this._decayState(currentData, toFrames(finalWaitTime), toFrames(finalWaitTime), activeTeam, activeRows, team);
      if (cutsSwappedOut || introCutsSwappedOut) this._cutSwappedOutMove(swappedOut, accumulatedTime + finalWaitTime, swappedOutPaused);

      // Wait for queued resource gains to cover a shortfall (not Energy).
      const { waitFrames: resourceWaitFrames, label: resourceWaitLabel } = this._computeCastWait(currentData, dbMove, team, activeTeam, activeRows);
      if (resourceWaitFrames > 0) {
        finalWaitTime += resourceWaitFrames;
        currentData.waitTime = finalWaitTime;
      }

      // Backfill prevData gauges to what's available right before this action.
      if (i > 0) {
        backfillPools(prevData, currentData);
        // Its "after" gauges are set; what its hits add from here lands later.
        prevData._gaugesSettled = true;
        prevData.enemyTune = currentData.enemyTune;
        prevData.enemyMaxTune = currentData.enemyMaxTune;
      }
      // Gauges right before the cast (after any wait), for the row's panels.
      RESOURCE_KEYS.forEach(key => { currentData[beforeKey(key)] = readResource(currentData, key, currentData.unit); });

      if (dbMove.inputType === 'Release' && dbMove.holdConfig && currentData.trackers && currentData.trackers.Hold_Start !== undefined && currentData.trackers.Hold_Unit === currentData.unit) {
        const holdStart = currentData.trackers.Hold_Start;
        holdConfigCache = this._resolveHoldCursor(dbMove.holdConfig || {}, currentData, team);
        const { mode, speed, maxVal } = holdConfigCache;

        let currentBaseStart = accumulatedGameTime + finalWaitTime;
        if (currentData.timing === 'Simultaneous' && i > 0) {
          const userDelay = currentData.manualOffset !== undefined ? currentData.manualOffset : 0;
          currentBaseStart = prevData.gameTimeStart + prevData.gameTimePassed + finalWaitTime + userDelay;
        }

        const accumulated = currentData.trackers.Cursor_Accumulated || 0;
        let holdReleaseDelay = 0;
        let holdReachable = false;
        for (let delay = 0; delay <= GAME_DEFAULTS.holdLookaheadMax; delay += GAME_DEFAULTS.holdLookaheadStep) {
          const checkTime = currentBaseStart + delay;
          const holdDuration = checkTime - holdStart;
          const cursor = CommonUtils.resolveHoldCursorAtTime(accumulated, holdDuration, speed, mode, maxVal);
          if (CommonUtils.isHoldCursorDone(cursor, holdConfigCache)) {
            holdReleaseDelay = delay;
            holdReachable = true;
            break;
          }
        }
        if (currentData.timing === 'Manual') {
          // Manual release: user's value, clamped to [0, auto delay].
          const manualDelay = Math.max(0, currentData.manualOffset || 0);
          const ceilingDelay = holdReachable ? holdReleaseDelay : GAME_DEFAULTS.holdLookaheadMax;
          const appliedDelay = Math.min(manualDelay, ceilingDelay);
          if (appliedDelay > 0) {
            finalWaitTime += appliedDelay;
            currentData.waitTime = finalWaitTime;
            holdWaitReasons.push({ label: 'Manual Hold Wait', valueFrames: toFrames(appliedDelay) });
          }
          // Manual mode: an auto-search miss isn't an error.
        } else if (holdReachable && holdReleaseDelay > 0) {
          finalWaitTime += holdReleaseDelay;
          currentData.waitTime = finalWaitTime;
          holdWaitReasons.push({ label: mode === 'clamp' ? 'Forte Full Wait' : 'Forte Window Wait', valueFrames: toFrames(holdReleaseDelay) });
        } else if (!holdReachable) {
          // Unreachable target; reported by _runValidation.
          currentData._holdUnreachable = mode === 'clamp' ? 'full/empty forte' : 'release window';
        }
      }

      const timings = this._resolveTimings(currentData, dbMove, team);
      let duration = timings.duration;
      let animationCommitment = timings.animationCommitment;
      const nextRow = currentData.nextRow;
      const isSwappingOut =
        isSwapTiming(currentData.timing) ||
        (currentData.timing === 'Auto' && currentData._autoTimingChoice === 'Swap') ||
        (nextRow && nextRow.unit !== currentData.unit && nextRow.unit !== '');

      const incomingUnit = nextRow?.unit && nextRow.unit !== currentData.unit ? nextRow.unit : null;
      let swapCdDelay = 0;
      // An Outro brings the next unit in through its Intro, ignoring swap cooldown.
      if (isSwappingOut && incomingUnit && !isOutroCast) {
        const desiredSwapOutTime = accumulatedTime + finalWaitTime + duration;
        const readyAt = swapBackReadyAt[incomingUnit] ?? 0;
        if (desiredSwapOutTime < readyAt) {
          swapCdDelay = readyAt - desiredSwapOutTime;
          duration += swapCdDelay;
          // The animation plays on during the wait; it only runs longer if the wait outlasts it.
          animationCommitment = Math.max(animationCommitment, duration);
        }
      }

      currentData.baseDuration = timings.baseDuration;
      currentData.duration = duration;
      currentData.animationCommitment = animationCommitment;
      currentData.gameTimePassed = toFrames(duration - frozenFramesWithin(duration, timings.freezeStart, timings.freezeTime));
      currentData.freezeTime = timings.freezeTime;
      currentData.freezeStart = timings.freezeStart;
      currentData.motionStop = timings.motionStop;
      currentData.damageTimeframe = timings.damageTimeframe;
      currentData.hitFrameOverrides = timings.hitFrameOverrides;
      currentData.allowedHits = timings.allowedHits;
      currentData._swapCancelAt = timings.swapCancelAt;

      if (dbMove.stanceReq && dbMove.stanceReq !== 'Any') currentData.stance = dbMove.stanceReq;

      // Stance changes that play out before the cancel/swap; the last sets the end stance.
      for (const change of sortedStanceChanges(dbMove)) {
        if (currentData.duration >= change.frame) currentData.stance = change.stance;
      }

      if (currentData.timing === 'Simultaneous' && i > 0) {
        // Unset: starts with the previous move.
        currentData.manualOffset ??= -timings.baseDuration;
        const baseTimeStart = prevData.timeStart + prevData.duration + finalWaitTime;
        const baseGameTimeStart = prevData.gameTimeStart + prevData.gameTimePassed + finalWaitTime;
        if (baseTimeStart + currentData.manualOffset < prevData.timeStart) {
          currentData.manualOffset = prevData.timeStart - baseTimeStart;
        }
        currentData.timeStart = baseTimeStart + currentData.manualOffset;
        currentData.gameTimeStart = baseGameTimeStart + currentData.manualOffset;
        currentData.totalRealTimeCost = currentData.duration;
        currentData.totalGameTimeCost = currentData.gameTimePassed;
      } else {
        currentData.timeStart = accumulatedTime + finalWaitTime;
        currentData.gameTimeStart = accumulatedGameTime + finalWaitTime;
        currentData.totalRealTimeCost = finalWaitTime + currentData.duration;
        currentData.totalGameTimeCost = finalWaitTime + currentData.gameTimePassed;
        accumulatedTime = currentData.timeStart + currentData.duration;
        accumulatedGameTime = currentData.gameTimeStart + currentData.gameTimePassed;
      }

      // Stance changes still to come in the animation that plays out off-field after a swap.
      const offFieldChanges = sortedStanceChanges(dbMove)
        .filter(change => change.frame > currentData.duration && change.frame <= currentData.animationCommitment);
      currentData._offFieldStance = offFieldChanges.length > 0 ? { start: currentData.gameTimeStart, changes: offFieldChanges } : undefined;

      // A simultaneous-only move has no animation: it leaves the unit's current one in place.
      if (!dbMove.simultaneous) {
        unitBusyUntil[currentData.unit] = currentData.timeStart + currentData.animationCommitment;
      }
      this._applyMotionStop(currentData, unitBusyUntil, lastRowByUnit, animationByUnit);
      if (!dbMove.simultaneous) {
        lastRowByUnit[currentData.unit] = currentData;
        const animationEnd = currentData.timeStart + currentData.animationCommitment;
        if (animationEnd >= (animationByUnit[currentData.unit]?.end ?? -Infinity)) {
          animationByUnit[currentData.unit] = { row: currentData, end: animationEnd };
        }
      }
      const baseActDur = timings.baseDuration;

      // Integer frames; no epsilon needed.
      const reasons: any[] = [];
      if (wCD > 0) reasons.push({ label: 'Waiting for Skill CD', valueFrames: wCD });
      if (wBusy > 0) reasons.push({ label: 'Animation Lock', valueFrames: toFrames(wBusy) });
      if (resourceWaitFrames > 0) reasons.push({ label: resourceWaitLabel || 'Waiting for Resource', valueFrames: toFrames(resourceWaitFrames) });
      reasons.push(...holdWaitReasons);
      if (baseActDur > 0) reasons.push({ label: 'Base Action Duration', valueFrames: toFrames(baseActDur) });
      else reasons.push({ label: 'Instant Cast', valueFrames: toFrames(0) });

      if (currentData.timing === 'Simultaneous' && i > 0) {
        currentData.offset = currentData.manualOffset;
        reasons.push({
          label: 'Parallel Execution Start',
          valueFrames: toFrames(currentData.offset),
          isNegative: currentData.offset < 0
        });
      } else {
        const unadjustedDur = duration - swapCdDelay;
        const timingDiff = unadjustedDur - baseActDur;
        const netTimingChange = timingDiff + swapCdDelay;
        const label = timingLabel(currentData);

        if (timingDiff < 0) reasons.push({ label: `${label} Time Saved`, valueFrames: toFrames(timingDiff), isNegative: true });
        else if (timingDiff > 0) reasons.push({ label: `${label} Penalty`, valueFrames: toFrames(timingDiff) });
        if (swapCdDelay > 0) reasons.push({ label: `Swap Cooldown Delay (${incomingUnit})`, valueFrames: toFrames(swapCdDelay) });
        const rawOffset = finalWaitTime + netTimingChange;
        currentData.offset = toFrames(rawOffset);
      }
      currentData.offsetReasons = reasons;

      const isRelease = dbMove.inputType === 'Release' || dbMove.holdConfig;
      const isHolding =
        currentData.trackers &&
        currentData.trackers.Hold_Start !== undefined &&
        currentData.trackers.Hold_Unit === currentData.unit;
      if (isRelease || isHolding) {
        const hold = holdConfigCache
          ?? this._resolveHoldCursor(
            dbMove.holdConfig || DataLoader.findHoldReleaseConfig(currentData.unit, currentData.trackers?.Hold_Input) || {},
            currentData,
            team
          );
        const { config, mode, speed, maxVal, center, size } = hold;
        // Repeat-style holds (no holdConfig) have no cursor.
        if (config && Object.keys(config).length > 0) {
          if (!currentData.trackers) currentData.trackers = {};
          // Clamp has no window.
          if (mode !== 'clamp') {
            currentData.trackers.Forte_Win_Center = center;
            currentData.trackers.Forte_Win_Size = size;
          }

          if (isHolding) {
            const holdDuration = currentData.gameTimeStart - currentData.trackers.Hold_Start;
            const accumulated = currentData.trackers.Cursor_Accumulated || 0;
            const finalCursor = CommonUtils.resolveHoldCursorAtTime(accumulated, holdDuration, speed, mode, maxVal);
            currentData.forteCursorPos = finalCursor;
            currentData.forteWinCenter = center;
            currentData.forteWinSize = size;
            // Read by IsInHoldWindow.
            currentData.isInForteWindow = CommonUtils.isHoldCursorDone(finalCursor, hold);
            currentData.trackers.Cursor_Pos = finalCursor;

            // Clamp: cursor is the forte value; keep the pool in sync.
            if (mode === 'clamp') {
              const slot = config.forteSlot || MECHANICS_NOTATION.HOLD_DEFAULTS.FORTE_SLOT;
              if (!currentData[slot]) currentData[slot] = {};
              currentData[slot][currentData.unit] = finalCursor;
            }
          }
        }
      }

      // Pre-cast snapshot for the row's panels.
      if (this._run.dropdownSnapshots) {
        currentData.dropdownState = dropdownSnapshot(currentData);
      }

      this._runValidation(currentData, prevData, team, dbMove);

      this._preCastOnField = undefined;
      this._evaluateMechanics(currentData, activeTeam, activeRows, i, team, dbMove);
      // Cast during another move, so it doesn't become @Self.PrevAction.
      if (!dbMove.simultaneous) this._resolveComboWindows(currentData, dbMove, team);
      // Spam-click indicator; after the row's state is final.
      currentData.priority = this._resolvePriority(dbMove, currentData, currentData.unit, team);
    }

    const emptyRow = activeRows[activeRows.length - 1];
    if (activeRows.length > 1) {
      const lastActive = activeRows[activeRows.length - 2];
      this._applyInheritance(emptyRow, lastActive, accumulatedGameTime, team);
      emptyRow.prevRow = lastActive;
      emptyRow.gameTimeStart = accumulatedGameTime;
      emptyRow.timeStart = accumulatedTime;
    }
    if (this._run.dropdownSnapshots) emptyRow.dropdownState = plainCopy(emptyRow, ROW_LINK_KEYS);

    // Flush hits still queued after the last row (repeats, since hits can queue procs).
    this._preCastOnField = undefined;
    const flushContext = activeRows[activeRows.length - 1];
    for (let guard = 0; this.damageQueue.length > 0 && guard < 1000; guard++) {
      const lastHitAt = Math.max(...this.damageQueue.map(hit => hit.executeAt));
      const window = toFrames(Math.max(0, lastHitAt - this.currentGlobalRealTime));
      this._decayState(flushContext, window, window, activeTeam, activeRows, team);
    }

    this.isRecalculating = false;
    return activeRows;
  }

  // Loop start: override, or main DPS's first Outro (skipping Hold-Repeat blocks).
  // The Loop Start marker's row, else the row after the main DPS's Outro. Until that row exists the
  // opener isn't done: after the last row (all opener, no loop).
  findLoopStart(rows: any[], mainDps: string | undefined, collapseMap?: number[]): { index: number; isOverride: boolean } {
    const overrideIndex = rows.findIndex(r => r.loopStartOverride === true && !!r.unit);
    if (overrideIndex !== -1) return { index: overrideIndex, isOverride: true };

    let end = rows.length;
    while (end > 0 && !rows[end - 1]?.unit) end--;
    if (mainDps) {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.unit === mainDps && Array.isArray(row.castTypes) && row.castTypes.includes('Outro')) {
          if (collapseMap && collapseMap.lastIndexOf(collapseMap[i]) !== i) continue;
          const next = i + 1;
          if (next < rows.length && rows[next]?.unit) return { index: next, isOverride: false };
          return { index: end, isOverride: false };
        }
      }
    }
    return { index: end, isOverride: false };
  }

  // Legality check: simulates opener + 2 loop reps and inspects the second.
  analyzeLoop(
    rows: any[],
    team: any[] = [],
    options: { startEnergy?: boolean; startConcerto?: boolean } = {},
    enemyConfig: EnemyStats = ENEMY_DEFAULTS,
    loopStartIndex: number = 0
  ): { errors: string[]; warnings: string[] } {
    // Ending Rotation rows don't repeat.
    const { openerRows, loopTemplate } = splitLoopSegments(rows.filter(r => r && r.unit), loopStartIndex, true);
    if (loopTemplate.length === 0) return { errors: [], warnings: [] };

    if (loopTiming(openerRows, loopTemplate).loopDuration === 0) {
      return { errors: ['Loop has no duration — cannot repeat.'], warnings: [] };
    }

    const extendedContent = [...openerRows, ...loopTemplate, ...loopTemplate];
    const extendedResult = this.recalculateState(toRunInput(extendedContent), team, { ...options, mode: 'lean' }, enemyConfig);

    // Second rep, excluding the trailing blank row.
    return this.loopIssues(extendedResult, openerRows.length + loopTemplate.length, extendedContent.length);
  }

  /** Issues in loop rows [from, to) of a run with at least one earlier rep. */
  loopIssues(runRows: any[], from: number, to: number): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (let i = from; i < to; i++) {
      const row = runRows[i];
      const moveName = row.moveName || row.action;

      (row.errorMsgs || []).forEach((msg: string) => errors.push(`${moveName}: ${msg}`));

      // Cooldown waits aren't illegal.
      const cooldownWarning = this._cooldownWaitWarning(row, moveName);
      if (cooldownWarning) warnings.push(cooldownWarning);
      (row.warningMsgs || []).forEach((msg: string) => {
        if (/^Combo requirement not met/.test(msg) || /out of the required .* (Resonance Energy|Forte \d+|Tune)/.test(msg)) {
          warnings.push(`${moveName}: ${msg}`);
        }
      });
    }

    return { errors, warnings };
  }

  // Per-run copy of a move, or null.
  _getModifiedMoveData(actionId: string): MechanicNode | null {
    if (!actionId) return null;
    const cached = this._moveDataCache.get(actionId);
    if (cached !== undefined) return cached;

    let rawMove = DataLoader.mechanicsDB[actionId] || null;
    if (!rawMove) {
      const matchKey = Object.keys(DataLoader.mechanicsDB).find(k =>
        k.startsWith(actionId + '_') && !DataLoader.mechanicsDB[k].isPassive
      );
      if (matchKey) rawMove = DataLoader.mechanicsDB[matchKey];
    }
    if (!rawMove) {
      this._moveDataCache.set(actionId, null);
      return null;
    }

    const { _compiledRule, ...safeData } = rawMove as any;
    const patchedMove = cloneJson(safeData);
    if (_compiledRule && typeof _compiledRule.evaluate === 'function') {
      patchedMove._compiledRule = _compiledRule;
    }
    this._moveDataCache.set(actionId, patchedMove);
    return patchedMove;
  }

  // `mainUnit`: on-field before row 0.
  _getDefaultData(mainUnit: string = ''): any {
    return {
      unit: mainUnit, action: '', timing: 'Auto', offset: 0,
      energy: {}, concerto: {}, hp: {}, trackers: {},
      cooldowns: {}, chargeCooldowns: {}, activeBuffs: {}, unitCombos: {},
      timeStart: 0, gameTimeStart: 0, duration: 0, gameTimePassed: 0
    };
  }

  _setupEventBoard(team: any[] = []): string[] {
    EventManager.reset();
    const activeTeam = teamCharacters(team);
    getMechanicOwners(team).forEach(owner => {
      const keys = DataLoader.mechanicsIndex[owner.name] || [];
      if (keys.length === 0) {
        const directNode = owner.allowDirectNode && MechanicKey.findNode(DataLoader.mechanicsDB, owner.name);
        if (directNode && owner.listens(directNode, owner.name)) {
          EventManager.registerMechanic(owner.transform ? owner.transform(directNode) : directNode, owner.equipper, undefined, owner.name);
        }
        return;
      }
      keys.forEach(key => {
        const mech = DataLoader.mechanicsDB[key];
        if (!mech || !owner.listens(mech, key)) return;
        EventManager.registerMechanic(owner.transform ? owner.transform(mech) : mech, owner.equipper, key, owner.name);
      });
    });

    return activeTeam;
  }

  _applyInheritance(currentData: any, prevData: any, currentTime: number, team: any[]): void {
    if (!prevData) return;
    currentData.unitCombos = { ...(prevData.unitCombos || {}) };
    const defaultBossHp = this._enemyConfig.hp > 0 ? this._enemyConfig.hp : ENEMY_DEFAULTS.hp;
    currentData.enemyMaxHp = prevData.enemyMaxHp ?? defaultBossHp;
    currentData.enemyHp = prevData.enemyHp ?? currentData.enemyMaxHp;
    currentData.enemyMaxTune = prevData.enemyMaxTune ?? ENEMY_DEFAULTS.maxTune;
    currentData.enemyTune = prevData.enemyTune ?? 0;
    inheritPools(currentData, prevData);

    currentData.trackers = structuredClone(prevData.trackers || {});
    for (const key in currentData.trackers) {
      if (key.endsWith('_Delta')) delete currentData.trackers[key];
    }

    currentData.cooldowns = structuredClone(prevData.cooldowns || {});
    currentData.chargeCooldowns = structuredClone(prevData.chargeCooldowns || {});
    currentData.activeBuffs = structuredClone(prevData.activeBuffs || {});

    // Drop the outgoing unit's removeOnSwap buffs (OnBuffRemove fires later).
    if (prevData.unit && currentData.unit && currentData.unit !== prevData.unit) {
      const swappedOutPrefix = `${prevData.unit}_`;
      for (const key in currentData.activeBuffs) {
        const buff = currentData.activeBuffs[key];
        if (buff?.removeOnSwap && key.startsWith(swappedOutPrefix)) {
          (currentData._swapRemovedBuffs ??= []).push(buff);
          delete currentData.activeBuffs[key];
          markBuffsChanged(currentData);
        }
      }
    }

    if (prevData.pendingNextBuffs && prevData.pendingNextBuffs.length > 0 && currentData.unit) {
      const activeTeam = teamCharacters(team);
      prevData.pendingNextBuffs.forEach((eff: any) => {
        const nextEff = { ...eff, target: currentData.unit, appliesTo: '@Next' };
        this._processEffect(nextEff, currentData, eff.provider || prevData.unit, activeTeam, [], currentData.arrayIndex, team);
      });
    }

    currentData.timeScales = structuredClone(prevData.timeScales || {});
    // Per-unit stance: midair persists through the combo window; otherwise inherit the outgoing stance.
    currentData.unitStances = { ...(prevData.unitStances || {}) };
    currentData.unitOffFieldStances = { ...(prevData.unitOffFieldStances || {}) };
    if (prevData.unit) {
      currentData.unitStances[prevData.unit] = prevData.stance || CHARACTER_DEFAULTS.defaultStance;
      currentData.unitOffFieldStances[prevData.unit] = prevData._offFieldStance;
    }
    if (prevData.unit && currentData.unit && currentData.unit !== prevData.unit) {
      const isIntro = currentData.castTypes?.includes('Intro');
      const myCombo = prevData.unitCombos?.[currentData.unit];
      const isDuringCombo = myCombo && currentTime <= myCombo.expiration;
      const swapInStance = isDuringCombo ? this._returningStance(currentData, currentData.unit, currentTime) : prevData.stance;
      currentData.stance = (!isIntro && swapInStance) || CHARACTER_DEFAULTS.defaultStance;
    } else {
      currentData.stance = prevData.stance || CHARACTER_DEFAULTS.defaultStance;
    }
    // Starting stance, for validation.
    currentData.entryStance = currentData.stance;
    this._logTimeline(currentData);
  }

  // A returning unit's stance: as it left, plus changes its off-field animation has reached by `now`.
  _returningStance(state: any, unit: string, now: number): string | undefined {
    let stance = state.unitStances[unit];
    const track = state.unitOffFieldStances?.[unit];
    for (const change of track?.changes || []) {
      if (now - track.start >= change.frame) stance = change.stance;
    }
    return stance;
  }

  _primeCombatStart(firstRowData: any, team: any[]): void {
    const activeTeam = teamCharacters(team);
    const passives = [
      ...EventManager.emit('OnStart', new Set(), firstRowData, firstRowData.unit, team),
      ...EventManager.emit('ALWAYS', new Set(), firstRowData, firstRowData.unit, team)
    ];

    passives.forEach(eff => {
      const owner = eff.provider || eff.source || firstRowData.unit;
      this._processEffect(eff, firstRowData, owner, activeTeam, [], 0, team);
    });
  }

  // Resolves a numeric or DSL field; NaN if unreadable.
  _resolveNumber(val: unknown, currentData: any, unit: string, team: any[]): number {
    return parseFloat(String(isDslExpr(val) ? this._resolveDynamicMath(val, currentData, unit, team) : val));
  }

  // Resolves a frames field to whole frames; `fallback` when unset.
  _resolveFrames(val: unknown, currentData: any, unit: string, team: any[], fallback: Frames): Frames {
    return val === undefined ? fallback : roundFrames(this._resolveNumber(val, currentData, unit, team));
  }

  // Resolved hitFrames; undefined entries are spread evenly.
  _hitFrameOverrides(move: MechanicNode, currentData: any, unit: string, team: any[]): Array<number | undefined> {
    return (move.hitFrames || []).map(v => (v === null || v === undefined || v === '' ? undefined : this._resolveFrames(v, currentData, unit, team, toFrames(0))));
  }

  _resolveComboWindows(currentData: any, dbMove: MechanicNode, team: any[]): void {
    if (!currentData.action) return;

    // Every cast sets @Self.PrevAction and refreshes the combo window.
    const postMoveWindow = this._resolveFrames(dbMove.comboWindow, currentData, currentData.unit, team, toFrames(GAME_DEFAULTS.comboWindow));
    currentData.unitCombos[currentData.unit] = {
      action: currentData.action,
      expiration: currentData.gameTimeStart + currentData.animationCommitment + postMoveWindow
    };
  }

  _resolvePriority(move: MechanicNode, currentData: any, unit: string, team: any[]): number {
    return this._resolveNumber(move.priority, currentData, unit, team) || 0;
  }

  // Priority `time` frames into the move: its last priorityTimeline step by then, else `priority`.
  _priorityAt(move: MechanicNode, time: number, currentData: any, unit: string, team: any[]): number {
    const step = sortedPrioritySteps(move).filter(s => s.time <= time).pop();
    return step ? this._resolveNumber(step.priority, currentData, unit, team) || 0 : this._resolvePriority(move, currentData, unit, team);
  }

  // Cuts an off-field move at `cutAt`, dropping unlanded hits.
  _cutSwappedOutMove(row: any, cutAt: number, paused: number): void {
    const before = this.damageQueue.length;
    this.damageQueue = this.damageQueue.filter(hit => !(hit.originRow === row && !hit.isProc && hit.executeAt > cutAt));
    row.allowedHits = Math.max(0, (row.allowedHits ?? 0) - (before - this.damageQueue.length));
    // Its own animation time; the Timeline adds the pauses back.
    row.animationCommitment = toFrames(Math.max(row.duration || 0, cutAt - row.timeStart - paused));
    row._swapCancelAt = undefined;
  }

  // Motion stop pauses every other mid-move unit; recorded as motionStopPauses for the Timeline.
  _applyMotionStop(
    currentData: any,
    unitBusyUntil: Record<string, number>,
    lastRowByUnit: Record<string, any>,
    animationByUnit: Record<string, { row: any; end: number }>
  ): void {
    const motionStop = currentData.motionStop || 0;
    if (motionStop <= 0) return;
    const visibleFrames = toFrames(motionStop - frozenFramesWithin(motionStop, currentData.freezeStart || 0, currentData.freezeTime || 0));
    for (const [unit, latestRow] of Object.entries(lastRowByUnit)) {
      if (unit === currentData.unit) continue;
      const animation = animationByUnit[unit];
      const isAnimating = !!animation && animation.end > currentData.timeStart;
      const hasPendingHits = this.damageQueue.some(hit => hit.origin.caster === unit);
      if (!isAnimating && !hasPendingHits) continue;
      if ((unitBusyUntil[unit] || 0) > currentData.timeStart) unitBusyUntil[unit] += motionStop;
      // Extends the paused move and its unit's lock.
      if (isAnimating) {
        animation.end += motionStop;
        unitBusyUntil[unit] = Math.max(unitBusyUntil[unit] || 0, animation.end);
      }
      if (visibleFrames > 0) {
        const row = isAnimating ? animation.row : latestRow;
        (row.motionStopPauses ||= []).push({ gameTime: currentData.gameTimeStart, frames: visibleFrames, by: currentData.unit, moveName: currentData.moveName });
      }
    }
  }

  _resolveTimings(currentData: any, moveData: MechanicNode, team: any[]): any {
    const timingType = currentData.timing || 'Auto';
    const unitName = currentData.unit;
    const resolveFrames = (val: unknown, fallback: Frames): Frames => this._resolveFrames(val, currentData, unitName, team, fallback);

    const actionDuration = resolveFrames(moveData.actionDuration, toFrames(0));
    const freezeTime = resolveFrames(moveData.freezeTime, toFrames(0));
    const freezeStart = resolveFrames(moveData.freezeStart, toFrames(0));
    const motionStop = resolveFrames(moveData.motionStop, toFrames(0));
    const swapDuration = moveData.swapTiming !== undefined
      ? toFrames(Math.max(resolveFrames(moveData.swapTiming, toFrames(0)), GAME_DEFAULTS.swapTime))
      : undefined;
    const hitCount = Array.isArray(moveData.hitMults) ? moveData.hitMults.length : 0;

    const nextRow = currentData.nextRow;
    const nextMoveData = nextRow?.action ? this._getModifiedMoveData(nextRow.action) : null;

    // No rule: next move must outrank this one on a different input. Swaps rank highest.
    const bindingOf = (m: MechanicNode) => `${m.input ?? ''}|${m.inputType ?? ''}`;
    const isNextSwapOut = swapDuration !== undefined && !!nextRow?.unit
      && (nextRow.unit !== unitName || !!nextMoveData?.castTypes?.includes('Outro'));
    // `other` outranks this move `time` frames in, on a different input.
    const outranksAt = (other: MechanicNode | null, otherUnit: string, time: number) => !!other
      && bindingOf(other) !== bindingOf(moveData)
      && this._resolvePriority(other, currentData, otherUnit, team) > this._priorityAt(moveData, time, currentData, unitName, team);
    const nextCancelsAt = (time: number) => isNextSwapOut || outranksAt(nextMoveData, nextRow?.unit, time);

    // A cancel rule is checked against the events its cancel fires: the next row's cast (and swap).
    const nextEvents = nextRow?.action && nextMoveData ? rowStartEvents(nextRow.action, nextMoveData, nextRow.unit, unitName) : [];
    const cancelRulePasses = (ct: any, events: RuleEvent[]): boolean =>
      !!(this._evaluateRule(ct, ct.triggerRule, currentData, currentData.unit, team, events) ?? false);

    const validCancels: Array<{ index: number; time: Frames; hits: number }> = [];
    if (moveData.cancelTimings && moveData.cancelTimings.length > 0) {
      moveData.cancelTimings.forEach((ct, idx) => {
        const isValid = !ct.triggerRule || ct.triggerRule.trim() === ''
          ? nextCancelsAt(ct.time)
          : cancelRulePasses(ct, nextEvents);
        if (isValid) validCancels.push({ index: idx, time: ct.time, hits: ct.hits !== undefined ? ct.hits : Infinity });
      });
    }
    // A priority drop opens a cancel for anything that now outranks the move.
    const authoredCancelCount = moveData.cancelTimings?.length ?? 0;
    sortedPrioritySteps(moveData).forEach((step, idx) => {
      if (step.time > 0 && step.time < actionDuration && !isNextSwapOut && nextCancelsAt(step.time)) {
        validCancels.push({ index: authoredCancelCount + idx, time: toFrames(step.time), hits: Infinity });
      }
    });

    // Swap + Cancel: swap out, then the unit's next move cancels this one off-field.
    const returnAction = isNextSwapOut && unitName ? currentData.nextUnitActions?.[unitName] : undefined;
    const returnMoveData = returnAction ? this._getModifiedMoveData(returnAction) : null;
    // The window's rule adds to the priority check rather than replacing it.
    const swapCancels: Array<{ index: number; time: Frames; hits: number }> = [];
    if (isNextSwapOut && returnMoveData && moveData.cancelTimings) {
      // The swap out, then the returning move's cast.
      const swapCancelEvents = [...nextEvents, ...rowStartEvents(returnAction, returnMoveData, unitName, nextRow.unit)];
      moveData.cancelTimings.forEach((ct, idx) => {
        const isValid = outranksAt(returnMoveData, unitName, ct.time) && (!ct.triggerRule || ct.triggerRule.trim() === ''
          || cancelRulePasses(ct, swapCancelEvents));
        if (isValid) swapCancels.push({ index: idx, time: ct.time, hits: ct.hits !== undefined ? ct.hits : Infinity });
      });
    }

    const cancelTimeForAnimation = validCancels.length > 0
      ? validCancels.reduce((prev, curr) => prev.time < curr.time ? prev : curr).time
      : actionDuration;

    const tfStart = resolveFrames(moveData.damageTimeframe?.start, toFrames(0));
    const tfEnd = resolveFrames(moveData.damageTimeframe?.end, cancelTimeForAnimation);

    const hitFrameOverrides = this._hitFrameOverrides(moveData, currentData, unitName, team);
    const hitOffsets = hitFrameOffsets(hitCount, tfStart, tfEnd, hitFrameOverrides);
    const getHitTimeOffset = (idx: number): Frames => hitOffsets[idx] ?? tfEnd;

    let capEnergyHitIdx = -1;
    let capConcertoHitIdx = -1;
    if (moveData.hitResources && unitName) {
      const erMult = energyRegenMult(currentData, unitName, team);
      const resolve = (v: unknown) => this._resolveNumber(v, currentData, unitName, team);
      capEnergyHitIdx = capHitIndex(currentData, unitName, 'energy', moveData, hitCount, amount => (amount > 0 ? amount * erMult : amount), resolve);
      capConcertoHitIdx = capHitIndex(currentData, unitName, 'concerto', moveData, hitCount, amount => amount, resolve);
    }

    const availableTimings: any[] = [
      { val: 'Auto', label: 'Auto', title: 'Quickest valid timing for all hits' },
      { val: 'Full', label: 'Full', title: `Duration: ${formatFramesAsSeconds(actionDuration)} | All Hits` }
    ];
    if (swapDuration !== undefined) {
      availableTimings.push({ val: 'Swap', label: 'Swap', title: `Duration: ${formatFramesAsSeconds(swapDuration)}` });
    }
    if (capEnergyHitIdx !== -1) {
      availableTimings.push({
        val: `Cap_Energy_${capEnergyHitIdx}`,
        label: 'Cap Energy',
        title: `Cancel at Hit ${capEnergyHitIdx + 1} (${formatFramesAsSeconds(getHitTimeOffset(capEnergyHitIdx))}) the frame Energy reaches max`
      });
    }
    if (capConcertoHitIdx !== -1) {
      availableTimings.push({
        val: `Cap_Concerto_${capConcertoHitIdx}`,
        label: 'Cap Concerto',
        title: `Cancel at Hit ${capConcertoHitIdx + 1} (${formatFramesAsSeconds(getHitTimeOffset(capConcertoHitIdx))}) the frame Concerto reaches max`
      });
    }
    validCancels.forEach((vc, i) => {
      const label = validCancels.length === 1 ? 'Cancel' : `Cancel ${i + 1}`;
      const title = `Duration: ${formatFramesAsSeconds(vc.time)}` + (vc.hits !== Infinity ? ` | Hits: ${vc.hits}` : ` | All Hits`);
      availableTimings.push({ val: `Cancel_${vc.index}`, label, title });
    });
    if (swapDuration !== undefined) {
      swapCancels.forEach((sc, i) => {
        const label = swapCancels.length === 1 ? 'Swap + Cancel' : `Swap + Cancel ${i + 1}`;
        const title = `Swap out at ${formatFramesAsSeconds(swapDuration)}; swapped back, ${returnMoveData?.name ?? 'the next move'} cancels what's left of it at ${formatFramesAsSeconds(sc.time)} or on the swap back, if later`;
        availableTimings.push({ val: `SwapCancel_${sc.index}`, label, title });
      });
    }
    const instantCancelTime = swapDuration ?? toFrames(GAME_DEFAULTS.swapTime);
    // Any move the next one can cancel, with or without authored cancel windows.
    const canInstantCancel = validCancels.length > 0 || nextCancelsAt(instantCancelTime);
    if (canInstantCancel) {
      availableTimings.push({ val: 'Instant_Cancel', label: 'Instant Cancel', title: `Duration: ${formatFramesAsSeconds(instantCancelTime)} | No Hits` });
    }
    if (moveData.inputType === 'Hold' || moveData.simultaneous) {
      availableTimings.push({ val: 'Simultaneous', label: 'Simultaneous', title: "Executes in parallel anchored to the previous move's start time." });
    }
    if (moveData.inputType === 'Release' && moveData.holdConfig) {
      availableTimings.push({
        val: 'Manual',
        label: 'Manual',
        title: "Set the hold's wait directly (down to 0) instead of auto-waiting for the forte/window to be reached -- for an early, partial release."
      });
    }
    // Simultaneous-only: parallel, no duration of its own (baseDuration still anchors its default offset).
    if (moveData.simultaneous) {
      currentData.availableTimings = availableTimings.filter(t => t.val === 'Simultaneous');
      return {
        baseDuration: actionDuration, duration: 0, animationCommitment: 0, gameTimePassed: 0, freezeTime: 0, freezeStart: 0, motionStop,
        damageTimeframe: { start: tfStart, end: tfEnd }, hitFrameOverrides, allowedHits: hitCount
      };
    }
    currentData.availableTimings = availableTimings;

    // Stance the move leaves the unit in when cut at `time`.
    const stanceAt = (time: number): string => {
      let stance = moveData.stanceReq && moveData.stanceReq !== 'Any'
        ? moveData.stanceReq
        : currentData.entryStance || currentData.stance || CHARACTER_DEFAULTS.defaultStance;
      for (const change of sortedStanceChanges(moveData)) {
        if (time >= change.frame) stance = change.stance;
      }
      return stance;
    };
    // The unit's own next move needs a stance this cut must leave it in.
    const nextStanceReq = nextRow?.unit === unitName && nextMoveData?.stanceReq !== 'Any' ? nextMoveData?.stanceReq : undefined;
    const keepsNextStance = (time: number) => !nextStanceReq || stanceAt(time) === nextStanceReq;

    let autoCancelTime = actionDuration;
    let autoAllowedHits = hitCount;
    const fullHitCancels = validCancels.filter(vc => vc.hits >= hitCount && keepsNextStance(vc.time));
    if (fullHitCancels.length > 0) {
      const quickest = fullHitCancels.reduce((prev, curr) => prev.time < curr.time ? prev : curr);
      autoCancelTime = quickest.time;
      autoAllowedHits = quickest.hits;
    }

    let duration = actionDuration;
    let animationCommitment = actionDuration;
    let finalHits = hitCount;
    // Cut at `time` with `hits` landed. Swapped-out animations play out off-field.
    const cutAt = (time: Frames, hits: number) => { duration = time; animationCommitment = time; finalHits = hits; };
    const swapOut = (swapAt: Frames) => { duration = swapAt; animationCommitment = actionDuration; finalHits = hitCount; };
    let swapCancelAt: Frames | undefined;
    const capAt = (hitIdx: number) => cutAt(getHitTimeOffset(hitIdx), hitIdx + 1);
    const cutAuto = () => cutAt(autoCancelTime, autoAllowedHits);

    if (timingType === 'Auto') {
      const isNextOutro = nextMoveData?.castTypes?.includes('Outro');
      const isNextSwap = nextRow && nextRow.unit !== currentData.unit && nextRow.unit !== '';

      if (isNextOutro && capConcertoHitIdx !== -1 && swapDuration !== undefined) {
        // Outro swaps out on the Concerto-filling hit; later hits land off-field.
        swapOut(toFrames(Math.max(getHitTimeOffset(capConcertoHitIdx), swapDuration)));
        currentData._autoTimingChoice = 'Concerto';
      } else if (isNextOutro && capConcertoHitIdx !== -1) {
        capAt(capConcertoHitIdx);
        currentData._autoTimingChoice = 'Concerto';
      } else if ((isNextOutro || isNextSwap) && swapDuration !== undefined) {
        swapOut(swapDuration);
        currentData._autoTimingChoice = 'Swap';
      } else {
        cutAuto();
        currentData._autoTimingChoice = 'Cancel';
      }
    } else if (timingType === 'Swap' && swapDuration !== undefined) {
      swapOut(swapDuration);
    } else if (timingType.startsWith('SwapCancel_') && swapDuration !== undefined) {
      const sc = swapCancels.find(c => c.index === parseInt(timingType.split('_')[1], 10));
      swapOut(swapDuration);
      // Earliest cancel point for the returning move.
      if (sc) swapCancelAt = sc.time;
    } else if (timingType.startsWith('Cap_')) {
      capAt(parseInt(timingType.split('_')[2], 10));
    } else if (timingType.startsWith('Cancel_')) {
      const ct = validCancels.find(vc => vc.index === parseInt(timingType.split('_')[1], 10));
      if (ct) cutAt(ct.time, ct.hits);
      else cutAuto();
    } else if (timingType === 'Instant_Cancel' && canInstantCancel) {
      cutAt(instantCancelTime, 0);
    } else if (timingType === 'Cancel') {
      if (validCancels.length > 0) cutAt(validCancels[0].time, validCancels[0].hits);
      else cutAuto();
    }

    return {
      baseDuration: actionDuration,
      duration,
      animationCommitment,
      // Only the freeze inside the move's window pauses game time.
      gameTimePassed: toFrames(duration - frozenFramesWithin(duration, freezeStart, freezeTime)),
      freezeTime,
      freezeStart,
      motionStop,
      damageTimeframe: { start: tfStart, end: tfEnd },
      hitFrameOverrides,
      allowedHits: finalHits,
      swapCancelAt
    };
  }

  _decayState(
    currentData: any,
    realTimePassed: Frames,
    gameTimePassed: Frames,
    activeTeam: string[],
    activeRows: any[],
    team: any[],
    freezeStart: Frames = toFrames(0)
  ): void {
    if (realTimePassed < 0) return;

    // Decay game time in segments up to each hit. Game time stands still from `freezeStart`
    // for the window's freeze; hits in it share that game time.
    const freezeFrames = Math.max(0, realTimePassed - gameTimePassed);
    const gameTimeAt = (elapsedReal: number) => elapsedReal < freezeStart ? elapsedReal : Math.max(freezeStart, elapsedReal - freezeFrames);
    let gameTimeElapsed = 0;
    const advanceGameTimeTo = (target: number) => {
      const segment = Math.min(target, gameTimePassed) - gameTimeElapsed;
      if (segment <= 0) return;
      // Clock first, so expiries log at the segment's end.
      this.currentGlobalGameTime += segment;
      this._processGameTimeDecay(currentData, toFrames(segment), activeTeam, activeRows, team);
      gameTimeElapsed += segment;
      this._logTimeline(currentData);
      this._buffRanOutAt.clear();
    };

    this._processQueuedHits(currentData, realTimePassed, activeTeam, activeRows, team, elapsedReal => advanceGameTimeTo(gameTimeAt(elapsedReal)), freezeFrames, freezeStart);
    this.currentGlobalRealTime += realTimePassed;
    advanceGameTimeTo(gameTimePassed);
  }

  // Why `move` can't be cast yet: each cast cost it's short of (not Energy -- that stays a warning),
  // else its own trigger rule if that fails (named by the move). Empty when it's castable.
  _castBlockers(currentData: any, move: MechanicNode, team: any[]): string[] {
    const unit = currentData.unit;
    const unitStats = DataLoader.characterDB[unit];
    const blockers = WAITABLE_RESOURCE_KEYS
      .filter(key => {
        const req = resourceRequirement(move, key, v => this._resolveNumber(v, currentData, unit, team));
        return req > 0 && readResource(currentData, key, unit) < req;
      })
      .map(key => resourceLabel(key, unitStats));
    if (blockers.length > 0) return blockers;
    if (!move.triggerRule || move.isPassive) return [];
    // Checked as _runValidation checks it.
    const events = rowStartEvents(currentData.action, move, unit, currentData.prevRow?.unit);
    const passed = this._evaluateRule(move, move.triggerRule, currentData, unit, team, events);
    return passed !== null && !passed ? [move.name || 'condition'] : [];
  }

  // A row whose move can't be cast yet waits for queued hits that make it castable -- a resource
  // they fill, or a condition they meet (Tune Break opening on a hit). Hits land one at a time in a
  // dry run that's then undone, so a row that queued hits can't unblock (in WAIT_HORIZON) doesn't
  // wait at all and keeps its error; one they can waits exactly as long, through the same steps.
  _computeCastWait(currentData: any, move: MechanicNode, team: any[], activeTeam: string[], activeRows: any[]): { waitFrames: number; label: string | null } {
    const none = { waitFrames: 0, label: null };
    if (!currentData.unit || this.damageQueue.length === 0) return none;
    const blockers = this._castBlockers(currentData, move, team);
    if (blockers.length === 0) return none;

    const steps: number[] = [];
    let waited = 0;
    let castable = false;
    const snapshot = this._dryRunSnapshot(currentData);
    this._dryRun = true;
    try {
      while (this.damageQueue.length > 0) {
        const step = Math.max(0, this.damageQueue[0].executeAt - this.currentGlobalRealTime);
        if (waited + step > WAIT_HORIZON) break;
        this._decayState(currentData, toFrames(step), toFrames(step), activeTeam, activeRows, team);
        steps.push(step);
        waited += step;
        if (this._castBlockers(currentData, move, team).length === 0) { castable = true; break; }
      }
    } finally {
      this._dryRun = false;
      this._restoreDryRun(currentData, snapshot);
    }
    if (!castable) return none;

    steps.forEach(step => this._decayState(currentData, toFrames(step), toFrames(step), activeTeam, activeRows, team));
    return { waitFrames: waited, label: `Waiting for ${blockers.join(' / ')}` };
  }

  // What landing queued hits can change, for _computeCastWait to undo: the row (minus its links),
  // the queue (each hit copied -- its multiplier resolves in place), the clocks and the run's buff bookkeeping.
  // The dry run skips what's kept on other rows (Generated credit, hit history) and the Timeline log.
  _dryRunSnapshot(currentData: any) {
    const row = { ...currentData };
    for (const key of ROW_LINK_KEYS) delete row[key];
    return {
      row: structuredClone(row),
      queue: this.damageQueue.map(hit => ({ ...hit })),
      realTime: this.currentGlobalRealTime,
      gameTime: this.currentGlobalGameTime,
      buffRanOutAt: new Map(this._buffRanOutAt),
      refreshedBuffs: new Set(this._refreshedBuffs),
      lastSwapOutTime: { ...this.lastSwapOutTime }
    };
  }

  _restoreDryRun(currentData: any, snapshot: ReturnType<TimelineEngineClass['_dryRunSnapshot']>): void {
    for (const key of Object.keys(currentData)) if (!ROW_LINK_KEYS.includes(key)) delete currentData[key];
    Object.assign(currentData, snapshot.row);
    this.damageQueue = snapshot.queue;
    this.currentGlobalRealTime = snapshot.realTime;
    this.currentGlobalGameTime = snapshot.gameTime;
    this._buffRanOutAt = snapshot.buffRanOutAt;
    this._refreshedBuffs = snapshot.refreshedBuffs;
    this.lastSwapOutTime = snapshot.lastSwapOutTime;
  }

  // `beforeHit` receives each hit's real-time offset into the window; the window's freeze is
  // `freezeFrames` long from `freezeStart`.
  _processQueuedHits(currentData: any, realTimePassed: Frames, activeTeam: string[], activeRows: any[], team: any[], beforeHit?: (elapsedReal: number) => void, freezeFrames = 0, freezeStart = 0): void {
    const realWindowEnd = this.currentGlobalRealTime + realTimePassed;
    while (this.damageQueue.length > 0) {
      const nextHit = this.damageQueue[0];
      if (nextHit.executeAt > realWindowEnd) break;

      this.damageQueue.shift();
      beforeHit?.(Math.max(0, nextHit.executeAt - this.currentGlobalRealTime));
      if (nextHit.hitIndex >= hitLimit(nextHit)) continue;
      // Failed hitCondition: the hit doesn't happen.
      if (!this._hitConditionPasses(nextHit, currentData, team)) continue;

      // Another row's hit: its resources count toward that row's Generated, not this one's.
      const creditRow = !this._dryRun && nextHit.originRow !== currentData && nextHit.originRow?.unit ? nextHit.originRow : null;
      const poolsBefore = creditRow && this._readPools(currentData, currentData.unit, creditRow.unit);

      // Multiplier resolved per hit, as it lands.
      const rawMult = nextHit.hitMult;
      if (typeof rawMult === 'string' && (rawMult.startsWith('MATH(') || isDslExpr(rawMult))) {
        nextHit.hitMult = this._resolveDynamicMath(rawMult, hitState(currentData, nextHit.originRow), nextHit.origin.caster, team);
      }

      const hitRes = nextHit.originMoveData.hitResources;
      if (hitRes) {
        for (const resKey in hitRes) {
          const resArray = hitRes[resKey];
          const amount = (Array.isArray(resArray) && resArray.length > nextHit.hitIndex) ? resArray[nextHit.hitIndex] : 0;
          if (amount !== 0) {
            const targetSelector = resKey === 'energy' ? '@Team' : '@Self';
            this._processEffect({ type: 'resource', name: resKey, value: amount, target: targetSelector, provider: nextHit.origin.caster, rateScaled: true }, currentData, nextHit.origin.caster, activeTeam, activeRows, currentData.arrayIndex, team);
          }
        }
      }

      // What @Hit reads in OnHit/AfterHit rules: whether the caster is on field (the previous row's
      // unit until this row casts), and whether the hit lands in this window's freeze.
      const hitInfo = {
        onField: nextHit.origin.caster === (this._preCastOnField ?? (currentData.onFieldUnit || currentData.unit)),
        inFreeze: nextHit.executeAt - this.currentGlobalRealTime >= freezeStart && nextHit.executeAt - this.currentGlobalRealTime < freezeStart + freezeFrames
      };

      currentData.activeProcSource = nextHit.originActionId;
      currentData._hit = hitInfo;
      this._fire('OnHit', nextHit.hitModifiers, currentData, nextHit.origin.caster, activeTeam, activeRows, team, nextHit.executeAt);
      delete currentData._hit;
      delete currentData.activeProcSource;

      if (creditRow && poolsBefore) {
        const poolsAfter = this._readPools(currentData, currentData.unit, creditRow.unit);
        this._deltaMeasures.forEach((measure, i) => {
          this._creditDelta(currentData, measure, poolsBefore.windowUnit[i] - poolsAfter.windowUnit[i]);
          this._creditDelta(creditRow, measure, poolsAfter.originUnit[i] - poolsBefore.originUnit[i]);
        });
      }

      // Hit history entry for the DMG cell and Results.
      if (this._run.hitLog && !this._dryRun) {
        const hitName = nextHit.originMoveData.name + (nextHit.totalHits > 1 ? ` (Hit ${nextHit.hitIndex + 1})` : '');
        if (!nextHit.originRow._pendingHits) nextHit.originRow._pendingHits = [];

        // Game time at landing; late hits (Simultaneous rows) are dated back.
        const lateBy = Math.max(0, this.currentGlobalRealTime - nextHit.executeAt);
        const hitGameTime = this.currentGlobalGameTime - lateBy;
        nextHit.originRow._pendingHits.push({
          config: {
            hitMult: nextHit.hitMult, provider: nextHit.origin.caster, dmgTypes: nextHit.originMoveData.dmgTypes,
            castTypes: nextHit.originMoveData.castTypes, scalar: nextHit.originMoveData.scalar,
            title: nextHit.isProc ? `[Proc] ${hitName}` : (nextHit.totalHits > 1 ? `Hit ${nextHit.hitIndex + 1}` : 'Active Hit'),
            isOpen: false,
            actionId: nextHit.originActionId,
            moveName: nextHit.originMoveData.name,
            moveRef: nextHit.origin.ref,
            gameTime: hitGameTime,
            hitIndex: nextHit.hitIndex,
            ...(readsSelfStats(rawMult) && { statScaledMult: rawMult })
          },
          context: plainCopy(currentData, [...ROW_LINK_KEYS, '_pendingHits'])
        });
      }

      currentData._hit = hitInfo;
      this._fire('AfterHit', nextHit.hitModifiers, currentData, nextHit.origin.caster, activeTeam, activeRows, team, nextHit.executeAt, { hitIndex: nextHit.hitIndex + 1, totalHits: nextHit.totalHits });
      delete currentData._hit;
    }
  }

  // Time-scale multiplier for a buff or cooldown.
  _timeScaleFor(currentData: any): (timerId: string) => number {
    return (timerId: string) => {
      let mult = 1.0;
      for (const key in currentData.timeScales) {
        const ts = currentData.timeScales[key];
        if (!ts.name || ts.name === 'ALL' || ts.name === timerId) {
          const valStr = String(ts.value || '0');
          let percentVal = parseFloat(valStr);
          if (valStr.includes('%')) percentVal /= 100;
          if (percentVal > -1) mult *= (1 / (1 + percentVal));
        }
      }
      return Math.max(0, mult);
    };
  }

  _processGameTimeDecay(currentData: any, gameTimePassed: Frames, activeTeam: string[], activeRows: any[], team: any[]): void {
    // Cooldowns and buff lifetimes are in seconds.
    const decaySeconds = framesToSeconds(gameTimePassed);
    const getTimeScale = this._timeScaleFor(currentData);

    const expiringBuffs: Effect[] = [];
    for (const key in currentData.activeBuffs) {
      const buff = currentData.activeBuffs[key];
      const buffSpeed = getTimeScale(buff.name || '');
      const actualDecay = decaySeconds * buffSpeed;
      if (!buff.isPaused) {
        if (buff.stackBehavior === 'separate' && buff.durations) {
          buff.durations = buff.durations.map((d: number) => d - actualDecay).filter((d: number) => d > 0.001);
          if (buff.stacks !== buff.durations.length) markBuffsChanged(currentData);
          buff.stacks = buff.durations.length;
        } else {
          if (buff.duration !== undefined) {
            buff.duration -= actualDecay;
            if (buff.duration <= 0.001 && (buff.stacks || 0) > 0) {
              expiringBuffs.push(buff);
              const overshoot = actualDecay > 0 ? Math.max(0, -buff.duration) / buffSpeed : 0;
              this._buffRanOutAt.set(key, this.currentGlobalGameTime - secondsToFrames(overshoot));
            }
          }
        }
      }
    }

    expiringBuffs.forEach(buff => {
      this._fire('OnBuffExpire', eventModifier(buff.name), currentData, buff.provider || currentData.unit, activeTeam, activeRows, team);
    });

    if (expiringBuffs.length > 0) markBuffsChanged(currentData);
    expiringBuffs.forEach(buff => {
      if (buff.expireBehavior === 'drop_one') {
        buff.stacks = (buff.stacks || 1) - 1;
        if (buff.stacks > 0) buff.duration = buff.maxDuration;
      } else if (buff.expireBehavior === 'drop_half') {
        buff.stacks = Math.floor((buff.stacks || 1) / 2);
        if (buff.stacks > 0) buff.duration = buff.maxDuration;
      } else {
        buff.stacks = 0;
      }
    });

    for (const key in currentData.activeBuffs) {
      const buff = currentData.activeBuffs[key];
      if ((buff.stacks || 0) <= 0 || (buff.stackBehavior !== 'separate' && (buff.duration ?? 0) <= 0.001)) {
        if (buff.linkedTracker && currentData.trackers) currentData.trackers[buff.linkedTracker] = 0;
        delete currentData.activeBuffs[key];
        markBuffsChanged(currentData);
      }
    }

    for (const key in currentData.timeScales) {
      if (currentData.timeScales[key].duration !== undefined) {
        currentData.timeScales[key].duration -= decaySeconds;
        if (currentData.timeScales[key].duration <= 0.001) delete currentData.timeScales[key];
      }
    }

    for (const key in currentData.cooldowns) {
      currentData.cooldowns[key] -= (decaySeconds * getTimeScale(key));
      if (currentData.cooldowns[key] <= 0.001) delete currentData.cooldowns[key];
    }

    // One timer per in-flight charge; each frees its charge when done.
    for (const key in currentData.chargeCooldowns) {
      const pending = currentData.chargeCooldowns[key];
      const scale = getTimeScale(key);
      for (let i = pending.length - 1; i >= 0; i--) {
        pending[i] -= decaySeconds * scale;
        if (pending[i] <= 0.001) pending.splice(i, 1);
      }
      if (pending.length === 0) delete currentData.chargeCooldowns[key];
    }

    // OnTick intervals are in seconds.
    this._fire('OnTick', new Set(), currentData, currentData.unit, activeTeam, activeRows, team, this.currentGlobalRealTime, { gameTimePassed: decaySeconds, getTimeScale });
  }

  // Queues a move's hits at `baseTime` + offsets. DSL mults resolve on landing.
  _scheduleHits(currentData: any, moveData: MechanicNode, origin: MoveOrigin, rawMults: any[], baseTime: number, offsets: number[], isProc: boolean, hitModifiers: Set<string>): void {
    const hitCount = rawMults.length;
    for (let i = 0; i < hitCount; i++) {
      const hitTime = baseTime + (offsets[i] ?? offsets[offsets.length - 1] ?? 0);
      this.damageQueue.push({
        originRow: currentData,
        originActionId: isProc ? moveData.name : currentData.action,
        originMoveData: moveData,
        hitIndex: i,
        totalHits: hitCount,
        hitMult: rawMults[i],
        origin,
        hitModifiers: hitModifiers,
        executeAt: roundFrames(hitTime),
        isProc: isProc
      });
    }
  }

  _queueProccedMechanic(currentData: any, proc: any, executeAt: number, team: any[]): void {
    const mData = proc.mechanicData;
    const rawProcMults = Array.isArray(mData.hitMults) ? mData.hitMults : [];
    const origin = MechanicKey.origin(mData.mechanicKey, proc.provider, mData.name);
    // Lets OnHit[...] target this proc by name.
    const procModifiers = modifierSet([...(mData.dmgTypes || []), ...(mData.castTypes || []), mData.name, origin.ref]);
    if (rawProcMults.length > 0) {
      // Optional damageTimeframe, offset from executeAt.
      const tfStart = this._resolveFrames(mData.damageTimeframe?.start, currentData, proc.provider, team, toFrames(0));
      const tfEnd = this._resolveFrames(mData.damageTimeframe?.end, currentData, proc.provider, team, tfStart);
      const offsets = hitFrameOffsets(rawProcMults.length, tfStart, tfEnd, this._hitFrameOverrides(mData, currentData, proc.provider, team));
      this._scheduleHits(currentData, mData, origin, rawProcMults, executeAt, offsets, true, procModifiers);
    }
    this.damageQueue.sort((a, b) => a.executeAt - b.executeAt);
  }

  // Emits an event and runs its listeners' effects. `modifiers` match `Event[...]` brackets.
  _fire(
    eventType: string, modifiers: Set<string>, currentData: any, provider: string, activeTeam: string[], activeRows: any[], team: any[],
    executeAt: number = this.currentGlobalRealTime, extraPayload: any = null
  ): void {
    this._nested(`${eventType}[${[...modifiers].join(', ')}]`, currentData, () => {
      const effects = EventManager.emit(eventType, modifiers, currentData, provider, team, extraPayload);
      this._executeEffectsStream(effects, currentData, activeTeam, activeRows, executeAt, provider, team);
    });
  }

  // Emits several events, gathering all effects before running any.
  _fireTrackerEvents(events: string[], trackerName: string, currentData: any, unitName: string, activeTeam: string[], activeRows: any[], team: any[]): void {
    this._nested(`${events.join(' + ')}[${trackerName}]`, currentData, () => {
      const effects = events.flatMap(event => EventManager.emit(event, eventModifier(trackerName), currentData, unitName, team));
      this._executeEffectsStream(effects, currentData, activeTeam, activeRows, this.currentGlobalRealTime, unitName, team);
    });
  }

  // Runs an event one level deeper; past MAX_EVENT_DEPTH it's dropped with a warning.
  _nested(label: string, currentData: any, run: () => void): void {
    if (this._eventChain.length >= MAX_EVENT_DEPTH) {
      const chain = [...this._eventChain.slice(-4), label].join(' → ');
      const msg = `Event loop stopped (... ${chain}) -- a rule's effects keep re-triggering events.`;
      if (Array.isArray(currentData.warningMsgs) && !currentData.warningMsgs.includes(msg)) currentData.warningMsgs.push(msg);
      return;
    }
    this._eventChain.push(label);
    try {
      run();
    } finally {
      this._eventChain.pop();
    }
  }

  // Evaluates a trigger rule, compiling and caching it on `holder`. null if no usable rule.
  _hitConditionPasses(hit: QueuedHit, currentData: any, team: any[]): boolean {
    const rule = hit.originMoveData.hitCondition;
    if (!rule || !rule.trim()) return true;
    let holder = this._hitConditions.get(hit.originMoveData);
    if (!holder) this._hitConditions.set(hit.originMoveData, holder = {});
    const onHit: RuleEvent[] = [{ type: 'OnHit', modifiers: hit.hitModifiers, unit: hit.origin.caster }];
    return this._evaluateRule(holder, rule, hitState(currentData, hit.originRow), hit.origin.caster, team, onHit) ?? true;
  }

  // `events`: what's happening as the rule is checked; its event part must match one.
  _evaluateRule(holder: { _compiledRule?: any }, rule: string, currentData: any, unit: string, team: any[], events?: RuleEvent[]): any {
    if (!holder._compiledRule || typeof holder._compiledRule.evaluate !== 'function') {
      holder._compiledRule = DSLParser.compile(rule);
    }
    if (!holder._compiledRule || typeof holder._compiledRule.evaluate !== 'function') return null;
    if (events && !ruleEventsMatch(holder._compiledRule, events, unit)) return false;
    return holder._compiledRule.evaluate(ContextManager.buildContext(currentData, unit, team), unit);
  }

  // Hold cursor physics and target window (0/0 for clamp).
  _resolveHoldCursor(config: HoldConfig, currentData: any, team: any[]): { config: HoldConfig; mode: string; speed: number; maxVal: number; center: number; size: number } {
    const defaults = MECHANICS_NOTATION.HOLD_DEFAULTS;
    const mode: string = config.cursorMode || defaults.CURSOR_MODE;
    const speed = config.cursorSpeed ?? defaults.CURSOR_SPEED;
    const maxVal = this._getHoldMaxCap(currentData.unit, config);
    let center = 0;
    let size = 0;
    if (mode !== 'clamp') {
      const centerExpr = config.windowCenter ?? defaults.WINDOW_CENTER;
      const sizeExpr = config.windowSize ?? defaults.WINDOW_SIZE;
      center = parseFloat(String(this._resolveDynamicMath(centerExpr, currentData, currentData.unit, team)));
      size = parseFloat(String(this._resolveDynamicMath(sizeExpr, currentData, currentData.unit, team)));
    }
    return { config, mode, speed, maxVal, center, size };
  }

  _executeEffectsStream(effectsArray: Effect[], currentData: any, activeTeam: string[], activeRows: any[], executeAt: number, defaultProvider: string, team: any[]): void {
    if (!effectsArray || effectsArray.length === 0) return;
    effectsArray.forEach((eff: any) => { if (eff.type === 'procced_mechanic') this._queueProccedMechanic(currentData, eff, executeAt, team); });
    effectsArray.forEach(eff => { if (eff.type !== 'procced_mechanic') this._processEffect(eff, currentData, eff.provider || defaultProvider, activeTeam, activeRows, currentData.arrayIndex, team); });
  }

  // Every measured value (_deltaMeasures) for two units (the enemy's, for Tune).
  _readPools(state: any, windowUnit: string, originUnit: string): { windowUnit: number[]; originUnit: number[] } {
    return {
      windowUnit: this._deltaMeasures.map(m => m.read(state, windowUnit)),
      originUnit: this._deltaMeasures.map(m => m.read(state, originUnit))
    };
  }

  // Adds to a row's delta tracker, even after its window has closed; past its "after" gauges, also to `late`.
  _creditDelta(row: any, measure: { delta: string; late?: string }, amount: number): void {
    if (!amount) return;
    let credits = this._deltaCredits.get(row);
    if (!credits) this._deltaCredits.set(row, credits = { adj: {}, done: false });
    if (!credits.done) {
      credits.adj[measure.delta] = (credits.adj[measure.delta] || 0) + amount;
      return;
    }
    row.trackers[measure.delta] = (row.trackers[measure.delta] || 0) + amount;
    if (measure.late && row._gaugesSettled) row.trackers[measure.late] = (row.trackers[measure.late] || 0) + amount;
  }

  // Logs Energy gains/spends per row for the required-ER analysis.
  _gainEnergy(currentData: any, unit: string, base: number, team: any[], scaled: boolean): void {
    if (!scaled) {
      (currentData.energyLog ??= []).push({ unit, flatGain: base });
      addResource(currentData, 'energy', unit, base, resourceCap(unit, 'energy'));
      return;
    }
    const erPct = energyRegenPct(currentData, unit, team);
    (currentData.energyLog ??= []).push({ unit, gain: base, erPct });
    addResource(currentData, 'energy', unit, base * (erPct / 100), resourceCap(unit, 'energy'));
  }

  // Non-Energy resource change; scaled gains use the unit's buildup rate.
  _changeResource(currentData: any, key: string, unit: string, amount: number, team: any[], scaled: boolean): void {
    const value = scaled && amount > 0 ? amount * buildupRateMult(currentData, unit, key, team) : amount;
    addResource(currentData, key, unit, value, resourceCap(unit, key));
  }

  // Resource change for one unit. `scaled`: a move's own resources (rates apply); effects are flat.
  _applyUnitResource(currentData: any, key: string, unit: string, amount: number, team: any[], scaled: boolean): void {
    if (key !== 'energy') return this._changeResource(currentData, key, unit, amount, team, scaled);
    if (amount > 0) return this._gainEnergy(currentData, unit, amount, team, scaled);
    if (amount < 0) (currentData.energyLog ??= []).push({ unit, spend: -amount });
    addResource(currentData, key, unit, amount, resourceCap(unit, key));
  }

  _applyCastResources(currentData: any, moveData: MechanicNode, activeTeam: string[], team: any[]): void {
    for (const key in moveData.castResources || {}) {
      const amount = this._resolveNumber(moveData.castResources![key], currentData, currentData.unit, team);
      if (!amount) continue;
      // Move Energy goes to the whole team; spends are the caster's.
      const units = key === 'energy' && amount > 0 ? activeTeam : [currentData.unit];
      units.forEach(unit => this._applyUnitResource(currentData, key, unit, amount, team, true));
    }
  }

  // Starts a move's cooldown and its shareCooldownWith partner's (one hop, partner's own values).
  _startCooldown(currentData: any, unitName: string, moveData: MechanicNode): void {
    this._startCooldownRaw(currentData, unitName, moveData);
    if (moveData.shareCooldownWith && moveData.shareCooldownWith !== moveData.name) {
      const partner = DataLoader.mechanicsDB[MechanicKey.build(unitName, moveData.shareCooldownWith)];
      if (partner) this._startCooldownRaw(currentData, unitName, partner);
    }
  }

  _startCooldownRaw(currentData: any, unitName: string, moveData: MechanicNode): void {
    const cdVal = parseFloat(String(moveData.cooldown));
    if (!(cdVal > 0)) return;
    const maxCharges = Math.max(1, parseInt(String(moveData.maxCharges ?? 1), 10) || 1);
    const key = scopedKey(unitName, moveData.name);
    this._cooldownOwners.set(key, { unit: unitName, name: moveData.name || '' });
    if (maxCharges > 1) ((currentData.chargeCooldowns ??= {})[key] ??= []).push(cdVal);
    else (currentData.cooldowns ??= {})[key] = cdVal;
  }

  _gatherInstantEffects(currentData: any, moveData: MechanicNode, prevData: any, castModifiers: Set<string>, team: any[]): Effect[] {
    const sourceOwner = MechanicKey.origin(currentData.action, currentData.unit, moveData.name).owner;
    const effects: Effect[] = (moveData.effects || []).map(eff => ({ ...eff, sourceOwner: eff.sourceOwner ?? sourceOwner }));
    effects.push(...EventManager.emit('OnCast', castModifiers, currentData, currentData.unit, team));
    if (prevData?.unit && prevData.unit !== currentData.unit) {
      effects.push(...EventManager.emit('OnSwapOut', new Set(), currentData, prevData.unit, team));
      (currentData._swapRemovedBuffs || []).forEach((buff: any) => {
        effects.push(...EventManager.emit('OnBuffRemove', eventModifier(buff.name), currentData, buff.provider || prevData.unit, team));
      });
      effects.push(...EventManager.emit('OnSwapIn', new Set(), currentData, currentData.unit, team));
      effects.push(...EventManager.emit('OnUnitChange', new Set(), currentData, currentData.unit, team));
    }
    delete currentData._swapRemovedBuffs;
    return effects;
  }

  _evaluateMechanics(currentData: any, activeTeam: string[], activeRows: any[], currentIndex: number, team: any[], dbMove: MechanicNode): void {
    const unitName = currentData.unit;
    const moveData = dbMove;
    const prevData = currentIndex > 0 ? activeRows[currentIndex - 1] : this._getDefaultData(team[0]?.character);
    const startValues = this._deltaMeasures.map(m => m.read(currentData, unitName));
    // Hits landing during the wait aren't in the window measured below.
    const credits = { adj: {} as Record<string, number>, done: false };
    this._deltaCredits.set(currentData, credits);

    // Motion stop delays other units' pending hits.
    const motionStop = currentData.motionStop || 0;
    if (motionStop > 0) {
      this.damageQueue.forEach(queuedHit => {
        if (queuedHit.origin.caster !== unitName) queuedHit.executeAt += motionStop;
      });
      this.damageQueue.sort((a, b) => a.executeAt - b.executeAt);
    }

    const origin = MechanicKey.origin(currentData.action, unitName, moveData.name);

    // Name/pointer let OnHit[...] target this specific move.
    const hitModifiers = modifierSet([...(moveData.dmgTypes || []), moveData.name, origin.ref]);
    const castModifiers = castModifiersOf(currentData.action, moveData, unitName);

    // OnCast/swap rules see the pre-cast state; their effects run after costs.
    const instantEffects = this._gatherInstantEffects(currentData, moveData, prevData, castModifiers, team);

    if (moveData.cooldown || moveData.shareCooldownWith) {
      this._startCooldown(currentData, unitName, moveData);
      this._logTimeline(currentData);
    }
    this._applyCastResources(currentData, moveData, activeTeam, team);

    const rawHitMults = Array.isArray(moveData.hitMults) ? moveData.hitMults : [];
    if (rawHitMults.length > 0) {
      const tfStart = currentData.damageTimeframe?.start || 0;
      const tfEnd = currentData.damageTimeframe?.end || currentData.baseDuration;
      const offsets = hitFrameOffsets(rawHitMults.length, tfStart, tfEnd, currentData.hitFrameOverrides);
      this._scheduleHits(currentData, moveData, origin, rawHitMults, currentData.timeStart, offsets, false, hitModifiers);
    }

    this._executeEffectsStream(instantEffects, currentData, activeTeam, activeRows, currentData.timeStart, unitName, team);
    this.damageQueue.sort((a, b) => a.executeAt - b.executeAt);

    // Hold trackers are cleared by the Release's own effects, not here.

    // Simultaneous rows don't advance the clock.
    const isSimultaneous = currentData.timing === 'Simultaneous';
    this._decayState(
      currentData,
      isSimultaneous ? toFrames(0) : toFrames(Math.max(0, currentData.duration || 0)),
      isSimultaneous ? toFrames(0) : toFrames(Math.max(0, currentData.gameTimePassed || 0)),
      activeTeam,
      activeRows,
      team,
      toFrames(currentData.freezeStart || 0)
    );

    if (!currentData.trackers) currentData.trackers = {};
    this._deltaMeasures.forEach((measure, i) => {
      const windowChange = measure.read(currentData, unitName) - startValues[i];
      currentData.trackers[measure.delta] = windowChange + (credits.adj[measure.delta] || 0);
    });
    credits.done = true;
  }

  _runValidation(currentData: any, prevData: any, team: any[], dbMove: MechanicNode): void {
    const errors: string[] = [];
    const warnings: string[] = [];
    currentData.errorMsgs = errors;
    currentData.warningMsgs = warnings;
    const moveData = dbMove;
    const moveName = moveData.name || currentData.action;

    // Energy shortfall is a warning; other resources are errors.
    const buildEnergyShortfallMsg = (myVal: number, req: number) => {
      const base = `${currentData.unit} has ${myVal.toFixed(1)} out of the required ${req} Resonance Energy`;
      if (myVal <= 0) return `${base}.`;
      // ER% needed to close the gap.
      const erTotal = energyRegenPct(currentData, currentData.unit, team);
      const extraErNeeded = erTotal * ((req - myVal) / myVal);
      return `${base} (Needs ${extraErNeeded.toFixed(0)}% ER on top of the current ${erTotal.toFixed(0)}% ER).`;
    };

    const validateRes = (key: string, myVal: number, label: string) => {
      const req = resourceRequirement(moveData, key, v => this._resolveNumber(v, currentData, currentData.unit, team));
      if (req > 0 && myVal < req) {
        if (key === 'energy') warnings.push(buildEnergyShortfallMsg(myVal, req));
        else errors.push(`Not enough ${label} (Needs ${req}).`);
      }
    };

    for (const key of RESOURCE_KEYS) {
      validateRes(key, readResource(currentData, key, currentData.unit), resourceLabel(key, DataLoader.characterDB[currentData.unit]));
    }

    // Cooldown wait warning, independent of resource warnings.
    const cooldownWarning = this._cooldownWaitWarning(currentData, moveName);
    if (cooldownWarning) warnings.push(cooldownWarning);

    // Hold cursor can't reach its target within holdLookaheadMax.
    if (currentData._holdUnreachable) {
      errors.push(`${moveName} never reaches its ${currentData._holdUnreachable} within ${GAME_DEFAULTS.holdLookaheadMax}f -- check the hold's speed/config.`);
    }

    if (moveData.triggerRule && !moveData.isPassive) {
      const ownEvents = rowStartEvents(currentData.action, moveData, currentData.unit, prevData.unit);
      const passed = this._evaluateRule(moveData, moveData.triggerRule, currentData, currentData.unit, team, ownEvents);
      // Only when nothing more specific explains the failure.
      if (passed !== null && !passed && errors.length === 0 && warnings.length === 0) {
        warnings.push(`Combo requirement not met for ${moveName}.`);
      }
    }

    if (currentData.timing === 'Simultaneous' && !moveData.simultaneous && moveData.castTypes?.includes('Echo')) {
      warnings.push(`${moveName} can't be cast simultaneously.`);
    }

    if (moveData.stanceReq && moveData.stanceReq !== 'Any') {
      const actualStance = currentData.entryStance || 'Grounded';
      if (actualStance !== moveData.stanceReq) {
        warnings.push(`Stance mismatch: Requires ${moveData.stanceReq}, but character is ${actualStance}.`);
      }
    }

    const prevWasOutro = !!prevData.castTypes?.includes('Outro');
    const currIsOutro = !!currentData.castTypes?.includes('Outro');
    if (prevWasOutro && currentData.unit === prevData.unit) {
      errors.push('The next move after an outro must be on a different unit.');
    }
    if (isSwapTiming(prevData.timing) && !currIsOutro && currentData.unit === prevData.unit) {
      errors.push('The next move after a swap timing must be an Outro or different unit.');
    }
    const isIntro = !!currentData.castTypes?.includes('Intro');
    if (prevData.unit && currentData.unit !== prevData.unit) {
      if (prevWasOutro) {
        if (!isIntro) errors.push('Must use an Intro skill immediately after an Outro.');
      } else if (isIntro) {
        errors.push('Intro skills can only be used immediately after an Outro.');
      }
    }

    // The swap-in is the unit's first non-simultaneous move: simultaneous ones (echoes) cast alongside it.
    const isSimultaneousRow = (row: any) => row?.timing === 'Simultaneous';
    let swapFrom = prevData;
    while (swapFrom?.unit === currentData.unit && isSimultaneousRow(swapFrom) && swapFrom.prevRow) swapFrom = swapFrom.prevRow;
    const isSwapIn = !!swapFrom?.unit && swapFrom.unit !== currentData.unit && !isSimultaneousRow(currentData);
    if (isSwapIn && !swapFrom.castTypes?.includes('Outro') && !isIntro) {
      const myCombo = swapFrom.unitCombos?.[currentData.unit];
      const isSwapback = myCombo && currentData.gameTimeStart <= myCombo.expiration;
      if (!isSwapback) {
        // .provider is only set for third-party sources (echoes).
        const expectedSwapIns: string[] = [];
        const fitsStance = (m: MechanicNode) => !m.stanceReq || m.stanceReq === 'Any' || m.stanceReq === (currentData.entryStance || 'Grounded');
        (DataLoader.mechanicsIndex[currentData.unit] || []).forEach(key => {
          const m = DataLoader.mechanicsDB[key];
          if (!m || !m.isSwapInDefault || !fitsStance(m)) return;
          const isValid = m.triggerRule && !m.isPassive
            ? this._evaluateRule(m, m.triggerRule, currentData, currentData.unit, team, rowStartEvents(key, m, currentData.unit, swapFrom.unit)) ?? true
            : true;
          if (isValid) expectedSwapIns.push(m.name);
        });
        // Hold moves can be held through the swap.
        if (expectedSwapIns.length > 0 && !moveData.isSwapInDefault && moveData.inputType !== 'Hold') {
          errors.push(`Standard swap-in expected. Must use: ${expectedSwapIns.join(' or ')}.`);
        }
      }
    }
  }

  // Cooldown wait over 3 frames, or null.
  _cooldownWaitWarning(row: any, moveName: string): string | null {
    return row.cdWaitTime > 3 ? `${moveName} needs ${formatFramesAsSeconds(row.cdWaitTime)} more ${COOLDOWN_WARNING_TAIL}` : null;
  }

  _rankOf(unit: string, team: any[]): number {
    return team.find(t => t.character === unit)?.rank ?? CHARACTER_DEFAULTS.rank;
  }

  _resolveDynamicMath(mathStr: string, currentData: any, unitName: string, team: any[]): number | string {
    // @Default-only math skips building the full context.
    const ctx = readsOnlyDefaults(mathStr) ? DEFAULTS_ONLY_CTX : ContextManager.buildContext(currentData, unitName, team);
    if (!ctx) return 0;
    return asDslResult(String(mathStr), DSLParser.evaluateMath(mathStr, ctx, unitName));
  }

  // Applies one effect. ALWAYS listeners sit out the events they fire.
  _processEffect(effect: Effect, currentData: any, unitName: string, activeTeam: string[], activeRows: any[], currentIndex: number, team: any[]): void {
    const { [ALWAYS_SOURCE]: alwaysListener, ...plainEffect } = effect;
    if (effect.type === ALWAYS_CHECK) {
      if (EventManager.applying.has(alwaysListener)) return;
      const { listener, activeUnitName } = effect as any;
      EventManager.checkAlways(listener, currentData, activeUnitName, team)
        .forEach(eff => this._processEffect(eff, currentData, eff.provider || unitName, activeTeam, activeRows, currentIndex, team));
      return;
    }
    if (!alwaysListener || EventManager.applying.has(alwaysListener)) {
      this._applyEffect(plainEffect, currentData, unitName, activeTeam, activeRows, currentIndex, team);
      return;
    }
    EventManager.applying.add(alwaysListener);
    try {
      this._applyEffect(plainEffect, currentData, unitName, activeTeam, activeRows, currentIndex, team);
    } finally {
      EventManager.applying.delete(alwaysListener);
    }
  }

  _applyEffect(effect: Effect, currentData: any, unitName: string, activeTeam: string[], activeRows: any[], currentIndex: number, team: any[]): void {
    const resolvedEffect = { ...effect };
    const resolve = (val: any) => isDslExpr(val, true) ? this._resolveDynamicMath(val, currentData, unitName, team) : val;
    const isBuff = isBuffEffect(resolvedEffect);
    if (!isBuff) {
      // Per-rank list ("8/10/12/14/16"): pick by weapon rank.
      const value = CommonUtils.isRankValue(resolvedEffect.value)
        ? CommonUtils.parseRankValue(resolvedEffect.value, this._rankOf(effect.provider || unitName, team))
        : resolvedEffect.value;
      resolvedEffect.value = resolve(value);
    }
    resolvedEffect.duration = resolve(resolvedEffect.duration) as number;
    if (resolvedEffect.maxStacks !== undefined) resolvedEffect.maxStacks = resolve(resolvedEffect.maxStacks) as number;

    const originalProvider = resolvedEffect.provider;
    const namesUnit = !isPlaceholderProvider(originalProvider);
    if (!resolvedEffect.source) resolvedEffect.source = namesUnit ? originalProvider : currentData.moveName;
    if (!namesUnit || originalProvider === resolvedEffect.source) resolvedEffect.provider = unitName;

    if (resolvedEffect.target === '@Next' || resolvedEffect.target === 'Next') {
      if (!currentData.pendingNextBuffs) currentData.pendingNextBuffs = [];
      currentData.pendingNextBuffs.push(resolvedEffect);
      return;
    }

    const targetUnits = this._resolveTargets(resolvedEffect.target, unitName, activeTeam, activeRows, currentIndex);
    if (resolvedEffect.type === 'tracker') this._handleTracker(resolvedEffect, currentData, unitName, activeTeam, activeRows, team);
    else if (resolvedEffect.type === 'cooldown') {
      targetUnits.forEach(t => {
        const key = scopedKey(t, resolvedEffect.name);
        (currentData.cooldowns ??= {})[key] = resolvedEffect.value;
        this._cooldownOwners.set(key, { unit: t, name: resolvedEffect.name || '' });
      });
      this._logTimeline(currentData);
    }
    else if (isBuff) this._updateActiveBuffs(resolvedEffect, currentData, targetUnits, activeTeam, activeRows, team);
    else if (resolvedEffect.type === 'resource') this._handleResourceEffect(resolvedEffect, currentData, targetUnits, team);
    else if (resolvedEffect.type === 'buffAction') this._handleBuffActionEffect(resolvedEffect, currentData, targetUnits, activeTeam, activeRows, team);
    else if (resolvedEffect.type === 'time_scale') { if (!currentData.timeScales) currentData.timeScales = {}; currentData.timeScales['ts_' + Math.random()] = resolvedEffect; }
  }

  _handleResourceEffect(resolvedEffect: Effect, currentData: any, targetUnits: string[], team: any[]): void {
    const amt = parseFloat(String(resolvedEffect.value || '0')) || 0;
    const resKey = resolvedEffect.name;
    if (!resKey) return;
    // Only hit resources (rateScaled) use regen/buildup rates.
    const scaled = resolvedEffect.rateScaled === true;
    // Enemy pool, at the causing unit's rate.
    if (isEnemyResource(resKey)) return this._changeResource(currentData, resKey, resolvedEffect.provider || currentData.unit, amt, team, scaled);
    targetUnits.forEach(tName => this._applyUnitResource(currentData, resKey, tName, amt, team, scaled));
  }

  _handleBuffActionEffect(effect: Effect, currentData: any, targetUnits: string[], activeTeam: string[], activeRows: any[], team: any[]): void {
    targetUnits.forEach(targetName => {
      const buffKey = scopedKey(targetName, effect.name);
      const buff = currentData.activeBuffs?.[buffKey];
      if (buff) {
        markBuffsChanged(currentData);
        if (effect.action === 'pause') buff.isPaused = true;
        else if (effect.action === 'resume') buff.isPaused = false;
        else if (effect.action === 'extend' && effect.value !== undefined) {
          buff.duration = (buff.duration || 0) + parseFloat(String(effect.value));
          this._refreshedBuffs.add(buffKey);
        }
        else if (effect.action === 'remove' || effect.action === 'consume') {
          // Remove and Consume share stack math; only the fired event differs.
          buff.stacks = stacksAfterSpending(buff.stacks || 1, effect.value !== undefined ? effect.value : 'ALL', true);
          if ((buff.stacks || 0) <= 0) {
            if (buff.linkedTracker && currentData.trackers) currentData.trackers[buff.linkedTracker] = 0;
            delete currentData.activeBuffs[buffKey];
          }
          this._logTimeline(currentData);
          this._fire(effect.action === 'consume' ? 'OnBuffConsume' : 'OnBuffRemove', eventModifier(effect.name), currentData, effect.provider || currentData.unit, activeTeam, activeRows, team);
        }
      }
    });
    this._logTimeline(currentData);
  }

  _resolveTargets(targetStr: string | undefined, unitName: string, activeTeam: string[], activeRows: any[], currentIndex: number): string[] {
    if (targetStr === '@Self') return [unitName];
    if (targetStr === '@Team') return [...activeTeam];
    if (targetStr === '@TeamOthers') return activeTeam.filter(c => c !== unitName);
    // @Target is an alias of @Enemy.
    if (targetStr === '@Enemy' || targetStr === '@Target') return ['Enemy'];
    if (targetStr === '@Active') return ['Active'];
    if (targetStr === '@Next') {
      if (activeRows && currentIndex + 1 < activeRows.length) return [activeRows[currentIndex + 1].unit];
      return ['Next'];
    }
    return [targetStr || unitName];
  }

  _handleTracker(effect: Effect, currentData: any, unitName: string, activeTeam: string[], activeRows: any[], team: any[]): void {
    if (!currentData.trackers) currentData.trackers = {};
    const action = effect.action || 'add';
    const name = effect.name || '';
    const amount = effect.value !== undefined ? parseFloat(String(effect.value)) : 1;

    // Deletes the key entirely.
    if (action === 'delete') {
      if (currentData.trackers[name] === undefined) return;
      delete currentData.trackers[name];
      // Ownership bookkeeping for Hold_Start.
      if (name === 'Hold_Start') {
        delete currentData.trackers.Hold_Unit;
        delete currentData.trackers.Hold_Input;
        const config = DataLoader.mechanicsDB[currentData.action]?.holdConfig || {};
        const retain = config.retainCursor ?? MECHANICS_NOTATION.HOLD_DEFAULTS.RETAIN_CURSOR;
        if (retain) {
          currentData.trackers.Cursor_Accumulated = currentData.trackers.Cursor_Pos || 0;
        } else {
          delete currentData.trackers.Cursor_Accumulated;
          currentData.trackers.Cursor_Pos = 0;
        }
      }
      this._fireTrackerEvents(['OnTrackerChanged', 'OnTrackerRemove'], name, currentData, unitName, activeTeam, activeRows, team);
      return;
    }

    const currentVal = currentData.trackers[name] || 0;
    let newVal = currentVal;
    let eventToEmit: string | null = null;

    if (action === 'add') {
      newVal = Math.max(0, Math.min(currentVal + amount, effect.max || Infinity));
      if (newVal > currentVal) eventToEmit = 'OnTrackerAdd';
      else if (newVal < currentVal) eventToEmit = 'OnTrackerRemove';
    } else if (action === 'remove') {
      newVal = Math.max(0, currentVal - amount);
      eventToEmit = 'OnTrackerRemove';
    } else if (action === 'consume') {
      // ALL/HALF/N stack math; unset means ALL.
      const spec = effect.value !== undefined ? effect.value : 'ALL';
      const remaining = stacksAfterSpending(currentVal, spec, false);
      newVal = spec === 'HALF' ? remaining : Math.max(0, remaining);
      eventToEmit = 'OnTrackerConsume';
    } else if (action === 'set' || action === 'copy') {
      newVal = parseFloat(String(effect.value)) || 0;
      if (newVal > currentVal) eventToEmit = 'OnTrackerAdd';
      else if (newVal < currentVal) eventToEmit = 'OnTrackerRemove';
    } else if (action === 'detonate' && currentVal > 0) {
      this._fireTrackerEvents(['OnTrackerDetonate'], name, currentData, unitName, activeTeam, activeRows, team);
      newVal = Math.max(0, currentVal - amount);
    }

    // Setting to 0 still creates the tracker (Hold at time 0).
    const createsTracker = (action === 'set' || action === 'copy') && currentData.trackers[name] === undefined;
    if (newVal === currentVal && action !== 'detonate' && !createsTracker) return;

    currentData.trackers[name] = newVal;

    // Stamp the hold's owner so other units' rows ignore it.
    if (name === 'Hold_Start') {
      currentData.trackers.Hold_Unit = unitName;
      // Pairs the Hold with its Release by input.
      const pressMove = DataLoader.mechanicsDB[currentData.action];
      const inputTag = pressMove?.input;
      if (inputTag) currentData.trackers.Hold_Input = inputTag;
      // Clamp: start from the current forte value unless a cursor was retained.
      const releaseConfig = DataLoader.findHoldReleaseConfig(unitName, inputTag);
      if (releaseConfig?.cursorMode === 'clamp' && currentData.trackers.Cursor_Accumulated === undefined) {
        const slot = releaseConfig.forteSlot || MECHANICS_NOTATION.HOLD_DEFAULTS.FORTE_SLOT;
        currentData.trackers.Cursor_Accumulated = currentData[slot]?.[unitName] || 0;
      }
    }

    this._logTimeline(currentData);
    if (action !== 'detonate') {
      this._fireTrackerEvents(eventToEmit ? ['OnTrackerChanged', eventToEmit] : ['OnTrackerChanged'], name, currentData, unitName, activeTeam, activeRows, team);
    }
  }

  // Logs buff/tracker/cooldown changes since the last call to currentData.timelineEvents.
  _logTimeline(currentData: any): void {
    if (!this._run.hitLog || this._dryRun) return;
    const now = this.currentGlobalGameTime;
    const events: any[] = (currentData.timelineEvents ||= []);
    const buffs = currentData.activeBuffs || {};

    for (const key in buffs) {
      const buff = buffs[key];
      const stacks = buff.stacks || 0;
      const sig = `${buff.stat ?? ''}|${buff.value ?? ''}|${buff.label ?? ''}`;
      const prev = this._buffWatch.get(key);
      const change = !prev ? 'start'
        : prev.sig !== sig || this._refreshedBuffs.has(key) ? 'refresh'
        : prev.stacks !== stacks ? 'stacks'
        : null;
      if (!change) continue;
      this._buffWatch.set(key, { sig, stacks });
      events.push({
        kind: 'buff', change, t: this._buffRanOutAt.get(key) ?? now, key, info: timelineBuffInfo(buff), stacks,
        // Seconds left (longest-lived stack).
        remaining: buff.duration ?? (buff.durations?.length ? Math.max(...buff.durations) : undefined)
      });
    }
    for (const key of [...this._buffWatch.keys()]) {
      if (key in buffs) continue;
      this._buffWatch.delete(key);
      events.push({ kind: 'buff', change: 'end', t: this._buffRanOutAt.get(key) ?? now, key });
    }
    this._refreshedBuffs.clear();

    const trackers = currentData.trackers || {};
    for (const name in trackers) {
      const value = Number(trackers[name]);
      if (!isTimelineTracker(name) || isNaN(value) || this._trackerWatch.get(name) === value) continue;
      this._trackerWatch.set(name, value);
      events.push({ kind: 'tracker', t: now, name, value });
    }
    for (const name of [...this._trackerWatch.keys()]) {
      if (name in trackers) continue;
      this._trackerWatch.delete(name);
      events.push({ kind: 'tracker', t: now, name, value: 0 });
    }

    // Cooldowns log on start, restart, reduction, or charge count change.
    const timers = new Map<string, { remaining: number; until: number; charges?: number }>();
    for (const key in currentData.cooldowns || {}) {
      const left = currentData.cooldowns[key];
      timers.set(key, { remaining: left, until: left });
    }
    for (const key in currentData.chargeCooldowns || {}) {
      const pending: number[] = currentData.chargeCooldowns[key];
      if (pending.length > 0) timers.set(key, { remaining: Math.min(...pending), until: Math.max(...pending), charges: pending.length });
    }
    const runsOut = (at: number, seconds: number) => Math.min(now, at + secondsToFrames(seconds));
    for (const [key, timer] of timers) {
      const prev = this._cooldownWatch.get(key);
      if (prev && prev.charges === timer.charges) {
        // Mid-segment reads can lag; only clear rises/drops count.
        const expected = prev.remaining - framesToSeconds(toFrames(now - prev.at));
        if (timer.remaining <= prev.remaining + 0.05 && timer.remaining >= expected - 0.05) continue;
      }
      this._cooldownWatch.set(key, { ...timer, at: now });
      const owner = this._cooldownOwners.get(key) ?? { unit: key.split('_')[0], name: key.slice(key.indexOf('_') + 1) };
      const t = prev && timer.charges !== undefined && (timer.charges ?? 0) < (prev.charges ?? 0) ? runsOut(prev.at, prev.remaining) : now;
      events.push({ kind: 'cooldown', t, ...timelineCooldownInfo(key, owner.unit, owner.name), remaining: timer.remaining, charges: timer.charges });
    }
    for (const [key, prev] of [...this._cooldownWatch]) {
      if (timers.has(key)) continue;
      this._cooldownWatch.delete(key);
      events.push({ kind: 'cooldown', change: 'end', t: runsOut(prev.at, prev.until), key });
    }
  }

  _updateActiveBuffs(buffDef: Effect, currentData: any, targetUnits: string[], activeTeam: string[], activeRows: any[], team: any[]): void {
    const buffName = buffDef.name || '';
    if (buffDef.stat || buffDef.label) {
      this._localBuffCache[buffName] = cloneJson(buffDef);
    } else {
      let cachedTemplate: Effect | null | undefined = this._localBuffCache[buffName];
      if (!cachedTemplate) {
        if (this._globalBuffCache[buffName] === undefined) {
          const template = Object.values(DataLoader.mechanicsDB)
            .flatMap(m => m.effects || [])
            .find(e => isBuffEffect(e) && e.name === buffDef.name && (e.stat || e.label));
          this._globalBuffCache[buffName] = template ? cloneJson(template) : null;
        }
        cachedTemplate = this._globalBuffCache[buffName];
        if (cachedTemplate) this._localBuffCache[buffName] = cachedTemplate;
      }
      if (cachedTemplate) {
        const template = cachedTemplate as Record<string, any>;
        for (const key in template) {
          if ((buffDef as any)[key] === undefined) (buffDef as any)[key] = typeof template[key] === 'object' ? cloneJson(template[key]) : template[key];
        }
      }
    }

    // Unset or unreadable: permanent.
    const duration = parseFloat(String(isDslExpr(buffDef.duration, true)
      ? this._resolveDynamicMath(buffDef.duration, currentData, currentData.unit, team)
      : buffDef.duration));
    const effDuration = isNaN(duration) ? GAME_DEFAULTS.permanentDuration : duration;
    const val = CommonUtils.isRankValue(buffDef.value)
      ? CommonUtils.parseRankValue(buffDef.value, this._rankOf(buffDef.provider || currentData.unit, team))
      : buffDef.value;

    targetUnits.forEach(targetName => {
      const key = scopedKey(targetName, buffDef.name);
      if (!currentData.activeBuffs) currentData.activeBuffs = {};
      const existingBuff = currentData.activeBuffs[key];
      const addedStacks = buffDef.stacks !== undefined ? parseInt(String(buffDef.stacks), 10) : 1;
      let actuallyAddedStacks: number;

      // False for a no-op re-application.
      let changed = true;
      if (existingBuff) {
        const before = { label: existingBuff.label, stat: existingBuff.stat, value: existingBuff.value, stacks: existingBuff.stacks };
        if (buffDef.label) existingBuff.label = buffDef.label;
        if (buffDef.stat) existingBuff.stat = buffDef.stat;
        if (buffDef.value !== undefined) existingBuff.value = val;
        const oldStacks = existingBuff.stacks || 0;
        const maxStacks = Number(buffDef.maxStacks) || 1;
        existingBuff.stacks = Math.min(oldStacks + addedStacks, maxStacks);
        actuallyAddedStacks = existingBuff.stacks - oldStacks;
        if (buffDef.stackBehavior === 'separate') {
          if (!existingBuff.durations) existingBuff.durations = [];
          for (let i = 0; i < addedStacks; i++) existingBuff.durations.push(effDuration);
          existingBuff.durations = existingBuff.durations.sort((a: number, b: number) => b - a).slice(0, maxStacks);
        } else {
          existingBuff.duration = effDuration;
          if (effDuration < GAME_DEFAULTS.permanentDuration) this._refreshedBuffs.add(key);
          else changed = before.label !== existingBuff.label || before.stat !== existingBuff.stat
            || before.value !== existingBuff.value || before.stacks !== existingBuff.stacks;
        }
      } else {
        currentData.activeBuffs[key] = {
          ...buffDef,
          value: val,
          target: targetName,
          // Original selector (@Team, @Next...).
          appliesTo: buffDef.appliesTo ?? buffDef.target,
          stacks: addedStacks,
          maxDuration: effDuration,
          duration: buffDef.stackBehavior === 'separate' ? undefined : effDuration,
          durations: buffDef.stackBehavior === 'separate' ? [effDuration] : undefined
        };
        actuallyAddedStacks = addedStacks;
      }

      if (changed) {
        markBuffsChanged(currentData);
        this._logTimeline(currentData);
      }
      if (actuallyAddedStacks > 0) {
        this._fire('OnBuffAdd', eventModifier(buffDef.name), currentData, buffDef.provider || currentData.unit, activeTeam, activeRows, team);
      }
    });
  }

  // Hold cursor max: the forte slot's cap (default Forte 1).
  _getHoldMaxCap(charName: string, config: HoldConfig): number {
    const slot = config.forteSlot || MECHANICS_NOTATION.HOLD_DEFAULTS.FORTE_SLOT;
    const slotNum = holdSlotNumber(slot);
    const forteCount = parseInt(String(DataLoader.characterDB[charName]?.forteCount), 10) || 1;
    if (slotNum > forteCount) {
      console.warn(`[TimelineEngine] ${charName}'s hold config targets ${slot}, but the character only has ${forteCount} forte slot(s) -- falling back to forte1.`);
      return resourceCap(charName, forteKey(1));
    }
    return resourceCap(charName, slot);
  }
}

export const TimelineEngine = new TimelineEngineClass();