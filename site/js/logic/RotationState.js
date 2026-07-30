// =========================================
//   ROTATION STATE (Source of Truth)
// =========================================

const BASE_ROW_TEMPLATE = {
    // --- User Selections ---
    unit: "", action: "", timing: "Auto", offset: 0, dmg: 0,
    
    // --- Move Metadata ---
    moveName: "", castTypes: [], dmgTypes: [], 
    
    // --- Time Tracking (Zeroed out placeholders) ---
    timeStart: 0, gameTimeStart: 0, waitTime: 0,
    baseDuration: 0, duration: 0, gameTimePassed: 0, freezeTime: 0, 
    totalRealTimeCost: 0, totalGameTimeCost: 0,
    damageTimeframe: { start: 0, end: 0 }, allowedHits: Infinity,
    
    // --- Game State & Resources ---
    hp: {}, enemyHp: null, enemyMaxHp: null, energy: {}, concerto: {}, enemyTune: 0, enemyMaxTune: null, stance: "Grounded",
    
    // --- Engine Objects ---
    trackers: {}, activeBuffs: {}, timeScales: {}, 
    unitCombos: {}, cooldowns: {}, damageInstances: [],
    
    // --- UI Feedback ---
    errorMsg: null, warningMsg: null, availableTimings: []
};

