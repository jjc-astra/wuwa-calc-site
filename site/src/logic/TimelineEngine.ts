import { DataLoader } from '../utils/DataLoader';
import { CommonUtils } from '../utils/Common';
import { DSLParser } from './DSLParser';
import { CombatCalculator } from './CombatCalculator';
import { ContextManager } from './ContextManager';
import { EventManager } from './EventManager';
import { calculateEchoStatsForSlot } from '../store/useRosterStore';
import { CHARACTER_DEFAULTS, ENEMY_DEFAULTS, GAME_DEFAULTS, MECHANICS_NOTATION } from '../data/db';
import type { Effect, MechanicNode, HoldConfig } from '../types';
import { type Frames, toFrames, roundFrames, secondsToFrames, framesToSeconds, formatFramesAsSeconds } from '../utils/Frames';

export interface QueuedHit {
  originRow: any;
  originActionId: string;
  originMoveData: MechanicNode;
  hitIndex: number;
  totalHits: number;
  hitMult: number | string;
  provider: string;
  hitModifiers: Set<string>;
  executeAt: Frames;
  isProc: boolean;
}

export class TimelineEngineClass {
  damageQueue: QueuedHit[] = [];
  currentGlobalGameTime = 0;
  currentGlobalRealTime = 0;
  isRecalculating = false;
  lastSwapOutTime: Record<string, number> = {};
  _localBuffCache: Record<string, Effect> = {};
  _globalBuffCache: Record<string, Effect | null> = {};
  _enemyConfig: { level: number; res: number; hp: number } = ENEMY_DEFAULTS;
  // Skips UI-only bookkeeping (dropdown snapshots, per-hit history) that throwaway analyzeLoop
  // sims never read.
  _lightweightMode = false;
  // Memoizes _getModifiedMoveData per actionId for one recalculateState call; reset each call.
  _moveDataCache: Record<string, MechanicNode | null> = {};

  recalculateState(
    activeRows: any[],
    team: any[] = [],
    options: { startEnergy?: boolean; startConcerto?: boolean; lightweight?: boolean } = {},
    enemyConfig: { level: number; res: number; hp: number } = ENEMY_DEFAULTS
  ): any[] {
    if (activeRows.length === 0) return [];

    this.isRecalculating = true;
    this._lightweightMode = !!options.lightweight;
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

    console.log(`[TimelineEngine] Starting recalculateState for ${activeRows.length} rows.`);

    for (let i = 0; i < activeRows.length; i++) {
      const currentData = activeRows[i];
      currentData.dropdownState = null;
      currentData.enemyLevel = enemyConfig.level;
      currentData.enemyRes = enemyConfig.res;

      if (!currentData.unit) {
        const prevData = i > 0 ? activeRows[i - 1] : this._getDefaultData();
        this._applyInheritance(currentData, prevData, accumulatedGameTime, team);
        currentData.timeStart = accumulatedTime;
        currentData.gameTimeStart = accumulatedGameTime;
        if (!this._lightweightMode) {
          const { dropdownState, prevRow, nextRow, ...cleanEmpty } = currentData;
          currentData.dropdownState = JSON.parse(JSON.stringify(cleanEmpty));
        }
        continue;
      }

      const prevData = i > 0 ? activeRows[i - 1] : this._getDefaultData();
      currentData.damageInstances = [];
      currentData._pendingHits = [];
      // Rows are recalculated in place -- clear so a fixed hold config doesn't keep showing
      // last run's "unreachable" error.
      currentData._holdUnreachable = undefined;

      // Populated by the auto-wait lookahead below when this row's own action is a Release --
      // the live cursor-tracking block further down reuses it instead of re-resolving the same
      // holdConfig/DSL-window/maxCap work a second time for the same row.
      let holdConfigCache: { config: HoldConfig; mode: string; speed: number; maxVal: number; center: number; size: number } | null = null;

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
        const teamMembers = team.map(t => t.character).filter(Boolean);
        teamMembers.forEach(charName => {
          if (charName) {
            if (!currentData.energy) currentData.energy = {};
            if (!currentData.concerto) currentData.concerto = {};
            if (options.startEnergy) currentData.energy[charName] = this._getMaxCap(charName, 'energy');
            if (options.startConcerto) currentData.concerto[charName] = this._getMaxCap(charName, 'concerto');
          }
        });
        this._primeCombatStart(currentData, team);
      }

      if (i > 0 && prevData.unit !== currentData.unit) {
        // swapCooldown is seconds-domain; convert once here into the frames-domain marker.
        globalSwapCdExpiresAt = Math.max(globalSwapCdExpiresAt, accumulatedTime + secondsToFrames(GAME_DEFAULTS.swapCooldown));
      }

      const cdKey = `${currentData.unit}_${currentData.moveName}`;
      const actualCdRemaining = currentData.cooldowns?.[cdKey] || 0; // seconds -- cooldowns stay in seconds
      const wCD = secondsToFrames(Math.max(0, actualCdRemaining));
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
        prevData.energy = { ...currentData.energy };
        prevData.concerto = { ...currentData.concerto };
        for (let k = 1; k <= 6; k++) prevData[`forte${k}`] = { ...currentData[`forte${k}`] };
        prevData.enemyTune = currentData.enemyTune;
        prevData.enemyMaxTune = currentData.enemyMaxTune;
      }

