import { DataLoader } from '../utils/DataLoader';
import { getMechanicOwners } from './MechanicOwners';
import {
  RESOURCE_KEYS, WAITABLE_RESOURCE_KEYS, addResource, spendResource, readResource, resourceCap,
  energyRegenMult, energyRegenPct, resourceLabel, resourceRequirement, capHitIndex
} from './resources';
import { deltaKey, forteKey, holdSlotNumber } from '../utils/ResourceKeys';
import { backfillPools, cloneJson, dropdownSnapshot, inheritPools, plainCopy, ROW_LINK_KEYS } from './rowState';
import { eventModifier, isDslExpr, modifierSet, stacksAfterSpending } from './engineValues';
import { isElement } from '../data/gameVocab';
import { MechanicKey } from '../utils/MechanicKey';
import { CommonUtils } from '../utils/Common';
import { teamCharacters } from '../utils/TeamUtils';
import { DSLParser } from './dsl/dslParser';
import { ContextManager } from './ContextManager';
import { EventManager } from './EventManager';
import { calculateEchoStatsForSlot } from '../store/useRosterStore';
import { CHARACTER_DEFAULTS, ENEMY_DEFAULTS, GAME_DEFAULTS, MECHANICS_NOTATION } from '../data/db';
import type { Effect, MechanicNode, HoldConfig, MoveOrigin } from '../types';
import { sortedStanceChanges } from '../utils/Stance';
import { type Frames, toFrames, roundFrames, secondsToFrames, framesToSeconds, formatFramesAsSeconds } from '../utils/Frames';

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

// What a run produces. Each mode skips the work whose output nobody reads, so a throwaway pass
// isn't slowed down by bookkeeping meant for the screen.
//   full    the rotation table: everything, plus console warnings for rows with problems
//   silent  the same rows and hits without the warnings, for passes that re-simulate rows
//           another pass already reported (Results, the Ending Rotation preview)
//   lean    only timings, resources and messages: no dropdown snapshots and no per-hit damage
//           log, for the loop analysis, which never reads them
export type EngineMode = 'full' | 'silent' | 'lean';
const RUN_PROFILES: Record<EngineMode, { dropdownSnapshots: boolean; hitLog: boolean; logWarnings: boolean }> = {
  full:   { dropdownSnapshots: true,  hitLog: true,  logWarnings: true },
  silent: { dropdownSnapshots: true,  hitLog: true,  logWarnings: false },
  lean:   { dropdownSnapshots: false, hitLog: false, logWarnings: false }
};

export class TimelineEngineClass {
  damageQueue: QueuedHit[] = [];
  currentGlobalGameTime = 0;
  currentGlobalRealTime = 0;
  isRecalculating = false;
  lastSwapOutTime: Record<string, number> = {};
  _localBuffCache: Record<string, Effect> = {};
  _globalBuffCache: Record<string, Effect | null> = {};
  _enemyConfig: { level: number; res: number; hp: number } = ENEMY_DEFAULTS;
  // Which optional work this recalculateState call does (see EngineMode).
  _run = RUN_PROFILES.full;
  // Memoizes _getModifiedMoveData per actionId for one recalculateState call; reset each call.
  _moveDataCache: Record<string, MechanicNode | null> = {};