const RotationState = {
    startEnergy: true,
    startConcerto: false,
    data: [],
    domMap: new WeakMap(),
    damageQueue: [], // The global timeline calendar for lingering hits
    currentGlobalGameTime: 0, 
    currentGlobalRealTime: 0,// Master clock for the timeline queue

    // --- OPTIMIZED: Unified Base Initialization ---
    insertRow: (domRow, index = -1) => {
        const data = structuredClone(BASE_ROW_TEMPLATE);
        data.domRef = domRow; 
        
        RotationState.domMap.set(domRow, data); 
        
        if (index >= 0 && index <= RotationState.data.length) {
            RotationState.data.splice(index, 0, data);
        } else {
            RotationState.data.push(data);
        }
        
        RotationState._buildLinkedList();
        return data;
    },

    removeRow: (domRow) => {
        const index = RotationState.data.findIndex(d => d.domRef === domRow);
        if (index > -1) {
            RotationState.data.splice(index, 1);
            RotationState.domMap.delete(domRow);
            RotationState._buildLinkedList();
        }
    },

    moveRow: (oldIndex, newIndex) => {
        if (oldIndex < 0 || oldIndex >= RotationState.data.length || newIndex < 0 || newIndex >= RotationState.data.length) return;
        const [movedRow] = RotationState.data.splice(oldIndex, 1);
        RotationState.data.splice(newIndex, 0, movedRow);
        RotationState._buildLinkedList();
    },

    _buildLinkedList: () => {
        const arr = RotationState.data;
        for (let i = 0; i < arr.length; i++) {
            arr[i].prevRow = i > 0 ? arr[i - 1] : null;
            arr[i].nextRow = i < arr.length - 1 ? arr[i + 1] : null;
            arr[i].arrayIndex = i; 
        }
    },

    getData: (domRow) => RotationState.domMap.get(domRow),

    updateField: (domRow, field, value) => {
        const data = RotationState.domMap.get(domRow);
        if (data) { data[field] = value; return true; }
        return false;
    },

    getActiveRows: () => RotationState.data.slice(0, -1),

    getOrderedRows: () => RotationState.data,

    _getModifiedMoveData: function(actionId, currentData) {
        if (!actionId) return {};
        let rawMove = (typeof MECHANICS_DB !== 'undefined') ? MECHANICS_DB[actionId] : null;
        
        // --- FALLBACK: Match Echo base names to their active skill node ---
        if (!rawMove && typeof MECHANICS_DB !== 'undefined') {
            const matchKey = Object.keys(MECHANICS_DB).find(k => 
                k.startsWith(actionId + "_") && !MECHANICS_DB[k].isPassive
            );
            if (matchKey) rawMove = MECHANICS_DB[matchKey];
        }
        
        rawMove = rawMove || {};
        const { _compiledRule, ...safeData } = rawMove;
        const patchedMove = structuredClone(safeData);
        if (_compiledRule) patchedMove._compiledRule = _compiledRule;
        return patchedMove;
    },

    _primeCombatStart: function(firstRowData) {
        if (typeof EventManager === 'undefined' || typeof RosterState === 'undefined') return;
        const teamMembers = RosterState.team ? RosterState.team.map(t => t.character).filter(Boolean) : [firstRowData.unit];
        
        // Emit startup passives once globally across the party
        const passives = [
            ...EventManager.emit('OnStart', new Set(), firstRowData.domRef, firstRowData.unit),
            ...EventManager.emit('ALWAYS', new Set(), firstRowData.domRef, firstRowData.unit)
        ];
        
        passives.forEach(eff => {
            // Respect the provider who owns the passive instead of the loop iteration character!
            const owner = eff.provider || eff.source || firstRowData.unit;
            let targetUnits = [owner];
            
            if (eff.target === '@Team') {
                targetUnits = teamMembers;
            } else if (eff.target && eff.target !== '@Self' && eff.target !== '@Equipper') {
                targetUnits = [eff.target];
            }
            
            if (eff.type === 'buff' || !eff.type) {
                this._updateActiveBuffs(eff, firstRowData, targetUnits);
            } else if (eff.type === 'tracker') {
                targetUnits.forEach(t => {
                    firstRowData.trackers[`${t}_${eff.name}`] = eff.value;
                });
            }
        });
    },

    recalculateState: function() {
        this._buildLinkedList();
        const activeRows = this.getActiveRows();
        if (activeRows.length === 0) return [];
        
        // Set global recalculation flag to isolate real-time context lookups
        this.isRecalculating = true;

        this.damageQueue = [];
        this.currentGlobalGameTime = 0;
        this.currentGlobalRealTime = 0;
        this.lastSwapOutTime = {};
        this._localBuffCache = {};

        if (typeof RosterState !== 'undefined' && RosterState.team) {
            RosterState.team.forEach((slot, index) => {
                if (slot.character && RosterState.calculateEchoStats) RosterState.calculateEchoStats(index);
            });
        }

        const activeTeam = this._setupEventBoard();
        let accumulatedTime = 0;
        let accumulatedGameTime = 0;
        const unitBusyUntil = {};
        let globalSwapCdExpiresAt = 0;

        for (let i = 0; i < activeRows.length; i++) {
            const currentData = activeRows[i];
            
            // Clear out old stale snapshots from previous runs to prevent context contamination
            currentData.dropdownState = null;

            const prevData = i > 0 ? activeRows[i - 1] : this._getDefaultData();
            currentData.damageInstances = [];
            currentData._pendingHits = [];

            const dbMove = (typeof MECHANICS_DB !== 'undefined') ? this._getModifiedMoveData(currentData.action, currentData) || {} : {};
            currentData.moveName = dbMove.name || currentData.action;
            currentData.castTypes = dbMove.castTypes || (currentData.action ? [currentData.action] : []);
            currentData.dmgTypes = dbMove.dmgTypes || [];
            
            this._applyInheritance(currentData, prevData, accumulatedGameTime);

            if (i === 0) {
                const teamMembers = (typeof RosterState !== 'undefined' && RosterState.team) ? RosterState.team.map(t => t.character).filter(Boolean) : [currentData.unit];
                teamMembers.forEach(charName => {
                    if (charName) {
                        if (this.startEnergy) currentData.energy[charName] = this._getMaxCap(charName, "energy");
                        if (this.startConcerto) currentData.concerto[charName] = this._getMaxCap(charName, "concerto");
                    }
                });
                this._primeCombatStart(currentData);
            }

            // 1. Check if a character swap occurred coming into this row
            if (i > 0 && prevData.unit !== currentData.unit) {
                // Swap cooldown (1.0s) begins at the frame the previous character actually left the field
                globalSwapCdExpiresAt = Math.max(globalSwapCdExpiresAt, accumulatedTime + 1.0);
            }

            // 2. Pre-Cast Delays
            const cdKey = `${currentData.unit}_${currentData.moveName}`;
            const actualCdRemaining = currentData.cooldowns[cdKey] || 0;
            const wCD = Math.max(0, actualCdRemaining);

            let wBusy = 0;
            const busyUntil = unitBusyUntil[currentData.unit] || 0;
            const isOutroCast = dbMove.castTypes && dbMove.castTypes.includes("Outro");
            if (busyUntil > accumulatedTime && !isOutroCast) {
                wBusy = busyUntil - accumulatedTime;
            }

            const finalWaitTime = Math.max(wCD, wBusy);
            currentData.waitTime = finalWaitTime;

            this._applyDecay(currentData, prevData, finalWaitTime, i > 0, activeTeam, activeRows);

            // --- FIXED: Automated Hold-Release Window Lookahead Delay System ---
            if (dbMove.inputType === "Release" && currentData.trackers && currentData.trackers.Hold_Start !== undefined) {
                const holdStart = currentData.trackers.Hold_Start;
                
                // --- NEW: Read Generic Hold Config ---
                const config = dbMove.holdConfig || {};
                const speed = config.cursorSpeed ?? (typeof MECHANICS_NOTATION !== 'undefined' && MECHANICS_NOTATION.HOLD_DEFAULTS ? MECHANICS_NOTATION.HOLD_DEFAULTS.CURSOR_SPEED : 100);
                const maxVal = config.maxCursorVal ?? (typeof MECHANICS_NOTATION !== 'undefined' && MECHANICS_NOTATION.HOLD_DEFAULTS ? MECHANICS_NOTATION.HOLD_DEFAULTS.MAX_CURSOR_VAL : 100);
                const mode = config.cursorMode || (typeof MECHANICS_NOTATION !== 'undefined' && MECHANICS_NOTATION.HOLD_DEFAULTS ? MECHANICS_NOTATION.HOLD_DEFAULTS.CURSOR_MODE : "pingpong");
                
                const centerExpr = config.windowCenter ?? (typeof MECHANICS_NOTATION !== 'undefined' && MECHANICS_NOTATION.HOLD_DEFAULTS ? MECHANICS_NOTATION.HOLD_DEFAULTS.WINDOW_CENTER : "65");
                const sizeExpr = config.windowSize ?? (typeof MECHANICS_NOTATION !== 'undefined' && MECHANICS_NOTATION.HOLD_DEFAULTS ? MECHANICS_NOTATION.HOLD_DEFAULTS.WINDOW_SIZE : "10");
                
                const center = parseFloat(this._resolveDynamicMath(centerExpr, currentData, currentData.unit));
                const size = parseFloat(this._resolveDynamicMath(sizeExpr, currentData, currentData.unit));
                const halfWidth = size / 2;
                
                // --- CHANGE FROM REAL TIME TO GAME TIME ---
                let currentBaseStart = accumulatedGameTime + finalWaitTime; // Use game time, not accumulatedTime
                if (currentData.timing === "Simultaneous" && i > 0) {
                    const userDelay = currentData.manualOffset !== undefined ? currentData.manualOffset : 0;
                    currentBaseStart = prevData.gameTimeStart + prevData.gameTimePassed + finalWaitTime + userDelay; // Switch to gameTimeStart
                }
                
                const accumulated = currentData.trackers.Cursor_Accumulated || 0;
                let holdReleaseDelay = 0;
                
                for (let delay = 0; delay <= 5.0; delay += 0.01) {
                    const checkTime = currentBaseStart + delay;
                    const holdDuration = checkTime - holdStart; // holdStart must now record gameTimeStart
                    const progress = accumulated + (holdDuration * speed);
                    
                    let cursor = 0;
                    if (mode === "clamp") {
                        cursor = Math.min(progress, maxVal);
                    } else if (mode === "loop") {
                        cursor = progress % maxVal;
                    } else { // pingpong
                        const doubleMax = maxVal * 2;
                        cursor = (progress % doubleMax > maxVal) ? (doubleMax - (progress % doubleMax)) : (progress % doubleMax);
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
                    currentData.offsetReasons.push({ label: "Forte Window Wait", value: `+${holdReleaseDelay.toFixed(2)}s` });
                }
            }

            const timings = this._resolveTimings(currentData, dbMove);
            let duration = timings.duration;
            let animationCommitment = timings.animationCommitment;

            // Check if this row wants to swap out and is blocked by the 1s Swap Cooldown
            const nextRow = currentData.nextRow;
            const isSwappingOut = (currentData.timing === "Swap") || 
                                  (currentData.timing === "Auto" && currentData._autoTimingChoice === "Swap") ||
                                  (nextRow && nextRow.unit !== currentData.unit && nextRow.unit !== "");

            let swapCdDelay = 0;
            if (isSwappingOut) {
                const desiredSwapOutTime = (accumulatedTime + finalWaitTime) + duration;
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

            if (dbMove.stanceReq === "Midair") currentData.stance = "Midair";
            else if (dbMove.stanceReq === "Grounded") currentData.stance = "Grounded";
            if (dbMove.stanceResult && dbMove.stanceResult !== "Retain") {
                const transitionTime = dbMove.stanceTime !== undefined ? dbMove.stanceTime : 0;
                if (currentData.duration >= transitionTime) currentData.stance = dbMove.stanceResult;
            }

            // Parallel execution track routing rules
            if (currentData.timing === "Simultaneous" && i > 0) {
                if (currentData.manualOffset === undefined || currentData.manualOffset === null) {
                    const X = typeof dbMove.actionDuration === 'number' ? dbMove.actionDuration : (parseFloat(dbMove.actionDuration) || 0);
                    currentData.manualOffset = -X; 
                }
                let baseTimeStart = prevData.timeStart + prevData.duration + finalWaitTime;
                let baseGameTimeStart = prevData.gameTimeStart + prevData.gameTimePassed + finalWaitTime;
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

            // --- TIME LEDGER ASSEMBLY ---
            const baseActDur = (dbMove.actionDuration !== undefined && dbMove.actionDuration !== null) ? parseFloat(dbMove.actionDuration) : 0;
            let reasons = [];

            // 1. Pre-Cast Delays
            if (wCD > 0.005) {
                reasons.push({ label: "Waiting for Skill CD", value: `+${wCD.toFixed(2)}s` });
            }
            if (wBusy > 0.005) {
                reasons.push({ label: "Off-Field Animation Lock", value: `+${wBusy.toFixed(2)}s` });
            }

            // 2. Base Cost
            if (baseActDur > 0) {
                reasons.push({ label: "Base Action Duration", value: `+${baseActDur.toFixed(2)}s` });
            } else {
                reasons.push({ label: "Instant Cast", value: `0.00s` });
            }

            // 3. Execution Savings & Delays
            if (currentData.timing === "Simultaneous" && i > 0) {
                currentData.offset = currentData.manualOffset;
                reasons.push({ 
                    label: "Parallel Execution Start", 
                    value: `${currentData.offset > 0 ? '+' : ''}${currentData.offset.toFixed(2)}s`, 
                    isNegative: currentData.offset < 0 
                });
            } else {
                const unadjustedDur = duration - swapCdDelay;
                const timingDiff = unadjustedDur - baseActDur;
                const netTimingChange = timingDiff + swapCdDelay;
                
                let timingLabel = currentData.timing === "Auto" 
                    ? (currentData._autoTimingChoice ? `Auto (${currentData._autoTimingChoice})` : "Auto")
                    : currentData.timing.replace('_', ' ');

                if (swapCdDelay > 0.005) {
                    if (netTimingChange > 0.005) {
                        reasons.push({ label: "Swap Cooldown Delay", value: `+${netTimingChange.toFixed(2)}s` });
                    } else if (netTimingChange < -0.005) {
                        reasons.push({ label: `${timingLabel} Time Saved`, value: `${netTimingChange.toFixed(2)}s`, isNegative: true });
                    }
                } else {
                    if (timingDiff < -0.005) {
                        reasons.push({ label: `${timingLabel} Time Saved`, value: `${timingDiff.toFixed(2)}s`, isNegative: true });
                    } else if (timingDiff > 0.005) {
                        reasons.push({ label: `${timingLabel} Penalty`, value: `+${timingDiff.toFixed(2)}s` });
                    }
                }

                const rawOffset = finalWaitTime + netTimingChange;
                currentData.offset = Math.abs(rawOffset) < 0.005 ? 0 : parseFloat(rawOffset.toFixed(2));
            }

            currentData.offsetReasons = reasons;

            // --- FIXED: Resolve the Detonation Window metrics from the move definition schema before snapshotting ---
            const isRelease = dbMove.inputType === "Release" || dbMove.holdConfig;
            const isHolding = currentData.trackers && currentData.trackers.Hold_Start !== undefined;
            
            if (isRelease || isHolding) {
                // If we are on an intermediate row during a hold, fetch the config from the character's Release move
                let config = dbMove.holdConfig;
                if (!config && typeof MECHANICS_DB !== 'undefined') {
                     const releaseKey = Object.keys(MECHANICS_DB).find(k => k.startsWith(currentData.unit + "_") && MECHANICS_DB[k].inputType === "Release" && MECHANICS_DB[k].holdConfig);
                     if (releaseKey) config = MECHANICS_DB[releaseKey].holdConfig;
                }
                config = config || {};
                
                const centerExpr = config.windowCenter ?? (typeof MECHANICS_NOTATION !== 'undefined' && MECHANICS_NOTATION.HOLD_DEFAULTS ? MECHANICS_NOTATION.HOLD_DEFAULTS.WINDOW_CENTER : "65");
                const sizeExpr = config.windowSize ?? (typeof MECHANICS_NOTATION !== 'undefined' && MECHANICS_NOTATION.HOLD_DEFAULTS ? MECHANICS_NOTATION.HOLD_DEFAULTS.WINDOW_SIZE : "10");
                
                const center = parseFloat(this._resolveDynamicMath(centerExpr, currentData, currentData.unit));
                const size = parseFloat(this._resolveDynamicMath(sizeExpr, currentData, currentData.unit));
                const halfWidth = size / 2;
                
                // Sync window specifications directly into the row tracking state
                if (!currentData.trackers) currentData.trackers = {};
                currentData.trackers.Forte_Win_Center = center;
                currentData.trackers.Forte_Win_Size = size;
                
                if (isHolding) {
                    const speed = config.cursorSpeed ?? (typeof MECHANICS_NOTATION !== 'undefined' && MECHANICS_NOTATION.HOLD_DEFAULTS ? MECHANICS_NOTATION.HOLD_DEFAULTS.CURSOR_SPEED : 100);
                    const maxVal = config.maxCursorVal ?? (typeof MECHANICS_NOTATION !== 'undefined' && MECHANICS_NOTATION.HOLD_DEFAULTS ? MECHANICS_NOTATION.HOLD_DEFAULTS.MAX_CURSOR_VAL : 100);
                    const mode = config.cursorMode || (typeof MECHANICS_NOTATION !== 'undefined' && MECHANICS_NOTATION.HOLD_DEFAULTS ? MECHANICS_NOTATION.HOLD_DEFAULTS.CURSOR_MODE : "pingpong");
                    
                    const holdDuration = currentData.gameTimeStart - currentData.trackers.Hold_Start;
                    const accumulated = currentData.trackers.Cursor_Accumulated || 0;
                    const progress = accumulated + (holdDuration * speed);
                    
                    let finalCursor = 0;
                    if (mode === "clamp") {
                        finalCursor = Math.min(progress, maxVal);
                    } else if (mode === "loop") {
                        finalCursor = progress % maxVal;
                    } else { // pingpong
                        const doubleMax = maxVal * 2;
                        finalCursor = (progress % doubleMax > maxVal) ? (doubleMax - (progress % doubleMax)) : (progress % doubleMax);
                    }
                                         
                    currentData.forteCursorPos = finalCursor;
                    currentData.forteWinCenter = center;
                    currentData.forteWinSize = size;
                    currentData.isInForteWindow = Math.abs(finalCursor - center) <= halfWidth;
                                         
                    // Explicitly inject these tracking values straight back into the live state trackers map
                    currentData.trackers.Cursor_Pos = finalCursor;
                }
            }

            // Capture the dropdown state right here as a pure Pre-Cast Snapshot
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

            this._runValidation(currentData, prevData);
            this._evaluateMechanics(currentData, activeTeam, activeRows, i);
            this._resolveComboWindows(currentData, dbMove, prevData);
        }

        const emptyRow = this.data[this.data.length - 1];
        if (emptyRow && activeRows.length > 0) {
            const lastActive = activeRows[activeRows.length - 1];
            this._applyInheritance(emptyRow, lastActive, accumulatedGameTime);
            emptyRow.prevRow = lastActive;
            emptyRow.gameTimeStart = accumulatedGameTime;
            emptyRow.timeStart = accumulatedTime;
            emptyRow.dropdownState = emptyRow;
        } else if (emptyRow) {
            emptyRow.dropdownState = emptyRow;
        }

        this.isRecalculating = false;
        return activeRows;
    },

    _resolveComboWindows: function(currentData, dbMove, prevData) {
        const resolveTime = (val) => {
            if (val === undefined) return null;
            return (typeof val === 'string' && (val.includes('@') || /[+\-*/]/.test(val))) ? this._resolveDynamicMath(val, currentData, currentData.unit) : parseFloat(val);
        };
        
        const isUtility = currentData.castTypes.includes("Dodge") || 
                          currentData.castTypes.includes("Echo") || 
                          currentData.castTypes.includes("Utility");

        if (!currentData.action) {
            // Preserve state
        } else if (!isUtility) {
            let defaultComboWindow = typeof GAME_DEFAULTS !== 'undefined' ? GAME_DEFAULTS.comboWindow : 0.5;
            let customWindow = dbMove.comboWindow !== undefined ? resolveTime(dbMove.comboWindow) : null;
            let postMoveWindow = customWindow !== null ? customWindow : defaultComboWindow;
            
            // USE the true animation time so swaps don't truncate the combo expiration
            const animTime = currentData.animationCommitment !== undefined ? currentData.animationCommitment : currentData.duration;

            currentData.unitCombos[currentData.unit] = {
                action: currentData.action,
                expiration: currentData.gameTimeStart + animTime + postMoveWindow
            };
        } else if (prevData && prevData.unitCombos[currentData.unit]) {
            currentData.unitCombos[currentData.unit] = {
                action: prevData.unitCombos[currentData.unit].action,
                expiration: prevData.unitCombos[currentData.unit].expiration + currentData.duration
            };
        }
    },

    _resolveTimings: function(currentData, moveData) {
        const timingType = currentData.timing;
        const unitName = currentData.unit;

        const resolveMath = (val, fallback) => {
            if (val === undefined) return fallback;
            return (typeof val === 'string' && (val.includes('@') || /[+\-*/]/.test(val))) ? this._resolveDynamicMath(val, currentData, currentData.unit) : parseFloat(val);
        };

        const actionDuration = moveData.actionDuration !== undefined ? resolveMath(moveData.actionDuration, 0) : 0;
        const freezeTime = moveData.freezeTime !== undefined ? resolveMath(moveData.freezeTime, 0) : 0;
        const swapTiming = moveData.swapTiming !== undefined ? resolveMath(moveData.swapTiming, GAME_DEFAULTS.swapTime) : undefined;
        const hitCount = Array.isArray(moveData.hitMults) ? moveData.hitMults.length : 0;

        const validCancels = [];
        if (moveData.cancelTimings && moveData.cancelTimings.length > 0) {
            moveData.cancelTimings.forEach((ct, idx) => {
                let isValid = false;
                if (!ct.triggerRule || ct.triggerRule.trim() === '') {
                    isValid = true;
                } else {
                    if (!ct._compiledRule) ct._compiledRule = (typeof DSLParser !== 'undefined') ? DSLParser.compile(ct.triggerRule) : null;
                    if (ct._compiledRule) {
                        const ctx = (typeof ContextManager !== 'undefined') ? ContextManager.buildContext(currentData.domRef, currentData.unit) : null;
                        isValid = ct._compiledRule.evaluate(ctx, currentData.unit);
                    }
                }
                if (isValid) validCancels.push({ index: idx, time: ct.time, hits: ct.hits !== undefined ? ct.hits : Infinity });
            });
        }

        const cancelTimeForAnimation = validCancels.length > 0 
            ? validCancels.reduce((prev, curr) => prev.time < curr.time ? prev : curr).time 
            : actionDuration;

        const tfStart = moveData.damageTimeframe && moveData.damageTimeframe.start !== undefined ? resolveMath(moveData.damageTimeframe.start, 0) : 0;
        const tfEnd = moveData.damageTimeframe && moveData.damageTimeframe.end !== undefined ? resolveMath(moveData.damageTimeframe.end, cancelTimeForAnimation) : cancelTimeForAnimation;

        // Helper to locate exact hit frames on your timeline
        const getHitTimeOffset = (idx) => {
            if (hitCount <= 1 || tfEnd <= tfStart) return tfEnd;
            return tfStart + (tfEnd - tfStart) * (idx / (hitCount - 1));
        };

        // --- NEW: Resource Capacity Lookahead Thread ---
        let capEnergyHitIdx = -1;
        let capConcertoHitIdx = -1;

        if (moveData.hitResources && unitName) {
            // Factor in active Energy Regen multipliers for predictive scaling accuracy
            let erMult = 1.0;
            if (typeof StatCalculator !== 'undefined') {
                const validBuffs = Object.values(currentData.activeBuffs).filter(b => 
                    b.target === unitName || b.target === "@Team" || (b.target === "Active" && unitName === currentData.unit)
                );
                const stats = StatCalculator.calculateFinalStats(unitName, validBuffs);
                erMult = (stats.energyRegen || 100) / 100;
            }

            // A. Energy Lookahead
            if (moveData.hitResources.energy && currentData.energy[unitName] !== undefined) {
                let cur = currentData.energy[unitName];
                const maxCap = this._getMaxCap(unitName, "energy");
                if (moveData.castResources && moveData.castResources.energy) {
                    const castAmt = parseFloat(moveData.castResources.energy) || 0;
                    cur += castAmt > 0 ? castAmt * erMult : castAmt;
                }
                const resArray = moveData.hitResources.energy;
                if (Array.isArray(resArray)) {
                    for (let i = 0; i < hitCount; i++) {
                        if (cur >= maxCap) break;
                        const hitAmt = parseFloat(resArray[i]) || 0;
                        cur += hitAmt > 0 ? hitAmt * erMult : hitAmt;
                        if (cur >= maxCap) { capEnergyHitIdx = i; break; }
                    }
                }
            }

            // B. Concerto Lookahead
            if (moveData.hitResources.concerto && currentData.concerto[unitName] !== undefined) {
                let cur = currentData.concerto[unitName];
                const maxCap = this._getMaxCap(unitName, "concerto");
                if (moveData.castResources && moveData.castResources.concerto) {
                    cur += parseFloat(moveData.castResources.concerto) || 0;
                }
                const resArray = moveData.hitResources.concerto;
                if (Array.isArray(resArray)) {
                    for (let i = 0; i < hitCount; i++) {
                        if (cur >= maxCap) break;
                        cur += parseFloat(resArray[i]) || 0;
                        if (cur >= maxCap) { capConcertoHitIdx = i; break; }
                    }
                }
            }
        }

        const availableTimings = [
            { val: "Auto", label: "Auto", title: "Quickest valid timing for all hits" },
            { val: "Full", label: "Full", title: `Duration: ${actionDuration}s | All Hits` }
        ];

        if (swapTiming !== undefined) availableTimings.push({ val: "Swap", label: "Swap", title: `Duration: ${Math.max(swapTiming, GAME_DEFAULTS.swapTime)}s` });
        
        // --- NEW: Inject Dynamic Capping Dropdown Choices ---
        if (capEnergyHitIdx !== -1) {
            availableTimings.push({ 
                val: `Cap_Energy_${capEnergyHitIdx}`, 
                label: "Cap Energy", 
                title: `Cancel at Hit ${capEnergyHitIdx + 1} (${getHitTimeOffset(capEnergyHitIdx).toFixed(2)}s) the frame Energy reaches max` 
            });
        }
        if (capConcertoHitIdx !== -1) {
            availableTimings.push({ 
                val: `Cap_Concerto_${capConcertoHitIdx}`, 
                label: "Cap Concerto", 
                title: `Cancel at Hit ${capConcertoHitIdx + 1} (${getHitTimeOffset(capConcertoHitIdx).toFixed(2)}s) the frame Concerto reaches max` 
            });
        }

        validCancels.forEach((vc, i) => {
            const label = validCancels.length === 1 ? "Cancel" : `Cancel ${i + 1}`;
            const title = `Duration: ${vc.time}s` + (vc.hits !== Infinity ? ` | Hits: ${vc.hits}` : ` | All Hits`);
            availableTimings.push({ val: `Cancel_${vc.index}`, label: label, title: title });
        });
        
        // --- FIXED: Expose Simultaneous track options for parallel input triggers ---
        if (moveData.inputType === "Hold" || moveData.castTypes?.includes("Echo")) {
            availableTimings.push({ val: "Simultaneous", label: "Simultaneous", title: "Executes in parallel anchored to the previous move's start time." });
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

        // ==================== REPLACE START ====================
        if (timingType === "Auto") {
            const nextRow = currentData.nextRow;
            const nextMoveData = (nextRow && nextRow.action && typeof MECHANICS_DB !== 'undefined') ? MECHANICS_DB[nextRow.action] : null;
            const isNextOutro = nextMoveData && nextMoveData.castTypes && nextMoveData.castTypes.includes("Outro");
            const isNextSwap = nextRow && nextRow.unit !== currentData.unit && nextRow.unit !== "";

            if (isNextOutro && capConcertoHitIdx !== -1) {
                // Concerto isn't full yet: Must stay on field for the exact hit that caps it
                const targetTime = getHitTimeOffset(capConcertoHitIdx);
                duration = targetTime;
                animationCommitment = targetTime;
                finalHits = capConcertoHitIdx + 1;
                currentData._autoTimingChoice = "Concerto";
            } else if ((isNextOutro || isNextSwap) && swapTiming !== undefined) {
                // Concerto is full (or not an outro): Instant Swap
                duration = Math.max(swapTiming, typeof GAME_DEFAULTS !== 'undefined' ? GAME_DEFAULTS.swapTime : 0.15);
                animationCommitment = cancelTimeForAnimation;
                finalHits = hitCount;
                currentData._autoTimingChoice = "Swap";
            } else {
                // Standard optimal cancel execution
                duration = autoCancelTime;
                animationCommitment = autoCancelTime;
                finalHits = autoAllowedHits;
                currentData._autoTimingChoice = "Cancel";
            }
        } else if (timingType === "Full") {
            duration = actionDuration; animationCommitment = actionDuration; finalHits = hitCount;
        } else if (timingType === "Swap" && swapTiming !== undefined) {
            duration = Math.max(swapTiming, GAME_DEFAULTS.swapTime); animationCommitment = cancelTimeForAnimation; finalHits = hitCount;
        } else if (timingType.startsWith("Cap_")) {
            // --- NEW: Extract and execute resource-cap animation truncations ---
            const parts = timingType.split("_");
            const parsedIdx = parseInt(parts[2], 10);
            const targetTime = getHitTimeOffset(parsedIdx);
            duration = targetTime;
            animationCommitment = targetTime;
            finalHits = parsedIdx + 1; // Process hits leading up to and including the capping hit
        } else if (timingType.startsWith("Cancel_")) {
            const ct = validCancels.find(vc => vc.index === parseInt(timingType.split("_")[1]));
            if (ct) { duration = ct.time; animationCommitment = ct.time; finalHits = ct.hits; }
            else { duration = autoCancelTime; animationCommitment = autoCancelTime; finalHits = autoAllowedHits; }
        } else if (timingType === "Cancel") {
            if (validCancels.length > 0) { duration = validCancels[0].time; animationCommitment = validCancels[0].time; finalHits = validCancels[0].hits; }
            else { duration = autoCancelTime; animationCommitment = autoCancelTime; finalHits = autoAllowedHits; }
        }

        return {
            baseDuration: actionDuration, duration: duration, animationCommitment: animationCommitment,
            gameTimePassed: Math.max(0, duration - freezeTime), freezeTime: freezeTime,
            damageTimeframe: { start: tfStart, end: tfEnd }, allowedHits: finalHits
        };
    },

    _applyInheritance: function(currentData, prevData, currentTime) {
        if (!prevData) return;
        currentData.unitCombos = {};
        for (const u in prevData.unitCombos) currentData.unitCombos[u] = { ...prevData.unitCombos[u] };
        
        const defaultBossHp = (typeof RosterState !== 'undefined' && RosterState.enemy && RosterState.enemy.hp > 0) ? RosterState.enemy.hp : 3000000;
        currentData.enemyMaxHp = prevData.enemyMaxHp !== null && prevData.enemyMaxHp !== undefined ? prevData.enemyMaxHp : defaultBossHp;
        currentData.enemyHp = prevData.enemyHp !== null && prevData.enemyHp !== undefined ? prevData.enemyHp : currentData.enemyMaxHp;
        const defaultBossTune = (typeof RosterState !== 'undefined' && RosterState.enemy && RosterState.enemy.maxTune > 0) ? RosterState.enemy.maxTune : 40;
        currentData.enemyMaxTune = prevData.enemyMaxTune !== null && prevData.enemyMaxTune !== undefined ? prevData.enemyMaxTune : defaultBossTune;
        currentData.enemyTune = prevData.enemyTune !== null && prevData.enemyTune !== undefined ? prevData.enemyTune : 0;
        
        currentData.hp = { ...prevData.hp }; 
        currentData.energy = { ...prevData.energy };
        currentData.concerto = { ...prevData.concerto };
        Object.keys(currentData).forEach(key => { if (key.startsWith("forte")) delete currentData[key]; });
        Object.keys(prevData).forEach(key => { if (key.startsWith("forte")) currentData[key] = { ...prevData[key] }; });
        
        // Clone historical values
        currentData.trackers = structuredClone(prevData.trackers);
        
        // --- FIXED: Flush stale resource deltas so they don't inherit infinitely down the line ---
        for (const key in currentData.trackers) {
            if (key.endsWith("_Delta")) {
                delete currentData.trackers[key];
            }
        }

        currentData.cooldowns = structuredClone(prevData.cooldowns);
        currentData.activeBuffs = {};
        for (const key in prevData.activeBuffs) {
            const b = prevData.activeBuffs[key];
            currentData.activeBuffs[key] = { ...b, durations: b.durations ? [...b.durations] : undefined };
        }

        // --- NEW: Instantiate pending @Next buffs directly on the incoming unit ---
        if (prevData.pendingNextBuffs && prevData.pendingNextBuffs.length > 0 && currentData.unit) {
            const activeTeam = (typeof RosterState !== 'undefined' && RosterState.team) ? RosterState.team.map(t => t.character).filter(Boolean) : [];
            const activeRows = this.getActiveRows();
            
            prevData.pendingNextBuffs.forEach(eff => {
                const nextEff = { ...eff, target: currentData.unit };
                this._processEffect(nextEff, currentData, eff.provider || prevData.unit, activeTeam, activeRows, currentData.arrayIndex);
            });
        }

        currentData.timeScales = structuredClone(prevData.timeScales || {});
        
        if (prevData.unit && currentData.unit && currentData.unit !== prevData.unit) {
            const isIntro = currentData.castTypes && currentData.castTypes.includes("Intro");
            const myCombo = prevData.unitCombos[currentData.unit];
            const isDuringCombo = myCombo && currentTime <= myCombo.expiration;
            currentData.stance = (isIntro || isDuringCombo) ? "Grounded" : (prevData.stance || "Grounded");
        } else {
            currentData.stance = prevData.stance || "Grounded";
        }
    },

    _applyDecay: function(currentData, prevData, waitTime, isSubsequentRow, activeTeam, activeRows) {
        if (!isSubsequentRow) return;
        let finalWaitTime = waitTime || 0;
        if (finalWaitTime > 0) {
            currentData.waitTime = finalWaitTime;
            this._decayState(currentData, finalWaitTime, finalWaitTime, activeTeam, activeRows);
        }
    },

    // =========================================
    //   CORE EXECUTION: MECHANICS & DECAY
    // =========================================

    _getMaxCap: function(charName, resKey) {
        if (resKey === "concerto") return 100;
        if (resKey === "maxConcerto") return 100;
        
        if (resKey === "tune" || resKey === "maxTune") {
            return (typeof RosterState !== 'undefined' && RosterState.enemy && RosterState.enemy.maxTune > 0) 
                ? RosterState.enemy.maxTune 
                : 100;
        }
        
        const dbChar = (typeof CHARACTER_DB !== 'undefined') ? CHARACTER_DB[charName] || {} : {};
        if (resKey === "energy" || resKey === "maxEnergy") return dbChar.maxEnergy || 100; 
        if (resKey.startsWith("forte")) return dbChar["maxForte" + resKey.replace("forte", "")] || 100; 
        if (resKey.startsWith("maxForte")) return dbChar["maxForte" + resKey.replace("maxForte", "")] || 100;
        
        return Infinity;
    },

    _applyMoveCosts: function(currentData, moveData) {
        if (!moveData.cost) return;
        const unitName = currentData.unit;
        const cost = moveData.cost;

        if (cost.energy) currentData.energy[unitName] = Math.max(0, (currentData.energy[unitName] || 0) - cost.energy);
        if (cost.concerto) currentData.concerto[unitName] = Math.max(0, (currentData.concerto[unitName] || 0) - cost.concerto);
        if (cost.tune) currentData.enemyTune = Math.max(0, currentData.enemyTune - cost.tune);
        
        for (let i = 1; i <= 6; i++) {
            const fKey = `forte${i}`;
            if (cost[fKey]) {
                if (!currentData[fKey]) currentData[fKey] = {};
                currentData[fKey][unitName] = Math.max(0, (currentData[fKey][unitName] || 0) - cost[fKey]);
            }
        }
    },

    _applyCastResources: function(currentData, moveData, activeTeam) {
        if (!moveData.castResources) return;
        const unitName = currentData.unit;
        const getERMult = (charName) => {
            if (typeof StatCalculator === 'undefined') return 1.0;
            const validBuffs = Object.values(currentData.activeBuffs).filter(b => 
                b.target === charName || b.target === "@Team" || (b.target === "Active" && charName === currentData.unit)
            );
            const stats = StatCalculator.calculateFinalStats(charName, validBuffs);
            return (stats.energyRegen || 100) / 100;
        };

        for (const key in moveData.castResources) {
            const val = moveData.castResources[key];
            if (val === undefined || val === 0) continue;
            const maxCap = this._getMaxCap(unitName, key);

            if (key === "tune") {
                currentData.enemyTune = Math.min(maxCap, Math.max(0, (currentData.enemyTune || 0) + parseFloat(val)));
                continue;
            }

            if (!currentData[key]) currentData[key] = {};

            // --- FIXED: Direct energy costs exclusively to the caster, only propagate generation to team ---
            if (key === "energy") {
                const numVal = parseFloat(val);
                if (numVal < 0) {
                    // Energy consumption/costs only affect the active casting character
                    const oldEnergy = currentData.energy[unitName] || 0;
                    currentData.energy[unitName] = Math.min(Math.max(0, oldEnergy + numVal), this._getMaxCap(unitName, "energy"));
                } else {
                    // Energy generation propagates to all team members and scales with their ER stats
                    activeTeam.forEach(tName => {
                        const erMult = getERMult(tName);
                        const gained = numVal * erMult;
                        const oldEnergy = currentData.energy[tName] || 0;
                        currentData.energy[tName] = Math.min(Math.max(0, oldEnergy + gained), this._getMaxCap(tName, "energy"));
                    });
                }
            } else {
                currentData[key][unitName] = Math.min(Math.max(0, (currentData[key][unitName] || 0) + parseFloat(val)), maxCap);
            }
        }
    },

    _gatherInstantEffects: function(currentData, moveData, prevData, castModifiers) {
        let effects = [...(moveData.effects || [])];
        if (typeof EventManager !== 'undefined') {
            effects.push(...EventManager.emit("OnCast", castModifiers, currentData.domRef, currentData.unit));
            if (prevData && prevData.unit && prevData.unit !== currentData.unit) {
                effects.push(...EventManager.emit("OnSwapOut", new Set(), currentData.domRef, prevData.unit));
                effects.push(...EventManager.emit("OnSwapIn", new Set(), currentData.domRef, currentData.unit));
                effects.push(...EventManager.emit("OnChange", new Set(), currentData.domRef, currentData.unit));
            }
        }
        return effects;
    },

    _evaluateMechanics: function(currentData, activeTeam, activeRows, currentIndex) {
        const unitName = currentData.unit;
        const moveData = (typeof MECHANICS_DB !== 'undefined') ? this._getModifiedMoveData(currentData.action, currentData) || {} : {};
        const prevData = currentIndex > 0 ? activeRows[currentIndex - 1] : this._getDefaultData();
        
        // --- FIXED: Capture resource baseline states prior to row action execution ---
        const startEnergy = currentData.energy[unitName] || 0;
        const startConcerto = currentData.concerto[unitName] || 0;
        const startTune = currentData.enemyTune || 0;
        const startFortes = {};
        for (let i = 1; i <= 6; i++) {
            const fKey = `forte${i}`;
            startFortes[fKey] = (currentData[fKey] && currentData[fKey][unitName]) ? currentData[fKey][unitName] : 0;
        }

        const currentFreezeTime = currentData.freezeTime || 0;
        if (currentFreezeTime > 0 && RotationState.damageQueue.length > 0) {
            RotationState.damageQueue.forEach(queuedHit => {
                if (queuedHit.provider !== unitName) {
                    queuedHit.executeAt += currentFreezeTime;
                }
            });
            RotationState.damageQueue.sort((a, b) => a.executeAt - b.executeAt);
        }
        if (moveData.cooldown) currentData.cooldowns[`${unitName}_${currentData.moveName}`] = parseFloat(moveData.cooldown);
        const hitModifiers = new Set([...(moveData.dmgTypes || [])]);
        const elements = ["Glacio", "Aero", "Electro", "Fusion", "Spectro", "Havoc", "Physical"];
        const moveElements = (moveData.dmgTypes || []).filter(t => elements.includes(t));

        const castModifiers = new Set([
            ...(moveData.castTypes || []), 
            ...moveElements,
            currentData.action,
            moveData.name,
            `@${currentData.unit}(${moveData.name})`
        ].map(m => String(m).toLowerCase()));

        this._applyMoveCosts(currentData, moveData);
        this._applyCastResources(currentData, moveData, activeTeam);
        const instantEffects = this._gatherInstantEffects(currentData, moveData, prevData, castModifiers);
        const rawHitMults = Array.isArray(moveData.hitMults) ? moveData.hitMults : [];
        const tfStart = currentData.timeStart + (currentData.damageTimeframe.start || 0);
        const tfEnd = currentData.timeStart + (currentData.damageTimeframe.end || currentData.baseDuration);
        if (rawHitMults.length > 0) {
            this._scheduleHits(currentData, moveData, unitName, rawHitMults, tfStart, tfEnd, false, hitModifiers);
        }
        this._executeEffectsStream(instantEffects, currentData, activeTeam, activeRows, currentData.timeStart, unitName);
        RotationState.damageQueue.sort((a, b) => a.executeAt - b.executeAt);

        // ==========================================================================
        //   FIXED: Handle Cursor Retention & Cleanup
        // ==========================================================================
        if (moveData.inputType === "Release" && currentData.trackers) {
            const config = moveData.holdConfig || {};
            const retain = config.retainCursor ?? (typeof MECHANICS_NOTATION !== 'undefined' && MECHANICS_NOTATION.HOLD_DEFAULTS ? MECHANICS_NOTATION.HOLD_DEFAULTS.RETAIN_CURSOR : false);
            
            if (retain && currentData.trackers.Hold_Start !== undefined) {
                // Save the final cursor position for the next hold
                currentData.trackers.Cursor_Accumulated = currentData.trackers.Cursor_Pos || 0;
            } else {
                delete currentData.trackers.Cursor_Accumulated;
                currentData.trackers.Cursor_Pos = 0;
            }
            
            // Always delete Hold_Start on release so we don't bleed states
            delete currentData.trackers.Hold_Start;
        }

        this._decayState(
            currentData, 
            Math.max(0, currentData.duration || 0), 
            Math.max(0, currentData.gameTimePassed || 0), 
            activeTeam, 
            activeRows
        );

        // --- FIXED: Compute and log true accumulative row resource deltas ---
        if (!currentData.trackers) currentData.trackers = {};
        currentData.trackers["energy_Delta"] = (currentData.energy[unitName] || 0) - startEnergy;
        currentData.trackers["concerto_Delta"] = (currentData.concerto[unitName] || 0) - startConcerto;
        currentData.trackers["tune_Delta"] = (currentData.enemyTune || 0) - startTune;
        for (let i = 1; i <= 6; i++) {
            const fKey = `forte${i}`;
            const finalForte = (currentData[fKey] && currentData[fKey][unitName]) ? currentData[fKey][unitName] : 0;
            const deltaKey = i === 1 ? "forte_Delta" : `forte${i}_Delta`;
            currentData.trackers[deltaKey] = finalForte - startFortes[fKey];
        }
    },

    _decayState: function(currentData, realTimePassed, gameTimePassed, activeTeam, activeRows) {
        if (realTimePassed < 0) return;

        this._processQueuedHits(currentData, realTimePassed, activeTeam, activeRows);
        this.currentGlobalRealTime += realTimePassed;

        if (gameTimePassed > 0) {
            // --- SIMPLIFIED: No longer passes a 'proccedTicks' array down ---
            this._processGameTimeDecay(currentData, gameTimePassed, activeTeam, activeRows);
            this.currentGlobalGameTime += gameTimePassed;
        }
    },

    _processQueuedHits: function(currentData, realTimePassed, activeTeam, activeRows) {
        const realWindowEnd = this.currentGlobalRealTime + realTimePassed;
        while (RotationState.damageQueue.length > 0) {
            const nextHit = RotationState.damageQueue[0];
            if (nextHit.executeAt > realWindowEnd + 0.001) break; 
            RotationState.damageQueue.shift();
            
            const limit = nextHit.isProc ? (nextHit.originMoveData.allowedHits !== undefined ? nextHit.originMoveData.allowedHits : Infinity) : nextHit.originRow.allowedHits;
            if (nextHit.hitIndex >= limit) continue;
            
            const hitRes = nextHit.originMoveData.hitResources;
            if (hitRes) {
                for (const resKey in hitRes) {
                    const resArray = hitRes[resKey];
                    const amount = (Array.isArray(resArray) && resArray.length > nextHit.hitIndex) ? resArray[nextHit.hitIndex] : 0;
                    if (amount !== 0) {
                        // --- FIXED: Direct energy from move hits to @Team so all party members receive it ---
                        const targetSelector = resKey === "energy" ? "@Team" : "@Self";
                        this._processEffect({ type: "resource", name: resKey, value: amount, target: targetSelector, provider: nextHit.provider }, currentData, nextHit.provider, activeTeam, activeRows, currentData.arrayIndex);
                    }
                }
            }
            if (typeof EventManager !== 'undefined') {
                currentData.activeProcSource = nextHit.originActionId;
                const onHitEffects = EventManager.emit("OnHit", nextHit.hitModifiers, currentData.domRef, nextHit.provider);
                this._executeEffectsStream(onHitEffects, currentData, activeTeam, activeRows, nextHit.executeAt, nextHit.provider);
                delete currentData.activeProcSource;
            }
            const hitName = nextHit.originMoveData.name + (nextHit.totalHits > 1 ? ` (Hit ${nextHit.hitIndex + 1})` : '');

            // Destructure DOM elements and circular references before cloning
            const { domRef, prevRow, nextRow, dropdownState, _pendingHits, ...cleanData } = currentData;
            const contextSnapshot = {
                ...structuredClone(cleanData),
                domRef,
                prevRow,
                nextRow
            };

            // Queue the hit and snapshot context instead of calculating damage immediately
            if (!nextHit.originRow._pendingHits) nextHit.originRow._pendingHits = [];
            nextHit.originRow._pendingHits.push({
                config: {
                    hitMult: nextHit.hitMult, provider: nextHit.provider, dmgTypes: nextHit.originMoveData.dmgTypes,
                    castTypes: nextHit.originMoveData.castTypes, scalar: nextHit.originMoveData.scalar,
                    title: nextHit.isProc ? `[Proc] ${hitName}` : (nextHit.totalHits > 1 ? `Hit ${nextHit.hitIndex + 1}` : "Active Hit"),
                    isOpen: true,
                    isNegativeStatus: nextHit.originMoveData.isNegativeStatus,
                    actionId: nextHit.originActionId,
                    moveName: nextHit.originMoveData.name
                },
                context: contextSnapshot
            });
            
            if (typeof EventManager !== 'undefined') {
                const afterHitEffects = EventManager.emit("AfterHit", nextHit.hitModifiers, currentData.domRef, nextHit.provider, { hitIndex: nextHit.hitIndex + 1, totalHits: nextHit.totalHits });
                this._executeEffectsStream(afterHitEffects, currentData, activeTeam, activeRows, nextHit.executeAt, nextHit.provider);
            }
        }
    },

    _processGameTimeDecay: function(currentData, gameTimePassed, activeTeam, activeRows) {
        
        // --- Percentage-based Time Scale Formula ---
        const getTimeScale = (timerId) => {
            let mult = 1.0;
            for (const key in currentData.timeScales) {
                const ts = currentData.timeScales[key];
                if (!ts.name || ts.name === "ALL" || ts.name === timerId) {
                    const valStr = String(ts.value || "0");
                    let percentVal = parseFloat(valStr);
                    if (valStr.includes('%')) percentVal /= 100;
                    
                    // -50% means 1 / (1 - 0.5) = 2.0 (Twice as fast)
                    // +50% means 1 / (1 + 0.5) = 0.66 (Takes 50% longer)
                    if (percentVal > -1) mult *= (1 / (1 + percentVal));
                }
            }
            return Math.max(0, mult);
        };
        
        let expiringBuffs = [];

        // 1. Tick down the timers
        for (const key in currentData.activeBuffs) {
            const buff = currentData.activeBuffs[key];
            const buffSpeed = getTimeScale(buff.name);
            const actualDecay = gameTimePassed * buffSpeed;
            
            if (!buff.isPaused) {
                if (buff.stackBehavior === "separate" && buff.durations) {
                    buff.durations = buff.durations.map(d => d - actualDecay).filter(d => d > 0.001);
                    buff.stacks = buff.durations.length; 
                } else {
                    buff.duration -= actualDecay;
                    if (buff.duration <= 0.001 && buff.stacks > 0) {
                        expiringBuffs.push(buff);
                    }
                }
            }
        }

        // 2. EMIT EVENTS FIRST! (So damage is calculated BEFORE stacks drop!)
        if (expiringBuffs.length > 0 && typeof EventManager !== 'undefined') {
            expiringBuffs.forEach(buff => {
                const provider = buff.provider || currentData.unit;
                const payloads = EventManager.emit("OnBuffExpire", new Set([buff.name]), currentData.domRef, provider);
                if (payloads.length > 0 && activeTeam && activeRows) {
                    this._executeEffectsStream(payloads, currentData, activeTeam, activeRows, this.currentGlobalRealTime, provider);
                }
            });
        }

        // 3. Apply Expiration Behaviors
        expiringBuffs.forEach(buff => {
            if (buff.expireBehavior === "drop_one") {
                buff.stacks -= 1;
                if (buff.stacks > 0) buff.duration = buff.maxDuration; // Loop timer
            } else if (buff.expireBehavior === "drop_half") {
                buff.stacks = Math.floor(buff.stacks / 2);
                if (buff.stacks > 0) buff.duration = buff.maxDuration; // Loop timer
            } else {
                buff.stacks = 0; // Clear all
            }
        });

        // 4. Cleanup dead buffs
        for (const key in currentData.activeBuffs) {
            const buff = currentData.activeBuffs[key];
            if (buff.stacks <= 0 || (buff.stackBehavior !== "separate" && buff.duration <= 0.001)) {
                if (buff.linkedTracker) currentData.trackers[buff.linkedTracker] = 0;
                delete currentData.activeBuffs[key];
            }
        }

        // Decay the Time Scales themselves
        for (const key in currentData.timeScales) {
            if (currentData.timeScales[key].duration !== undefined) {
                currentData.timeScales[key].duration -= gameTimePassed;
                if (currentData.timeScales[key].duration <= 0.001) delete currentData.timeScales[key];
            }
        }
        
        // Decay Cooldowns using Time Scales
        for (const key in currentData.cooldowns) {
            currentData.cooldowns[key] -= (gameTimePassed * getTimeScale(key));
            if (currentData.cooldowns[key] <= 0.001) delete currentData.cooldowns[key];
        }
        
        // Emit OnTick Event
        if (typeof EventManager !== 'undefined') {
            const tickEffects = EventManager.emit("OnTick", new Set(), currentData.domRef, currentData.unit, { gameTimePassed, getTimeScale });
            this._executeEffectsStream(tickEffects, currentData, activeTeam, activeRows, this.currentGlobalRealTime, currentData.unit);
        }
    },

    // =========================================
    //   TIMELINE & EFFECT HELPERS
    // =========================================

    _scheduleHits: function(currentData, moveData, provider, rawMults, executeStartTime, executeEndTime, isProc, hitModifiers) {
        const snapshotMath = (hm, pUnit) => (typeof hm === 'string' && (hm.includes('@') || /[+\-*/]/.test(hm))) ? this._resolveDynamicMath(hm, currentData, pUnit) : hm;
        const snapshottedMults = rawMults.map(hm => snapshotMath(hm, provider));
        const hitCount = snapshottedMults.length;
        
        for (let i = 0; i < hitCount; i++) {
            let hitTime = executeEndTime; 
            if (hitCount > 1 && executeEndTime > executeStartTime) {
                hitTime = executeStartTime + (executeEndTime - executeStartTime) * (i / (hitCount - 1));
            }

            RotationState.damageQueue.push({
                originRow: currentData, originActionId: isProc ? moveData.name : currentData.action, originMoveData: moveData,
                hitIndex: i, totalHits: hitCount, hitMult: snapshottedMults[i], provider: provider, hitModifiers: hitModifiers,
                executeAt: hitTime, isProc: isProc 
            });
        }
    },

    _queueProccedMechanic: function(currentData, proc, executeAt) {
        const mData = proc.mechanicData;
        const rawProcMults = Array.isArray(mData.hitMults) ? mData.hitMults : [];
        const procModifiers = new Set([...(mData.dmgTypes || []), ...(mData.castTypes || [])].map(m => String(m).toLowerCase()));
        
        if (rawProcMults.length > 0) this._scheduleHits(currentData, mData, proc.provider, rawProcMults, executeAt, executeAt, true, procModifiers);
        RotationState.damageQueue.sort((a, b) => a.executeAt - b.executeAt);
    },

    _executeEffectsStream: function(effectsArray, currentData, activeTeam, activeRows, executeAt, defaultProvider) {
        if (!effectsArray || effectsArray.length === 0) return;
        effectsArray.forEach(eff => { if (eff.type === 'procced_mechanic') this._queueProccedMechanic(currentData, eff, executeAt); });
        effectsArray.forEach(eff => { if (eff.type !== 'procced_mechanic') this._processEffect(eff, currentData, eff.provider || defaultProvider, activeTeam, activeRows, currentData.arrayIndex); });
    },

    _setupEventBoard: function() {
        if (typeof EventManager === 'undefined') return [];
        EventManager.reset(); 
        const activeTeam = (typeof RosterState !== 'undefined' && RosterState.team) ? RosterState.team.map(t => t.character).filter(Boolean) : [];
        
        if (typeof RosterState !== 'undefined' && RosterState.team) {
            RosterState.team.forEach(slot => {
                if (!slot.character || typeof MECHANICS_DB === 'undefined') return;
                
                const registerAll = (itemName) => {
                    if (!itemName) return;
                    if (typeof MECHANICS_INDEX !== 'undefined' && MECHANICS_INDEX[itemName]) {
                        MECHANICS_INDEX[itemName].forEach(k => { if (MECHANICS_DB[k]) EventManager.registerMechanic(MECHANICS_DB[k], slot.character); });
                    } else {
                        const mech = MECHANICS_DB[itemName] || MECHANICS_DB[`System_${itemName}`];
                        if (mech) EventManager.registerMechanic(mech, slot.character);
                    }
                }; 
                
                const registerWeapon = (weaponName, rank) => {
                    if (!weaponName) return;
                    const rIdx = Math.max(0, (rank || 1) - 1);
                    const parseRank = (val) => {
                        if (typeof val === 'string' && val.includes('/')) {
                            const p = val.split('/'); let res = p[Math.min(rIdx, p.length - 1)].trim();
                            if (val.includes('%') && !res.includes('%')) res += '%';
                            return res;
                        }
                        return val;
                    };
                    const applyRank = (mech) => {
                        const m = { ...mech };

                        // Parse effect values
                        if (m.effects) m.effects = m.effects.map(e => ({ ...e, value: parseRank(e.value) }));
                        
                        return m;
                    };

                    if (typeof MECHANICS_INDEX !== 'undefined' && MECHANICS_INDEX[weaponName]) {
                        MECHANICS_INDEX[weaponName].forEach(k => { if (MECHANICS_DB[k]) EventManager.registerMechanic(applyRank(MECHANICS_DB[k]), slot.character); });
                    } else {
                        const singleMech = MECHANICS_DB[weaponName] || MECHANICS_DB[`System_${weaponName}`];
                        if (singleMech) EventManager.registerMechanic(applyRank(singleMech), slot.character);
                    }
                };
                
                registerAll(slot.mainSet); registerAll(slot.subSet); registerWeapon(slot.weapon, slot.rank); registerAll(slot.mainEcho); 
                
                if (typeof MECHANICS_INDEX !== 'undefined' && MECHANICS_INDEX[slot.character]) {
                    MECHANICS_INDEX[slot.character].forEach(key => {
                        const mech = MECHANICS_DB[key];
                        if (mech && (mech.isPassive || key === `${slot.character}_Outro`)) EventManager.registerMechanic(mech, slot.character);
                    });
                }
            });
        }
        return activeTeam;
    },

    _runValidation: function(currentData, prevData) {
        currentData.errorMsg = null; currentData.warningMsg = null;
        const moveData = (typeof MECHANICS_DB !== 'undefined') ? this._getModifiedMoveData(currentData.action, currentData) || {} : {}; 
        const moveName = moveData.name || currentData.action; 

        const castRes = moveData.castResources || moveData.resources || {};
        const costs = moveData.cost || {}; 

        const validateRes = (key, myVal, label) => {
            const req = (costs[key] || 0) + (castRes[key] < 0 ? Math.abs(castRes[key]) : 0);
            if (req > 0 && myVal < req) {
                if (key === "concerto") currentData.errorMsg = `Not enough Concerto (Needs ${req}).`;
                else currentData.warningMsg = `Not enough ${label} (Needs ${req}).`;
            }
        };

        validateRes("energy", currentData.energy[currentData.unit] || 0, "Resonance Energy");
        validateRes("concerto", currentData.concerto[currentData.unit] || 0, "Concerto");
        validateRes("tune", currentData.enemyTune || 0, "Tune");
        for (let i = 1; i <= 6; i++) validateRes(`forte${i}`, (currentData[`forte${i}`] && currentData[`forte${i}`][currentData.unit]) ? currentData[`forte${i}`][currentData.unit] : 0, `Forte ${i}`);

        if (moveData.triggerRule && !moveData.isPassive) {
            if (!moveData._compiledRule) moveData._compiledRule = (typeof DSLParser !== 'undefined') ? DSLParser.compile(moveData.triggerRule) : null;
            if (moveData._compiledRule) {
                const ctx = ContextManager.buildContext(currentData.domRef, currentData.unit);
                if (!moveData._compiledRule.evaluate(ctx, currentData.unit)) currentData.warningMsg = `Combo requirement not met for ${moveName}.`;
            }
        }
        
        if (moveData.stanceReq && moveData.stanceReq !== "Any") {
            const actualStance = prevData.stance || "Grounded";
            if (currentData.unit === prevData.unit && actualStance !== moveData.stanceReq) {
                currentData.warningMsg = (currentData.warningMsg ? currentData.warningMsg + " | " : "") + `Stance mismatch: Requires ${moveData.stanceReq}, but character is ${actualStance}.`;
            }
        }

        const prevWasOutro = prevData.castTypes && prevData.castTypes.includes("Outro");
        const currIsOutro = currentData.castTypes && currentData.castTypes.includes("Outro");

        if (prevWasOutro && currentData.unit === prevData.unit) currentData.errorMsg = "The next move after an outro must be on a different unit.";
        if (prevData.timing === "Swap" && !currIsOutro && currentData.unit === prevData.unit) currentData.errorMsg = "The next move after a swap timing must be an Outro or different unit.";

        if (prevData.unit && currentData.unit !== prevData.unit) {
            const isIntro = currentData.castTypes && currentData.castTypes.includes("Intro");
            const myCombo = prevData.unitCombos[currentData.unit];
            const isSwapback = myCombo && currentData.gameTimeStart <= myCombo.expiration;
            
            if (prevWasOutro) {
                if (!isIntro) currentData.errorMsg = "Must use an Intro skill immediately after an Outro.";
            } else {
                if (isIntro) currentData.errorMsg = "Intro skills can only be used immediately after an Outro.";
                else if (!isSwapback) {
                    let expectedSwapIns = [];
                    if (typeof MECHANICS_DB !== 'undefined' && typeof ContextManager !== 'undefined') {
                        Object.values(MECHANICS_DB).filter(m => m.provider === currentData.unit && m.isSwapInDefault).forEach(m => {
                            let isValid = true;
                            if (m.triggerRule && !m.isPassive) {
                                if (!m._compiledRule) m._compiledRule = (typeof DSLParser !== 'undefined') ? DSLParser.compile(m.triggerRule) : null;
                                if (m._compiledRule) isValid = m._compiledRule.evaluate(ContextManager.buildContext(currentData.domRef, currentData.unit), currentData.unit);
                            }
                            if (isValid) expectedSwapIns.push(m.name);
                        });
                    }
                    if (expectedSwapIns.length > 0 && !moveData.isSwapInDefault) currentData.errorMsg = `Standard swap-in expected. Must use: ${expectedSwapIns.join(' or ')}.`;
                }
            }
        }
    },

    _resolveDynamicMath: function(mathStr, currentData, unitName) {
        if (typeof DSLParser === 'undefined') return 0;
        const ctx = ContextManager.buildContext(currentData.domRef, unitName);
        if (!ctx) return 0;
        
        const isPct = typeof mathStr === 'string' && mathStr.includes('%');
        const result = DSLParser.evaluateMath(mathStr, ctx, unitName);
        return isPct ? parseFloat((result * 100).toFixed(6)) + "%" : result;
    },

    _processEffect: function(effect, currentData, unitName, activeTeam, activeRows, currentIndex) {
        const resolvedEffect = { ...effect };
        const resolve = (val) => (typeof val === 'string' && (val.includes('@') || /[+\-*/%]/.test(val))) ? this._resolveDynamicMath(val, currentData, unitName) : val;
        
        const isBuff = resolvedEffect.type === "buff" || !resolvedEffect.type;
        if (!isBuff) resolvedEffect.value = resolve(resolvedEffect.value);
        
        resolvedEffect.duration = resolve(resolvedEffect.duration);
        const originalProvider = resolvedEffect.provider;
        if (!resolvedEffect.source) resolvedEffect.source = (originalProvider && originalProvider !== "System" && originalProvider !== "@Equipper") ? originalProvider : currentData.moveName;
        if (!originalProvider || originalProvider === "System" || originalProvider === "@Equipper" || originalProvider === resolvedEffect.source) resolvedEffect.provider = unitName;

        // --- NEW: Queue @Next target effects to be created directly on the next unit ---
        if (resolvedEffect.target === "@Next" || resolvedEffect.target === "Next") {
            if (!currentData.pendingNextBuffs) currentData.pendingNextBuffs = [];
            currentData.pendingNextBuffs.push(resolvedEffect);
            return; // Exit early so this buff is NOT added to currentData.activeBuffs
        }

        let targetUnits = this._resolveTargets(resolvedEffect.target, unitName, activeTeam, activeRows, currentIndex);
        
        if (resolvedEffect.type === "tracker") this._handleTracker(resolvedEffect, currentData, currentData.domRef, unitName, activeTeam, activeRows, currentIndex, targetUnits);
        else if (resolvedEffect.type === "cooldown") targetUnits.forEach(t => currentData.cooldowns[`${t}_${resolvedEffect.name}`] = resolvedEffect.value);
        else if (resolvedEffect.type === "buff" || !resolvedEffect.type) this._updateActiveBuffs(resolvedEffect, currentData, targetUnits, activeTeam, activeRows);
        else if (resolvedEffect.type === "resource") this._handleResourceEffect(resolvedEffect, currentData, targetUnits);
        else if (resolvedEffect.type === "buffAction") this._handleBuffActionEffect(resolvedEffect, currentData, targetUnits, activeTeam, activeRows);
        else if (resolvedEffect.type === "time_scale") currentData.timeScales["ts_" + Math.random()] = resolvedEffect;
    },

    _handleResourceEffect: function(resolvedEffect, currentData, targetUnits) {
        const amt = parseFloat(resolvedEffect.value) || 0;
        const resKey = resolvedEffect.name; 
        if (!resKey) return;
        
        if (resKey === "tune") {
            const maxCap = this._getMaxCap(currentData.unit, "tune");
            currentData.enemyTune = Math.min(maxCap, Math.max(0, (currentData.enemyTune || 0) + amt));
            return;
        }
        if (!currentData[resKey]) currentData[resKey] = {};
        
        targetUnits.forEach(tName => {
            let finalAmt = amt;
            // --- FIXED: Dynamically calculate and apply the ER stat bonus uniquely per teammate slot ---
            if (resKey === "energy") {
                const validBuffs = Object.values(currentData.activeBuffs).filter(b => 
                    b.target === tName || b.target === "@Team" || (b.target === "Active" && tName === currentData.unit)
                );
                const stats = (typeof StatCalculator !== 'undefined') ? StatCalculator.calculateFinalStats(tName, validBuffs) : {};
                finalAmt = amt > 0 ? amt * ((stats.energyRegen || 100) / 100) : amt;
            }
            const oldVal = currentData[resKey][tName] || 0;
            // --- FIXED: Query max capacity matching the iterated character's database rules ---
            const maxCap = this._getMaxCap(tName, resKey);
            currentData[resKey][tName] = Math.min(Math.max(0, oldVal + finalAmt), maxCap);
        });
    },

    _handleBuffActionEffect: function(effect, currentData, targetUnits, activeTeam, activeRows) {
        targetUnits.forEach(targetName => {
            const buffKey = `${targetName}_${effect.name}`;
            const buff = currentData.activeBuffs[buffKey];
            if (buff) {
                if (effect.action === "pause") buff.isPaused = true;
                else if (effect.action === "resume") buff.isPaused = false;
                else if (effect.action === "extend" && effect.value !== undefined) {
                    buff.duration += parseFloat(effect.value);
                } 
                // --- UNIFIED: 'remove' now handles ALL, HALF, or a specific number of stacks! ---
                else if (effect.action === "remove" || effect.action === "consume") {
                    let removed = false;
                    const val = effect.value !== undefined ? effect.value : "ALL";
                    
                    if (val === "HALF") { buff.stacks = Math.floor(buff.stacks / 2); removed = true; }
                    else if (val === "ALL") { buff.stacks = 0; removed = true; }
                    else { buff.stacks -= (parseInt(val) || 1); removed = true; }
                    
                    if (buff.stacks <= 0) delete currentData.activeBuffs[buffKey];

                    // Emit OnBuffRemove
                    if (removed && typeof EventManager !== 'undefined') {
                        const provider = effect.provider || currentData.unit;
                        const payloads = EventManager.emit("OnBuffRemove", new Set([effect.name]), currentData.domRef, provider);
                        if (payloads.length > 0 && activeTeam && activeRows) {
                            this._executeEffectsStream(payloads, currentData, activeTeam, activeRows, this.currentGlobalRealTime, provider);
                        }
                    }
                }
            }
        });
    },

    _resolveTargets: function(targetStr, unitName, activeTeam, activeRows, currentIndex) {
        if (targetStr === "@Self") return [unitName];
        if (targetStr === "@Team") return [...activeTeam];
        if (targetStr === "@TeamOthers") return activeTeam.filter(c => c !== unitName);
        if (targetStr === "@Target") return ["Enemy"];
        if (targetStr === "@Active") return ["Active"]; 
        if (targetStr === "@Next") {
            if (activeRows && currentIndex + 1 < activeRows.length) return [activeRows[currentIndex + 1].unit];
            return ["Next"]; 
        }
        return [targetStr || unitName];
    },

    _handleTracker: function(effect, currentData, domRow, unitName, activeTeam, activeRows, currentIndex, targetUnits) {
        const currentVal = currentData.trackers[effect.name] || 0;
        const action = effect.action || "add";
        let newVal = currentVal;
        let eventToEmit = null;

        if (action === "add") {
            const added = effect.value !== undefined ? parseFloat(effect.value) : 1;
            newVal = Math.max(0, Math.min(currentVal + added, effect.max || Infinity)); 
            if (newVal > currentVal) eventToEmit = "OnTrackerAdd";
            else if (newVal < currentVal) eventToEmit = "OnTrackerRemove";
        } else if (action === "remove") {
            const removed = effect.value !== undefined ? parseFloat(effect.value) : 1;
            newVal = Math.max(0, currentVal - removed);
            eventToEmit = "OnTrackerRemove";
        } else if (action === "consume") {
            newVal = 0;
            eventToEmit = "OnTrackerConsume";
        } else if (action === "set" || action === "copy") {
            newVal = parseFloat(effect.value) || 0;
            if (newVal > currentVal) eventToEmit = "OnTrackerAdd";
            else if (newVal < currentVal) eventToEmit = "OnTrackerRemove";
        } else if (action === "detonate" && currentVal > 0) {
            if (typeof EventManager !== 'undefined') {
                const payloads = EventManager.emit("Detonate", new Set([effect.name]), domRow, unitName);
                this._executeEffectsStream(payloads, currentData, activeTeam, activeRows, this.currentGlobalRealTime, unitName);
            }
            newVal = Math.max(0, currentVal - (effect.value !== undefined ? parseFloat(effect.value) : 1));
        }

        const delta = newVal - currentVal;
        if (delta === 0 && action !== "detonate") return; // Ignore if nothing changed

        currentData.trackers[effect.name] = newVal;

        if (typeof EventManager !== 'undefined' && action !== "detonate") {
            const payloads = [];
            payloads.push(...EventManager.emit("OnTrackerChanged", new Set([effect.name]), domRow, unitName));
            if (eventToEmit) payloads.push(...EventManager.emit(eventToEmit, new Set([effect.name]), domRow, unitName));
            
            this._executeEffectsStream(payloads, currentData, activeTeam, activeRows, this.currentGlobalRealTime, unitName);
        }
    },

    _updateActiveBuffs: function(buffDef, currentData, targetUnits, activeTeam, activeRows) {
        if (buffDef.stat || buffDef.label) {
            this._localBuffCache[buffDef.name] = JSON.parse(JSON.stringify(buffDef));
        } else if (typeof MECHANICS_DB !== 'undefined') {
            let cachedTemplate = this._localBuffCache[buffDef.name];
            if (!cachedTemplate) {
                this._globalBuffCache = this._globalBuffCache || {};
                if (this._globalBuffCache[buffDef.name] === undefined) {
                    const template = Object.values(MECHANICS_DB).flatMap(m => m.effects || []).find(e => (e.type === 'buff' || !e.type) && e.name === buffDef.name && (e.stat || e.label));
                    this._globalBuffCache[buffDef.name] = template ? JSON.parse(JSON.stringify(template)) : null;
                }
                cachedTemplate = this._globalBuffCache[buffDef.name];
                if (cachedTemplate) this._localBuffCache[buffDef.name] = cachedTemplate; 
            }
            if (cachedTemplate) {
                for (const key in cachedTemplate) {
                    if (buffDef[key] === undefined) buffDef[key] = typeof cachedTemplate[key] === 'object' && cachedTemplate[key] !== null ? JSON.parse(JSON.stringify(cachedTemplate[key])) : cachedTemplate[key];
                }
            }
        }
        
        targetUnits.forEach(targetName => {
            const key = `${targetName}_${buffDef.name}`;
            
            const providerUnit = buffDef.provider || currentData.unit;
            const providerSlot = (typeof RosterState !== 'undefined' && RosterState.team) 
                ? RosterState.team.find(t => t.character === providerUnit) 
                : null;
            const weaponRank = providerSlot ? providerSlot.rank : 1;
            
            if (buffDef.value && typeof buffDef.value === 'string' && buffDef.value.includes('/')) {
                buffDef.value = parseRankValue(buffDef.value, weaponRank);
            }

            const existingBuff = currentData.activeBuffs[key];
            const addedStacks = buffDef.stacks !== undefined ? parseInt(buffDef.stacks) : 1;
            let actuallyAddedStacks = 0;

            if (existingBuff) {
                if (buffDef.label) existingBuff.label = buffDef.label;
                if (buffDef.stat) existingBuff.stat = buffDef.stat;
                if (buffDef.value !== undefined) existingBuff.value = buffDef.value;
                
                const oldStacks = existingBuff.stacks;
                existingBuff.stacks = Math.min(existingBuff.stacks + addedStacks, buffDef.maxStacks || 1);
                actuallyAddedStacks = existingBuff.stacks - oldStacks;
                
                if (buffDef.stackBehavior === "separate") {
                    for(let i=0; i < addedStacks; i++) existingBuff.durations.push(buffDef.duration);
                    existingBuff.durations = existingBuff.durations.sort((a, b) => b - a).slice(0, buffDef.maxStacks || 1);
                } else {
                    existingBuff.duration = buffDef.duration; 
                }
            } else {
                currentData.activeBuffs[key] = {
                    ...buffDef, 
                    target: targetName, 
                    stacks: addedStacks,
                    maxDuration: buffDef.duration, 
                    duration: buffDef.stackBehavior === "separate" ? undefined : buffDef.duration,
                    durations: buffDef.stackBehavior === "separate" ? [buffDef.duration] : undefined
                };
                actuallyAddedStacks = addedStacks;
            }

            // ONLY LOG WHEN A BUFF IS NEWLY CREATED OR GAINS A STACK
            if (actuallyAddedStacks > 0) {
                const rowIndex = (currentData.arrayIndex !== undefined ? currentData.arrayIndex + 1 : "?");
                console.log(`[BUFF GAINED] Row #${rowIndex} (${currentData.unit}) | "${buffDef.name}" -> [${targetName}] (Stacks: ${currentData.activeBuffs[key].stacks})`);
            }

            if (actuallyAddedStacks > 0 && typeof EventManager !== 'undefined') {
                const provider = buffDef.provider || currentData.unit;
                const payloads = EventManager.emit("OnBuffAdd", new Set([buffDef.name]), currentData.domRef, provider);
                if (payloads.length > 0 && activeTeam && activeRows) {
                    this._executeEffectsStream(payloads, currentData, activeTeam, activeRows, this.currentGlobalRealTime, provider);
                }
            }
        });
    },

    _getDefaultData: function() {
        return structuredClone(BASE_ROW_TEMPLATE);
    },
};