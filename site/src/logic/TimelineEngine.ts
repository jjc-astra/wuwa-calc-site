import { DataLoader } from '../utils/DataLoader';
import { CommonUtils } from '../utils/Common';
import { DSLParser } from './DSLParser';
import { CombatCalculator } from './CombatCalculator';
import { ContextManager } from './ContextManager';
import { EventManager } from './EventManager';
import { calculateEchoStatsForSlot } from '../store/useRosterStore';
import { CHARACTER_DEFAULTS, ENEMY_DEFAULTS, GAME_DEFAULTS, MECHANICS_NOTATION } from '../data/db';
import type { Effect, MechanicNode } from '../types';
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
  // Skips building UI-only bookkeeping (dropdown snapshots, per-hit history entries) that
  // callers like analyzeLoop's throwaway simulations never read -- see recalculateState.
  _lightweightMode = false;
  // Memoizes _getModifiedMoveData per actionId for the current recalculateState call, since
  // the same move gets looked up repeatedly (a row's own cast, the next-row lookahead in
  // _resolveTimings, and every occurrence of that action across repeated loop iterations)
  // and its raw definition can't change mid-simulation. Reset at the top of every call.
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

    // --- LINK ROW POINTERS (Restores @Prev, @Next, and @Self.PrevAction) ---
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

      const dbMove =
        this._getModifiedMoveData(currentData.action) ||
        ({ name: currentData.action } as MechanicNode);

      currentData.moveName = dbMove.name || currentData.action;
      currentData.castTypes = dbMove.castTypes || (currentData.action ? [currentData.action] : []);
      currentData.dmgTypes = dbMove.dmgTypes || [];
      // Surfaced for the rotation Timeline's input-press flags (which key/hold this move
      // corresponds to) -- pure metadata, never read by any damage-calculation logic below.
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
        // swapCooldown is a real cooldown (seconds domain, per the frame-timing split) --
        // convert it once here where it crosses into the frames-domain "expires at" marker.
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

      if (dbMove.inputType === 'Release' && currentData.trackers && currentData.trackers.Hold_Start !== undefined) {
        const holdStart = currentData.trackers.Hold_Start;
        const config = dbMove.holdConfig || {};
        const speed = config.cursorSpeed ?? MECHANICS_NOTATION.HOLD_DEFAULTS.CURSOR_SPEED;
        const maxVal = config.maxCursorVal ?? MECHANICS_NOTATION.HOLD_DEFAULTS.MAX_CURSOR_VAL;
        const mode = config.cursorMode || MECHANICS_NOTATION.HOLD_DEFAULTS.CURSOR_MODE;
        const centerExpr = config.windowCenter ?? MECHANICS_NOTATION.HOLD_DEFAULTS.WINDOW_CENTER;
        const sizeExpr = config.windowSize ?? MECHANICS_NOTATION.HOLD_DEFAULTS.WINDOW_SIZE;
        const center = parseFloat(String(this._resolveDynamicMath(centerExpr, currentData, currentData.unit, team)));
        const size = parseFloat(String(this._resolveDynamicMath(sizeExpr, currentData, currentData.unit, team)));
        const halfWidth = size / 2;

        let currentBaseStart = accumulatedGameTime + finalWaitTime;
        if (currentData.timing === 'Simultaneous' && i > 0) {
          const userDelay = currentData.manualOffset !== undefined ? currentData.manualOffset : 0;
          currentBaseStart = prevData.gameTimeStart + prevData.gameTimePassed + finalWaitTime + userDelay;
        }

        const accumulated = currentData.trackers.Cursor_Accumulated || 0;
        let holdReleaseDelay = 0;
        for (let delay = 0; delay <= GAME_DEFAULTS.holdLookaheadMax; delay += GAME_DEFAULTS.holdLookaheadStep) {
          const checkTime = currentBaseStart + delay;
          const holdDuration = checkTime - holdStart;
          // cursorSpeed is calibrated in cursor-units per real-time SECOND (e.g. a full 0-100
          // sweep once per second), unrelated to the frames-domain duration migration -- convert
          // the elapsed frames to seconds right at this one multiplication, same pattern as the
          // cooldown/buff decay boundary.
          const progress = accumulated + framesToSeconds(toFrames(holdDuration)) * speed;
          let cursor = 0;
          if (mode === 'clamp') cursor = Math.min(progress, maxVal);
          else if (mode === 'loop') cursor = progress % maxVal;
          else {
            const doubleMax = maxVal * 2;
            cursor = progress % doubleMax > maxVal ? doubleMax - (progress % doubleMax) : progress % doubleMax;
          }
          if (Math.abs(cursor - center) <= halfWidth) {
            holdReleaseDelay = delay;
            break;
          }
        }
        if (holdReleaseDelay > 0) {
          finalWaitTime += holdReleaseDelay;
          currentData.waitTime = finalWaitTime;
          if (!currentData.offsetReasons) currentData.offsetReasons = [];
          currentData.offsetReasons.push({ label: 'Forte Window Wait', valueFrames: toFrames(holdReleaseDelay) });
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

      // Frame counts are exact integers, so every threshold below is a plain > 0 / < 0 / === 0
      // comparison -- no epsilon needed (unlike the seconds-domain decay checks elsewhere in
      // this file, which keep their epsilons since that side is still float). Each reason
      // carries a raw valueFrames instead of a pre-formatted string; SubPanel.tsx formats it
      // to seconds at display time.
      const reasons: any[] = [];
      if (wCD > 0) reasons.push({ label: 'Waiting for Skill CD', valueFrames: wCD });
      if (wBusy > 0) reasons.push({ label: 'Off-Field Animation Lock', valueFrames: toFrames(wBusy) });
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
      const isHolding = currentData.trackers && currentData.trackers.Hold_Start !== undefined;
      if (isRelease || isHolding) {
        let config = dbMove.holdConfig;
        if (!config) {
          const releaseKey = Object.keys(DataLoader.mechanicsDB).find(
            k => k.startsWith(currentData.unit + '_') && DataLoader.mechanicsDB[k].inputType === 'Release' && DataLoader.mechanicsDB[k].holdConfig
          );
          if (releaseKey) config = DataLoader.mechanicsDB[releaseKey].holdConfig;
        }
        config = config || {};
        const centerExpr = config.windowCenter ?? MECHANICS_NOTATION.HOLD_DEFAULTS.WINDOW_CENTER;
        const sizeExpr = config.windowSize ?? MECHANICS_NOTATION.HOLD_DEFAULTS.WINDOW_SIZE;
        const center = parseFloat(String(this._resolveDynamicMath(centerExpr, currentData, currentData.unit, team)));
        const size = parseFloat(String(this._resolveDynamicMath(sizeExpr, currentData, currentData.unit, team)));
        const halfWidth = size / 2;

        if (!currentData.trackers) currentData.trackers = {};
        currentData.trackers.Forte_Win_Center = center;
        currentData.trackers.Forte_Win_Size = size;

        if (isHolding) {
          const speed = config.cursorSpeed ?? MECHANICS_NOTATION.HOLD_DEFAULTS.CURSOR_SPEED;
          const maxVal = config.maxCursorVal ?? MECHANICS_NOTATION.HOLD_DEFAULTS.MAX_CURSOR_VAL;
          const mode = config.cursorMode || MECHANICS_NOTATION.HOLD_DEFAULTS.CURSOR_MODE;
          const holdDuration = currentData.gameTimeStart - currentData.trackers.Hold_Start;
          const accumulated = currentData.trackers.Cursor_Accumulated || 0;
          // Same seconds-calibrated cursorSpeed conversion as the lookahead loop above.
          const progress = accumulated + framesToSeconds(toFrames(holdDuration)) * speed;
          let finalCursor = 0;
          if (mode === 'clamp') finalCursor = Math.min(progress, maxVal);
          else if (mode === 'loop') finalCursor = progress % maxVal;
          else {
            const doubleMax = maxVal * 2;
            finalCursor = progress % doubleMax > maxVal ? doubleMax - (progress % doubleMax) : progress % doubleMax;
          }
          currentData.forteCursorPos = finalCursor;
          currentData.forteWinCenter = center;
          currentData.forteWinSize = size;
          currentData.isInForteWindow = Math.abs(finalCursor - center) <= halfWidth;
          currentData.trackers.Cursor_Pos = finalCursor;
        }
      }

      // --- PRE-CAST DROPDOWN SNAPSHOT --- (skipped in lightweight mode: legality-only
      // simulations never render a row's inspector panel, so this is pure waste for them)
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

      if (currentData.warningMsg || currentData.errorMsg) {
        console.warn(`[TimelineEngine] Row #${i + 1} (${currentData.unit} - ${currentData.action}):`, {
          error: currentData.errorMsg,
          warning: currentData.warningMsg,
          prevAction: currentData.unitCombos?.[currentData.unit]?.action,
          prevUnit: prevData?.unit
        });
      }

      this._evaluateMechanics(currentData, activeTeam, activeRows, i, team, dbMove);
      this._resolveComboWindows(currentData, dbMove, prevData, team);
      // Surfaced for the rotation Timeline's spam-click indicator (comparing this row's priority
      // against the previous row's) -- resolved the same DSL-or-number way _resolveComboWindows
      // resolves comboWindow/actionDuration, deferred until here so @Self/@Move context reflects
      // this row's own fully-computed state rather than whatever was set before inheritance ran.
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

    // A hit can still be sitting in the queue here: an action's damage timeframe can
    // land after its own animation was cut short (e.g. cancelling into an Outro via
    // swapTiming), and if no later row's own decay ever advances the clock far enough
    // to reach it, it would otherwise sit unresolved forever and silently deal no
    // damage. Flush whatever's left now — nothing later in the rotation will reach it.
    // (Event context uses the last row since each hit's true origin row already
    // receives the result via nextHit.originRow, regardless of context passed here.)
    if (this.damageQueue.length > 0) {
      const flushContext = activeRows[activeRows.length - 1];
      this._processQueuedHits(flushContext, toFrames(Number.MAX_SAFE_INTEGER), activeTeam, activeRows, team);
    }

    this.isRecalculating = false;
    return activeRows;
  }

  // Checks whether the loop portion of a rotation (rows[loopStartIndex..]) can repeat: builds
  // opener + 2 loop reps and inspects the second rep for issues that only surface once state
  // has carried over from a prior loop (cooldowns not yet up, trigger rules no longer
  // satisfied, resources not regenerated). This is the live, on-every-edit legality check --
  // it only needs to prove the *next* iteration works, not simulate out to a full 2-minute
  // window, so it stays cheap regardless of how short the loop is. Simulating far enough to
  // cover 2 minutes for real DPS stats is future work, reserved for an explicit "Calculate"
  // action rather than this live check.
  // A manual override (a row flagged `loopStartOverride`) always wins. Otherwise, auto-detect:
  // the loop starts right after the main DPS's first Outro in the rotation, since that's what
  // ends the opener. No Outro found, or nothing follows it, means there's no distinct opener --
  // the whole rotation is the loop. Lives here (not in useRotationStore) so both the store and
  // the calc worker -- which can't import a Zustand store -- can call the same logic.
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
    // A row flagged loopEndOverride marks where the repeating loop template stops -- anything
    // after it is Ending Rotation content, fixed one-time material that never repeats, not a
    // continuation of the loop. Without this cutoff, that tail got folded into loopTemplate and
    // duplicated below along with the real loop for the repeat-legality check, which validated
    // combo/resource continuity as if the loop repeated *into* the Ending Rotation and the
    // Ending Rotation looped back into a fresh copy of itself -- surfacing bogus "combo
    // requirement not met" warnings against Ending Rotation moves that only ever play once.
    const loopEndIndex = contentRows.findIndex(r => r.loopEndOverride === true);
    const loopTemplate = loopEndIndex !== -1 && loopEndIndex >= clampedStart
      ? contentRows.slice(clampedStart, loopEndIndex + 1)
      : contentRows.slice(clampedStart);
    if (loopTemplate.length === 0) return { errors: [], warnings: [] };

    // `rows` is this edit's already-recalculated pass, so its timing fields are trustworthy --
    // no need to re-simulate the opener+1-loop from scratch just to read them back.
    const openerEndRow = openerRows.length > 0 ? openerRows[openerRows.length - 1] : null;
    const openerEndTime = openerEndRow ? (openerEndRow.gameTimeStart || 0) + (openerEndRow.gameTimePassed || 0) : 0;
    const loopEndRow = loopTemplate[loopTemplate.length - 1];
    const loopEndTime = (loopEndRow.gameTimeStart || 0) + (loopEndRow.gameTimePassed || 0);
    const loopDuration = loopEndTime - openerEndTime;

    if (loopDuration === 0) {
      return { errors: ['Loop has no duration — cannot repeat.'], warnings: [] };
    }

    // recalculateState's post-loop pass assumes the array's last element is the UI's
    // trailing blank row; feeding it a real action there silently corrupts that row's
    // timing, so every synthetic array built here must end with one.
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

      if (row.errorMsg) {
        errors.push(`${moveName}: ${row.errorMsg}`);
        continue;
      }
      // A cooldown-blocked move fails its trigger rule the same way a genuine combo-order
      // violation does, but it isn't actually illegal -- the loop is fine, it just needs to
      // wait. Check cdWaitTime first so that case is always a wait-time warning, never
      // promoted to the "illegal loop" error below.
      if (row.cdWaitTime > 3) {
        warnings.push(`${moveName} needs ${formatFramesAsSeconds(row.cdWaitTime)} more (on cooldown).`);
      } else if (row.warningMsg && /^Combo requirement not met/.test(row.warningMsg)) {
        errors.push(`${moveName}: ${row.warningMsg}`);
      } else if (row.warningMsg && /out of the required .* (Resonance Energy|Forte \d+|Tune)/.test(row.warningMsg)) {
        warnings.push(`${moveName}: ${row.warningMsg}`);
      }
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

    // Buffs flagged removeOnSwap belong to whoever swaps off-field; drop them the moment
    // that unit leaves so later hits (from a different acting unit) can't still benefit.
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
      // Process through _processEffect to properly handle dynamic math, resources, trackers, and buff targets
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

      // Builds this hit's UI-facing history entry (the damage breakdown shown when a row's
      // DMG cell is inspected). Skipped in lightweight mode: analyzeLoop's throwaway
      // simulations only read errorMsg/warningMsg/cdWaitTime off the result rows, never this.
      if (!this._lightweightMode) {
        const hitName = nextHit.originMoveData.name + (nextHit.totalHits > 1 ? ` (Hit ${nextHit.hitIndex + 1})` : '');
        const { prevRow, nextRow, dropdownState, _pendingHits, ...cleanData } = currentData;
        if (!nextHit.originRow._pendingHits) nextHit.originRow._pendingHits = [];

        // executeAt is a real-time offset; convert it to the equivalent game time. Only the
        // move's own freezeTime pulls real time and game time apart -- NOT the swap/cancel
        // truncated duration, since hits scheduled within the move's true damage window (which
        // is resolved before that truncation is applied) keep resolving in the background after
        // a swap cuts the animation short. Elapsed time still inside the freeze window collapses
        // to the instant the freeze began; anything past it resumes 1:1 with real time.
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
            isNegativeStatus: nextHit.originMoveData.isNegativeStatus,
            actionId: nextHit.originActionId,
            moveName: nextHit.originMoveData.name,
            gameTime: hitGameTime
          },
          context: JSON.parse(JSON.stringify(cleanData))
        });
      }

      const afterHitEffects = EventManager.emit('AfterHit', nextHit.hitModifiers, currentData, nextHit.provider, team, { hitIndex: nextHit.hitIndex + 1, totalHits: nextHit.totalHits });
      this._executeEffectsStream(afterHitEffects, currentData, activeTeam, activeRows, nextHit.executeAt, nextHit.provider, team);
    }
  }

  _processGameTimeDecay(currentData: any, gameTimePassed: Frames, activeTeam: string[], activeRows: any[], team: any[]): void {
    // gameTimePassed arrives in frames (row-scheduling domain); cooldowns and buff/effect
    // lifetimes are a deliberate exception that stays in seconds, so this is the one place
    // elapsed frame-time needs to cross into that domain to decay them.
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
        // Modifier brackets (e.g. OnBuffExpire[Fusion Burst]) are lowercased at DSL-parse time
        // (see DSLParser.ts's _parseTrigger), so the emitted modifier set has to match that case.
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

    // OnTick intervals (e.g. DoT ticks) are authored/parsed as raw seconds literals in the DSL
    // trigger modifier (no frame-suffix syntax there), so this payload stays seconds too.
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
    // Same move-name/pointer addition as the main action's hitModifiers above -- lets an
    // OnHit[...] rule target a specific proc'd mechanic by name (e.g. Sanhua's Forte Detonate
    // Base, itself only ever fired as a proc), not just its dmgTypes/castTypes tags.
    const procModifiers = new Set([
      ...(mData.dmgTypes || []),
      ...(mData.castTypes || []),
      mData.name,
      `@${proc.provider}(${mData.name})`
    ].map((m: any) => String(m).toLowerCase()));
    if (rawProcMults.length > 0) {
      // A passive/proc'd mechanic (e.g. Lumi's laser-beam passives) can carry its own
      // damageTimeframe -- the hit lands some frames after whatever triggered it, not
      // instantly -- offset from executeAt the same way _resolveTimings resolves a normal
      // action's own damageTimeframe. Left unset, both default to executeAt (today's
      // instant-fire behavior), so every other existing proc is unaffected.
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
        currentData.enemyTune = Math.min(maxCap, Math.max(0, (currentData.enemyTune || 0) + parseFloat(String(val))));
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

    // Plain dmgTypes (e.g. "Glacio", "Heavy") plus the move's own name/pointer -- the same two
    // extra entries castModifiers below adds for OnCast -- so an OnHit[...] rule can target one
    // specific move (OnHit[Self, @Sanhua(Forte Detonate Base)]) instead of only being able to
    // filter by damage type, which a mechanic can share with unrelated moves (e.g. Sanhua's
    // Heavy Attack has the same ["Glacio","Heavy"] tags as Forte Detonate Base).
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

    if (moveData.inputType === 'Release' && currentData.trackers) {
      const config = moveData.holdConfig || {};
      const retain = config.retainCursor ?? MECHANICS_NOTATION.HOLD_DEFAULTS.RETAIN_CURSOR;
      if (retain && currentData.trackers.Hold_Start !== undefined) {
        currentData.trackers.Cursor_Accumulated = currentData.trackers.Cursor_Pos || 0;
      } else {
        delete currentData.trackers.Cursor_Accumulated;
        currentData.trackers.Cursor_Pos = 0;
      }
      delete currentData.trackers.Hold_Start;
    }

    // A Simultaneous-timed row (see recalculateState's timing branch) never advances the shared
    // accumulatedTime/accumulatedGameTime clock -- it's anchored inside the window the
    // surrounding rows already own, by design ("executes in parallel", no extra time cost to the
    // rotation). Decaying cooldowns/buffs by its own duration here would double-count that same
    // already-elapsed window (e.g. Forte Hold Press's 6-frame actionDuration was shaving 0.1s off
    // every cooldown wait computed after it), so it decays 0 real/game time instead.
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
    currentData.errorMsg = null;
    currentData.warningMsg = null;
    const moveData = dbMove;
    const moveName = moveData.name || currentData.action;
    const castRes: Record<string, any> = moveData.castResources || (moveData as any).resources || {};
    const costs: Record<string, any> = (moveData as any).cost || {};

    const buildShortfallMsg = (label: string, myVal: number, req: number, isEnergy: boolean) => {
      const base = `${currentData.unit} has ${myVal.toFixed(1)} out of the required ${req} ${label}`;
      if (!isEnergy || myVal <= 0) return `${base}.`;
      // Energy accumulated so far already reflects the unit's current ER% (see
      // _handleResourceEffect), so the base (unbuffed) potential can be backed out and
      // re-scaled to find the ER% that would have closed the gap by now -- a rough
      // "aim for this much ER" target rather than just the flat energy shortfall. There's no
      // equivalent rate to extrapolate for Concerto/Forte/Tune, so they skip this suffix.
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
        if (key === 'concerto') currentData.errorMsg = `Not enough Concerto (Needs ${req}).`;
        else currentData.warningMsg = buildShortfallMsg(label, myVal, req, key === 'energy');
      }
    };

    validateRes('energy', currentData.energy?.[currentData.unit] || 0, 'Resonance Energy');
    validateRes('concerto', currentData.concerto?.[currentData.unit] || 0, 'Concerto');
    validateRes('tune', currentData.enemyTune || 0, 'Tune');
    for (let i = 1; i <= 6; i++) {
      validateRes(`forte${i}`, currentData[`forte${i}`]?.[currentData.unit] || 0, `Forte ${i}`);
    }

    if (moveData.triggerRule && !moveData.isPassive) {
      if (!moveData._compiledRule || typeof moveData._compiledRule.evaluate !== 'function') {
        moveData._compiledRule = DSLParser.compile(moveData.triggerRule);
      }
      if (moveData._compiledRule && typeof moveData._compiledRule.evaluate === 'function') {
        const ctx = ContextManager.buildContext(currentData, currentData.unit, team);
        // validateRes above may already have diagnosed a specific resource shortfall -- that's
        // more useful than this generic text, so only fall back to it when nothing better has
        // been found yet. (If the rule failed purely because of cooldown, the standalone check
        // below replaces this with the concrete wait anyway.)
        if (!moveData._compiledRule.evaluate(ctx, currentData.unit) && !currentData.warningMsg) {
          currentData.warningMsg = `Combo requirement not met for ${moveName}.`;
        }
      }
    }

    if (moveData.stanceReq && moveData.stanceReq !== 'Any') {
      const actualStance = prevData.stance || 'Grounded';
      if (currentData.unit === prevData.unit && actualStance !== moveData.stanceReq) {
        currentData.warningMsg = (currentData.warningMsg ? currentData.warningMsg + ' | ' : '') + `Stance mismatch: Requires ${moveData.stanceReq}, but character is ${actualStance}.`;
      }
    }

    // A move can be delayed by its own cooldown regardless of whether it has a trigger rule at
    // all (most moves don't) -- surface that wait directly rather than only catching it as a
    // side effect of a trigger-rule failure. Resource-shortfall messages from validateRes above
    // are more specific/actionable, so they're left alone; this only replaces nothing or the
    // generic combo-requirement fallback.
    if (currentData.cdWaitTime > 3 && (!currentData.warningMsg || /^Combo requirement not met/.test(currentData.warningMsg))) {
      currentData.warningMsg = `${moveName} needs ${formatFramesAsSeconds(currentData.cdWaitTime)} more (on cooldown).`;
    }

    const prevWasOutro = prevData.castTypes && prevData.castTypes.includes('Outro');
    const currIsOutro = currentData.castTypes && currentData.castTypes.includes('Outro');
    if (prevWasOutro && currentData.unit === prevData.unit) {
      currentData.errorMsg = 'The next move after an outro must be on a different unit.';
    }
    if (prevData.timing === 'Swap' && !currIsOutro && currentData.unit === prevData.unit) {
      currentData.errorMsg = 'The next move after a swap timing must be an Outro or different unit.';
    }
    if (prevData.unit && currentData.unit !== prevData.unit) {
      const isIntro = currentData.castTypes && currentData.castTypes.includes('Intro');
      const myCombo = prevData.unitCombos?.[currentData.unit];
      const isSwapback = myCombo && currentData.gameTimeStart <= myCombo.expiration;
      if (prevWasOutro) {
        if (!isIntro) currentData.errorMsg = 'Must use an Intro skill immediately after an Outro.';
      } else {
        if (isIntro) currentData.errorMsg = 'Intro skills can only be used immediately after an Outro.';
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
            currentData.errorMsg = `Standard swap-in expected. Must use: ${expectedSwapIns.join(' or ')}.`;
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
    // @Enemy is the pointer DSL_SCHEMA/autocomplete actually surfaces (db.ts's DSL_SCHEMA.pointers)
    // for the unit taking damage; @Target predates it and was never wired into the autocomplete
    // suggestions, but is kept resolving the same way in case anything already authored uses it.
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
    const currentVal = currentData.trackers[effect.name || ''] || 0;
    const action = effect.action || 'add';
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

      // Safe DSL duration evaluation
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
}

export const TimelineEngine = new TimelineEngineClass();