  recalculateState(
    activeRows: any[],
    team: any[] = [],
    options: { startEnergy?: boolean; startConcerto?: boolean; mode?: EngineMode } = {},
    enemyConfig: { level: number; res: number; hp: number } = ENEMY_DEFAULTS
  ): any[] {
    if (activeRows.length === 0) return [];

    this.isRecalculating = true;
    this._run = RUN_PROFILES[options.mode ?? 'full'];
    this._moveDataCache = {};
    this._enemyConfig = enemyConfig;
    this.damageQueue = [];
    this.currentGlobalGameTime = 0;
    this.currentGlobalRealTime = 0;
    this.lastSwapOutTime = {};
    this._localBuffCache = {};

    if (team && team.length > 0) {
      team.forEach(slot => {
        if (slot && slot.character) {
          slot.echoStats = calculateEchoStatsForSlot(slot);
        }
      });
    }

    const activeTeam = this._setupEventBoard(team);
    let accumulatedTime = 0;
    let accumulatedGameTime = 0;
    const unitBusyUntil: Record<string, number> = {};
    let globalSwapCdExpiresAt = 0;

    // Link row pointers (@Prev, @Next, @Self.PrevAction)
    activeRows.forEach((row, i) => {
      row.arrayIndex = i;
      row.prevRow = i > 0 ? activeRows[i - 1] : null;
      row.nextRow = i < activeRows.length - 1 ? activeRows[i + 1] : null;
    });
    // @Self.NextAction: each unit's next action after a row, which isn't necessarily the next row's.
    const upcomingActions: Record<string, string> = {};
    for (let i = activeRows.length - 1; i >= 0; i--) {
      const row = activeRows[i];
      row.nextUnitActions = { ...upcomingActions };
      if (row.unit && row.action) upcomingActions[row.unit] = row.action;
    }

    for (let i = 0; i < activeRows.length; i++) {
      const currentData = activeRows[i];
      currentData.dropdownState = null;
      currentData.enemyLevel = enemyConfig.level;
      currentData.enemyRes = enemyConfig.res;

      if (!currentData.unit) {
        const prevData = i > 0 ? activeRows[i - 1] : this._getDefaultData(team[0]?.character);
        this._applyInheritance(currentData, prevData, accumulatedGameTime, team);
        currentData.timeStart = accumulatedTime;
        currentData.gameTimeStart = accumulatedGameTime;
        if (this._run.dropdownSnapshots) currentData.dropdownState = plainCopy(currentData, ROW_LINK_KEYS);
        continue;
      }

      const prevData = i > 0 ? activeRows[i - 1] : this._getDefaultData(team[0]?.character);
      currentData.damageInstances = [];
      currentData._pendingHits = [];
      // Rows are recalculated in place -- clear so a fixed hold config doesn't keep showing
      // last run's "unreachable" error.
      currentData._holdUnreachable = undefined;

      // Populated by the auto-wait lookahead below when this row's own action is a Release --
      // the live cursor-tracking block further down reuses it instead of re-resolving the same
      // holdConfig/DSL-window/maxCap work a second time for the same row.
      let holdConfigCache: { config: HoldConfig; mode: string; speed: number; maxVal: number; center: number; size: number } | null = null;
      // Waits the same lookahead adds for a hold's release, listed with this row's other wait reasons below.
      const holdWaitReasons: Array<{ label: string; valueFrames: Frames }> = [];

      const dbMove =
        this._getModifiedMoveData(currentData.action) ||
        ({ name: currentData.action } as MechanicNode);

      currentData.moveName = dbMove.name || currentData.action;
      currentData.castTypes = dbMove.castTypes || (currentData.action ? [currentData.action] : []);
      currentData.dmgTypes = dbMove.dmgTypes || [];
      // Metadata for the Timeline's input-press flags; never read by damage calculation below.
      currentData.input = dbMove.input;
      currentData.inputType = dbMove.inputType;

      this._applyInheritance(currentData, prevData, accumulatedGameTime, team);

      if (i === 0) {
        const teamMembers = teamCharacters(team);
        teamMembers.forEach(charName => {
          if (charName) {
            if (!currentData.energy) currentData.energy = {};
            if (!currentData.concerto) currentData.concerto = {};
            if (options.startEnergy) currentData.energy[charName] = resourceCap(charName, 'energy');
            if (options.startConcerto) currentData.concerto[charName] = resourceCap(charName, 'concerto');
          }
        });
        this._primeCombatStart(currentData, team);
      }

      if (prevData.unit !== currentData.unit) {
        // swapCooldown is seconds-domain; convert once here into the frames-domain marker.
        globalSwapCdExpiresAt = Math.max(globalSwapCdExpiresAt, accumulatedTime + secondsToFrames(GAME_DEFAULTS.swapCooldown));
      }

      // seconds -- cooldowns stay in seconds. Charge-aware (see ContextManager.cooldownRemaining):
      // a maxCharges > 1 move waits only once every charge is in use, not on its own single timer.
      const actualCdRemaining = ContextManager.cooldownRemaining(currentData, currentData.unit, currentData.moveName);
      const wCD = secondsToFrames(actualCdRemaining);
      let wBusy = 0;
      const busyUntil = unitBusyUntil[currentData.unit] || 0;
      const isOutroCast = dbMove.castTypes && dbMove.castTypes.includes('Outro');
      if (busyUntil > accumulatedTime && !isOutroCast) {
        wBusy = busyUntil - accumulatedTime;
      }

      let finalWaitTime = Math.max(wCD, wBusy);
      currentData.waitTime = finalWaitTime;
      currentData.cdWaitTime = wCD;
      this._applyDecay(currentData, toFrames(finalWaitTime), toFrames(finalWaitTime), i > 0, activeTeam, activeRows, team);

      // Waits if this move would error on a resource (Concerto/Tune/Forte; Energy stays just
      // a warning) because its own generation is still undrained in the queue -- same
      // mechanism as wCD/wBusy above.
      const { waitFrames: resourceWaitFrames, label: resourceWaitLabel } = this._computeResourceWait(currentData, dbMove, team, activeTeam, activeRows);
      if (resourceWaitFrames > 0) {
        finalWaitTime += resourceWaitFrames;
        currentData.waitTime = finalWaitTime;
      }

      // prevData's gauges should read as "available right before this action starts", not
      // "whatever landed within its own truncated duration" -- else a gauge can look short of
      // a requirement the wait above is about to satisfy, with nothing on screen explaining why.
      // Safe to backfill here: currentData already cloned prevData's dicts via
      // _applyInheritance, and nothing later re-reads prevData's resource pools.
      if (i > 0) {
        backfillPools(prevData, currentData);
        prevData.enemyTune = currentData.enemyTune;
        prevData.enemyMaxTune = currentData.enemyMaxTune;
      }

      if (dbMove.inputType === 'Release' && dbMove.holdConfig && currentData.trackers && currentData.trackers.Hold_Start !== undefined && currentData.trackers.Hold_Unit === currentData.unit) {
        const holdStart = currentData.trackers.Hold_Start;
        // Cached for the live-tracking block below, so the same row doesn't resolve it twice.
        holdConfigCache = this._resolveHoldCursor(dbMove.holdConfig || {}, currentData, team);
        const { mode, speed, maxVal, center } = holdConfigCache;
        const halfWidth = holdConfigCache.size / 2;

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
          // No window in clamp mode -- full (speed >= 0) or empty (speed < 0) is what "done" means.
          const done = mode === 'clamp' ? (speed >= 0 ? cursor >= maxVal : cursor <= 0) : Math.abs(cursor - center) <= halfWidth;
          if (done) {
            holdReleaseDelay = delay;
            holdReachable = true;
            break;
          }
        }
        if (currentData.timing === 'Manual') {
          // User has taken explicit control of the release (e.g. an intentional early/partial
          // release for a shorter charge) -- apply their value directly instead of auto-waiting
          // for "done", clamped to [0, the delay auto would have used] so Manual can only
          // shorten the wait, never lengthen it past what the hold's own config would produce.
          // The live-tracking block further down reads gameTimeStart/Hold_Start the same way
          // regardless of how the wait got here, so the cursor/forte naturally reflect this
          // shorter hold instead of assuming "done" -- no separate handling needed there.
          const manualDelay = Math.max(0, currentData.manualOffset || 0);
          const ceilingDelay = holdReachable ? holdReleaseDelay : GAME_DEFAULTS.holdLookaheadMax;
          const appliedDelay = Math.min(manualDelay, ceilingDelay);
          if (appliedDelay > 0) {
            finalWaitTime += appliedDelay;
            currentData.waitTime = finalWaitTime;
            holdWaitReasons.push({ label: 'Manual Hold Wait', valueFrames: toFrames(appliedDelay) });
          }
          // Not surfaced here: the user has explicitly opted out of waiting for "done", so an
          // auto-search miss isn't an error for them the way it is in every other timing mode.
        } else if (holdReachable && holdReleaseDelay > 0) {
          finalWaitTime += holdReleaseDelay;
          currentData.waitTime = finalWaitTime;
          holdWaitReasons.push({ label: mode === 'clamp' ? 'Forte Full Wait' : 'Forte Window Wait', valueFrames: toFrames(holdReleaseDelay) });
        } else if (!holdReachable) {
          // Speed is 0 (or otherwise can't reach the target) -- surfaced by _runValidation as
          // an error instead of silently releasing as if it were already ready.
          currentData._holdUnreachable = mode === 'clamp' ? 'full/empty forte' : 'release window';
        }
      }

      const timings = this._resolveTimings(currentData, dbMove, team);
      let duration = timings.duration;
      let animationCommitment = timings.animationCommitment;
      const nextRow = currentData.nextRow;
      const isSwappingOut =
        currentData.timing === 'Swap' ||
        (currentData.timing === 'Auto' && currentData._autoTimingChoice === 'Swap') ||
        (nextRow && nextRow.unit !== currentData.unit && nextRow.unit !== '');

      let swapCdDelay = 0;
      if (isSwappingOut) {
        const desiredSwapOutTime = accumulatedTime + finalWaitTime + duration;
        if (desiredSwapOutTime < globalSwapCdExpiresAt) {
          swapCdDelay = globalSwapCdExpiresAt - desiredSwapOutTime;
          duration += swapCdDelay;
          animationCommitment += swapCdDelay;
        }
      }

      currentData.baseDuration = timings.baseDuration;
      currentData.duration = duration;
      currentData.animationCommitment = animationCommitment;
      currentData.gameTimePassed = Math.max(0, duration - timings.freezeTime);
      currentData.freezeTime = timings.freezeTime;
      currentData.damageTimeframe = timings.damageTimeframe;
      currentData.allowedHits = timings.allowedHits;

      if (dbMove.stanceReq === 'Midair') currentData.stance = 'Midair';
      else if (dbMove.stanceReq === 'Grounded') currentData.stance = 'Grounded';

      // Only changes the move plays out before it's cancelled/swapped land; the last one sets the end stance.
      for (const change of sortedStanceChanges(dbMove)) {
        if (currentData.duration >= change.frame) currentData.stance = change.stance;
      }

      if (currentData.timing === 'Simultaneous' && i > 0) {
        if (currentData.manualOffset === undefined || currentData.manualOffset === null) {
          const X = typeof dbMove.actionDuration === 'number' ? dbMove.actionDuration : parseFloat(String(dbMove.actionDuration)) || 0;
          currentData.manualOffset = -X;
        }
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

      unitBusyUntil[currentData.unit] = currentData.timeStart + currentData.animationCommitment;
      const baseActDur = dbMove.actionDuration !== undefined && dbMove.actionDuration !== null ? parseFloat(String(dbMove.actionDuration)) : 0;

      // Frame counts are exact integers -- no epsilon needed here (unlike seconds-domain decay
      // checks elsewhere). SubPanel.tsx formats valueFrames to seconds.
      const reasons: any[] = [];
      if (wCD > 0) reasons.push({ label: 'Waiting for Skill CD', valueFrames: wCD });
      if (wBusy > 0) reasons.push({ label: 'Off-Field Animation Lock', valueFrames: toFrames(wBusy) });
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
        const timingLabel =
          currentData.timing === 'Auto'
            ? currentData._autoTimingChoice ? `Auto (${currentData._autoTimingChoice})` : 'Auto'
            : currentData.timing?.replace('_', ' ');

        if (swapCdDelay > 0) {
          if (netTimingChange > 0) reasons.push({ label: 'Swap Cooldown Delay', valueFrames: toFrames(netTimingChange) });
          else if (netTimingChange < 0) reasons.push({ label: `${timingLabel} Time Saved`, valueFrames: toFrames(netTimingChange), isNegative: true });
        } else {
          if (timingDiff < 0) reasons.push({ label: `${timingLabel} Time Saved`, valueFrames: toFrames(timingDiff), isNegative: true });
          else if (timingDiff > 0) reasons.push({ label: `${timingLabel} Penalty`, valueFrames: toFrames(timingDiff) });
        }
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
        const { config, mode, speed, maxVal, center, size } = holdConfigCache
          ?? this._resolveHoldCursor(
            dbMove.holdConfig || DataLoader.findHoldReleaseConfig(currentData.unit, currentData.trackers?.Hold_Input) || {},
            currentData,
            team
          );
        // A Repeat-style hold (no holdConfig anywhere for this character's hold pair) has no
        // cursor system at all -- skip writing any cursor/window state so it doesn't inherit
        // meaningless all-default values (e.g. a bogus pingpong Cursor_Pos) it never asked for.
        if (config && Object.keys(config).length > 0) {
          const halfWidth = size / 2;

          if (!currentData.trackers) currentData.trackers = {};
          // Clamp has no window -- skip storing meaningless center/size trackers for it.
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
            // 'clamp' has no window -- "done" (and IsInHoldWindow for trigger rules) means
            // reaching full (speed >= 0) or empty (speed < 0) instead.
            currentData.isInForteWindow = mode === 'clamp'
              ? (speed >= 0 ? finalCursor >= maxVal : finalCursor <= 0)
              : Math.abs(finalCursor - center) <= halfWidth;
            currentData.trackers.Cursor_Pos = finalCursor;

            // Clamp mode: the cursor *is* the forte value while holding (unlike a window mode
            // like Sanhua's, where the cursor is just release timing and forte comes from
            // separate hitResources/effects) -- keep the real pool in lockstep.
            if (mode === 'clamp') {
              const slot = config.forteSlot || MECHANICS_NOTATION.HOLD_DEFAULTS.FORTE_SLOT;
              if (!currentData[slot]) currentData[slot] = {};
              currentData[slot][currentData.unit] = finalCursor;
            }
          }
        }
      }

      // Pre-cast dropdown snapshot, for the row's panels.
      if (this._run.dropdownSnapshots) {
        currentData.dropdownState = dropdownSnapshot(currentData);
      }

      this._runValidation(currentData, prevData, team, dbMove);

      if (this._run.logWarnings && (currentData.warningMsgs.length > 0 || currentData.errorMsgs.length > 0)) {
        console.warn(`[TimelineEngine] Row #${i + 1} (${currentData.unit} - ${currentData.action}):`, {
          errors: currentData.errorMsgs,
          warnings: currentData.warningMsgs,
          prevAction: currentData.unitCombos?.[currentData.unit]?.action,
          prevUnit: prevData?.unit
        });
      }

