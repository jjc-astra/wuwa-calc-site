const ContextManager = {
    buildContext: (rowId, activeUnitName) => {
        
        if (!rowId) console.warn(`[ContextManager] WARNING: rowId is ${rowId}. Data lookup will fallback to empty object.`);
        if (!activeUnitName) console.warn(`[ContextManager] WARNING: activeUnitName is ${activeUnitName}.`);

        try {
            let stateData = RotationState.getData(rowId) || RotationState._getDefaultData();
            
            // --- FIXED: Intercept the Pre-Action Snapshot so actions don't validate themselves! ---
            if (stateData.dropdownState && !(typeof RotationState !== 'undefined' && RotationState.isRecalculating)) {
                stateData = stateData.dropdownState;
            }
            const teamData = (typeof RosterState !== 'undefined' && RosterState.team) ? RosterState.team.map(t => t.character).filter(Boolean) : [];

            // --- FIXED: Gather permanent ALWAYS buffs for the Idle Stat Sheet ---
            // --- CLEANED: No more ALWAYS extraction workarounds. ---
            const validBuffs = Object.values(stateData.activeBuffs).filter(buff => 
                buff.target === activeUnitName || buff.target === "@Team" || buff.target === "Active"
            );

            // Pass to StatCalculator just so simple conditional rules (IF ATK > 2000) can still resolve
            const finalStats = (typeof StatCalculator !== 'undefined') ? StatCalculator.calculateFinalStats(activeUnitName, validBuffs) : {};

            const comboDict = stateData.prevRow ? (stateData.prevRow.unitCombos || {}) : {};
            
            const myCombo = comboDict[activeUnitName];
            
            let selfPrevAction = null;
            if (myCombo && stateData.gameTimeStart <= myCombo.expiration) {
                selfPrevAction = myCombo.action;
            }

            const onFieldUnit = stateData.onFieldUnit || stateData.unit;
            const isActive = (onFieldUnit === activeUnitName);
            
            // --- FIXED: Inject activeProcSource for precise OnHit proc identification! ---
            const actionId = stateData.activeProcSource || stateData.action;

            let currentSequence = 0; 
            if (typeof RosterState !== 'undefined' && RosterState.team) {
                const rosterUnit = RosterState.team.find(t => t.character === activeUnitName);
                if (rosterUnit) currentSequence = parseInt(rosterUnit.sequence) || 0;
            } else if (typeof BuilderState !== 'undefined') {
                currentSequence = 6; 
            }

            const dbChar = CHARACTER_DB[activeUnitName] || {};
            const fCount = dbChar.forteCount || CHARACTER_DEFAULTS.forteCount;
            
            // Compute current flat calculations based on StatCalculator totals
            const maxHp = finalStats.hp || 10000;
            const hpPct = stateData.hp[activeUnitName] ?? 1.0;

            const selfContext = {
                name: activeUnitName,
                prevAction: selfPrevAction,
                sequence: currentSequence,
                
                // Unified Energy Context
                energy: stateData.energy[activeUnitName] || 0,
                maxEnergy: dbChar.maxEnergy ? parseFloat(dbChar.maxEnergy) : CHARACTER_DEFAULTS.maxEnergy,

                // Unified Concerto Context
                concerto: stateData.concerto[activeUnitName] || 0,
                maxConcerto: CHARACTER_DEFAULTS.maxConcerto,

                // Unified Symmetric HP Context
                hp: hpPct * maxHp,
                maxHp: maxHp,
                hpPct: hpPct,
                
                // Friendly units possess no posture meter
                tune: 0,
                maxTune: 0,
                
                getBuffStacks: (buffName) => {
                    const activeBuff = stateData.activeBuffs[`${activeUnitName}_${buffName}`];
                    const teamBuff = stateData.activeBuffs[`@Team_${buffName}`];
                    const auraBuff = isActive ? stateData.activeBuffs[`Active_${buffName}`] : null;
                    return (activeBuff ? activeBuff.stacks : 0) + (teamBuff ? teamBuff.stacks : 0) + (auraBuff ? auraBuff.stacks : 0);
                },
                getBuffMaxStacks: (buffName) => {
                    const buff = stateData.activeBuffs[`${activeUnitName}_${buffName}`];
                    return buff ? (buff.maxStacks || 1) : 1;
                },
                hasBuff: (buffName) => {
                    const activeBuff = stateData.activeBuffs[`${activeUnitName}_${buffName}`];
                    const teamBuff = stateData.activeBuffs[`@Team_${buffName}`];
                    const auraBuff = isActive ? stateData.activeBuffs[`Active_${buffName}`] : null;
                    const check = (b) => b && (b.duration > 0 || b.stacks > 0);
                    return (check(activeBuff) || check(teamBuff) || check(auraBuff)) ? 1 : 0;
                },
                getTracker: (trackerName) => stateData.trackers[trackerName] || 0,
                getCooldown: (actionName) => stateData.cooldowns[`${activeUnitName}_${actionName}`] || 0,
                getStat: (statKey) => finalStats[statKey] || 0
            };

            for (let i = 1; i <= fCount; i++) {
                const fKey = `forte${i}`;
                selfContext[fKey] = stateData[fKey] ? (stateData[fKey][activeUnitName] || 0) : 0;
                
                const maxFKey = `maxForte${i}`;
                selfContext[maxFKey] = dbChar[maxFKey] !== undefined ? parseFloat(dbChar[maxFKey]) : 100;
            }

            // Resolve Enemy Parameters
            const enemyMaxHp = stateData.enemyMaxHp ?? RosterState.enemy.hp ?? ENEMY_DEFAULTS.hp;
            const enemyHp = stateData.enemyHp ?? enemyMaxHp;

            return {
                self: selfContext,
                active: { name: onFieldUnit },

                move: {
                    id: actionId,
                    name: stateData.moveName || actionId,
                    castTypes: stateData.castTypes,
                    dmgTypes: stateData.dmgTypes,
                    timeStart: stateData.timeStart,
                    gameTimeStart: stateData.gameTimeStart,
                    duration: stateData.duration,
                    gameTimePassed: stateData.gameTimePassed,
                    freezeTime: stateData.freezeTime,
                    damageTimeframe: stateData.damageTimeframe,
                    swapTiming: stateData.swapTiming || 0,
                    baseMult: stateData.baseMult || 0,
                    hitMults: stateData.hitMults || [],
                    isInHoldWindow: stateData.isInForteWindow || false // <--- ADD THIS
                },

                enemy: {
                    hp: enemyHp,
                    maxHp: enemyMaxHp,
                    hpPct: enemyMaxHp > 0 ? (enemyHp / enemyMaxHp) : 1.0,
                    tune: stateData.enemyTune,
                    maxTune: stateData.enemyMaxTune ?? ENEMY_DEFAULTS.maxTune,
                    getBuffStacks: (debuffName) => {
                        const debuff = stateData.activeBuffs[`Enemy_${debuffName}`];
                        return debuff ? debuff.stacks : 0;
                    },
                    getBuffMaxStacks: (buffName) => {
                        const buff = stateData.activeBuffs[`Enemy_${buffName}`];
                        return buff ? (buff.maxStacks || 1) : 1;
                    },
                    hasBuff: (debuffName) => {
                        const debuff = stateData.activeBuffs[`Enemy_${debuffName}`];
                        return (debuff && (debuff.duration > 0 || debuff.stacks > 0)) ? 1 : 0;
                    }
                },
                
                team: teamData,
                teamOthers: teamData.filter(c => c !== activeUnitName),
                default: GAME_DEFAULTS,

                next: (() => {
                    const nextRow = stateData.nextRow;
                    if (nextRow && nextRow.action) {
                        // Look up the next move in the database to grab its properties
                        const nextMove = (typeof MECHANICS_DB !== 'undefined') ? MECHANICS_DB[nextRow.action] || {} : {};
                        return { 
                            name: nextRow.unit, 
                            action: nextRow.action,
                            castTypes: nextMove.castTypes || [],
                            priority: nextMove.priority || 0
                        };
                    }
                    return { name: nextRow ? nextRow.unit : null, action: null, castTypes: [], priority: 0 };
                })(),

                prev: (() => {
                    const prevRow = stateData.prevRow;
                    if (prevRow) return { unit: prevRow.unit, action: prevRow.action, castTypes: prevRow.castTypes || [] };
                    return { unit: null, action: null, castTypes: [] };
                })(),

                checkCooldown: (unitName, actionName) => stateData.cooldowns[`${unitName}_${actionName}`] || 0
            };

        } catch (err) {
            console.error(`[ContextManager] CRITICAL ERROR during buildContext!`, err);
            return undefined; 
        }
    }
};

window.ContextManager = ContextManager;