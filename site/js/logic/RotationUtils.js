// =========================================
//   ROTATION CONTROLLER (Bridge)
// =========================================

const RotationUtils = {
    updateIndices: (container) => {
        container.querySelectorAll('.rotation-row').forEach((row, index) => {
            const span = row.querySelector('.row-index');
            if (span) span.innerText = index + 1;
        });
    },

    updateActionButtons: (container, clipboard) => {
        const count = container.querySelectorAll('.rotation-row.selected:not(:last-child)').length;
        const hasSelection = count > 0;
        
        const setBtn = (id, disabled) => { const b = document.getElementById(id); if(b) b.disabled = disabled; };
        setBtn('rot-del-btn', count === 0);
        setBtn('rot-up-btn', !hasSelection);
        setBtn('rot-down-btn', !hasSelection);

        const copyBtn = document.getElementById('rot-copy-btn');
        if (copyBtn) copyBtn.disabled = !hasSelection;

        const pasteBtn = document.getElementById('rot-paste-btn');
        if (pasteBtn) {
            const canPaste = clipboard && clipboard.length > 0;
            pasteBtn.disabled = !canPaste;
            if (canPaste) pasteBtn.classList.add('btn-highlight'); 
            else pasteBtn.classList.remove('btn-highlight');
        }
    },

    setCalcWarning: (type) => {
        const warnLabel = document.getElementById('rot-calc-warning');
        const warnText = document.getElementById('rot-calc-warning-text');
        if (!warnLabel || !warnText) return;

        if (type === null) {
            warnLabel.style.display = 'none';
            RotationRenderer.setDamageState(false); 
        } else {
            warnLabel.style.display = 'inline-flex';
            warnText.textContent = (type === 'team') ? "TEAM STATS CHANGED" : "ROTATION CHANGED";
            RotationRenderer.setDamageState(true); 
        }
    },

    updateForteVisibility: (row, unitName) => {
        const charData = (typeof CHARACTER_DB !== 'undefined') ? CHARACTER_DB[unitName] || {} : {};
        
        const forteCount = unitName ? (charData.forteCount || 1) : 0; 
        
        // Target the wrapper instead of the old data-trigger attribute
        const forteCell = row.querySelector('.multi-gauge-wrap');
        if (!forteCell) return;
        
        // Hide the newly separated sub-panel-triggers so empty ones can't be clicked!
        forteCell.querySelectorAll('.sub-panel-trigger').forEach((trigger, i) => { 
            trigger.style.display = (i < forteCount) ? '' : 'none'; 
        });
    },

    updateActionOptions: (row, unitName, forcedAction = null) => {
        const moveSelect = row.querySelector('.move-select');
        if (!moveSelect) return;

        let optionsHTML = '';
        const stateData = RotationState.getData(row) || {};
        const currentAction = forcedAction || stateData.action || moveSelect.value;
        
        if (unitName && typeof MECHANICS_DB !== 'undefined' && typeof MECHANICS_INDEX !== 'undefined') {
            optionsHTML += '<option value="" disabled hidden selected>Select Action</option>';

            const unitMoves = MECHANICS_INDEX[unitName] || [];
            const systemMoves = MECHANICS_INDEX['System'] || [];
            
            // --- Identify the Echo Key Early for Categorization ---
            let echoKey = null;
            let echoName = null;
            if (typeof RosterState !== 'undefined') {
                const slot = RosterState.team.find(t => t.character === unitName);
                if (slot && slot.mainEcho) {
                    echoName = slot.mainEcho;
                    const sanitizedEcho = slot.mainEcho.replace(/\s+/g, '_');
                    echoKey = slot.mainEcho; 
                    if (MECHANICS_DB[sanitizedEcho]) echoKey = sanitizedEcho;
                    else if (MECHANICS_DB[`System_${sanitizedEcho}`]) echoKey = `System_${sanitizedEcho}`;
                    else {
                        const found = Object.keys(MECHANICS_DB).find(k => MECHANICS_DB[k].name === slot.mainEcho);
                        if (found) echoKey = found;
                    }
                }
            }

            const availableKeys = [...unitMoves, ...systemMoves];
            
            // Inject the Echo into the evaluation pool!
            if (echoKey && !availableKeys.includes(echoKey)) {
                availableKeys.push(echoKey); 
            }

            const ctx = (typeof ContextManager !== 'undefined') ? ContextManager.buildContext(row, unitName) : null;

            const resolvedGroups = new Map();
            const forcedOptions = new Map();

            for (const key of availableKeys) {
                const moveData = MECHANICS_DB[key];
                if (moveData && !moveData.isPassive) {
                    
                    let isAvailable = true;
                    if (moveData.triggerRule) {
                        if (!moveData._compiledRule) {
                            moveData._compiledRule = (typeof DSLParser !== 'undefined') ? DSLParser.compile(moveData.triggerRule) : null;
                        }
                        if (moveData._compiledRule && ctx) {
                            isAvailable = moveData._compiledRule.evaluate(ctx, unitName);
                        }
                    }
                    
                    // --- GENERIC HOLD SYSTEM: Prevent basic attack actions while holding button ---
                    if (isAvailable && ctx && ctx.self.hasBuff("Forte_Holding") && moveData.input === "Basic" && moveData.inputType !== "Release") {
                        isAvailable = false;
                    }

                    const isCurrent = (key === currentAction);

                    if (isAvailable || isCurrent) {
                        const opt = {
                            key: key,
                            name: moveData.name || key,
                            input: moveData.input || "None",
                            inputType: moveData.inputType || "Press",
                            stance: moveData.stanceReq || "Any", 
                            priority: moveData.priority || 0,
                            category: moveData.category || (key === echoKey ? "Echo Skill" : "Uncategorized"),
                            sourceType: (key === echoKey) ? "Echo" : (unitMoves.includes(key) ? "Character" : "System")
                        };

                        if (isCurrent && !isAvailable) {
                            forcedOptions.set(key, opt);
                        } else if (isAvailable) {
                            const groupKey = opt.input === "None" ? opt.key : `${opt.input}_${opt.inputType}_${opt.stance}`;
                            const existing = resolvedGroups.get(groupKey);
                            
                            if (isCurrent) {
                                forcedOptions.set(key, opt);
                            }

                            if (!existing || opt.priority > existing.priority) {
                                resolvedGroups.set(groupKey, opt);
                            }
                        }
                    }
                }
            }

            // --- OPTIMIZED: Deduplicate and merge directly via Map constructor ---
            const finalMoves = new Map([...resolvedGroups.values(), ...forcedOptions.values()].map(opt => [opt.key, opt]));
            
            // --- NEW: Failsafe for Echo if it lacked a DB entry ---
            if (echoKey && !finalMoves.has(echoKey)) {
                const moveData = MECHANICS_DB[echoKey] || {};
                finalMoves.set(echoKey, {
                    key: echoKey,
                    name: moveData.name || echoName || echoKey,
                    category: "Echo Skill",
                    sourceType: "Echo"
                });
            }

            // --- OPTIMIZED: Group options in a single pass using Nullish Coalescing ---
            const groupedOptions = { Character: {}, Echo: {}, System: {} };
            for (const opt of finalMoves.values()) {
                (groupedOptions[opt.sourceType][opt.category] ??= []).push(opt);
            }

            // Sync category order to the Mechanics Builder sheet!
            const categoryOrder = (typeof BuilderState !== 'undefined' && BuilderState.categories) 
                ? BuilderState.categories 
                : ["Basic Attack", "Resonance Skill", "Resonance Liberation", "Forte Circuit", "Intro", "Outro", "Inherent Skill", "Tune Break", "Resonance Chain"];

            const sortCategories = (a, b) => {
                let idxA = categoryOrder.indexOf(a);
                let idxB = categoryOrder.indexOf(b);
                if (idxA === -1) idxA = 999;
                if (idxB === -1) idxB = 999;
                if (idxA !== idxB) return idxA - idxB;
                return a.localeCompare(b);
            };

            const buildOptGroup = (groupObj, labelPrefix = "") => {
                const categories = Object.keys(groupObj).sort(sortCategories);
                for (const cat of categories) {
                    let label = labelPrefix ? `${cat} (${labelPrefix})` : cat;
                    
                    // --- NEW: Inject Lore Name into the Category Header! ---
                    if (typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[unitName]) {
                        const loreNames = CHARACTER_DB[unitName].skillGroupNames || {};
                        if (loreNames[cat]) {
                            // This transforms "Resonance Liberation" into "Resonance Liberation: Squeakie Express"
                            label = `${cat}: ${loreNames[cat]}`; 
                        }
                    }

                    optionsHTML += `<optgroup label="${label}">`;
                    
                    // Sort options alphabetically inside their category for a clean UI
                    const sortedOpts = groupObj[cat].sort((a, b) => a.name.localeCompare(b.name));
                    for (const opt of sortedOpts) {
                        optionsHTML += `<option value="${opt.key}">${opt.name}</option>`;
                    }
                    
                    optionsHTML += `</optgroup>`;
                }
            };

            // Order: Character -> Echo -> System
            buildOptGroup(groupedOptions.Character);
            buildOptGroup(groupedOptions.Echo);
            buildOptGroup(groupedOptions.System, "System");
        }

        if (optionsHTML === '') optionsHTML = '<option value="" disabled hidden selected>Select Unit First</option>';

        moveSelect.innerHTML = optionsHTML;
        
        if (currentAction && Array.from(moveSelect.options).some(opt => opt.value === currentAction)) {
            moveSelect.value = currentAction;
            RotationState.updateField(row, 'action', currentAction);
        } else {
            moveSelect.value = "";
            RotationState.updateField(row, 'action', "");
        }
    },

    runSimulation: () => {
        RotationUtils.setCalcWarning('rotation');
        const activeRows = RotationState.recalculateState();
        RotationRenderer.renderAll(activeRows);
        
        RotationState.data.forEach(data => {
            const row = data.domRef;
            const moveSelect = row.querySelector('.move-select');
            
            if (moveSelect) {
                // --- FIXED: Always rebuild the dropdown to clear illegal "ghost" options! ---
                RotationUtils.updateActionOptions(row, data.unit, data.action);
            }
        });
            // --- PERSISTENCE: Save state dynamically after recalculation repaints ---
        if (typeof LocalCacheManager !== 'undefined') {
            LocalCacheManager.saveCurrentSession();
        }
    },

    // =========================================
    //   DAMAGE FORMULA HELPERS
    // =========================================

    calculateDamage: () => {
        RotationUtils.setCalcWarning(null); 
        const activeRows = RotationState.getActiveRows();
        activeRows.forEach(data => {
            
            let rowTotal = 0;
            if (data.damageInstances) {
                data.damageInstances.forEach(inst => {
                    rowTotal += inst.total || 0; // Directly add the number!
                });
            }
            
            data.dmg = Math.floor(rowTotal);
            RotationRenderer.updateDamageValue(data.domRef, data.dmg);
        });
    },

    calcDefense: function(unitLvl, enemyLvl, ignoreDef, reduceDef) {
        return (800 + 8 * unitLvl) / ((792 + 8 * enemyLvl) * (1 - ignoreDef) * (1 - reduceDef) + 800 + 8 * unitLvl);
    },

    calcResistance: function(baseRes, ignoreRes, reduceRes) {
        let effectiveRes = baseRes - ignoreRes - reduceRes;
        return effectiveRes > 0 ? 1 - effectiveRes : 1 - (effectiveRes / 2);
    },

    calcStandardDmg: function(baseDmg, critMult, dmgBonusTotal, dmgAmp, dmgTaken, multiMult, resMult, defMult) {
        return baseDmg * critMult * dmgBonusTotal * (1 + dmgAmp) * (1 + dmgTaken) * (1 + multiMult) * resMult * defMult;
    },

    // --- GENERIC NEGATIVE STATUS LOOKUP ---
    NEGATIVE_STATUS_MULTS: {
        Fusion:  [0, 8400, 15229, 22058, 28888, 35717, 42546, 49375, 56204, 63034, 69863, 93150, 116438, 139726],
        Electro: [0, 5000, 9065, 13130, 17195, 21260, 25325, 29390, 33455, 37520, 41585, 55447, 69308, 83170],
        Aero:    [0, 4500, 11250, 22500, 33750, 45000, 56250, 67500, 78750, 90000, 101250, 112500, 123750, 135000],
        Spectro: [0, 3000, 5439, 7878, 10317, 12756, 15195, 17634, 20073, 22512, 24951, 33268, 41585, 49902],
        Glacio:  [0, 1225, 2221, 3217, 4213, 5209, 6205, 7201, 8196, 9192, 10188, 13584, 16981, 20377],
        Havoc:   [0, -200, -400, -600, -800, -1000, -1200]
    },

    getNegativeStatusMult: function(type, stacks) {
        const table = RotationUtils.NEGATIVE_STATUS_MULTS[type];
        if (!table || stacks <= 0) return 0;
        if (stacks < table.length) return table[stacks];
        // Extrapolate indefinitely if max stacks are modded above the table limit
        const last = table[table.length - 1];
        const diff = last - table[table.length - 2];
        return last + (diff * (stacks - table.length + 1));
    },

    calcNegativeStatusDmg: function(baseDmg, dmgAmp, dmgTaken, multiMult, resMult, defMult) {
        return baseDmg * (1 + dmgAmp) * (1 + dmgTaken) * (1 + multiMult) * resMult * defMult;
    },

    calcTuneDmg: function(baseDmg, dmgAmp, dmgTaken, multiMult) {
        return baseDmg * (1 + dmgAmp) * (1 + dmgTaken) * (1 + multiMult);
    },

    createRow: (optionsHTML, targetIndex = -1) => {
        const row = document.createElement('div');
        row.className = 'rotation-row';
        row.draggable = true;

        // --- DELETED TO PREVENT DOUBLE INITIALIZATION BUG ---
        // RotationState.insertRow(row, targetIndex);

        const gridLayer = document.createElement('div');
        gridLayer.className = 'row-grid-layer';
        gridLayer.innerHTML = RotationRenderer.generateRowGridHTML(optionsHTML);

        const statusStrip = document.createElement('div');
        statusStrip.className = 'status-msg-strip';
        const subPanel = document.createElement('div');
        subPanel.className = 'sub-panel';

        row.appendChild(gridLayer);
        row.appendChild(statusStrip);
        row.appendChild(subPanel);

        RotationUtils._bindRowEvents(row, gridLayer);
        RotationUtils.updateForteVisibility(row, "");
        
        return row;
    },

    _bindRowEvents: (row, gridLayer) => {
        const bindSelect = (sel, field) => {
            const el = row.querySelector(sel);
            el.addEventListener('change', (e) => { 
                RotationState.updateField(row, field, e.target.value);
                
                if (field === 'unit') {
                    RotationUtils.updateForteVisibility(row, e.target.value); 
                }
                
                if (typeof history !== 'undefined' && history.isExecuting) return;
                
                RotationUtils.runSimulation();
            });
        };

        bindSelect('.unit-select', 'unit');
        bindSelect('.move-select', 'action');
        bindSelect('.timing-select', 'timing');

        gridLayer.querySelectorAll('.base-select').forEach(CommonUtils.updatePlaceholderStyle);
        gridLayer.querySelectorAll('.gauge-dial, .gauge-vertical').forEach(gauge => {
            TooltipManager.attach(gauge, () => gauge.classList.contains('gauge-disabled') ? null : `<span class="tooltip-key">${gauge.dataset.name}:</span> <span class="tooltip-val">${gauge.dataset.value}</span>`);
        });

        const idxCell = gridLayer.querySelector('.index-cell');
        TooltipManager.attach(idxCell, () => {
            const msg = idxCell.dataset.tooltipMsg;
            return msg ? `<span class="${idxCell.classList.contains('is-error') ? 'text-red' : 'text-gold'} text-bold">${msg}</span>` : null;
        });
    },

    extractData: (domRows) => {
        // --- OPTIMIZED: O(1) Reads from array ---
        const targetRows = domRows ? domRows.map(r => RotationState.getData(r)) : RotationState.getActiveRows();
        return targetRows.map(d => {
            return d ? { unit: d.unit, action: d.action, timing: d.timing } : null;
        }).filter(Boolean);
    },

    applyRotationImport: (container, dataArray, rowFactory) => {
        if (!Array.isArray(dataArray)) return;
        
        container.innerHTML = '';
        RotationState.data = []; 
        RotationState.domMap = new WeakMap();

        dataArray.forEach((item, i) => {
            const newRow = rowFactory(i); 
            
            // ==========================================================================
            //   FIX: Register the newly instantiated imported row with RotationState
            // ==========================================================================
            RotationState.insertRow(newRow);
            
            const data = RotationState.getData(newRow);
            
            data.unit = item.unit || ""; 
            data.timing = item.timing || "Auto";
            data.action = item.action || ""; 
            
            // Explicitly force the action into the dropdown
            RotationUtils.updateActionOptions(newRow, data.unit, data.action);

            const setVal = (sel, val) => { const el = newRow.querySelector(sel); if(el) el.value = val; };
            setVal('.unit-select', data.unit); 
            setVal('.move-select', data.action); 
            setVal('.timing-select', data.timing);

            newRow.querySelectorAll('.base-select').forEach(sel => { if(typeof CommonUtils !== 'undefined') CommonUtils.updatePlaceholderStyle(sel); });
            RotationUtils.updateForteVisibility(newRow, data.unit);
            container.appendChild(newRow);
        });
        
        // ==========================================================================
        //   FIX: Register the trailing empty placeholder row with RotationState too
        // ==========================================================================
        const emptyRow = rowFactory(dataArray.length);
        RotationState.insertRow(emptyRow);
        
        container.appendChild(emptyRow); 
        container.dispatchEvent(new CustomEvent('row-structure-change'));
    },

    generatePasteCommands: (container, clipboard, selectedRows, factoryCallback) => {
        const commands = [];
        let startIndex = -1;
        
        if (selectedRows && selectedRows.length > 0) {
            const startData = RotationState.getData(selectedRows[0]);
            startIndex = RotationState.data.indexOf(startData);
        } else {
            // If nothing is selected, paste at the very end (before the empty placeholder)
            startIndex = Math.max(0, RotationState.data.length - 1);
        }
        
        // Match clipboard items with selected rows 1-to-1 to "overwrite" them safely
        const maxEdits = selectedRows ? Math.min(clipboard.length, selectedRows.length) : 0;
        
        for (let i = 0; i < maxEdits; i++) {
            const data = clipboard[i];
            const existingRow = selectedRows[i];
            
            const pushEdit = (sel, val) => { 
                const el = existingRow.querySelector(sel); 
                if (el && el.value !== val) commands.push(new EditValueCommand(el, el.value, val)); 
            };
            
            pushEdit('.unit-select', data.unit); 
            pushEdit('.move-select', data.action); 
            pushEdit('.timing-select', data.timing);
        }
        
        // If there are MORE clipboard items than selected rows, ADD new rows
        if (clipboard.length > maxEdits) {
            let insertIndex = startIndex + maxEdits;
            
            for (let i = maxEdits; i < clipboard.length; i++) {
                const data = clipboard[i];
                const targetIndex = insertIndex + (i - maxEdits);
                
                const newRow = factoryCallback(targetIndex); 
                const stateData = RotationState.getData(newRow);
                stateData.unit = data.unit; 
                stateData.timing = data.timing;
                stateData.action = data.action; 

                RotationUtils.updateActionOptions(newRow, data.unit, data.action);

                const setVal = (sel, val) => {
                    const el = newRow.querySelector(sel);
                    if (el) el.value = val;
                };
                
                setVal('.unit-select', data.unit); 
                setVal('.move-select', data.action); 
                setVal('.timing-select', data.timing);
                
                newRow.querySelectorAll('.base-select').forEach(CommonUtils.updatePlaceholderStyle);
                if (typeof RotationUtils !== 'undefined') RotationUtils.updateForteVisibility(newRow, data.unit);
                
                commands.push(new AddRowCommand(container, newRow, targetIndex));
            }
        }
        
        // If there are FEWER clipboard items than selected rows, DELETE the excess selected rows
        if (selectedRows && selectedRows.length > maxEdits) {
            const rowsToDelete = selectedRows.slice(maxEdits);
            commands.push(new DeleteRowsCommand(container, rowsToDelete));
        }
        
        return { commands, startIndex };
    }
};