      if (dbMove.inputType === 'Release' && currentData.trackers && currentData.trackers.Hold_Start !== undefined && currentData.trackers.Hold_Unit === currentData.unit) {
        const holdStart = currentData.trackers.Hold_Start;
        const config = dbMove.holdConfig || {};
        const speed = config.cursorSpeed ?? MECHANICS_NOTATION.HOLD_DEFAULTS.CURSOR_SPEED;
        const maxVal = this._getHoldMaxCap(currentData.unit, config);
        const mode = config.cursorMode || MECHANICS_NOTATION.HOLD_DEFAULTS.CURSOR_MODE;
        // Clamp has no window -- don't bother resolving it (both here and in the live-tracking
        // block below, via the cache this populates) when 'done' never reads it.
        let center = 0;
        let halfWidth = 0;
        if (mode !== 'clamp') {
          const centerExpr = config.windowCenter ?? MECHANICS_NOTATION.HOLD_DEFAULTS.WINDOW_CENTER;
          const sizeExpr = config.windowSize ?? MECHANICS_NOTATION.HOLD_DEFAULTS.WINDOW_SIZE;
          center = parseFloat(String(this._resolveDynamicMath(centerExpr, currentData, currentData.unit, team)));
          halfWidth = parseFloat(String(this._resolveDynamicMath(sizeExpr, currentData, currentData.unit, team))) / 2;
        }
        holdConfigCache = { config, mode, speed, maxVal, center, size: halfWidth * 2 };

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
            if (!currentData.offsetReasons) currentData.offsetReasons = [];
            currentData.offsetReasons.push({ label: 'Manual Hold Wait', valueFrames: toFrames(appliedDelay) });
          }
          // Not surfaced here: the user has explicitly opted out of waiting for "done", so an
          // auto-search miss isn't an error for them the way it is in every other timing mode.
        } else if (holdReachable && holdReleaseDelay > 0) {
          finalWaitTime += holdReleaseDelay;
          currentData.waitTime = finalWaitTime;
          if (!currentData.offsetReasons) currentData.offsetReasons = [];
          currentData.offsetReasons.push({ label: mode === 'clamp' ? 'Forte Full Wait' : 'Forte Window Wait', valueFrames: toFrames(holdReleaseDelay) });
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

      if (dbMove.stanceResult && dbMove.stanceResult !== 'Retain') {
        const transitionTime = dbMove.stanceTime !== undefined ? parseFloat(String(dbMove.stanceTime)) : 0;
        if (currentData.duration >= transitionTime) currentData.stance = dbMove.stanceResult;
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
        let config: HoldConfig, mode: string, speed: number, maxVal: number, center: number, size: number;
        if (holdConfigCache) {
          ({ config, mode, speed, maxVal, center, size } = holdConfigCache);
        } else {
          config = dbMove.holdConfig || DataLoader.findHoldReleaseConfig(currentData.unit, currentData.trackers?.Hold_Input) || {};
          mode = config.cursorMode || MECHANICS_NOTATION.HOLD_DEFAULTS.CURSOR_MODE;
          speed = config.cursorSpeed ?? MECHANICS_NOTATION.HOLD_DEFAULTS.CURSOR_SPEED;
          maxVal = this._getHoldMaxCap(currentData.unit, config);
          if (mode === 'clamp') {
            center = 0;
            size = 0;
          } else {
            const centerExpr = config.windowCenter ?? MECHANICS_NOTATION.HOLD_DEFAULTS.WINDOW_CENTER;
            const sizeExpr = config.windowSize ?? MECHANICS_NOTATION.HOLD_DEFAULTS.WINDOW_SIZE;
            center = parseFloat(String(this._resolveDynamicMath(centerExpr, currentData, currentData.unit, team)));
            size = parseFloat(String(this._resolveDynamicMath(sizeExpr, currentData, currentData.unit, team)));
          }
        }
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

      // Pre-cast dropdown snapshot, skipped in lightweight mode (nothing renders it there).
      if (!this._lightweightMode) {
        currentData.dropdownState = {
          ...currentData,
          hp: JSON.parse(JSON.stringify(currentData.hp || {})),
          energy: JSON.parse(JSON.stringify(currentData.energy || {})),
          forte1: JSON.parse(JSON.stringify(currentData.forte1 || {})),
          forte2: JSON.parse(JSON.stringify(currentData.forte2 || {})),
          forte3: JSON.parse(JSON.stringify(currentData.forte3 || {})),
          forte4: JSON.parse(JSON.stringify(currentData.forte4 || {})),
          forte5: JSON.parse(JSON.stringify(currentData.forte5 || {})),
          forte6: JSON.parse(JSON.stringify(currentData.forte6 || {})),
          concerto: JSON.parse(JSON.stringify(currentData.concerto || {})),
          trackers: JSON.parse(JSON.stringify(currentData.trackers || {})),
          activeBuffs: JSON.parse(JSON.stringify(currentData.activeBuffs || {})),
          cooldowns: JSON.parse(JSON.stringify(currentData.cooldowns || {})),
          enemyTune: currentData.enemyTune,
          enemyMaxTune: currentData.enemyMaxTune,
          gameTimeStart: currentData.gameTimeStart,
          prevRow: currentData.prevRow,
          nextRow: currentData.nextRow,
          unitCombos: currentData.unitCombos ? JSON.parse(JSON.stringify(currentData.unitCombos)) : {}
        };
      }

      this._runValidation(currentData, prevData, team, dbMove);

      if (currentData.warningMsgs.length > 0 || currentData.errorMsgs.length > 0) {
        console.warn(`[TimelineEngine] Row #${i + 1} (${currentData.unit} - ${currentData.action}):`, {
          errors: currentData.errorMsgs,
          warnings: currentData.warningMsgs,
          prevAction: currentData.unitCombos?.[currentData.unit]?.action,
          prevUnit: prevData?.unit
        });
      }

      this._evaluateMechanics(currentData, activeTeam, activeRows, i, team, dbMove);
      this._resolveComboWindows(currentData, dbMove, prevData, team);
      // For the Timeline's spam-click indicator; deferred until here so @Self/@Move context
      // reflects this row's fully-computed state.
      currentData.priority = dbMove.priority === undefined
        ? 0
        : (typeof dbMove.priority === 'string' && (dbMove.priority.includes('@') || /[+\-*/]/.test(dbMove.priority)))
          ? Number(this._resolveDynamicMath(dbMove.priority, currentData, currentData.unit, team))
          : parseFloat(String(dbMove.priority));
    }

    const emptyRow = activeRows[activeRows.length - 1];
    if (emptyRow && activeRows.length > 1) {
      const lastActive = activeRows[activeRows.length - 2];
      this._applyInheritance(emptyRow, lastActive, accumulatedGameTime, team);
      emptyRow.prevRow = lastActive;
      emptyRow.gameTimeStart = accumulatedGameTime;
      emptyRow.timeStart = accumulatedTime;

      if (!this._lightweightMode) {
        const { dropdownState, prevRow, nextRow, ...cleanEmpty } = emptyRow;
        emptyRow.dropdownState = JSON.parse(JSON.stringify(cleanEmpty));
      }
    } else if (emptyRow && !this._lightweightMode) {
      const { dropdownState, prevRow, nextRow, ...cleanEmpty } = emptyRow;
      emptyRow.dropdownState = JSON.parse(JSON.stringify(cleanEmpty));
    }

    // A hit can still be queued here (e.g. cancelled into an Outro via swapTiming) with no
    // later row to advance the clock far enough to reach it -- flush what's left now.
    if (this.damageQueue.length > 0) {
      const flushContext = activeRows[activeRows.length - 1];
      this._processQueuedHits(flushContext, toFrames(Number.MAX_SAFE_INTEGER), activeTeam, activeRows, team);
    }

    this.isRecalculating = false;
    return activeRows;
  }

  // loopStartOverride always wins. Otherwise the loop starts after the main DPS's first Outro
  // (no Outro = whole rotation is the loop). Lives here so the calc worker can call it too.
  findLoopStart(rows: any[], mainDps: string | undefined): { index: number; isOverride: boolean } {
    const overrideIndex = rows.findIndex(r => r.loopStartOverride === true && !!r.unit);
    if (overrideIndex !== -1) return { index: overrideIndex, isOverride: true };

    if (mainDps) {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.unit === mainDps && Array.isArray(row.castTypes) && row.castTypes.includes('Outro')) {
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
    const extendedResult = this.recalculateState(extendedInput, team, { ...options, lightweight: true }, enemyConfig);

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
    const patchedMove = JSON.parse(JSON.stringify(safeData));
    if (_compiledRule && typeof _compiledRule.evaluate === 'function') {
      patchedMove._compiledRule = _compiledRule;
    }
    this._moveDataCache[actionId] = patchedMove;
    return patchedMove;
  }

  _getDefaultData(): any {
    return {
      unit: '', action: '', timing: 'Auto', offset: 0,
      energy: {}, concerto: {}, hp: {}, trackers: {},
      cooldowns: {}, activeBuffs: {}, unitCombos: {},
      timeStart: 0, gameTimeStart: 0, duration: 0, gameTimePassed: 0
    };
  }

  _setupEventBoard(team: any[] = []): string[] {
    EventManager.reset();
    const activeTeam = team.map(t => t.character).filter(Boolean);
    team.forEach(slot => {
      if (!slot.character) return;
      const registerAll = (itemName: string) => {
        if (!itemName) return;
        const indexKeys = DataLoader.mechanicsIndex[itemName] || [];
        if (indexKeys.length > 0) {
          indexKeys.forEach(k => {
            if (DataLoader.mechanicsDB[k]) EventManager.registerMechanic(DataLoader.mechanicsDB[k], slot.character);
          });
        } else {
          const directMech = DataLoader.mechanicsDB[itemName] || DataLoader.mechanicsDB[`System_${itemName}`];
          if (directMech) EventManager.registerMechanic(directMech, slot.character);
        }
      };

      const registerWeapon = (weaponName: string, rank: number) => {
        if (!weaponName) return;
        const applyRank = (mech: MechanicNode) => {
          const m = JSON.parse(JSON.stringify(mech));
          if (m.effects) {
            m.effects = m.effects.map((e: any) => ({ ...e, value: CommonUtils.parseRankValue(e.value, rank) }));
          }
          return m;
        };
        const indexKeys = DataLoader.mechanicsIndex[weaponName] || [];
        if (indexKeys.length > 0) {
          indexKeys.forEach(k => {
            if (DataLoader.mechanicsDB[k]) EventManager.registerMechanic(applyRank(DataLoader.mechanicsDB[k]), slot.character);
          });
        } else {
          const directWep = DataLoader.mechanicsDB[weaponName] || DataLoader.mechanicsDB[`System_${weaponName}`];
          if (directWep) EventManager.registerMechanic(applyRank(directWep), slot.character);
        }
      };

      [slot.mainSet, slot.subSet, slot.mainEcho].filter(Boolean).forEach(registerAll);
      registerWeapon(slot.weapon, slot.rank);

      const charKeys = DataLoader.mechanicsIndex[slot.character] || [];
      charKeys.forEach(key => {
        const mech = DataLoader.mechanicsDB[key];
        if (mech && (mech.isPassive || key === `${slot.character}_Outro`)) {
          EventManager.registerMechanic(mech, slot.character);
        }
      });
    });

    // Generic.json's status/Tune-Break nodes aren't owned by any team slot, so they never get
    // registered above -- register them once under a synthetic 'System' equipper.
    (DataLoader.mechanicsIndex['System'] || []).forEach(key => {
      const mech = DataLoader.mechanicsDB[key];
      if (mech?.isPassive) EventManager.registerMechanic(mech, 'System');
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
    currentData.hp = { ...(prevData.hp || {}) };
    currentData.energy = { ...(prevData.energy || {}) };
    currentData.concerto = { ...(prevData.concerto || {}) };

    for (let i = 1; i <= 6; i++) {
      const fKey = `forte${i}`;
      currentData[fKey] = { ...(prevData[fKey] || {}) };
    }

    currentData.trackers = structuredClone(prevData.trackers || {});
    for (const key in currentData.trackers) {
      if (key.endsWith('_Delta')) delete currentData.trackers[key];
    }

    currentData.cooldowns = structuredClone(prevData.cooldowns || {});
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
      const activeTeam = team.map(t => t.character).filter(Boolean);
      prevData.pendingNextBuffs.forEach((eff: any) => {
        const nextEff = { ...eff, target: currentData.unit };
        this._processEffect(nextEff, currentData, eff.provider || prevData.unit, activeTeam, [], currentData.arrayIndex, team);
      });
    }

    currentData.timeScales = structuredClone(prevData.timeScales || {});
    if (prevData.unit && currentData.unit && currentData.unit !== prevData.unit) {
      const isIntro = currentData.castTypes?.includes('Intro');
      const myCombo = prevData.unitCombos?.[currentData.unit];
      const isDuringCombo = myCombo && currentTime <= myCombo.expiration;
      currentData.stance = (isIntro || isDuringCombo) ? CHARACTER_DEFAULTS.defaultStance : (prevData.stance || CHARACTER_DEFAULTS.defaultStance);
    } else {
      currentData.stance = prevData.stance || CHARACTER_DEFAULTS.defaultStance;
    }
  }

  _primeCombatStart(firstRowData: any, team: any[]): void {
    const teamMembers = team.map(t => t.character).filter(Boolean);
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

  _resolveComboWindows(currentData: any, dbMove: MechanicNode, prevData: any, team: any[]): void {
    const resolveTime = (val: any): Frames | null => {
      if (val === undefined) return null;
      return (typeof val === 'string' && (val.includes('@') || /[+\-*/]/.test(val)))
        ? roundFrames(Number(this._resolveDynamicMath(val, currentData, currentData.unit, team)))
        : roundFrames(parseFloat(val));
    };

    const isUtility = currentData.castTypes?.includes('Dodge') ||
                      currentData.castTypes?.includes('Echo') ||
                      currentData.castTypes?.includes('Utility');

    if (!currentData.action) return;

    if (!isUtility) {
      const customWindow = dbMove.comboWindow !== undefined ? resolveTime(dbMove.comboWindow) : null;
      const postMoveWindow = customWindow !== null ? customWindow : GAME_DEFAULTS.comboWindow;
      const animTime = currentData.animationCommitment;
      currentData.unitCombos[currentData.unit] = {
        action: currentData.action,
        expiration: currentData.gameTimeStart + animTime + postMoveWindow
      };
    } else if (prevData && prevData.unitCombos?.[currentData.unit]) {
      currentData.unitCombos[currentData.unit] = {
        action: prevData.unitCombos[currentData.unit].action,
        expiration: prevData.unitCombos[currentData.unit].expiration + currentData.duration
      };
    }
  }

  _resolveTimings(currentData: any, moveData: MechanicNode, team: any[]): any {
    const timingType = currentData.timing || 'Auto';
    const unitName = currentData.unit;

    const resolveMath = (val: any, fallback: Frames): Frames => {
      if (val === undefined) return fallback;
      return (typeof val === 'string' && (val.includes('@') || /[+\-*/]/.test(val)))
        ? roundFrames(parseFloat(String(this._resolveDynamicMath(val, currentData, currentData.unit, team))))
        : roundFrames(parseFloat(val));
    };

    const actionDuration = moveData.actionDuration !== undefined ? resolveMath(moveData.actionDuration, toFrames(0)) : toFrames(0);
    const freezeTime = moveData.freezeTime !== undefined ? resolveMath(moveData.freezeTime, toFrames(0)) : toFrames(0);
    const swapTiming = moveData.swapTiming !== undefined ? resolveMath(moveData.swapTiming, toFrames(GAME_DEFAULTS.swapTime)) : undefined;
    const hitCount = Array.isArray(moveData.hitMults) ? moveData.hitMults.length : 0;

    const validCancels: Array<{ index: number; time: Frames; hits: number }> = [];
    if (moveData.cancelTimings && moveData.cancelTimings.length > 0) {
      moveData.cancelTimings.forEach((ct, idx) => {
        let isValid = false;
        if (!ct.triggerRule || ct.triggerRule.trim() === '') isValid = true;
        else {
          if (!ct._compiledRule || typeof ct._compiledRule.evaluate !== 'function') {
            ct._compiledRule = DSLParser.compile(ct.triggerRule);
          }
          if (ct._compiledRule && typeof ct._compiledRule.evaluate === 'function') {
            const ctx = ContextManager.buildContext(currentData, currentData.unit, team);
            isValid = ct._compiledRule.evaluate(ctx, currentData.unit);
          }
        }
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
      let erMult = 1.0;
      const validBuffs = Object.values(currentData.activeBuffs || {}).filter((b: any) =>
        b.target === unitName || b.target === '@Team' || (b.target === 'Active' && unitName === currentData.unit)
      );
      const stats = CombatCalculator.calculateFinalStats(unitName, validBuffs as Effect[], team);
      erMult = (stats.energyRegen || 100) / 100;

      if (moveData.hitResources.energy && currentData.energy?.[unitName] !== undefined) {
        let cur = currentData.energy[unitName];
        const maxCap = this._getMaxCap(unitName, 'energy');
        if (moveData.castResources?.energy) {
          const castAmt = parseFloat(String(moveData.castResources.energy)) || 0;
          cur += castAmt > 0 ? castAmt * erMult : castAmt;
        }
        const resArray = moveData.hitResources.energy;
        if (Array.isArray(resArray)) {
          for (let i = 0; i < hitCount; i++) {
            if (cur >= maxCap) break;
            const hitAmt = parseFloat(String(resArray[i])) || 0;
            cur += hitAmt > 0 ? hitAmt * erMult : hitAmt;
            if (cur >= maxCap) { capEnergyHitIdx = i; break; }
          }
        }
      }

      if (moveData.hitResources.concerto && currentData.concerto?.[unitName] !== undefined) {
        let cur = currentData.concerto[unitName];
        const maxCap = this._getMaxCap(unitName, 'concerto');
        if (moveData.castResources?.concerto) {
          cur += parseFloat(String(moveData.castResources.concerto)) || 0;
        }
        const resArray = moveData.hitResources.concerto;
        if (Array.isArray(resArray)) {
          for (let i = 0; i < hitCount; i++) {
            if (cur >= maxCap) break;
            cur += parseFloat(String(resArray[i])) || 0;
            if (cur >= maxCap) { capConcertoHitIdx = i; break; }
          }
        }
      }
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
      const nextRow = currentData.nextRow;
      const nextMoveData = nextRow?.action ? this._getModifiedMoveData(nextRow.action) : null;
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
    this._processQueuedHits(currentData, realTimePassed, activeTeam, activeRows, team);
    this.currentGlobalRealTime += realTimePassed;
    if (gameTimePassed > 0) {
      this._processGameTimeDecay(currentData, gameTimePassed, activeTeam, activeRows, team);
      this.currentGlobalGameTime += gameTimePassed;
    }
  }

  _applyDecay(currentData: any, realTimePassed: Frames, gameTimePassed: Frames, isSubsequentRow: boolean, activeTeam: string[], activeRows: any[], team: any[]): void {
    if (!isSubsequentRow || realTimePassed < 0) return;
    this._processQueuedHits(currentData, realTimePassed, activeTeam, activeRows, team);
    this.currentGlobalRealTime += realTimePassed;
    if (gameTimePassed > 0) {
      this._processGameTimeDecay(currentData, gameTimePassed, activeTeam, activeRows, team);
      this.currentGlobalGameTime += gameTimePassed;
    }
  }

  // A row can be short on a resource purely because its own generation is still undrained
  // in the queue (e.g. an Outro right after a Swap). Static prediction isn't reliable here --
  // passive/OnHit grants aren't visible ahead of time -- so this drains the queue hit-by-hit
  // via _decayState, like a cooldown wait, until the shortfall resolves or the queue can't help.
  // Energy is excluded: stays a warning, never worth forcing a wait.
  _computeResourceWait(currentData: any, dbMove: MechanicNode, team: any[], activeTeam: string[], activeRows: any[]): { waitFrames: number; label: string | null } {
    const unit = currentData.unit;
    if (!unit) return { waitFrames: 0, label: null };

    const costs: Record<string, any> = (dbMove as any).cost || {};
    const castRes: Record<string, any> = dbMove.castResources || (dbMove as any).resources || {};
    const reqFor = (key: string): number => (costs[key] || 0) + (castRes[key] < 0 ? Math.abs(castRes[key]) : 0);
    const currentValue = (key: string): number => key === 'tune' ? (currentData.enemyTune || 0) : (currentData[key]?.[unit] || 0);

    const trackedKeys: Array<{ key: string; label: string }> = [
      { key: 'concerto', label: 'Concerto' },
      { key: 'tune', label: 'Tune' },
      { key: 'forte1', label: 'Forte 1' }, { key: 'forte2', label: 'Forte 2' }, { key: 'forte3', label: 'Forte 3' },
      { key: 'forte4', label: 'Forte 4' }, { key: 'forte5', label: 'Forte 5' }, { key: 'forte6', label: 'Forte 6' }
    ];

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
          if (k.key !== 'tune' && hit.provider !== unit) return false;
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

  _processQueuedHits(currentData: any, realTimePassed: Frames, activeTeam: string[], activeRows: any[], team: any[]): void {
    const realWindowEnd = this.currentGlobalRealTime + realTimePassed;
    while (this.damageQueue.length > 0) {
      const nextHit = this.damageQueue[0];
      if (nextHit.executeAt > realWindowEnd) break;

      this.damageQueue.shift();
      const limit = nextHit.isProc ? (nextHit.originMoveData.allowedHits !== undefined ? nextHit.originMoveData.allowedHits : Infinity) : nextHit.originRow.allowedHits;
      if (nextHit.hitIndex >= limit) continue;

      const hitRes = nextHit.originMoveData.hitResources;
      if (hitRes) {
        for (const resKey in hitRes) {
          const resArray = hitRes[resKey];
          const amount = (Array.isArray(resArray) && resArray.length > nextHit.hitIndex) ? resArray[nextHit.hitIndex] : 0;
          if (amount !== 0) {
            const targetSelector = resKey === 'energy' ? '@Team' : '@Self';
            this._processEffect({ type: 'resource', name: resKey, value: amount, target: targetSelector, provider: nextHit.provider }, currentData, nextHit.provider, activeTeam, activeRows, currentData.arrayIndex, team);
          }
        }
      }

      currentData.activeProcSource = nextHit.originActionId;
      const onHitEffects = EventManager.emit('OnHit', nextHit.hitModifiers, currentData, nextHit.provider, team);
      this._executeEffectsStream(onHitEffects, currentData, activeTeam, activeRows, nextHit.executeAt, nextHit.provider, team);
      delete currentData.activeProcSource;

      // Builds this hit's UI-facing history entry (DMG-cell breakdown); skipped in lightweight mode.
      if (!this._lightweightMode) {
        const hitName = nextHit.originMoveData.name + (nextHit.totalHits > 1 ? ` (Hit ${nextHit.hitIndex + 1})` : '');
        const { prevRow, nextRow, dropdownState, _pendingHits, ...cleanData } = currentData;
        if (!nextHit.originRow._pendingHits) nextHit.originRow._pendingHits = [];

        // executeAt is real-time; convert to game time. Only freezeTime splits the two domains
        // -- not a truncated duration, since a hit can resolve after a swap cuts the animation short.
        const originRow = nextHit.originRow;
        const elapsedSinceRowStart = Math.max(0, nextHit.executeAt - (originRow.timeStart || 0));
        const rowFreezeTime = originRow.freezeTime || 0;
        const hitGameTime = (originRow.gameTimeStart || 0) + Math.max(0, elapsedSinceRowStart - rowFreezeTime);

        nextHit.originRow._pendingHits.push({
          config: {
            hitMult: nextHit.hitMult, provider: nextHit.provider, dmgTypes: nextHit.originMoveData.dmgTypes,
            castTypes: nextHit.originMoveData.castTypes, scalar: nextHit.originMoveData.scalar,
            title: nextHit.isProc ? `[Proc] ${hitName}` : (nextHit.totalHits > 1 ? `Hit ${nextHit.hitIndex + 1}` : 'Active Hit'),
            isOpen: false,
            actionId: nextHit.originActionId,
            moveName: nextHit.originMoveData.name,
            gameTime: hitGameTime,
            hitIndex: nextHit.hitIndex
          },
          context: JSON.parse(JSON.stringify(cleanData))
        });
      }

      const afterHitEffects = EventManager.emit('AfterHit', nextHit.hitModifiers, currentData, nextHit.provider, team, { hitIndex: nextHit.hitIndex + 1, totalHits: nextHit.totalHits });
      this._executeEffectsStream(afterHitEffects, currentData, activeTeam, activeRows, nextHit.executeAt, nextHit.provider, team);
    }
  }

  _processGameTimeDecay(currentData: any, gameTimePassed: Frames, activeTeam: string[], activeRows: any[], team: any[]): void {
    // Cooldowns and buff/effect lifetimes deliberately stay in seconds, unlike frame-domain gameTimePassed.
    const decaySeconds = framesToSeconds(gameTimePassed);
    const getTimeScale = (timerId: string) => {
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
        const provider = buff.provider || currentData.unit;
        // Modifier brackets are lowercased at DSL-parse time (DSLParser.ts), so match that case.
        const payloads = EventManager.emit('OnBuffExpire', new Set([(buff.name || '').toLowerCase()]), currentData, provider, team);
        if (payloads.length > 0) {
          this._executeEffectsStream(payloads, currentData, activeTeam, activeRows, this.currentGlobalRealTime, provider, team);
        }
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

    // OnTick intervals are authored as raw seconds literals in the DSL, so this stays seconds.
    const tickEffects = EventManager.emit('OnTick', new Set(), currentData, currentData.unit, team, { gameTimePassed: decaySeconds, getTimeScale });
    this._executeEffectsStream(tickEffects, currentData, activeTeam, activeRows, this.currentGlobalRealTime, currentData.unit, team);
  }

  _scheduleHits(currentData: any, moveData: MechanicNode, provider: string, rawMults: any[], executeStartTime: number, executeEndTime: number, isProc: boolean, hitModifiers: Set<string>, team: any[]): void {
    const snapshotMath = (hm: any, pUnit: string) => (typeof hm === 'string' && (hm.includes('@') || /[+\-*/]/.test(hm))) ? this._resolveDynamicMath(hm, currentData, pUnit, team) : hm;
    const snapshottedMults = rawMults.map(hm => snapshotMath(hm, provider));
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
        provider: provider,
        hitModifiers: hitModifiers,
        executeAt: roundFrames(hitTime),
        isProc: isProc
      });
    }
  }

  _queueProccedMechanic(currentData: any, proc: any, executeAt: number, team: any[]): void {
    const mData = proc.mechanicData;
    const rawProcMults = Array.isArray(mData.hitMults) ? mData.hitMults : [];
    // Adds name/pointer so an OnHit[...] rule can target this specific proc'd mechanic by name.
    const procModifiers = new Set([
      ...(mData.dmgTypes || []),
      ...(mData.castTypes || []),
      mData.name,
      `@${proc.provider}(${mData.name})`
    ].map((m: any) => String(m).toLowerCase()));
    if (rawProcMults.length > 0) {
      // A proc'd mechanic can carry its own damageTimeframe, offsetting from executeAt; left
      // unset, both default to executeAt (instant-fire).
      const resolveOffset = (val: any): Frames => (typeof val === 'string' && (val.includes('@') || /[+\-*/]/.test(val)))
        ? roundFrames(parseFloat(String(this._resolveDynamicMath(val, currentData, proc.provider, team))))
        : roundFrames(parseFloat(val));
      const tfStart = mData.damageTimeframe?.start !== undefined ? resolveOffset(mData.damageTimeframe.start) : toFrames(0);
      const tfEnd = mData.damageTimeframe?.end !== undefined ? resolveOffset(mData.damageTimeframe.end) : tfStart;
      this._scheduleHits(currentData, mData, proc.provider, rawProcMults, executeAt + tfStart, executeAt + tfEnd, true, procModifiers, team);
    }
    this.damageQueue.sort((a, b) => a.executeAt - b.executeAt);
  }

  _executeEffectsStream(effectsArray: Effect[], currentData: any, activeTeam: string[], activeRows: any[], executeAt: number, defaultProvider: string, team: any[]): void {
    if (!effectsArray || effectsArray.length === 0) return;
    effectsArray.forEach((eff: any) => { if (eff.type === 'procced_mechanic') this._queueProccedMechanic(currentData, eff, executeAt, team); });
    effectsArray.forEach(eff => { if (eff.type !== 'procced_mechanic') this._processEffect(eff, currentData, eff.provider || defaultProvider, activeTeam, activeRows, currentData.arrayIndex, team); });
  }

  _applyMoveCosts(currentData: any, moveData: MechanicNode): void {
    if (!moveData.cost) return;
    const unitName = currentData.unit;
    const cost = moveData.cost as Record<string, number>;
    if (cost.energy) currentData.energy[unitName] = Math.max(0, (currentData.energy[unitName] || 0) - cost.energy);
    if (cost.concerto) currentData.concerto[unitName] = Math.max(0, (currentData.concerto[unitName] || 0) - cost.concerto);
    if (cost.tune) currentData.enemyTune = Math.max(0, (currentData.enemyTune || 0) - cost.tune);
    for (let i = 1; i <= 6; i++) {
      const fKey = `forte${i}`;
      if (cost[fKey]) {
        if (!currentData[fKey]) currentData[fKey] = {};
        currentData[fKey][unitName] = Math.max(0, (currentData[fKey][unitName] || 0) - cost[fKey]);
      }
    }
  }

  // A timed 'Enemy_TuneImmune' buff (e.g. applied by Tune Break) blocks tune gain entirely.
  _isTuneImmune(currentData: any): boolean {
    return !!currentData.activeBuffs?.['Enemy_TuneImmune'];
  }

  _applyCastResources(currentData: any, moveData: MechanicNode, activeTeam: string[], team: any[]): void {
    if (!moveData.castResources) return;
    const unitName = currentData.unit;
    const getERMult = (charName: string) => {
      const validBuffs = Object.values(currentData.activeBuffs || {}).filter((b: any) =>
        b.target === charName || b.target === '@Team' || (b.target === 'Active' && charName === currentData.unit)
      );
      const stats = CombatCalculator.calculateFinalStats(charName, validBuffs as Effect[], team);
      return (stats.energyRegen || 100) / 100;
    };

    for (const key in moveData.castResources) {
      const val = moveData.castResources[key];
      if (val === undefined || val === 0) continue;
      const maxCap = this._getMaxCap(unitName, key);
      if (key === 'tune') {
        const numVal = parseFloat(String(val));
        if (numVal > 0 && this._isTuneImmune(currentData)) continue;
        currentData.enemyTune = Math.min(maxCap, Math.max(0, (currentData.enemyTune || 0) + numVal));
        continue;
      }
      if (!currentData[key]) currentData[key] = {};
      if (key === 'energy') {
        const numVal = parseFloat(String(val));
        if (numVal < 0) {
          const oldEnergy = currentData.energy[unitName] || 0;
          currentData.energy[unitName] = Math.min(Math.max(0, oldEnergy + numVal), this._getMaxCap(unitName, 'energy'));
        } else {
          activeTeam.forEach(tName => {
            const erMult = getERMult(tName);
            const gained = numVal * erMult;
            const oldEnergy = currentData.energy[tName] || 0;
            currentData.energy[tName] = Math.min(Math.max(0, oldEnergy + gained), this._getMaxCap(tName, 'energy'));
          });
        }
      } else {
        currentData[key][unitName] = Math.min(Math.max(0, (currentData[key][unitName] || 0) + parseFloat(String(val))), maxCap);
      }
    }
  }

  _gatherInstantEffects(currentData: any, moveData: MechanicNode, prevData: any, castModifiers: Set<string>, team: any[]): Effect[] {
    const effects: Effect[] = [...(moveData.effects || [])];
    effects.push(...EventManager.emit('OnCast', castModifiers, currentData, currentData.unit, team));
    if (prevData && prevData.unit && prevData.unit !== currentData.unit) {
      effects.push(...EventManager.emit('OnSwapOut', new Set(), currentData, prevData.unit, team));
      effects.push(...EventManager.emit('OnSwapIn', new Set(), currentData, currentData.unit, team));
      effects.push(...EventManager.emit('OnChange', new Set(), currentData, currentData.unit, team));
    }
    return effects;
  }

  _evaluateMechanics(currentData: any, activeTeam: string[], activeRows: any[], currentIndex: number, team: any[], dbMove: MechanicNode): void {
    const unitName = currentData.unit;
    const moveData = dbMove;
    const prevData = currentIndex > 0 ? activeRows[currentIndex - 1] : this._getDefaultData();

    const startEnergy = currentData.energy?.[unitName] || 0;
    const startConcerto = currentData.concerto?.[unitName] || 0;
    const startTune = currentData.enemyTune || 0;
    const startFortes: Record<string, number> = {};
    for (let i = 1; i <= 6; i++) {
      const fKey = `forte${i}`;
      startFortes[fKey] = currentData[fKey]?.[unitName] || 0;
    }

    const currentFreezeTime = currentData.freezeTime || 0;
    if (currentFreezeTime > 0 && this.damageQueue.length > 0) {
      this.damageQueue.forEach(queuedHit => {
        if (queuedHit.provider !== unitName) {
          queuedHit.executeAt += currentFreezeTime;
        }
      });
      this.damageQueue.sort((a, b) => a.executeAt - b.executeAt);
    }

    if (moveData.cooldown) {
      if (!currentData.cooldowns) currentData.cooldowns = {};
      currentData.cooldowns[`${unitName}_${currentData.moveName}`] = parseFloat(String(moveData.cooldown));
    }

    // dmgTypes plus name/pointer, so OnHit[...] can target one specific move, not just a
    // shared dmg type.
    const hitModifiers = new Set([
      ...(moveData.dmgTypes || []),
      moveData.name,
      `@${unitName}(${moveData.name})`
    ].map(m => String(m).toLowerCase()));
    const elements = ['Glacio', 'Aero', 'Electro', 'Fusion', 'Spectro', 'Havoc', 'Physical'];
    const moveElements = (moveData.dmgTypes || []).filter(t => elements.includes(t));
    const castModifiers = new Set([
      ...(moveData.castTypes || []),
      ...moveElements,
      currentData.action,
      moveData.name,
      `@${currentData.unit}(${moveData.name})`
    ].map(m => String(m).toLowerCase()));

    this._applyMoveCosts(currentData, moveData);
    this._applyCastResources(currentData, moveData, activeTeam, team);
    const instantEffects = this._gatherInstantEffects(currentData, moveData, prevData, castModifiers, team);

    const rawHitMults = Array.isArray(moveData.hitMults) ? moveData.hitMults : [];
    const tfStart = currentData.timeStart + (currentData.damageTimeframe?.start || 0);
    const tfEnd = currentData.timeStart + (currentData.damageTimeframe?.end || currentData.baseDuration);

    if (rawHitMults.length > 0) {
      this._scheduleHits(currentData, moveData, unitName, rawHitMults, tfStart, tfEnd, false, hitModifiers, team);
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
    currentData.trackers.energy_Delta = (currentData.energy?.[unitName] || 0) - startEnergy;
    currentData.trackers.concerto_Delta = (currentData.concerto?.[unitName] || 0) - startConcerto;
    currentData.trackers.tune_Delta = (currentData.enemyTune || 0) - startTune;
    for (let i = 1; i <= 6; i++) {
      const fKey = `forte${i}`;
      const finalForte = currentData[fKey]?.[unitName] || 0;
      const deltaKey = i === 1 ? 'forte_Delta' : `forte${i}_Delta`;
      currentData.trackers[deltaKey] = finalForte - startFortes[fKey];
    }
  }

  _runValidation(currentData: any, prevData: any, team: any[], dbMove: MechanicNode): void {
    const errors: string[] = [];
    const warnings: string[] = [];
    currentData.errorMsgs = errors;
    currentData.warningMsgs = warnings;
    const moveData = dbMove;
    const moveName = moveData.name || currentData.action;
    const castRes: Record<string, any> = moveData.castResources || (moveData as any).resources || {};
    const costs: Record<string, any> = (moveData as any).cost || {};

    // Energy is the only resource whose shortfall stays a warning (rotation can limp forward
    // on low energy); Concerto/Tune/Forte shortfalls are errors -- see validateRes.
    const buildEnergyShortfallMsg = (myVal: number, req: number) => {
      const base = `${currentData.unit} has ${myVal.toFixed(1)} out of the required ${req} Resonance Energy`;
      if (myVal <= 0) return `${base}.`;
      // Backs out the ER% that would have closed the gap by now, as an "aim for this much ER" hint.
      const validBuffs = Object.values(currentData.activeBuffs || {}).filter((b: any) =>
        b.target === currentData.unit || b.target === '@Team' || b.target === 'Active'
      );
      const stats = CombatCalculator.calculateFinalStats(currentData.unit, validBuffs as Effect[], team);
      const erTotal = stats.energyRegen || 100;
      const extraErNeeded = erTotal * ((req - myVal) / myVal);
      return `${base} (Needs ${extraErNeeded.toFixed(0)}% ER on top of the current ${erTotal.toFixed(0)}% ER).`;
    };

    const validateRes = (key: string, myVal: number, label: string) => {
      const req = (costs[key] || 0) + (castRes[key] < 0 ? Math.abs(castRes[key]) : 0);
      if (req > 0 && myVal < req) {
        if (key === 'energy') warnings.push(buildEnergyShortfallMsg(myVal, req));
        else errors.push(`Not enough ${label} (Needs ${req}).`);
      }
    };

    validateRes('energy', currentData.energy?.[currentData.unit] || 0, 'Resonance Energy');
    validateRes('concerto', currentData.concerto?.[currentData.unit] || 0, 'Concerto');
    validateRes('tune', currentData.enemyTune || 0, 'Tune');
    for (let i = 1; i <= 6; i++) {
      validateRes(`forte${i}`, currentData[`forte${i}`]?.[currentData.unit] || 0, `Forte ${i}`);
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
      if (!moveData._compiledRule || typeof moveData._compiledRule.evaluate !== 'function') {
        moveData._compiledRule = DSLParser.compile(moveData.triggerRule);
      }
      if (moveData._compiledRule && typeof moveData._compiledRule.evaluate === 'function') {
        const ctx = ContextManager.buildContext(currentData, currentData.unit, team);
        // Only surfaced when nothing more specific (a shortfall/cooldown wait above) already
        // explains the failure.
        if (!moveData._compiledRule.evaluate(ctx, currentData.unit) && errors.length === 0 && warnings.length === 0) {
          warnings.push(`Combo requirement not met for ${moveName}.`);
        }
      }
    }

    if (moveData.stanceReq && moveData.stanceReq !== 'Any') {
      const actualStance = prevData.stance || 'Grounded';
      if (currentData.unit === prevData.unit && actualStance !== moveData.stanceReq) {
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
          const expectedSwapIns: string[] = [];
          Object.values(DataLoader.mechanicsDB).filter(m => m.provider === currentData.unit && m.isSwapInDefault).forEach(m => {
            let isValid = true;
            if (m.triggerRule && !m.isPassive) {
              if (!m._compiledRule) m._compiledRule = DSLParser.compile(m.triggerRule);
              if (m._compiledRule) isValid = m._compiledRule.evaluate(ContextManager.buildContext(currentData, currentData.unit, team), currentData.unit);
            }
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
    const resolve = (val: any) => (typeof val === 'string' && (val.includes('@') || /[+\-*/%]/.test(val))) ? this._resolveDynamicMath(val, currentData, unitName, team) : val;
    const isBuff = resolvedEffect.type === 'buff' || !resolvedEffect.type;
    if (!isBuff) resolvedEffect.value = resolve(resolvedEffect.value);
    resolvedEffect.duration = resolve(resolvedEffect.duration) as number;

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
      if (amt > 0 && this._isTuneImmune(currentData)) return;
      const maxCap = this._getMaxCap(currentData.unit, 'tune');
      currentData.enemyTune = Math.min(maxCap, Math.max(0, (currentData.enemyTune || 0) + amt));
      return;
    }
    if (!currentData[resKey]) currentData[resKey] = {};
    targetUnits.forEach(tName => {
      let finalAmt = amt;
      if (resKey === 'energy') {
        const validBuffs = Object.values(currentData.activeBuffs || {}).filter((b: any) =>
          b.target === tName || b.target === '@Team' || (b.target === 'Active' && tName === currentData.unit)
        );
        const stats = CombatCalculator.calculateFinalStats(tName, validBuffs as Effect[], team);
        finalAmt = amt > 0 ? amt * ((stats.energyRegen || 100) / 100) : amt;
      }
      const oldVal = currentData[resKey][tName] || 0;
      const maxCap = this._getMaxCap(tName, resKey);
      currentData[resKey][tName] = Math.min(Math.max(0, oldVal + finalAmt), maxCap);
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
          let removed = false;
          const val = effect.value !== undefined ? effect.value : 'ALL';
          if (val === 'HALF') { buff.stacks = Math.floor((buff.stacks || 1) / 2); removed = true; }
          else if (val === 'ALL') { buff.stacks = 0; removed = true; }
          else { buff.stacks = (buff.stacks || 1) - (parseInt(String(val), 10) || 1); removed = true; }
          if ((buff.stacks || 0) <= 0) {
            if (buff.linkedTracker && currentData.trackers) currentData.trackers[buff.linkedTracker] = 0;
            delete currentData.activeBuffs[buffKey];
          }
          if (removed) {
            const provider = effect.provider || currentData.unit;
            const payloads = EventManager.emit('OnBuffRemove', new Set([(effect.name || '').toLowerCase()]), currentData, provider, team);
            if (payloads.length > 0) this._executeEffectsStream(payloads, currentData, activeTeam, activeRows, this.currentGlobalRealTime, provider, team);
          }
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
      const payloads = EventManager.emit('OnTrackerChanged', new Set([name]), currentData, unitName, team);
      payloads.push(...EventManager.emit('OnTrackerRemove', new Set([name]), currentData, unitName, team));
      this._executeEffectsStream(payloads, currentData, activeTeam, activeRows, this.currentGlobalRealTime, unitName, team);
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
      newVal = 0;
      eventToEmit = 'OnTrackerConsume';
    } else if (action === 'set' || action === 'copy') {
      newVal = parseFloat(String(effect.value)) || 0;
      if (newVal > currentVal) eventToEmit = 'OnTrackerAdd';
      else if (newVal < currentVal) eventToEmit = 'OnTrackerRemove';
    } else if (action === 'detonate' && currentVal > 0) {
      const payloads = EventManager.emit('Detonate', new Set([effect.name || '']), currentData, unitName, team);
      this._executeEffectsStream(payloads, currentData, activeTeam, activeRows, this.currentGlobalRealTime, unitName, team);
      newVal = Math.max(0, currentVal - (effect.value !== undefined ? parseFloat(String(effect.value)) : 1));
    }

    const delta = newVal - currentVal;
    if (delta === 0 && action !== 'detonate') return;

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
      const payloads: Effect[] = [];
      payloads.push(...EventManager.emit('OnTrackerChanged', new Set([effect.name || '']), currentData, unitName, team));
      if (eventToEmit) payloads.push(...EventManager.emit(eventToEmit, new Set([effect.name || '']), currentData, unitName, team));
      this._executeEffectsStream(payloads, currentData, activeTeam, activeRows, this.currentGlobalRealTime, unitName, team);
    }
  }

  _updateActiveBuffs(buffDef: Effect, currentData: any, targetUnits: string[], activeTeam: string[], activeRows: any[], team: any[]): void {
    const buffName = buffDef.name || '';
    if (buffDef.stat || buffDef.label) {
      this._localBuffCache[buffName] = JSON.parse(JSON.stringify(buffDef));
    } else {
      let cachedTemplate: Effect | null | undefined = this._localBuffCache[buffName];
      if (!cachedTemplate) {
        if (this._globalBuffCache[buffName] === undefined) {
          const template = Object.values(DataLoader.mechanicsDB)
            .flatMap(m => m.effects || [])
            .find(e => (e.type === 'buff' || !e.type) && e.name === buffDef.name && (e.stat || e.label));
          this._globalBuffCache[buffName] = template ? JSON.parse(JSON.stringify(template)) : null;
        }
        cachedTemplate = this._globalBuffCache[buffName];
        if (cachedTemplate) this._localBuffCache[buffName] = cachedTemplate;
      }
      if (cachedTemplate) {
        for (const key in cachedTemplate) {
          if ((buffDef as any)[key] === undefined) {
            (buffDef as any)[key] = typeof (cachedTemplate as any)[key] === 'object' && (cachedTemplate as any)[key] !== null
                ? JSON.parse(JSON.stringify((cachedTemplate as any)[key]))
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
        if (typeof buffDef.duration === 'string' && (buffDef.duration.includes('@') || /[+\-*/%]/.test(buffDef.duration))) {
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
        existingBuff.stacks = Math.min(oldStacks + addedStacks, buffDef.maxStacks || 1);
        actuallyAddedStacks = existingBuff.stacks - oldStacks;
        if (buffDef.stackBehavior === 'separate') {
          if (!existingBuff.durations) existingBuff.durations = [];
          for (let i = 0; i < addedStacks; i++) existingBuff.durations.push(effDuration);
          existingBuff.durations = existingBuff.durations.sort((a: number, b: number) => b - a).slice(0, buffDef.maxStacks || 1);
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
        const provider = buffDef.provider || currentData.unit;
        const payloads = EventManager.emit('OnBuffAdd', new Set([(buffDef.name || '').toLowerCase()]), currentData, provider, team);
        if (payloads.length > 0) {
          this._executeEffectsStream(payloads, currentData, activeTeam, activeRows, this.currentGlobalRealTime, provider, team);
        }
      }
    });
  }

  _getMaxCap(charName: string, resKey: string): number {
    if (resKey === 'concerto' || resKey === 'maxConcerto') return CHARACTER_DEFAULTS.maxConcerto;
    if (resKey === 'tune' || resKey === 'maxTune') return ENEMY_DEFAULTS.maxTune;
    const dbChar = DataLoader.characterDB[charName] || {};
    if (resKey === 'energy' || resKey === 'maxEnergy') return parseFloat(String(dbChar.maxEnergy)) || CHARACTER_DEFAULTS.maxEnergy;
    if (resKey.startsWith('forte') || resKey.startsWith('maxForte')) {
      const fNum = resKey.replace('maxForte', '').replace('forte', '');
      return parseFloat(String((dbChar as any)[`maxForte${fNum}`])) || CHARACTER_DEFAULTS.maxConcerto;
    }
    return Infinity;
  }

  // A hold cursor's max is the forte slot it's tied to (forteSlot, defaulting to Forte 1) --
  // maxCursorVal is only a fallback for a slot the active character doesn't actually have.
  _getHoldMaxCap(charName: string, config: HoldConfig): number {
    const slot = config.forteSlot || MECHANICS_NOTATION.HOLD_DEFAULTS.FORTE_SLOT;
    const slotNum = parseInt(slot.replace('forte', ''), 10) || 1;
    const forteCount = parseInt(String(DataLoader.characterDB[charName]?.forteCount), 10) || 1;
    if (slotNum > forteCount) {
      console.warn(`[TimelineEngine] ${charName}'s hold config targets ${slot}, but the character only has ${forteCount} forte slot(s) -- falling back to forte1.`);
      return this._getMaxCap(charName, 'forte1');
    }
    const fromForte = this._getMaxCap(charName, slot);
    if (fromForte > 0) return fromForte;
    return config.maxCursorVal ?? MECHANICS_NOTATION.HOLD_DEFAULTS.MAX_CURSOR_VAL;
  }

}

export const TimelineEngine = new TimelineEngineClass();