      this._evaluateMechanics(currentData, activeTeam, activeRows, i, team, dbMove);
      this._resolveComboWindows(currentData, dbMove, team);
      // For the Timeline's spam-click indicator; deferred until here so @Self/@Move context
      // reflects this row's fully-computed state.
      currentData.priority = this._resolvePriority(dbMove, currentData, currentData.unit, team);
    }

    const emptyRow = activeRows[activeRows.length - 1];
    if (emptyRow && activeRows.length > 1) {
      const lastActive = activeRows[activeRows.length - 2];
      this._applyInheritance(emptyRow, lastActive, accumulatedGameTime, team);
      emptyRow.prevRow = lastActive;
      emptyRow.gameTimeStart = accumulatedGameTime;
      emptyRow.timeStart = accumulatedTime;

      if (this._run.dropdownSnapshots) emptyRow.dropdownState = plainCopy(emptyRow, ROW_LINK_KEYS);
    } else if (emptyRow && this._run.dropdownSnapshots) {
      emptyRow.dropdownState = plainCopy(emptyRow, ROW_LINK_KEYS);
    }

    // A hit can still be queued here (e.g. cancelled into an Outro via swapTiming) with no
    // later row to advance the clock far enough to reach it -- flush what's left now.
    // Runs through _decayState like any other window (freeze is long over, so real time is game
    // time), ending at the last queued hit, so buffs and cooldowns run down between these hits too.
    // A hit can queue a proc that lands later, so it repeats until the queue is empty.
    const flushContext = activeRows[activeRows.length - 1];
    for (let guard = 0; this.damageQueue.length > 0 && guard < 1000; guard++) {
      const lastHitAt = Math.max(...this.damageQueue.map(hit => hit.executeAt));
      const window = toFrames(Math.max(0, lastHitAt - this.currentGlobalRealTime));
      this._decayState(flushContext, window, window, activeTeam, activeRows, team);
    }

    this.isRecalculating = false;
    return activeRows;
  }

  // Determines loop start via override or main DPS's first true Outro; uses collapseMap to prevent premature loop splitting on Hold-Repeat blocks.
  findLoopStart(rows: any[], mainDps: string | undefined, collapseMap?: number[]): { index: number; isOverride: boolean } {
    const overrideIndex = rows.findIndex(r => r.loopStartOverride === true && !!r.unit);
    if (overrideIndex !== -1) return { index: overrideIndex, isOverride: true };

    if (mainDps) {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.unit === mainDps && Array.isArray(row.castTypes) && row.castTypes.includes('Outro')) {
          if (collapseMap && collapseMap.lastIndexOf(collapseMap[i]) !== i) continue;
          const next = i + 1;
          if (next < rows.length && rows[next]?.unit) return { index: next, isOverride: false };
          return { index: 0, isOverride: false };
        }
      }
    }
    return { index: 0, isOverride: false };
  }

  // Live legality check: simulates opener + 2 loop reps, inspects the second rep for issues
  // that only surface once state carries over (cooldowns, trigger rules, resources). Cheap on
  // purpose -- proves just the next iteration works, not a full DPS run.
  analyzeLoop(
    rows: any[],
    team: any[] = [],
    options: { startEnergy?: boolean; startConcerto?: boolean } = {},
    enemyConfig: { level: number; res: number; hp: number } = ENEMY_DEFAULTS,
    loopStartIndex: number = 0
  ): { errors: string[]; warnings: string[] } {
    const contentRows = rows.filter(r => r && r.unit);
    if (contentRows.length === 0) return { errors: [], warnings: [] };

    const clampedStart = Math.max(0, Math.min(loopStartIndex, contentRows.length));
    const openerRows = contentRows.slice(0, clampedStart);
    // loopEndOverride marks where the loop template stops -- anything after is Ending Rotation
    // content and must be excluded, or it gets validated as if it repeated too.
    const loopEndIndex = contentRows.findIndex(r => r.loopEndOverride === true);
    const loopTemplate = loopEndIndex !== -1 && loopEndIndex >= clampedStart
      ? contentRows.slice(clampedStart, loopEndIndex + 1)
      : contentRows.slice(clampedStart);
    if (loopTemplate.length === 0) return { errors: [], warnings: [] };

    // `rows` is already-recalculated, so its timing fields can be read directly.
    const openerEndRow = openerRows.length > 0 ? openerRows[openerRows.length - 1] : null;
    const openerEndTime = openerEndRow ? (openerEndRow.gameTimeStart || 0) + (openerEndRow.gameTimePassed || 0) : 0;
    const loopEndRow = loopTemplate[loopTemplate.length - 1];
    const loopEndTime = (loopEndRow.gameTimeStart || 0) + (loopEndRow.gameTimePassed || 0);
    const loopDuration = loopEndTime - openerEndTime;

    if (loopDuration === 0) {
      return { errors: ['Loop has no duration — cannot repeat.'], warnings: [] };
    }

    // recalculateState assumes the array's last element is the UI's trailing blank row.
    const cloneAuthored = (r: any) => ({
      unit: r.unit,
      action: r.action,
      timing: r.timing,
      ...(r.offset !== undefined && { offset: r.offset }),
      ...(r.manualOffset !== undefined && { manualOffset: r.manualOffset })
    });

    const extendedContent: any[] = [
      ...openerRows.map(cloneAuthored),
      ...loopTemplate.map(cloneAuthored),
      ...loopTemplate.map(cloneAuthored)
    ];
    const extendedInput = [...extendedContent, { unit: '', action: '', timing: 'Auto', offset: 0 }];
    const extendedResult = this.recalculateState(extendedInput, team, { ...options, mode: 'lean' }, enemyConfig);

    const secondRepStart = openerRows.length + loopTemplate.length;
    const contentEnd = extendedContent.length; // excludes the synthetic trailing blank row

    const errors: string[] = [];
    const warnings: string[] = [];

    for (let i = secondRepStart; i < contentEnd; i++) {
      const row = extendedResult[i];
      const moveName = row.moveName || row.action;

      (row.errorMsgs || []).forEach((msg: string) => errors.push(`${moveName}: ${msg}`));

      // A cooldown-blocked move fails its trigger rule too, but it's just a wait, not illegal.
      if (row.cdWaitTime > 3) {
        warnings.push(`${moveName} needs ${formatFramesAsSeconds(row.cdWaitTime)} more (on cooldown).`);
      }
      (row.warningMsgs || []).forEach((msg: string) => {
        if (/^Combo requirement not met/.test(msg)) {
          errors.push(`${moveName}: ${msg}`);
        } else if (/out of the required .* (Resonance Energy|Forte \d+|Tune)/.test(msg)) {
          warnings.push(`${moveName}: ${msg}`);
        }
      });
    }

    return { errors, warnings };
  }

  _getModifiedMoveData(actionId: string): MechanicNode | null {
    if (!actionId) return null;
    if (Object.prototype.hasOwnProperty.call(this._moveDataCache, actionId)) {
      return this._moveDataCache[actionId];
    }

    let rawMove = DataLoader.mechanicsDB[actionId] || null;
    if (!rawMove) {
      const matchKey = Object.keys(DataLoader.mechanicsDB).find(k =>
        k.startsWith(actionId + '_') && !DataLoader.mechanicsDB[k].isPassive
      );
      if (matchKey) rawMove = DataLoader.mechanicsDB[matchKey];
    }
    if (!rawMove) {
      this._moveDataCache[actionId] = null;
      return null;
    }

    const { _compiledRule, ...safeData } = rawMove as any;
    const patchedMove = cloneJson(safeData);
    if (_compiledRule && typeof _compiledRule.evaluate === 'function') {
      patchedMove._compiledRule = _compiledRule;
    }
    this._moveDataCache[actionId] = patchedMove;
    return patchedMove;
  }

  // `mainUnit` (team[0]'s character) stands in for "who was on-field before row 0"
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
          EventManager.registerMechanic(owner.transform ? owner.transform(directNode) : directNode, owner.equipper);
        }
        return;
      }
      keys.forEach(key => {
        const mech = DataLoader.mechanicsDB[key];
        if (!mech || !owner.listens(mech, key)) return;
        EventManager.registerMechanic(owner.transform ? owner.transform(mech) : mech, owner.equipper, key);
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

    // removeOnSwap buffs belong to whoever swaps off-field; drop them the moment they leave.
    if (prevData.unit && currentData.unit && currentData.unit !== prevData.unit) {
      const swappedOutPrefix = `${prevData.unit}_`;
      for (const key in currentData.activeBuffs) {
        const buff = currentData.activeBuffs[key];
        if (buff?.removeOnSwap && key.startsWith(swappedOutPrefix)) {
          delete currentData.activeBuffs[key];
        }
      }
    }

    if (prevData.pendingNextBuffs && prevData.pendingNextBuffs.length > 0 && currentData.unit) {
      const activeTeam = teamCharacters(team);
      prevData.pendingNextBuffs.forEach((eff: any) => {
        const nextEff = { ...eff, target: currentData.unit };
        this._processEffect(nextEff, currentData, eff.provider || prevData.unit, activeTeam, [], currentData.arrayIndex, team);
      });
    }

    currentData.timeScales = structuredClone(prevData.timeScales || {});
    // Stance is tracked per unit: a unit that swaps out midair stays midair for its combo window
    // (a swap back inside it finds them still airborne), then lands.
    currentData.unitStances = { ...(prevData.unitStances || {}) };
    if (prevData.unit) currentData.unitStances[prevData.unit] = prevData.stance || CHARACTER_DEFAULTS.defaultStance;
    if (prevData.unit && currentData.unit && currentData.unit !== prevData.unit) {
      const isIntro = currentData.castTypes?.includes('Intro');
      const myCombo = prevData.unitCombos?.[currentData.unit];
      const isDuringCombo = myCombo && currentTime <= myCombo.expiration;
      currentData.stance = (!isIntro && isDuringCombo && currentData.unitStances[currentData.unit]) || CHARACTER_DEFAULTS.defaultStance;
    } else {
      currentData.stance = prevData.stance || CHARACTER_DEFAULTS.defaultStance;
    }
    // The move's own stanceReq overwrites `stance` later; validation needs the stance it started from.
    currentData.entryStance = currentData.stance;
  }

  _primeCombatStart(firstRowData: any, team: any[]): void {
    const teamMembers = teamCharacters(team);
    const activeTeam = teamMembers;

    const passives = [
      ...EventManager.emit('OnStart', new Set(), firstRowData, firstRowData.unit, team),
      ...EventManager.emit('ALWAYS', new Set(), firstRowData, firstRowData.unit, team)
    ];

    passives.forEach(eff => {
      const owner = eff.provider || eff.source || firstRowData.unit;
      this._processEffect(eff, firstRowData, owner, activeTeam, [], 0, team);
    });
  }

  _resolveComboWindows(currentData: any, dbMove: MechanicNode, team: any[]): void {
    const resolveTime = (val: any): Frames | null => {
      if (val === undefined) return null;
      return isDslExpr(val)
        ? roundFrames(Number(this._resolveDynamicMath(val, currentData, currentData.unit, team)))
        : roundFrames(parseFloat(val));
    };

    if (!currentData.action) return;

    // Every cast row (echo skills, Dodge, Jump, Tune Break, utility...) counts as the unit's own
    // last action (@Self.PrevAction) and refreshes its combo window.
    const customWindow = dbMove.comboWindow !== undefined ? resolveTime(dbMove.comboWindow) : null;
    const postMoveWindow = customWindow !== null ? customWindow : GAME_DEFAULTS.comboWindow;
    currentData.unitCombos[currentData.unit] = {
      action: currentData.action,
      expiration: currentData.gameTimeStart + currentData.animationCommitment + postMoveWindow
    };
  }

  _resolvePriority(move: MechanicNode, currentData: any, unit: string, team: any[]): number {
    if (move.priority === undefined) return 0;
    const value = isDslExpr(move.priority)
      ? Number(this._resolveDynamicMath(move.priority, currentData, unit, team))
      : parseFloat(String(move.priority));
    return isNaN(value) ? 0 : value;
  }

  _resolveTimings(currentData: any, moveData: MechanicNode, team: any[]): any {
    const timingType = currentData.timing || 'Auto';
    const unitName = currentData.unit;

    const resolveMath = (val: any, fallback: Frames): Frames => {
      if (val === undefined) return fallback;
      return isDslExpr(val)
        ? roundFrames(parseFloat(String(this._resolveDynamicMath(val, currentData, currentData.unit, team))))
        : roundFrames(parseFloat(val));
    };

    const actionDuration = moveData.actionDuration !== undefined ? resolveMath(moveData.actionDuration, toFrames(0)) : toFrames(0);
    const freezeTime = moveData.freezeTime !== undefined ? resolveMath(moveData.freezeTime, toFrames(0)) : toFrames(0);
    const swapTiming = moveData.swapTiming !== undefined ? resolveMath(moveData.swapTiming, toFrames(GAME_DEFAULTS.swapTime)) : undefined;
    const hitCount = Array.isArray(moveData.hitMults) ? moveData.hitMults.length : 0;

    const nextRow = currentData.nextRow;
    const nextMoveData = nextRow?.action ? this._getModifiedMoveData(nextRow.action) : null;

    // A cancel with no rule is only usable by a next move that outranks this one and isn't the
    // same input binding + type (e.g. a Basic+Hold heavy can cancel a Basic string).
    const bindingOf = (m: MechanicNode) => `${m.input ?? ''}|${m.inputType ?? ''}`;
    const nextMoveCancels = !!nextMoveData
      && bindingOf(nextMoveData) !== bindingOf(moveData)
      && this._resolvePriority(nextMoveData, currentData, nextRow.unit, team) > this._resolvePriority(moveData, currentData, unitName, team);

    const validCancels: Array<{ index: number; time: Frames; hits: number }> = [];
    if (moveData.cancelTimings && moveData.cancelTimings.length > 0) {
      moveData.cancelTimings.forEach((ct, idx) => {
        const isValid = !ct.triggerRule || ct.triggerRule.trim() === ''
          ? nextMoveCancels
          : this._evaluateRule(ct, ct.triggerRule, currentData, currentData.unit, team) ?? false;
        if (isValid) validCancels.push({ index: idx, time: ct.time, hits: ct.hits !== undefined ? ct.hits : Infinity });
      });
    }

    const cancelTimeForAnimation = validCancels.length > 0
      ? validCancels.reduce((prev, curr) => prev.time < curr.time ? prev : curr).time
      : actionDuration;

    const tfStart = moveData.damageTimeframe?.start !== undefined ? resolveMath(moveData.damageTimeframe.start, toFrames(0)) : toFrames(0);
    const tfEnd = moveData.damageTimeframe?.end !== undefined ? resolveMath(moveData.damageTimeframe.end, cancelTimeForAnimation) : cancelTimeForAnimation;

    const getHitTimeOffset = (idx: number): Frames => {
      if (hitCount <= 1 || tfEnd <= tfStart) return tfEnd;
      return roundFrames(tfStart + (tfEnd - tfStart) * (idx / (hitCount - 1)));
    };

    let capEnergyHitIdx = -1;
    let capConcertoHitIdx = -1;
    if (moveData.hitResources && unitName) {
      const erMult = energyRegenMult(currentData, unitName, team);
      capEnergyHitIdx = capHitIndex(currentData, unitName, 'energy', moveData, hitCount, amount => (amount > 0 ? amount * erMult : amount));
      capConcertoHitIdx = capHitIndex(currentData, unitName, 'concerto', moveData, hitCount, amount => amount);
    }

    const availableTimings: any[] = [
      { val: 'Auto', label: 'Auto', title: 'Quickest valid timing for all hits' },
      { val: 'Full', label: 'Full', title: `Duration: ${formatFramesAsSeconds(actionDuration)} | All Hits` }
    ];
    if (swapTiming !== undefined) {
      availableTimings.push({ val: 'Swap', label: 'Swap', title: `Duration: ${formatFramesAsSeconds(roundFrames(Math.max(swapTiming, GAME_DEFAULTS.swapTime)))}` });
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
    if (moveData.inputType === 'Hold' || moveData.castTypes?.includes('Echo')) {
      availableTimings.push({ val: 'Simultaneous', label: 'Simultaneous', title: "Executes in parallel anchored to the previous move's start time." });
    }
    if (moveData.inputType === 'Release' && moveData.holdConfig) {
      availableTimings.push({
        val: 'Manual',
        label: 'Manual',
        title: "Set the hold's wait directly (down to 0) instead of auto-waiting for the forte/window to be reached -- for an early, partial release."
      });
    }
    currentData.availableTimings = availableTimings;

    let autoCancelTime = actionDuration;
    let autoAllowedHits = hitCount;
    const fullHitCancels = validCancels.filter(vc => vc.hits >= hitCount);
    if (fullHitCancels.length > 0) {
      const quickest = fullHitCancels.reduce((prev, curr) => prev.time < curr.time ? prev : curr);
      autoCancelTime = quickest.time;
      autoAllowedHits = quickest.hits;
    }

    let duration = actionDuration;
    let animationCommitment = actionDuration;
    let finalHits = hitCount;

    if (timingType === 'Auto') {
      const isNextOutro = nextMoveData?.castTypes?.includes('Outro');
      const isNextSwap = nextRow && nextRow.unit !== currentData.unit && nextRow.unit !== '';

      if (isNextOutro && capConcertoHitIdx !== -1) {
        const targetTime = getHitTimeOffset(capConcertoHitIdx);
        duration = targetTime;
        animationCommitment = targetTime;
        finalHits = capConcertoHitIdx + 1;
        currentData._autoTimingChoice = 'Concerto';
      } else if ((isNextOutro || isNextSwap) && swapTiming !== undefined) {
        duration = toFrames(Math.max(swapTiming, GAME_DEFAULTS.swapTime));
        animationCommitment = cancelTimeForAnimation;
        finalHits = hitCount;
        currentData._autoTimingChoice = 'Swap';
      } else {
        duration = autoCancelTime;
        animationCommitment = autoCancelTime;
        finalHits = autoAllowedHits;
        currentData._autoTimingChoice = 'Cancel';
      }
    } else if (timingType === 'Full') {
      duration = actionDuration; animationCommitment = actionDuration; finalHits = hitCount;
    } else if (timingType === 'Swap' && swapTiming !== undefined) {
      duration = toFrames(Math.max(swapTiming, GAME_DEFAULTS.swapTime));
      animationCommitment = cancelTimeForAnimation;
      finalHits = hitCount;
    } else if (timingType.startsWith('Cap_')) {
      const parts = timingType.split('_');
      const parsedIdx = parseInt(parts[2], 10);
      const targetTime = getHitTimeOffset(parsedIdx);
      duration = targetTime;
      animationCommitment = targetTime;
      finalHits = parsedIdx + 1;
    } else if (timingType.startsWith('Cancel_')) {
      const ct = validCancels.find(vc => vc.index === parseInt(timingType.split('_')[1], 10));
      if (ct) { duration = ct.time; animationCommitment = ct.time; finalHits = ct.hits; }
      else { duration = autoCancelTime; animationCommitment = autoCancelTime; finalHits = autoAllowedHits; }
    } else if (timingType === 'Cancel') {
      if (validCancels.length > 0) { duration = validCancels[0].time; animationCommitment = validCancels[0].time; finalHits = validCancels[0].hits; }
      else { duration = autoCancelTime; animationCommitment = autoCancelTime; finalHits = autoAllowedHits; }
    }

    return {
      baseDuration: actionDuration,
      duration,
      animationCommitment,
      gameTimePassed: Math.max(0, duration - freezeTime),
      freezeTime,
      damageTimeframe: { start: tfStart, end: tfEnd },
      allowedHits: finalHits
    };
  }

  _decayState(
    currentData: any,
    realTimePassed: Frames,
    gameTimePassed: Frames,
    activeTeam: string[],
    activeRows: any[],
    team: any[]
  ): void {
    if (realTimePassed < 0) return;

    // Game time runs down in segments up to each hit, so a buff or cooldown can expire before a later
    // hit in the window lands. Freeze (the window's real time that isn't game time) is on cast, so a
    // hit during it sits at game time 0: nothing runs down until the freeze is over.
    const freezeFrames = Math.max(0, realTimePassed - gameTimePassed);
    let gameTimeElapsed = 0;
    const advanceGameTimeTo = (target: number) => {
      const segment = Math.min(target, gameTimePassed) - gameTimeElapsed;
      if (segment <= 0) return;
      this._processGameTimeDecay(currentData, toFrames(segment), activeTeam, activeRows, team);
      this.currentGlobalGameTime += segment;
      gameTimeElapsed += segment;
    };

    this._processQueuedHits(currentData, realTimePassed, activeTeam, activeRows, team, elapsedReal => advanceGameTimeTo(Math.max(0, elapsedReal - freezeFrames)));
    this.currentGlobalRealTime += realTimePassed;
    advanceGameTimeTo(gameTimePassed);
  }

  // The first row has nothing before it to run down, so it never decays.
  _applyDecay(currentData: any, realTimePassed: Frames, gameTimePassed: Frames, isSubsequentRow: boolean, activeTeam: string[], activeRows: any[], team: any[]): void {
    if (!isSubsequentRow) return;
    this._decayState(currentData, realTimePassed, gameTimePassed, activeTeam, activeRows, team);
  }

  // A row can be short on a resource purely because its own generation is still undrained
  // in the queue (e.g. an Outro right after a Swap). Static prediction isn't reliable here --
  // passive/OnHit grants aren't visible ahead of time -- so this drains the queue hit-by-hit
  // via _decayState, like a cooldown wait, until the shortfall resolves or the queue can't help.
  // Energy is excluded: stays a warning, never worth forcing a wait.
  _computeResourceWait(currentData: any, dbMove: MechanicNode, team: any[], activeTeam: string[], activeRows: any[]): { waitFrames: number; label: string | null } {
    const unit = currentData.unit;
    if (!unit) return { waitFrames: 0, label: null };

    const reqFor = (key: string): number => resourceRequirement(dbMove, key);
    const currentValue = (key: string): number => readResource(currentData, key, unit);

    const unitStats = DataLoader.characterDB[unit];
    const trackedKeys = WAITABLE_RESOURCE_KEYS.map(key => ({ key, label: resourceLabel(key, unitStats) }));

    let shortKeys = trackedKeys.filter(k => reqFor(k.key) > 0 && currentValue(k.key) < reqFor(k.key));
    if (shortKeys.length === 0) return { waitFrames: 0, label: null };

    let waitFrames = 0;
    const resolvedLabels: string[] = [];
    let guard = 0;

    while (shortKeys.length > 0 && guard++ < 1000) {
      let target: QueuedHit | null = null;
      for (const hit of this.damageQueue) {
        const limit = hit.isProc ? (hit.originMoveData.allowedHits !== undefined ? hit.originMoveData.allowedHits : Infinity) : hit.originRow.allowedHits;
        if (hit.hitIndex >= limit) continue;
        const hitRes = hit.originMoveData.hitResources;
        if (!hitRes) continue;
        const isRelevant = shortKeys.some(k => {
          if (k.key !== 'tune' && hit.origin.caster !== unit) return false;
          const arr = hitRes[k.key];
          return Array.isArray(arr) && arr.length > hit.hitIndex && (parseFloat(String(arr[hit.hitIndex])) || 0) !== 0;
        });
        if (isRelevant) { target = hit; break; }
      }
      if (!target) break;

      const delta = Math.max(0, target.executeAt - this.currentGlobalRealTime);
      this._decayState(currentData, toFrames(delta), toFrames(delta), activeTeam, activeRows, team);
      waitFrames += delta;

      const stillShort = shortKeys.filter(k => currentValue(k.key) < reqFor(k.key));
      shortKeys.filter(k => !stillShort.includes(k)).forEach(k => resolvedLabels.push(k.label));
      shortKeys = stillShort;
    }

    return { waitFrames, label: resolvedLabels.length > 0 ? `Waiting for ${resolvedLabels.join(' / ')}` : null };
  }

  // `beforeHit` gets each hit's real time into the window, so the caller can run game time down to it first.
  _processQueuedHits(currentData: any, realTimePassed: Frames, activeTeam: string[], activeRows: any[], team: any[], beforeHit?: (elapsedReal: number) => void): void {
    const realWindowEnd = this.currentGlobalRealTime + realTimePassed;
    while (this.damageQueue.length > 0) {
      const nextHit = this.damageQueue[0];
      if (nextHit.executeAt > realWindowEnd) break;

      this.damageQueue.shift();
      beforeHit?.(Math.max(0, nextHit.executeAt - this.currentGlobalRealTime));
      const limit = nextHit.isProc ? (nextHit.originMoveData.allowedHits !== undefined ? nextHit.originMoveData.allowedHits : Infinity) : nextHit.originRow.allowedHits;
      if (nextHit.hitIndex >= limit) continue;

      const hitRes = nextHit.originMoveData.hitResources;
      if (hitRes) {
        for (const resKey in hitRes) {
          const resArray = hitRes[resKey];
          const amount = (Array.isArray(resArray) && resArray.length > nextHit.hitIndex) ? resArray[nextHit.hitIndex] : 0;
          if (amount !== 0) {
            const targetSelector = resKey === 'energy' ? '@Team' : '@Self';
            this._processEffect({ type: 'resource', name: resKey, value: amount, target: targetSelector, provider: nextHit.origin.caster }, currentData, nextHit.origin.caster, activeTeam, activeRows, currentData.arrayIndex, team);
          }
        }
      }

      currentData.activeProcSource = nextHit.originActionId;
      this._fire('OnHit', nextHit.hitModifiers, currentData, nextHit.origin.caster, activeTeam, activeRows, team, nextHit.executeAt);
      delete currentData.activeProcSource;

      // Builds this hit's history entry: the DMG-cell breakdown, and what Results prices.
      if (this._run.hitLog) {
        const hitName = nextHit.originMoveData.name + (nextHit.totalHits > 1 ? ` (Hit ${nextHit.hitIndex + 1})` : '');
        if (!nextHit.originRow._pendingHits) nextHit.originRow._pendingHits = [];

        // executeAt is real-time; convert to game time. Only freezeTime splits the two domains
        // -- not a truncated duration, since a hit can resolve after a swap cuts the animation short.
        const originRow = nextHit.originRow;
        const elapsedSinceRowStart = Math.max(0, nextHit.executeAt - (originRow.timeStart || 0));
        const rowFreezeTime = originRow.freezeTime || 0;
        const hitGameTime = (originRow.gameTimeStart || 0) + Math.max(0, elapsedSinceRowStart - rowFreezeTime);

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
            hitIndex: nextHit.hitIndex
          },
          context: plainCopy(currentData, [...ROW_LINK_KEYS, '_pendingHits'])
        });
      }

      this._fire('AfterHit', nextHit.hitModifiers, currentData, nextHit.origin.caster, activeTeam, activeRows, team, nextHit.executeAt, { hitIndex: nextHit.hitIndex + 1, totalHits: nextHit.totalHits });
    }
  }

  // Time-scale multiplier for a timer id (a buff or cooldown name) under the row's active timeScales.
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
    // Cooldowns and buff/effect lifetimes deliberately stay in seconds, unlike frame-domain gameTimePassed.
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
          buff.stacks = buff.durations.length;
        } else {
          if (buff.duration !== undefined) {
            buff.duration -= actualDecay;
            if (buff.duration <= 0.001 && (buff.stacks || 0) > 0) expiringBuffs.push(buff);
          }
        }
      }
    }

    if (expiringBuffs.length > 0) {
      expiringBuffs.forEach(buff => {
        this._fire('OnBuffExpire', eventModifier(buff.name), currentData, buff.provider || currentData.unit, activeTeam, activeRows, team);
      });
    }

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

    // Each entry is one in-flight charge's own recharge timer -- decay every entry independently
    // and drop it (freeing that charge) once it completes, rather than clearing the whole key.
    for (const key in currentData.chargeCooldowns) {
      const pending = currentData.chargeCooldowns[key];
      const scale = getTimeScale(key);
      for (let i = pending.length - 1; i >= 0; i--) {
        pending[i] -= decaySeconds * scale;
        if (pending[i] <= 0.001) pending.splice(i, 1);
      }
      if (pending.length === 0) delete currentData.chargeCooldowns[key];
    }

    // OnTick intervals are authored as raw seconds literals in the DSL, so this stays seconds.
    this._fire('OnTick', new Set(), currentData, currentData.unit, activeTeam, activeRows, team, this.currentGlobalRealTime, { gameTimePassed: decaySeconds, getTimeScale });
  }

  _scheduleHits(currentData: any, moveData: MechanicNode, origin: MoveOrigin, rawMults: any[], executeStartTime: number, executeEndTime: number, isProc: boolean, hitModifiers: Set<string>, team: any[]): void {
    const snapshotMath = (hm: any, pUnit: string) => isDslExpr(hm) ? this._resolveDynamicMath(hm, currentData, pUnit, team) : hm;
    const snapshottedMults = rawMults.map(hm => snapshotMath(hm, origin.caster));
    const hitCount = snapshottedMults.length;
    for (let i = 0; i < hitCount; i++) {
      let hitTime = executeEndTime;
      if (hitCount > 1 && executeEndTime > executeStartTime) {
        hitTime = executeStartTime + (executeEndTime - executeStartTime) * (i / (hitCount - 1));
      }
      this.damageQueue.push({
        originRow: currentData,
        originActionId: isProc ? moveData.name : currentData.action,
        originMoveData: moveData,
        hitIndex: i,
        totalHits: hitCount,
        hitMult: snapshottedMults[i],
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
    // Adds name/pointer so an OnHit[...] rule can target this specific proc'd mechanic by name.
    const procModifiers = modifierSet([...(mData.dmgTypes || []), ...(mData.castTypes || []), mData.name, origin.ref]);
    if (rawProcMults.length > 0) {
      // A proc'd mechanic can carry its own damageTimeframe, offsetting from executeAt; left
      // unset, both default to executeAt (instant-fire).
      const resolveOffset = (val: any): Frames => isDslExpr(val)
        ? roundFrames(parseFloat(String(this._resolveDynamicMath(val, currentData, proc.provider, team))))
        : roundFrames(parseFloat(val));
      const tfStart = mData.damageTimeframe?.start !== undefined ? resolveOffset(mData.damageTimeframe.start) : toFrames(0);
      const tfEnd = mData.damageTimeframe?.end !== undefined ? resolveOffset(mData.damageTimeframe.end) : tfStart;
      this._scheduleHits(currentData, mData, origin, rawProcMults, executeAt + tfStart, executeAt + tfEnd, true, procModifiers, team);
    }
    this.damageQueue.sort((a, b) => a.executeAt - b.executeAt);
  }

  // Emits an event and runs whatever its listeners produce. `modifiers` is what `Event[...]`
  // brackets on those listeners are matched against.
  _fire(
    eventType: string, modifiers: Set<string>, currentData: any, provider: string, activeTeam: string[], activeRows: any[], team: any[],
    executeAt: number = this.currentGlobalRealTime, extraPayload: any = null
  ): void {
    const effects = EventManager.emit(eventType, modifiers, currentData, provider, team, extraPayload);
    this._executeEffectsStream(effects, currentData, activeTeam, activeRows, executeAt, provider, team);
  }

  // Emits several events for one tracker, gathering every listener's effects before running any of them.
  _fireTrackerEvents(events: string[], trackerName: string, currentData: any, unitName: string, activeTeam: string[], activeRows: any[], team: any[]): void {
    const effects = events.flatMap(event => EventManager.emit(event, eventModifier(trackerName), currentData, unitName, team));
    this._executeEffectsStream(effects, currentData, activeTeam, activeRows, this.currentGlobalRealTime, unitName, team);
  }

  // Evaluates a trigger rule (a mechanic's, or a cancel timing's) against the row, compiling and
  // caching it on `holder` the first time. null when there's no usable rule to evaluate.
  _evaluateRule(holder: { _compiledRule?: any }, rule: string, currentData: any, unit: string, team: any[]): any {
    if (!holder._compiledRule || typeof holder._compiledRule.evaluate !== 'function') {
      holder._compiledRule = DSLParser.compile(rule);
    }
    if (!holder._compiledRule || typeof holder._compiledRule.evaluate !== 'function') return null;
    return holder._compiledRule.evaluate(ContextManager.buildContext(currentData, unit, team), unit);
  }

  // A hold's cursor physics: its mode, speed and cap, plus the target window's center and size
  // (a clamp has no window, so both are 0).
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

  _applyMoveCosts(currentData: any, moveData: MechanicNode): void {
    if (!moveData.cost) return;
    const cost = moveData.cost as Record<string, number>;
    for (const key of RESOURCE_KEYS) {
      if (cost[key]) spendResource(currentData, key, currentData.unit, cost[key]);
    }
  }

  _applyCastResources(currentData: any, moveData: MechanicNode, activeTeam: string[], team: any[]): void {
    if (!moveData.castResources) return;
    const unitName = currentData.unit;

    for (const key in moveData.castResources) {
      const val = moveData.castResources[key];
      if (val === undefined || val === 0) continue;
      const amount = parseFloat(String(val));
      if (key === 'energy' && !(amount < 0)) {
        // Energy a move grants goes to the whole team, each scaled by their own Energy Regen;
        // spending it is the caster's alone.
        activeTeam.forEach(name => addResource(currentData, key, name, amount * energyRegenMult(currentData, name, team), resourceCap(name, key)));
      } else {
        addResource(currentData, key, unitName, amount, resourceCap(unitName, key));
      }
    }
  }

  // Starts a move's own cooldown/charge, then -- one hop only, never following the partner's own
  // shareCooldownWith -- does the same for its shared-cooldown partner using the PARTNER's own
  // cooldown/maxCharges (the two values don't need to match; only the start is linked). The
  // one-hop cap keeps a symmetric pair (A<->B, as CooldownPanel always writes them) from recursing.
  _startCooldown(currentData: any, unitName: string, moveData: MechanicNode): void {
    this._startCooldownRaw(currentData, unitName, moveData);
    if (moveData.shareCooldownWith && moveData.shareCooldownWith !== moveData.name) {
      const partner = DataLoader.mechanicsDB[`${unitName}_${moveData.shareCooldownWith}`];
      if (partner) this._startCooldownRaw(currentData, unitName, partner);
    }
  }

  _startCooldownRaw(currentData: any, unitName: string, moveData: MechanicNode): void {
    const cdVal = moveData.cooldown ? parseFloat(String(moveData.cooldown)) : 0;
    if (!(cdVal > 0)) return;
    const maxCharges = Math.max(1, parseInt(String(moveData.maxCharges ?? 1), 10) || 1);
    const key = `${unitName}_${moveData.name}`;
    if (maxCharges > 1) {
      if (!currentData.chargeCooldowns) currentData.chargeCooldowns = {};
      if (!currentData.chargeCooldowns[key]) currentData.chargeCooldowns[key] = [];
      currentData.chargeCooldowns[key].push(cdVal);
    } else {
      if (!currentData.cooldowns) currentData.cooldowns = {};
      currentData.cooldowns[key] = cdVal;
    }
  }

  _gatherInstantEffects(currentData: any, moveData: MechanicNode, prevData: any, castModifiers: Set<string>, team: any[]): Effect[] {
    const effects: Effect[] = [...(moveData.effects || [])];
    effects.push(...EventManager.emit('OnCast', castModifiers, currentData, currentData.unit, team));
    if (prevData && prevData.unit && prevData.unit !== currentData.unit) {
      effects.push(...EventManager.emit('OnSwapOut', new Set(), currentData, prevData.unit, team));
      effects.push(...EventManager.emit('OnSwapIn', new Set(), currentData, currentData.unit, team));
      effects.push(...EventManager.emit('OnUnitChange', new Set(), currentData, currentData.unit, team));
    }
    return effects;
  }

  _evaluateMechanics(currentData: any, activeTeam: string[], activeRows: any[], currentIndex: number, team: any[], dbMove: MechanicNode): void {
    const unitName = currentData.unit;
    const moveData = dbMove;
    const prevData = currentIndex > 0 ? activeRows[currentIndex - 1] : this._getDefaultData(team[0]?.character);

    const startValues = RESOURCE_KEYS.map(key => readResource(currentData, key, unitName));

    const currentFreezeTime = currentData.freezeTime || 0;
    if (currentFreezeTime > 0 && this.damageQueue.length > 0) {
      this.damageQueue.forEach(queuedHit => {
        if (queuedHit.origin.caster !== unitName) {
          queuedHit.executeAt += currentFreezeTime;
        }
      });
      this.damageQueue.sort((a, b) => a.executeAt - b.executeAt);
    }

    if (moveData.cooldown || moveData.shareCooldownWith) {
      this._startCooldown(currentData, unitName, moveData);
    }

    const origin = MechanicKey.origin(currentData.action, unitName, moveData.name);

    // dmgTypes plus name/pointer, so OnHit[...] can target one specific move, not just a
    // shared dmg type.
    const hitModifiers = modifierSet([...(moveData.dmgTypes || []), moveData.name, origin.ref]);
    const moveElements = (moveData.dmgTypes || []).filter(isElement);
    const castModifiers = modifierSet([...(moveData.castTypes || []), ...moveElements, currentData.action, moveData.name, origin.ref]);

    this._applyMoveCosts(currentData, moveData);
    this._applyCastResources(currentData, moveData, activeTeam, team);
    const instantEffects = this._gatherInstantEffects(currentData, moveData, prevData, castModifiers, team);

    const rawHitMults = Array.isArray(moveData.hitMults) ? moveData.hitMults : [];
    const tfStart = currentData.timeStart + (currentData.damageTimeframe?.start || 0);
    const tfEnd = currentData.timeStart + (currentData.damageTimeframe?.end || currentData.baseDuration);

    if (rawHitMults.length > 0) {
      this._scheduleHits(currentData, moveData, origin, rawHitMults, tfStart, tfEnd, false, hitModifiers, team);
    }

    this._executeEffectsStream(instantEffects, currentData, activeTeam, activeRows, currentData.timeStart, unitName, team);
    this.damageQueue.sort((a, b) => a.executeAt - b.executeAt);

    // Hold_Start/Cursor_Pos/Cursor_Accumulated cleanup is NOT automatic here -- a hold's own
    // Release `effects` must explicitly clear them (see HoldConfig's doc comment). A Release
    // that forgets to will just keep "holding" forever, the same visible way any other
    // forgotten tracker cleanup would.

    // A Simultaneous row never advances the shared clock (anchored in a window surrounding
    // rows already own) -- decaying by its own duration here would double-count, so it decays
    // 0 real/game time instead.
    const isSimultaneous = currentData.timing === 'Simultaneous';
    this._decayState(
      currentData,
      isSimultaneous ? toFrames(0) : toFrames(Math.max(0, currentData.duration || 0)),
      isSimultaneous ? toFrames(0) : toFrames(Math.max(0, currentData.gameTimePassed || 0)),
      activeTeam,
      activeRows,
      team
    );

    if (!currentData.trackers) currentData.trackers = {};
    RESOURCE_KEYS.forEach((key, i) => {
      currentData.trackers[deltaKey(key)] = readResource(currentData, key, unitName) - startValues[i];
    });
  }

  _runValidation(currentData: any, prevData: any, team: any[], dbMove: MechanicNode): void {
    const errors: string[] = [];
    const warnings: string[] = [];
    currentData.errorMsgs = errors;
    currentData.warningMsgs = warnings;
    const moveData = dbMove;
    const moveName = moveData.name || currentData.action;

    // Energy is the only resource whose shortfall stays a warning (rotation can limp forward
    // on low energy); Concerto/Tune/Forte shortfalls are errors -- see validateRes.
    const buildEnergyShortfallMsg = (myVal: number, req: number) => {
      const base = `${currentData.unit} has ${myVal.toFixed(1)} out of the required ${req} Resonance Energy`;
      if (myVal <= 0) return `${base}.`;
      // Backs out the ER% that would have closed the gap by now, as an "aim for this much ER" hint.
      const erTotal = energyRegenPct(currentData, currentData.unit, team);
      const extraErNeeded = erTotal * ((req - myVal) / myVal);
      return `${base} (Needs ${extraErNeeded.toFixed(0)}% ER on top of the current ${erTotal.toFixed(0)}% ER).`;
    };

    const validateRes = (key: string, myVal: number, label: string) => {
      const req = resourceRequirement(moveData, key);
      if (req > 0 && myVal < req) {
        if (key === 'energy') warnings.push(buildEnergyShortfallMsg(myVal, req));
        else errors.push(`Not enough ${label} (Needs ${req}).`);
      }
    };

    for (const key of RESOURCE_KEYS) {
      validateRes(key, readResource(currentData, key, currentData.unit), resourceLabel(key, DataLoader.characterDB[currentData.unit]));
    }

    // Surfaces a cooldown wait directly, even with no trigger rule -- independent of any
    // resource shortfall above, so both can show at once (e.g. ER + cooldown warnings together).
    if (currentData.cdWaitTime > 3) {
      warnings.push(`${moveName} needs ${formatFramesAsSeconds(currentData.cdWaitTime)} more (on cooldown).`);
    }

    // Set by the hold-release lookahead above when the cursor can't reach its target within
    // the lookahead window (holdLookaheadMax) -- e.g. cursorSpeed is 0, or the window is
    // unreachable from the current position. Genuinely misconfigured, not a resource wait.
    if (currentData._holdUnreachable) {
      errors.push(`${moveName} never reaches its ${currentData._holdUnreachable} within ${GAME_DEFAULTS.holdLookaheadMax}f -- check the hold's speed/config.`);
    }

    if (moveData.triggerRule && !moveData.isPassive) {
      const passed = this._evaluateRule(moveData, moveData.triggerRule, currentData, currentData.unit, team);
      // Only surfaced when nothing more specific (a shortfall/cooldown wait above) already
      // explains the failure.
      if (passed !== null && !passed && errors.length === 0 && warnings.length === 0) {
        warnings.push(`Combo requirement not met for ${moveName}.`);
      }
    }

    if (moveData.stanceReq && moveData.stanceReq !== 'Any') {
      const actualStance = currentData.entryStance || 'Grounded';
      if (actualStance !== moveData.stanceReq) {
        warnings.push(`Stance mismatch: Requires ${moveData.stanceReq}, but character is ${actualStance}.`);
      }
    }

    const prevWasOutro = prevData.castTypes && prevData.castTypes.includes('Outro');
    const currIsOutro = currentData.castTypes && currentData.castTypes.includes('Outro');
    if (prevWasOutro && currentData.unit === prevData.unit) {
      errors.push('The next move after an outro must be on a different unit.');
    }
    if (prevData.timing === 'Swap' && !currIsOutro && currentData.unit === prevData.unit) {
      errors.push('The next move after a swap timing must be an Outro or different unit.');
    }
    if (prevData.unit && currentData.unit !== prevData.unit) {
      const isIntro = currentData.castTypes && currentData.castTypes.includes('Intro');
      const myCombo = prevData.unitCombos?.[currentData.unit];
      const isSwapback = myCombo && currentData.gameTimeStart <= myCombo.expiration;
      if (prevWasOutro) {
        if (!isIntro) errors.push('Must use an Intro skill immediately after an Outro.');
      } else {
        if (isIntro) errors.push('Intro skills can only be used immediately after an Outro.');
        else if (!isSwapback) {
          // mechanicsIndex is keyed by owner; .provider is only set for third-party attributions (e.g., echoes).
          const expectedSwapIns: string[] = [];
          const ownMechanics = (DataLoader.mechanicsIndex[currentData.unit] || []).map(key => DataLoader.mechanicsDB[key]);
          ownMechanics.filter(m => m && m.isSwapInDefault).forEach(m => {
            const isValid = m.triggerRule && !m.isPassive
              ? this._evaluateRule(m, m.triggerRule, currentData, currentData.unit, team) ?? true
              : true;
            if (isValid) expectedSwapIns.push(m.name);
          });
          if (expectedSwapIns.length > 0 && !moveData.isSwapInDefault) {
            errors.push(`Standard swap-in expected. Must use: ${expectedSwapIns.join(' or ')}.`);
          }
        }
      }
    }
  }

  _resolveDynamicMath(mathStr: string, currentData: any, unitName: string, team: any[]): number | string {
    const ctx = ContextManager.buildContext(currentData, unitName, team);
    if (!ctx) return 0;
    const isPct = typeof mathStr === 'string' && mathStr.includes('%');
    const result = DSLParser.evaluateMath(mathStr, ctx, unitName);
    return isPct ? parseFloat((result * 100).toFixed(6)) + '%' : result;
  }

  _processEffect(effect: Effect, currentData: any, unitName: string, activeTeam: string[], activeRows: any[], currentIndex: number, team: any[]): void {
    const resolvedEffect = { ...effect };
    const resolve = (val: any) => isDslExpr(val, true) ? this._resolveDynamicMath(val, currentData, unitName, team) : val;
    const isBuff = resolvedEffect.type === 'buff' || !resolvedEffect.type;
    if (!isBuff) resolvedEffect.value = resolve(resolvedEffect.value);
    resolvedEffect.duration = resolve(resolvedEffect.duration) as number;
    if (resolvedEffect.maxStacks !== undefined) resolvedEffect.maxStacks = resolve(resolvedEffect.maxStacks) as number;

    const originalProvider = resolvedEffect.provider;
    if (!resolvedEffect.source) resolvedEffect.source = (originalProvider && originalProvider !== 'System' && originalProvider !== '@Equipper') ? originalProvider : currentData.moveName;
    if (!originalProvider || originalProvider === 'System' || originalProvider === '@Equipper' || originalProvider === resolvedEffect.source) resolvedEffect.provider = unitName;

    if (resolvedEffect.target === '@Next' || resolvedEffect.target === 'Next') {
      if (!currentData.pendingNextBuffs) currentData.pendingNextBuffs = [];
      currentData.pendingNextBuffs.push(resolvedEffect);
      return;
    }

    const targetUnits = this._resolveTargets(resolvedEffect.target, unitName, activeTeam, activeRows, currentIndex);
    if (resolvedEffect.type === 'tracker') this._handleTracker(resolvedEffect, currentData, unitName, activeTeam, activeRows, currentIndex, targetUnits, team);
    else if (resolvedEffect.type === 'cooldown') targetUnits.forEach(t => { if (!currentData.cooldowns) currentData.cooldowns = {}; currentData.cooldowns[`${t}_${resolvedEffect.name}`] = resolvedEffect.value; });
    else if (resolvedEffect.type === 'buff' || !resolvedEffect.type) this._updateActiveBuffs(resolvedEffect, currentData, targetUnits, activeTeam, activeRows, team);
    else if (resolvedEffect.type === 'resource') this._handleResourceEffect(resolvedEffect, currentData, targetUnits, team);
    else if (resolvedEffect.type === 'buffAction') this._handleBuffActionEffect(resolvedEffect, currentData, targetUnits, activeTeam, activeRows, team);
    else if (resolvedEffect.type === 'time_scale') { if (!currentData.timeScales) currentData.timeScales = {}; currentData.timeScales['ts_' + Math.random()] = resolvedEffect; }
  }

  _handleResourceEffect(resolvedEffect: Effect, currentData: any, targetUnits: string[], team: any[]): void {
    const amt = parseFloat(String(resolvedEffect.value || '0')) || 0;
    const resKey = resolvedEffect.name;
    if (!resKey) return;
    if (resKey === 'tune') {
      addResource(currentData, resKey, currentData.unit, amt, resourceCap(currentData.unit, resKey));
      return;
    }
    if (!currentData[resKey]) currentData[resKey] = {};
    targetUnits.forEach(tName => {
      // Only Energy a unit gains is scaled by its Energy Regen.
      const finalAmt = resKey === 'energy' && amt > 0 ? amt * energyRegenMult(currentData, tName, team) : amt;
      addResource(currentData, resKey, tName, finalAmt, resourceCap(tName, resKey));
    });
  }

  _handleBuffActionEffect(effect: Effect, currentData: any, targetUnits: string[], activeTeam: string[], activeRows: any[], team: any[]): void {
    targetUnits.forEach(targetName => {
      const buffKey = `${targetName}_${effect.name}`;
      const buff = currentData.activeBuffs?.[buffKey];
      if (buff) {
        if (effect.action === 'pause') buff.isPaused = true;
        else if (effect.action === 'resume') buff.isPaused = false;
        else if (effect.action === 'extend' && effect.value !== undefined) buff.duration = (buff.duration || 0) + parseFloat(String(effect.value));
        else if (effect.action === 'remove' || effect.action === 'consume') {
          // Remove and Consume share the same ALL/HALF/N stack math -- they only diverge on
          // which event fires below, so listeners can tell "spent by the wearer" (Consume) apart
          // from "stripped by something else" (Remove).
          buff.stacks = stacksAfterSpending(buff.stacks || 1, effect.value !== undefined ? effect.value : 'ALL', true);
          if ((buff.stacks || 0) <= 0) {
            if (buff.linkedTracker && currentData.trackers) currentData.trackers[buff.linkedTracker] = 0;
            delete currentData.activeBuffs[buffKey];
          }
          this._fire(effect.action === 'consume' ? 'OnBuffConsume' : 'OnBuffRemove', eventModifier(effect.name), currentData, effect.provider || currentData.unit, activeTeam, activeRows, team);
        }
      }
    });
  }

  _resolveTargets(targetStr: string | undefined, unitName: string, activeTeam: string[], activeRows: any[], currentIndex: number): string[] {
    if (targetStr === '@Self') return [unitName];
    if (targetStr === '@Team') return [...activeTeam];
    if (targetStr === '@TeamOthers') return activeTeam.filter(c => c !== unitName);
    // @Target predates @Enemy and isn't in autocomplete, but still resolves the same way.
    if (targetStr === '@Enemy' || targetStr === '@Target') return ['Enemy'];
    if (targetStr === '@Active') return ['Active'];
    if (targetStr === '@Next') {
      if (activeRows && currentIndex + 1 < activeRows.length) return [activeRows[currentIndex + 1].unit];
      return ['Next'];
    }
    return [targetStr || unitName];
  }

  _handleTracker(
    effect: Effect,
    currentData: any,
    unitName: string,
    activeTeam: string[],
    activeRows: any[],
    _currentIndex: number,
    _targetUnits: string[],
    team: any[]
  ): void {
    if (!currentData.trackers) currentData.trackers = {};
    const action = effect.action || 'add';

    // True removal (the key stops existing), unlike 'remove'/'consume'
    if (action === 'delete') {
      const name = effect.name || '';
      if (currentData.trackers[name] === undefined) return;
      delete currentData.trackers[name];
      // Hold_Unit/Hold_Input are pure ownership bookkeeping for Hold_Start
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

    const currentVal = currentData.trackers[effect.name || ''] || 0;
    let newVal = currentVal;
    let eventToEmit: string | null = null;

    if (action === 'add') {
      const added = effect.value !== undefined ? parseFloat(String(effect.value)) : 1;
      newVal = Math.max(0, Math.min(currentVal + added, effect.max || Infinity));
      if (newVal > currentVal) eventToEmit = 'OnTrackerAdd';
      else if (newVal < currentVal) eventToEmit = 'OnTrackerRemove';
    } else if (action === 'remove') {
      const removed = effect.value !== undefined ? parseFloat(String(effect.value)) : 1;
      newVal = Math.max(0, currentVal - removed);
      eventToEmit = 'OnTrackerRemove';
    } else if (action === 'consume') {
      // Same ALL/HALF/N math as a buffAction consume/remove (_handleBuffActionEffect) -- an
      // unset value defaults to ALL, matching "Consume" wiping the whole tracker by default.
      const spec = effect.value !== undefined ? effect.value : 'ALL';
      const remaining = stacksAfterSpending(currentVal, spec, false);
      newVal = spec === 'HALF' ? remaining : Math.max(0, remaining);
      eventToEmit = 'OnTrackerConsume';
    } else if (action === 'set' || action === 'copy') {
      newVal = parseFloat(String(effect.value)) || 0;
      if (newVal > currentVal) eventToEmit = 'OnTrackerAdd';
      else if (newVal < currentVal) eventToEmit = 'OnTrackerRemove';
    } else if (action === 'detonate' && currentVal > 0) {
      this._fireTrackerEvents(['OnTrackerDetonate'], effect.name || '', currentData, unitName, activeTeam, activeRows, team);
      newVal = Math.max(0, currentVal - (effect.value !== undefined ? parseFloat(String(effect.value)) : 1));
    }

    // Setting a tracker that doesn't exist yet to 0 still creates it -- a Hold pressed at game
    // time 0 has to register its start, or its Release has nothing to wait against.
    const createsTracker = (action === 'set' || action === 'copy') && currentData.trackers[effect.name || ''] === undefined;
    const delta = newVal - currentVal;
    if (delta === 0 && action !== 'detonate' && !createsTracker) return;

    currentData.trackers[effect.name || ''] = newVal;

    // Hold_Start is a global tracker key (like Cursor_Pos, Forte_Win_Center) shared across
    // every row -- stamp the owner so hold/release logic can ignore a lingering hold from
    // another unit's row.
    if (effect.name === 'Hold_Start') {
      currentData.trackers.Hold_Unit = unitName;
      // Hold_Input disambiguates which Release mechanic this pairs with (e.g. a dual-mode
      // character with one Hold per mode) -- Press and its matching Release always share an input.
      const pressMove = DataLoader.mechanicsDB[currentData.action];
      const inputTag = pressMove?.input;
      if (inputTag) currentData.trackers.Hold_Input = inputTag;
      // Clamp mode ties the cursor to a real forte pool -- pick up from wherever it already
      // sits instead of assuming 0, unless a retained cursor already carried a value forward.
      const releaseConfig = DataLoader.findHoldReleaseConfig(unitName, inputTag);
      if (releaseConfig?.cursorMode === 'clamp' && currentData.trackers.Cursor_Accumulated === undefined) {
        const slot = releaseConfig.forteSlot || MECHANICS_NOTATION.HOLD_DEFAULTS.FORTE_SLOT;
        currentData.trackers.Cursor_Accumulated = currentData[slot]?.[unitName] || 0;
      }
    }

    if (action !== 'detonate') {
      this._fireTrackerEvents(eventToEmit ? ['OnTrackerChanged', eventToEmit] : ['OnTrackerChanged'], effect.name || '', currentData, unitName, activeTeam, activeRows, team);
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
            .find(e => (e.type === 'buff' || !e.type) && e.name === buffDef.name && (e.stat || e.label));
          this._globalBuffCache[buffName] = template ? cloneJson(template) : null;
        }
        cachedTemplate = this._globalBuffCache[buffName];
        if (cachedTemplate) this._localBuffCache[buffName] = cachedTemplate;
      }
      if (cachedTemplate) {
        for (const key in cachedTemplate) {
          if ((buffDef as any)[key] === undefined) {
            (buffDef as any)[key] = typeof (cachedTemplate as any)[key] === 'object' && (cachedTemplate as any)[key] !== null
                ? cloneJson((cachedTemplate as any)[key])
                : (cachedTemplate as any)[key];
          }
        }
      }
    }

    targetUnits.forEach(targetName => {
      const key = `${targetName}_${buffDef.name}`;
      const providerUnit = buffDef.provider || currentData.unit;
      const providerSlot = team.find(t => t.character === providerUnit);
      const weaponRank = providerSlot ? providerSlot.rank : CHARACTER_DEFAULTS.rank;

      let val = buffDef.value;
      if (buffDef.value && typeof buffDef.value === 'string' && buffDef.value.includes('/')) {
        val = CommonUtils.parseRankValue(buffDef.value, weaponRank);
      }

      let effDuration = GAME_DEFAULTS.permanentDuration;
      if (buffDef.duration !== undefined) {
        if (isDslExpr(buffDef.duration, true)) {
          const res = this._resolveDynamicMath(buffDef.duration, currentData, currentData.unit, team);
          effDuration = typeof res === 'number' ? res : (parseFloat(String(res)) || GAME_DEFAULTS.permanentDuration);
        } else {
          const parsed = parseFloat(String(buffDef.duration));
          effDuration = !isNaN(parsed) ? parsed : GAME_DEFAULTS.permanentDuration;
        }
      }

      if (!currentData.activeBuffs) currentData.activeBuffs = {};
      const existingBuff = currentData.activeBuffs[key];
      const addedStacks = buffDef.stacks !== undefined ? parseInt(String(buffDef.stacks), 10) : 1;
      let actuallyAddedStacks = 0;

      if (existingBuff) {
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
        }
      } else {
        currentData.activeBuffs[key] = {
          ...buffDef,
          value: val,
          target: targetName,
          stacks: addedStacks,
          maxDuration: effDuration,
          duration: buffDef.stackBehavior === 'separate' ? undefined : effDuration,
          durations: buffDef.stackBehavior === 'separate' ? [effDuration] : undefined
        };
        actuallyAddedStacks = addedStacks;
      }

      if (actuallyAddedStacks > 0) {
        this._fire('OnBuffAdd', eventModifier(buffDef.name), currentData, buffDef.provider || currentData.unit, activeTeam, activeRows, team);
      }
    });
  }

  // A hold cursor's max is the forte slot it's tied to (forteSlot, defaulting to Forte 1) --
  // maxCursorVal is only a fallback for a slot the active character doesn't actually have.
  _getHoldMaxCap(charName: string, config: HoldConfig): number {
    const slot = config.forteSlot || MECHANICS_NOTATION.HOLD_DEFAULTS.FORTE_SLOT;
    const slotNum = holdSlotNumber(slot);
    const forteCount = parseInt(String(DataLoader.characterDB[charName]?.forteCount), 10) || 1;
    if (slotNum > forteCount) {
      console.warn(`[TimelineEngine] ${charName}'s hold config targets ${slot}, but the character only has ${forteCount} forte slot(s) -- falling back to forte1.`);
      return resourceCap(charName, forteKey(1));
    }
    const fromForte = resourceCap(charName, slot);
    if (fromForte > 0) return fromForte;
    return config.maxCursorVal ?? MECHANICS_NOTATION.HOLD_DEFAULTS.MAX_CURSOR_VAL;
  }

}

export const TimelineEngine = new TimelineEngineClass();