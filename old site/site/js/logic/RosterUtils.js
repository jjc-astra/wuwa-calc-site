// =========================================
//   ROSTER CONTROLLER
// =========================================

const RosterUtils = {
    // --- HTML GENERATORS (Static) ---
    generateCharCardHTML: () => UIComponents.generateCharCardHTML(),
    generateEchoesHTML: () => UIComponents.generateEchoesHTML(),
    getCurrentTeamOptionsHTML: () => UIComponents.getCurrentTeamOptionsHTML(),
    updateHeaderPreview: () => {
        const container = document.getElementById('header-team-preview');
        UIComponents.updateHeaderPreview(container);
    },

    // --- EVENT DELEGATION HANDLERS ---
    
    bindRows: () => {
        const rows = document.querySelectorAll('.char-row');
        rows.forEach((row, i) => {
            RosterState.registerRow(i, row);
        });
    },

    handleCharSelect: async (row, charName) => {
        const index = RosterState.domMap.get(row).index;
        RosterState.updateField(index, 'character', charName);
        RosterState.updateField(index, 'weapon', ""); 
        
        // --- NEW: Dynamic Fetch ---
        if (typeof DataLoader !== 'undefined' && charName) {
            await DataLoader.loadMechanic('characters', charName);
        }
        
        // --- NEW: Automatically Apply Recommended Build ---
        await RosterUtils.applyRecommendedBuild(index, charName);
        
        const options = RosterUtils.getCurrentTeamOptionsHTML();
        document.querySelectorAll('.rotation-row .unit-select').forEach(s => {
            const oldVal = s.value; s.innerHTML = options; s.value = oldVal;
        });

        RotationUtils.setCalcWarning('team');
        RosterRenderer.updateSlotVisuals(RosterState.getSlot(index));
    },

    applyRecommendedBuild: async (index, charName) => {
        if (!charName || typeof BUILD_DB === 'undefined' || !BUILD_DB[charName]) return;

        // Grab the first role listed in db_builds (e.g. "Main DPS")
        const roles = Object.keys(BUILD_DB[charName]);
        if (roles.length === 0) return;
        const build = BUILD_DB[charName][roles[0]]; 

        const slot = RosterState.team[index];
        const row = slot.domRef;

        // 1. Update Core Equipment
        if (build.weapon) {
            RosterState.updateField(index, 'weapon', build.weapon);
            if (typeof DataLoader !== 'undefined') await DataLoader.loadMechanic('weapons', build.weapon);
        }
        if (build.echoLayout) RosterState.updateField(index, 'layout', build.echoLayout);
        
        if (build.mainSet) {
            RosterState.updateField(index, 'mainSet', build.mainSet);
            if (typeof DataLoader !== 'undefined') await DataLoader.loadMechanic('sets', build.mainSet);
        }
        
        // --- FIXED: Sub Set Logic ---
        const targetSubSet = build.subSet || build.subset; 
        if (targetSubSet) {
            RosterState.updateField(index, 'subSet', targetSubSet);
            if (typeof DataLoader !== 'undefined') await DataLoader.loadMechanic('sets', targetSubSet);
        } else {
            RosterState.updateField(index, 'subSet', ""); // Clear if not needed
        }

        if (build.mainEcho) {
            RosterState.updateField(index, 'mainEcho', build.mainEcho);
            if (typeof DataLoader !== 'undefined') await DataLoader.loadMechanic('echoes', build.mainEcho);
        }

        // Generate the valid options for the requested layout
        RosterUtils.updateEchoMainStats(row, slot.layout);

        // 2. Update Echo Stats
        const costs = COST_DISTRIBUTION[slot.layout || "4 3 3 1 1"] || [4, 3, 3, 1, 1];
        
        // Deep clone the targets so we can safely decrement them
        let remainingSubs = build.subStats ? { ...build.subStats } : {};
        const subStatKeys = Object.keys(remainingSubs);
        
        slot.echoes.forEach((echo, i) => {
            const cost = costs[i];
            let targetMainStat = "";
            
            // Dynamic Main Stat Array Logic
            const costKey = `cost${cost}`; 
            const statData = build.mainStats[costKey];

            if (statData) {
                if (Array.isArray(statData)) {
                    // Count how many echoes of THIS cost we have already processed
                    const countSoFar = costs.slice(0, i).filter(c => c === cost).length;
                    targetMainStat = statData[countSoFar] || statData[0]; 
                } else {
                    targetMainStat = statData; 
                }
            }

            if (targetMainStat) RosterState.updateEcho(index, i, 'mainStat', targetMainStat);

            // Distributed Substat Logic
            let usedOnThisEcho = new Set();
            
            echo.substats.forEach((sub, subIdx) => {
                let targetSub = "N/A";
                
                // Find the highest priority stat that still needs rolls and isn't on this echo yet
                for (let key of subStatKeys) {
                    if (remainingSubs[key] > 0 && !usedOnThisEcho.has(key)) {
                        targetSub = key;
                        remainingSubs[key]--;
                        usedOnThisEcho.add(key);
                        break;
                    }
                }

                let val = "";
                if (targetSub !== "N/A" && typeof STAT_DB !== 'undefined' && STAT_DB[targetSub]) {
                    const defaultIdx = STAT_DB[targetSub].defaultIndex || 0;
                    val = STAT_DB[targetSub].values[defaultIdx]; 
                }
                RosterState.updateEcho(index, i, 'substat', { name: targetSub, value: val }, subIdx);
            });
        });

        RosterState.calculateEchoStats(index);
        RosterRenderer.updateSlotVisuals(slot);
    },

    handleSetSelect: async (panelCol, setName) => {
        const row = panelCol.closest('.char-row');
        const index = RosterState.domMap.get(row).index;
        
        RosterState.updateField(index, 'mainSet', setName);
        if (!setName) RosterState.updateField(index, 'mainEcho', "");
        
        if (typeof DataLoader !== 'undefined' && setName) {
            await DataLoader.loadMechanic('sets', setName);
        }
        
        // --- FIXED: Force recalculation so the Idle Stats update immediately ---
        RosterState.calculateEchoStats(index); 
        RosterRenderer.updateSlotVisuals(RosterState.getSlot(index));
        if (typeof RotationUtils !== 'undefined') RotationUtils.setCalcWarning('team');
    },

    handleWeaponSelect: async (row, weaponName) => {
        const index = RosterState.domMap.get(row).index;
        RosterState.updateField(index, 'weapon', weaponName);
        
        // --- NEW: Dynamic Fetch ---
        if (typeof DataLoader !== 'undefined' && weaponName) {
            await DataLoader.loadMechanic('weapons', weaponName);
        }
        
        RosterRenderer.updateSlotVisuals(RosterState.getSlot(index));
        RotationUtils.setCalcWarning('team');
    },

    handleSubSetSelect: async (row, setName) => {
        const index = RosterState.domMap.get(row).index;
        RosterState.updateField(index, 'subSet', setName);
        
        // --- NEW: Dynamic Fetch ---
        if (typeof DataLoader !== 'undefined' && setName) {
            await DataLoader.loadMechanic('sets', setName);
        }
        
        RosterRenderer.updateSlotVisuals(RosterState.getSlot(index));
        RotationUtils.setCalcWarning('team');
    },

    handleMainEchoSelect: async (row, echoName) => {
        const index = RosterState.domMap.get(row).index;
        RosterState.updateField(index, 'mainEcho', echoName);
        
        // --- NEW: Dynamic Fetch ---
        if (typeof DataLoader !== 'undefined' && echoName) {
            await DataLoader.loadMechanic('echoes', echoName);
        }
        
        RosterRenderer.updateSlotVisuals(RosterState.getSlot(index));
        RotationUtils.setCalcWarning('team');
    },

    updateEchoMainStats: (charRow, layoutValue) => {
        const index = RosterState.domMap.get(charRow).index;
        RosterState.updateField(index, 'layout', layoutValue);
        
        const echoHeaders = charRow.querySelectorAll('.echo-main-stat-select');
        let costs = COST_DISTRIBUTION[layoutValue] || [4, 3, 3, 1, 1];

        echoHeaders.forEach((select, i) => {
            const cost = costs[i];
            let optionsList = cost === 4 ? MAIN_STATS_4_COST : (cost === 3 ? MAIN_STATS_3_COST : MAIN_STATS_1_COST);
            const currentVal = select.value;
            select.innerHTML = CommonUtils.createOptions(optionsList, null, `Echo ${i + 1} (Cost ${cost})`);
            
            // Re-select if valid, else pick the first available option
            if (optionsList.includes(currentVal)) {
                select.value = currentVal;
            } else if (optionsList.length > 0) {
                select.value = optionsList[0];
            } else {
                select.value = "";
            }
            
            // --- FIXED: Actually save the new Layout's Main Stats into memory! ---
            RosterState.updateEcho(index, i, 'mainStat', select.value);
            CommonUtils.updatePlaceholderStyle(select);
        });

        // --- FIXED: Trigger the math recalculation ---
        RosterState.calculateEchoStats(index);
        RosterRenderer.updateSlotVisuals(RosterState.getSlot(index));
        if (typeof RotationUtils !== 'undefined') RotationUtils.setCalcWarning('team');
    },

    updateStatFromSlider: (statRow, sliderValue) => {
        const sel = statRow.querySelector('.stat-select');
        const numInput = statRow.querySelector('.stat-value');
        const statName = sel.value;

        if (statName === "N/A" || !STAT_DB[statName]) return;
        
        const entry = STAT_DB[statName];
        const val = entry.values[sliderValue];
        numInput.value = val;

        // Save to State
        const cardWrap = statRow.closest('.echo-card-wrap');
        const charRow = statRow.closest('.char-row');
        if (cardWrap && charRow) {
            const slotData = RosterState.domMap.get(charRow);
            
            // --- FIXED: Use dataset.echoIndex, and fallback safely ---
            const echoIdx = cardWrap.dataset.echoIndex !== undefined ? parseInt(cardWrap.dataset.echoIndex) : Array.from(charRow.querySelectorAll('.echo-card-wrap')).indexOf(cardWrap);
            const statIdx = Array.from(cardWrap.querySelectorAll('.stat-row')).indexOf(statRow);
            
            // --- FIXED: Pass the value as an object, then force a UI update! ---
            RosterState.updateEcho(slotData.index, echoIdx, 'substat', { value: val }, statIdx);
            
            RosterState.calculateEchoStats(slotData.index);
            RosterRenderer.updateSlotVisuals(slotData);
            if (typeof RotationUtils !== 'undefined') RotationUtils.setCalcWarning('team');
        }
    },

    // --- NEW: Added missing handler for Main Stat changes ---
    handleEchoMainStatSelect: (echoCard, statName) => {
        const charRow = echoCard.closest('.char-row');
        if (!charRow) return;
        
        const slotIdx = RosterState.domMap.get(charRow).index;
        const echoIdx = echoCard.dataset.echoIndex !== undefined ? parseInt(echoCard.dataset.echoIndex) : Array.from(charRow.querySelectorAll('.echo-card-wrap')).indexOf(echoCard);
        
        RosterState.updateEcho(slotIdx, echoIdx, 'mainStat', statName);
        RosterState.calculateEchoStats(slotIdx);
        
        RosterRenderer.updateSlotVisuals(RosterState.getSlot(slotIdx));
        if (typeof RotationUtils !== 'undefined') RotationUtils.setCalcWarning('team');
    },

    updateStatRow: (statRow, shouldReset = false) => {
        const select = statRow.querySelector('.stat-select');
        const statName = select.value;
        const card = statRow.closest('.echo-card-wrap');
        const charRow = card.closest('.char-row');
        
        // Grab the necessary indices
        const slotIdx = RosterState.domMap.get(charRow).index;
        // Fallback to array indexing if dataset isn't attached in HTML
        const echoIdx = card.dataset.echoIndex !== undefined ? parseInt(card.dataset.echoIndex) : Array.from(charRow.querySelectorAll('.echo-card-wrap')).indexOf(card);
        const statIdx = statRow.dataset.statIndex !== undefined ? parseInt(statRow.dataset.statIndex) : Array.from(card.querySelectorAll('.stat-row')).indexOf(statRow);

        // 1. Update the Stat Name in State
        RosterState.updateEcho(slotIdx, echoIdx, 'substat', { name: statName }, statIdx);

        // 2. Reset the Stat Value to default if requested (e.g., when the dropdown actually changes)
        if (shouldReset) {
            if (STAT_DB[statName]) {
                const entry = STAT_DB[statName];
                const val = entry.values[entry.defaultIndex];
                RosterState.updateEcho(slotIdx, echoIdx, 'substat', { value: val }, statIdx);
            } else {
                // If N/A is selected, clear the value
                RosterState.updateEcho(slotIdx, echoIdx, 'substat', { value: "" }, statIdx);
            }
        }

        // 3. NEW: Recalculate the aggregated Echo stats for the Context Manager
        RosterState.calculateEchoStats(slotIdx);

        // 4. Trigger UI Updates
        RosterRenderer.updateSlotVisuals(RosterState.getSlot(slotIdx));
        RotationUtils.setCalcWarning('team');
    },

    calculateIdleStats: (slotIndex) => {
        const slot = RosterState.team[slotIndex];
        const activeBuffs = []; // We will pack the ALWAYS passives in here

        // --- Simulate "ALWAYS" Passive Buffs ---
        if (typeof MECHANICS_DB !== 'undefined') {
            const applyBuffsFromSource = (sourceName, isSelf) => {
                if (!sourceName) return;
                
                Object.keys(MECHANICS_DB).filter(k => k.startsWith(sourceName)).forEach(mechId => {
                    const mech = MECHANICS_DB[mechId];
                    
                    // --- FIXED: Only treat isPassive as ALWAYS if there is NO trigger rule defined! ---
                    const hasNoRule = !mech.triggerRule || mech.triggerRule.trim() === "";
                    const isAlways = (!hasNoRule && mech.triggerRule.trim().startsWith("ALWAYS")) || (hasNoRule && mech.isPassive);
                    
                    if (isAlways) {
                        (mech.effects || []).forEach(eff => {
                            if (eff.type === 'buff' && eff.stat) {
                                
                                const appliesToSelf = (eff.target === "@Self" || eff.target === "@Equipper") && isSelf;
                                const appliesToTeam = eff.target === "@Team";
                                const appliesToOthers = eff.target === "@TeamOthers" && !isSelf;

                                if (appliesToSelf || appliesToTeam || appliesToOthers) {
                                    activeBuffs.push({
                                        stat: eff.stat,
                                        value: eff.value,
                                        stacks: eff.maxStacks || 1
                                    });
                                }
                            }
                        });
                    }
                });
            };

            // --- Dedicated Weapon Loader for Idle Stats ---
            const applyWeaponBuffs = (sourceName, isSelf, rank) => {
                if (!sourceName) return;
                
                const rIdx = Math.max(0, (rank || 1) - 1);
                
                Object.keys(MECHANICS_DB).filter(k => k.startsWith(sourceName)).forEach(mechId => {
                    const mech = MECHANICS_DB[mechId];
                    
                    // --- FIXED: Only treat isPassive as ALWAYS if there is NO trigger rule defined! ---
                    const hasNoRule = !mech.triggerRule || mech.triggerRule.trim() === "";
                    const isAlways = (!hasNoRule && mech.triggerRule.trim().startsWith("ALWAYS")) || (hasNoRule && mech.isPassive);
                    
                    if (isAlways) {
                        (mech.effects || []).forEach(eff => {
                            if (eff.type === 'buff' && eff.stat) {
                                const appliesToSelf = (eff.target === "@Self" || eff.target === "@Equipper") && isSelf;
                                const appliesToTeam = eff.target === "@Team";
                                const appliesToOthers = eff.target === "@TeamOthers" && !isSelf;

                                if (appliesToSelf || appliesToTeam || appliesToOthers) {
                                    
                                    // Parse the slash format: "12/15/18/21/24%"
                                    let finalVal = eff.value;
                                    if (typeof finalVal === 'string' && finalVal.includes('/')) {
                                        const p = finalVal.split('/');
                                        finalVal = p[Math.min(rIdx, p.length - 1)].trim();
                                        if (eff.value.includes('%') && !finalVal.includes('%')) finalVal += '%';
                                    }
                                    
                                    activeBuffs.push({ stat: eff.stat, value: finalVal, stacks: eff.maxStacks || 1 });
                                }
                            }
                        });
                    }
                });
            };

            // Calculate Teammate Auras First
            RosterState.team.forEach((tSlot, tIndex) => {
                if (tIndex !== slotIndex && tSlot.character) {
                    applyBuffsFromSource(tSlot.character, false); 
                    applyWeaponBuffs(tSlot.weapon, false, tSlot.rank); // FIXED
                    applyBuffsFromSource(tSlot.mainSet, false); applyBuffsFromSource(tSlot.subSet, false);
                    applyBuffsFromSource(tSlot.mainEcho, false); 
                }
            });

            // Calculate Self Passives & System Passives
            if (slot.character) applyBuffsFromSource(slot.character, true);
            if (slot.weapon) applyWeaponBuffs(slot.weapon, true, slot.rank); // FIXED
            if (slot.mainSet) applyBuffsFromSource(slot.mainSet, true);
            if (slot.subSet) applyBuffsFromSource(slot.subSet, true);
            if (slot.mainEcho) applyBuffsFromSource(slot.mainEcho, true); 
            applyBuffsFromSource("System", true);
        }

        if (typeof LocalCacheManager !== 'undefined') {
            LocalCacheManager.saveBuilderSession();
        }

        if (typeof StatCalculator !== 'undefined') {
            return StatCalculator.calculateFinalStats(slot.character, activeBuffs);
        }
        return {}; 
    },

    // --- IMPORT/EXPORT ---
    extractTeamData: () => {
        // We exclude domRef from export to keep JSON clean, 
        // though JSON.stringify would ignore it anyway (if element) or make it {}
        return RosterState.team.map(slot => {
            const { domRef, ...cleanData } = slot;
            return cleanData;
        });
    },

    applyTeamImport: async (data) => {
        if (!Array.isArray(data)) return;
        
        for (let i = 0; i < data.length; i++) {
            if (i >= 3) break;
            const slotData = data[i];
            
            // FIX: Preserve the existing DOM Reference!
            const existingDomRef = RosterState.team[i].domRef;
            
            // Merge new data ON TOP of existing state
            RosterState.team[i] = { 
                ...RosterState.team[i], 
                ...slotData,
                domRef: existingDomRef 
            };

            // --- FIXED: Re-sync the DOM Map to the newly created memory object! ---
            if (existingDomRef) {
                RosterState.domMap.set(existingDomRef, RosterState.team[i]);
            }

            // --- NEW: Batch Fetch on Import ---
            if (typeof DataLoader !== 'undefined') {
                if (slotData.character) await DataLoader.loadMechanic('characters', slotData.character);
                if (slotData.weapon) await DataLoader.loadMechanic('weapons', slotData.weapon);
                if (slotData.mainSet) await DataLoader.loadMechanic('sets', slotData.mainSet);
                if (slotData.subSet) await DataLoader.loadMechanic('sets', slotData.subSet);
                if (slotData.mainEcho) await DataLoader.loadMechanic('echoes', slotData.mainEcho);
            }
        }
        
        RosterRenderer.renderAll();
        
        // --- FIXED: Safely restore rotation selections if the character is still on the imported team! ---
        const options = RosterUtils.getCurrentTeamOptionsHTML();
        document.querySelectorAll('.rotation-row .unit-select').forEach(s => {
            const oldVal = s.value; 
            s.innerHTML = options; 
            s.value = oldVal;
            
            // If their equipped character was completely removed from the new team, flush the memory!
            if (!s.value && typeof RotationState !== 'undefined' && typeof RotationUtils !== 'undefined') {
                const row = s.closest('.rotation-row');
                RotationState.updateField(row, 'unit', "");
                RotationState.updateField(row, 'action', "");
                RotationUtils.updateActionOptions(row, "");
            }
        });
        
        // Force the math engine to recalculate now that the import and UI refresh are completely finished
        if (typeof RotationUtils !== 'undefined') RotationUtils.runSimulation();
    },
    
    // --- HELPER ---
    generateFilename: (prefix = "Team") => {
        const names = RosterState.team
            .filter(s => s.character)
            .map(s => {
                let id = s.character.replace(/\s+/g, '');
                if (s.weapon) {
                    const initials = s.weapon.match(/\b\w/g) || [];
                    id += `-${initials.join('').toUpperCase()}`;
                }
                return id;
            });
        return names.length > 0 ? `${prefix}_${names.join('_')}.json` : `${prefix}_Config.json`;
    },
};