// =========================================
//   ROTATION RENDERER (View Layer)
// =========================================

const RotationRenderer = {
    
    generateRowGridHTML: (optionsHTML) => {
        const wrap = (type, content) => `<div class="sub-panel-trigger" data-trigger="${type}">${content}</div>`;
        const iconError = `<svg class="status-icon icon-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
        const iconWarn = `<svg class="status-icon icon-warn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
        
        return `
            <div class="index-cell">
                <span class="row-index">#</span> ${iconError} ${iconWarn}
                <label class="check-wrap"><input type="checkbox" class="row-select-check"><span class="check-visual"></span></label>
            </div>
            <select class="base-select unit-select text-bold">${optionsHTML}</select>
            
            <select class="base-select move-select"><option value="" disabled hidden selected>Select Unit</option></select>
            
            <div class="col-time center-content sub-panel-trigger" data-trigger="time">
                <div class="base-num-box" style="width:100%; padding: 2px 5px;"><input type="text" class="num-input text-xs" placeholder="0.0s" readonly></div>
            </div>
            <select class="base-select timing-select text-xs"><option value="Auto">Auto</option></select>
            
            <!-- --- FIXED: Added the 'offset-input' class to the element below --- -->
            ${wrap('offset', `<div class="base-num-box" style="width:100%; padding: 2px 5px;"><input type="text" class="num-input text-xs offset-input" value="0.00" readonly></div>`)}
            
            ${wrap('dmg', `<div class="base-num-box" style="width:100%; padding: 2px 5px;"><input type="text" class="num-input text-xs" placeholder="0" readonly></div>`)}
            
            <div class="gauge-cell" style="width:100%">
                <div class="multi-gauge-wrap">
                    ${wrap('forte1', `<div class="gauge-dial" data-name="Forte 1" style="--p:0%"></div>`)}
                    ${wrap('forte2', `<div class="gauge-dial" data-name="Forte 2" style="--p:0%"></div>`)}
                    ${wrap('forte3', `<div class="gauge-dial" data-name="Forte 3" style="--p:0%"></div>`)}
                    ${wrap('forte4', `<div class="gauge-dial" data-name="Forte 4" style="--p:0%"></div>`)}
                    ${wrap('forte5', `<div class="gauge-dial" data-name="Forte 5" style="--p:0%"></div>`)}
                    ${wrap('forte6', `<div class="gauge-dial" data-name="Forte 6" style="--p:0%"></div>`)}
                </div>
            </div>
            
            ${wrap('concerto', `<div class="gauge-cell" style="width:100%"><div class="gauge-dial" data-name="Concerto" style="--p:0%"></div></div>`)}
            ${wrap('energy', `<div class="gauge-cell" style="width:100%"><div class="gauge-vertical" data-name="Energy"><div class="gauge-vertical-fill"></div></div></div>`)}
            ${wrap('tune', `<div class="gauge-cell" style="width:100%"><div class="gauge-dial" data-name="Tune" style="--p:0%"></div></div>`)}
        `;
    },

    formatDamageBreakdown: function(calculatedTotal, formulaUsed, pctMult, flatMult, scalingStatVal, finalCritRate, finalCritDamage, baseDmgBonus, buffTotals, resMultiplier, defMult, statBreakdown = null) {
        let displayMult = "";
        const totalPctMult = pctMult + buffTotals.additiveMult;
        
        if (totalPctMult > 0) displayMult += +(totalPctMult * 100).toFixed(6) + "%";
        if (totalPctMult > 0 && flatMult > 0) displayMult += " + ";
        if (flatMult > 0) displayMult += +(flatMult).toFixed(6); 
        if (displayMult === "") displayMult = "0";

        let statStr = `${Math.floor(scalingStatVal)}`;
        
        if (statBreakdown && statBreakdown.base) {
            const label = statBreakdown.label ? `(${statBreakdown.label}) ` : ""; // Format: (ATK)
            const pctStr = statBreakdown.pct !== 0 ? ` * ${(1 + statBreakdown.pct).toFixed(3)}` : ` * 1.000`;
            const flatStr = statBreakdown.flat > 0 ? ` + ${Math.floor(statBreakdown.flat)}` : ``;
            // Updated output: (ATK) [Base * Mult + Flat]
            statStr = `[${Math.floor(statBreakdown.base)}${pctStr}${flatStr}] ${label}`;
        }

        const baseDmgStr = (totalPctMult > 0 && flatMult > 0) ? `(${+(totalPctMult * 100).toFixed(4)}% * ${statStr} + ${Math.floor(flatMult)})` 
                         : (totalPctMult > 0) ? `${+(totalPctMult * 100).toFixed(4)}% * ${statStr}`
                         : `${Math.floor(flatMult)}`;
                         
        const breakdownParts = [baseDmgStr];
        
        if (formulaUsed === "Standard") {
            const cr = Math.min(1.0, Math.max(0.0, finalCritRate));
            const critMult = (1 - cr) * 1 + cr * finalCritDamage;
            const dmgBonusTotal = 1 + baseDmgBonus + buffTotals.dmgBonus;
            
            if (dmgBonusTotal !== 1) breakdownParts.push(`${dmgBonusTotal.toFixed(3)} (DMG%)`);
            if (critMult !== 1) breakdownParts.push(`${critMult.toFixed(3)} (Crit)`);
        }
        
        if (buffTotals.dmgAmp !== 0) breakdownParts.push(`${(1+buffTotals.dmgAmp).toFixed(3)} (Amp)`);
        if (buffTotals.dmgTaken !== 0) breakdownParts.push(`${(1+buffTotals.dmgTaken).toFixed(3)} (Taken)`);
        if (buffTotals.multiplicativeMult !== 0) breakdownParts.push(`${(1+buffTotals.multiplicativeMult).toFixed(3)} (Multi)`);
        
        if (formulaUsed !== "Tune") {
            if (resMultiplier !== 1) breakdownParts.push(`${resMultiplier.toFixed(3)} (RES)`);
            if (defMult !== 1) breakdownParts.push(`${defMult.toFixed(3)} (DEF)`);
        }
        
        const suffix = formulaUsed !== "Standard" ? ` [${formulaUsed}]` : "";
        return { displayMult, calcBreakdown: `${Math.floor(calculatedTotal)} = ${breakdownParts.join(' * ')}${suffix}` };
    },

    updateRowVisuals: (data) => {
        const row = data.domRef;
        if (!row) return;
        RotationRenderer._syncInputs(row, data);
        RotationRenderer._updateGauges(row, data);
        RotationRenderer._updateStatusStrip(row, data);
    },

    _syncInputs: (row, data) => {
        const u = data.unit;
        const dbChar = (typeof CHARACTER_DB !== 'undefined' && u) ? CHARACTER_DB[u] || {} : {};
        
        // --- INJECT CHARACTER THEME ACCENT COLOR ---
        if (dbChar.themeColor) {
            row.style.setProperty('--char-theme-raw', dbChar.themeColor);
        } else {
            row.style.removeProperty('--char-theme-raw');
        }

        const setVal = (sel, val) => {
            const el = row.querySelector(sel);
            if (el && el.value !== val) {
                el.value = val;
                if(el.classList.contains('base-select')) el.classList.toggle('has-value', val !== "");
            }
        };
        setVal('.unit-select', data.unit);
        setVal('.move-select', data.action);

        // --- NEW: Dynamic Timing Dropdown ---
        const timingSelect = row.querySelector('.timing-select');
        if (timingSelect && data.availableTimings) {
            const currentOptionsHTML = data.availableTimings.map(t => `<option value="${t.val}" title="${t.title}">${t.label}</option>`).join('');
            
            if (timingSelect.innerHTML !== currentOptionsHTML) {
                timingSelect.innerHTML = currentOptionsHTML;
            }
            
            if (Array.from(timingSelect.options).some(opt => opt.value === data.timing)) {
                setVal('.timing-select', data.timing);
            } else {
                setVal('.timing-select', "Auto");
                data.timing = "Auto"; // Fallback to avoid invalid selections
            }
        } else {
            setVal('.timing-select', data.timing);
        }
        
        if (typeof RotationUtils !== 'undefined') RotationUtils.updateForteVisibility(row, data.unit);

        const timeInput = row.querySelector('.sub-panel-trigger[data-trigger="time"] .num-input');
        // Point the visual UI column to the Tower Clock instead of the Stopwatch!
        if (timeInput) timeInput.value = (data.gameTimeStart || 0).toFixed(2) + "s";

        const offsetInput = row.querySelector('.sub-panel-trigger[data-trigger="offset"] .num-input');
        if (offsetInput) {
            const val = data.offset || 0;
            const box = offsetInput.closest('.base-num-box');
            box.classList.remove('offset-pos', 'offset-neg');
            if (val > 0) { box.classList.add('offset-pos'); offsetInput.value = "+ " + Math.abs(val).toFixed(2); } 
            else if (val < 0) { box.classList.add('offset-neg'); offsetInput.value = "- " + Math.abs(val).toFixed(2); } 
            else { offsetInput.value = "0.00"; }
        }

        // --- FIXED: Dynamically unlock offset input for simultaneous/parallel timing setups ---
        const offsetBoxInput = row.querySelector('.sub-panel-trigger[data-trigger="offset"] .num-input');
        if (offsetBoxInput) {
            if (data.timing === "Simultaneous") {
                offsetBoxInput.removeAttribute('readonly');
                offsetBoxInput.style.cursor = 'text';
                offsetBoxInput.value = data.manualOffset !== undefined ? data.manualOffset.toFixed(2) : "0.00";
            } else {
                offsetBoxInput.setAttribute('readonly', 'true');
                offsetBoxInput.style.cursor = 'pointer';
            }
        }
        
    },

    _updateGauges: (row, data) => {
        const u = data.unit;
        const dbChar = (typeof CHARACTER_DB !== 'undefined' && u) ? CHARACTER_DB[u] || {} : {};
        
        // ==========================================================================
        //   RESTORED: updateGauge hijacks 'is-full' class for DRY visual matching
        // ==========================================================================
        const updateGauge = (name, val, maxVal, isGlowing = false) => {
            const el = row.querySelector(`.gauge-dial[data-name="${name}"], .gauge-vertical[data-name="${name}"]`);
            if (!el) return; // Clean, early exit
            
            if (el.classList.contains('gauge-vertical')) {
                if (!el.querySelector('.gauge-vertical-fill')) {
                    el.innerHTML = '<div class="gauge-vertical-fill"></div>';
                }
            } else if (el.innerHTML !== '') {
                el.innerHTML = '';
            }
            
            el.className = el.classList.contains('gauge-vertical') ? 'gauge-vertical' : 'gauge-dial';
            
            const pct = maxVal > 0 ? Math.min(MECHANICS_NOTATION.GAUGES.DEFAULT_MAX, Math.max(0, (val / maxVal) * MECHANICS_NOTATION.GAUGES.DEFAULT_MAX)) : 0;
            el.style.setProperty('--p', pct + '%');
            el.dataset.value = typeof val === 'number' && !Number.isInteger(val) ? parseFloat(val.toFixed(2)) : val;
            
            el.classList.toggle('is-full', val >= maxVal || isGlowing);
        };

        const liveConcerto = data.concerto ? (data.concerto[u] || 0) : 0;
        const liveEnergy = data.energy ? (data.energy[u] || 0) : 0;
        const liveTune = data.enemyTune !== undefined ? data.enemyTune : (data.trackers?.tune || 0);
        
        updateGauge('Concerto', liveConcerto, MECHANICS_NOTATION.GAUGES.DEFAULT_MAX);
        updateGauge('Energy', liveEnergy, dbChar.maxEnergy || MECHANICS_NOTATION.GAUGES.DEFAULT_MAX);
        updateGauge('Tune', liveTune, MECHANICS_NOTATION.GAUGES.DEFAULT_MAX);

        for (let i = 1; i <= 6; i++) {
            const fKey = `forte${i}`;
            let fValue = data[fKey] ? (data[fKey][u] || 0) : 0;
            const maxKey = `maxForte${i}`;
            const fMax = dbChar[maxKey] || MECHANICS_NOTATION.GAUGES.DEFAULT_MAX;
            
            let isGlowing = false;
            
            // ==========================================================================
                //   GENERIC HOLD TRACKING (Visualized on Forte 1 by default)
                // ==========================================================================
                if (i === 1 && data.trackers && data.trackers.Hold_Start !== undefined) {
                    const holdStart = data.trackers.Hold_Start;
                    const rowEndGameTime = data.gameTimeStart + (data.gameTimePassed || 0);
                    const currentHoldDuration = rowEndGameTime - holdStart;
                    
                    const speed = typeof MECHANICS_NOTATION !== 'undefined' && MECHANICS_NOTATION.HOLD_DEFAULTS ? MECHANICS_NOTATION.HOLD_DEFAULTS.CURSOR_SPEED : 100;
                    const maxVal = typeof MECHANICS_NOTATION !== 'undefined' && MECHANICS_NOTATION.HOLD_DEFAULTS ? MECHANICS_NOTATION.HOLD_DEFAULTS.MAX_CURSOR_VAL : 100;
                    const mode = typeof MECHANICS_NOTATION !== 'undefined' && MECHANICS_NOTATION.HOLD_DEFAULTS ? MECHANICS_NOTATION.HOLD_DEFAULTS.CURSOR_MODE : "pingpong";
                    
                    const accumulated = data.trackers.Cursor_Accumulated || 0;
                    const progress = accumulated + (currentHoldDuration * speed);
                    
                    if (mode === "clamp") {
                        fValue = Math.min(progress, maxVal);
                    } else if (mode === "loop") {
                        fValue = progress % maxVal;
                    } else { // pingpong
                        const doubleMax = maxVal * 2;
                        fValue = (progress % doubleMax > maxVal) ? (doubleMax - (progress % doubleMax)) : (progress % doubleMax);
                    }
                    
                    // Retrieve dynamic math variables if they were stamped into the trackers by the Engine
                    const center = data.trackers.Forte_Win_Center || (typeof MECHANICS_NOTATION !== 'undefined' && MECHANICS_NOTATION.HOLD_DEFAULTS ? parseFloat(MECHANICS_NOTATION.HOLD_DEFAULTS.WINDOW_CENTER) : 65);
                    const size = data.trackers.Forte_Win_Size || (typeof MECHANICS_NOTATION !== 'undefined' && MECHANICS_NOTATION.HOLD_DEFAULTS ? parseFloat(MECHANICS_NOTATION.HOLD_DEFAULTS.WINDOW_SIZE) : 10);
                    
                    isGlowing = Math.abs(fValue - center) <= (size / 2);
                    
                    updateGauge('Forte ' + i, fValue, maxVal, isGlowing);
                } else {
                    updateGauge('Forte ' + i, fValue, fMax, isGlowing);
                }
        }
    },

    _updateStatusStrip: (row, data) => {
        const indexCell = row.querySelector('.index-cell');
        const statusStrip = row.querySelector('.status-msg-strip');
        
        indexCell.classList.remove('is-error', 'is-warning');
        indexCell.dataset.tooltipMsg = "";
        statusStrip.style.display = 'none';
        statusStrip.className = 'status-msg-strip';

        if (data.errorMsg) {
            indexCell.classList.add('is-error'); indexCell.dataset.tooltipMsg = data.errorMsg;
            statusStrip.classList.add('is-error-strip'); statusStrip.textContent = "ERROR: " + data.errorMsg; statusStrip.style.display = 'block';
        } else if (data.warningMsg) {
            indexCell.classList.add('is-warning'); indexCell.dataset.tooltipMsg = data.warningMsg;
            statusStrip.classList.add('is-warning-strip'); statusStrip.textContent = "WARNING: " + data.warningMsg; statusStrip.style.display = 'block';
        }
    },

    renderAll: (activeDataList) => {
        activeDataList.forEach(data => RotationRenderer.updateRowVisuals(data));
        const lastRow = document.getElementById('rotation-builder').lastElementChild;
        if(lastRow) {
             const idx = lastRow.querySelector('.index-cell');
             if(idx) { idx.className = 'index-cell'; idx.dataset.tooltipMsg = ""; }
             const strip = lastRow.querySelector('.status-msg-strip');
             if(strip) strip.style.display = 'none';
        }
    },

    setDamageState: (isStale) => {
        const container = document.getElementById('rotation-builder');
        if(container) container.querySelectorAll('.sub-panel-trigger[data-trigger="dmg"] .num-input').forEach(el => el.classList.toggle('dmg-dimmed', isStale));
    },
    updateDamageValue: (domRow, value) => {
        const input = domRow.querySelector('.sub-panel-trigger[data-trigger="dmg"] .num-input');
        if (input) { input.value = value.toLocaleString(); input.classList.remove('dmg-dimmed'); }
    },

    _createPanelItem: (label, value, extraClass = "") => `<div class="panel-info-item"><span class="panel-info-label">${label}</span><div class="panel-info-value ${extraClass}">${value}</div></div>`,
    _createStatTableRow: (label, value) => `<tr><td class="stat-table-label">${label}</td><td class="stat-table-value">${value}</td></tr>`,
    _createBuffCard: (source, stacks, effects) => `
        <div class="buff-card">
            <div class="buff-card-header"><span class="buff-source">${source}</span><span class="buff-stacks">×${stacks}</span></div>
            <div class="buff-card-body">${effects.map(e => `<div class="buff-effect-row"><svg class="buff-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 10 20 15 15 20"></polyline><path d="M4 4v7a4 4 0 0 0 4 4h12"></path></svg><span class="buff-effect-label">${e.label}:</span><span class="buff-val-box">${e.value}</span></div>`).join('')}</div>
        </div>`,
    _createFormulaRow: (formulaStr) => {
        if (!formulaStr) return "";
        return `
        <div class="dmg-formula-container">
            <div class="panel-header-tiny">Calculation Breakdown</div>
            <div class="dmg-formula-box text-dim">${formulaStr}</div>
        </div>`;
    },

    _renderStandardPanel: (config, data) => {
        return `<div class="panel-content-grid">${config.fields.map(f => {
            const u = data.unit;
            let displayVal = undefined;

            // 1. Process standard current state numbers
            let stateVal = data[f.key];
            if (f.key === "tune" && data.enemyTune !== undefined) stateVal = data.enemyTune; // Tune routing patch
            if (stateVal && typeof stateVal === 'object' && !Array.isArray(stateVal)) {
                stateVal = stateVal[u];
            }

            // 2. Process Delta Generation metrics out of trackers/memory streams
            let deltaVal = undefined;
            const lookupKeys = [`${u}_${f.key}`, f.key];
            const dataContainers = [data.trackers, data.memory, data.dropdownState?.trackers].filter(Boolean);

            for (const container of dataContainers) {
                for (const key of lookupKeys) {
                    if (container[key] !== undefined) {
                        deltaVal = container[key];
                        break;
                    }
                }
                if (deltaVal !== undefined) break;
            }

            let rawVal = stateVal !== undefined ? stateVal : (deltaVal !== undefined ? deltaVal : f.default);

            if (typeof rawVal === 'number') {
                displayVal = Number.isInteger(rawVal) ? rawVal : parseFloat(rawVal.toFixed(3));
                // Add explicit indicator symbol if a positive delta mutation occurred
                if (String(f.key).toLowerCase().includes('delta') && rawVal > 0) {
                    displayVal = "+" + displayVal;
                }
            } else {
                displayVal = rawVal;
            }

            return RotationRenderer._createPanelItem(f.label, displayVal + (f.suffix || ""), f.highlight);
        }).join('')}</div>`;
    },

    _renderComplexTimePanel: (config, data) => {
        const groupsHTML = config.groups.map(group => {
            const fieldsHTML = group.fields.map(f => {
                let rawVal = data[f.key] !== undefined ? data[f.key] : f.default;
                let displayVal = typeof rawVal === 'number' && !Number.isInteger(rawVal) ? parseFloat(rawVal.toFixed(3)) : rawVal;
                return RotationRenderer._createPanelItem(f.label, displayVal + (f.suffix || ""), f.highlight);
            }).join('');
            
            
            return `
                <div class="time-panel-group" style="margin-bottom: 12px;">
                    <div class="panel-header-tiny" style="margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.1); color: #aaa;">${group.title}</div>
                    <div class="panel-content-grid">${fieldsHTML}</div>
                </div>
            `;
        }).join('');
        return `<div class="complex-time-container">${groupsHTML}</div>`;
    },

    _renderComplexDmgPanel: (config, data) => {
        if (!data || !data.damageInstances || data.damageInstances.length === 0) {
            return `<div class="empty-buff-state" style="padding: 20px; text-align: center; color: var(--text-dim);">No damage instances dealth by this action.</div>`;
        }
        let instances = data.damageInstances;
        
        const sectionsHTML = instances.map(inst => {
            // Guarantee the fallback object shape so later Object.values() doesn't fail
            const instData = inst.data || { activeBuffs: {} };
            const tagsHTML = config.tags.map(t => {
                const rawVals = Array.isArray(t.keys) ? t.keys.map(k => instData[k]).filter(Boolean) : [instData[t.key]].filter(Boolean);
                
                // NEW: Also clean up floating point variables in the complex tags (like Base Mults)
                const cleanVals = rawVals.map(v => (typeof v === 'number' && !Number.isInteger(v)) ? parseFloat(v.toFixed(3)) : v);
                
                let displayVal = cleanVals.length > 0 ? cleanVals.join(', ') : (t.default || '-');
                return RotationRenderer._createPanelItem(t.label, displayVal !== '-' && t.suffix ? displayVal + t.suffix : displayVal, t.highlight || "");
            }).join('');

            const statsHTML = config.stats.map(s => {
                let actualLabel = s.label;
                let actualKey = s.key;

                // --- FIXED: Dynamically inject the Scalar Name and Value ---
                if (s.label === "Scalar" || s.key === "scalar") {
                    actualLabel = instData.scalarLabel || "ATK";
                    actualKey = "scalarValue"; 
                }

                let val = instData[actualKey] !== undefined ? instData[actualKey] : "0";
                
                // Format table stat values if they are messy floats
                if (typeof val === 'number' && !Number.isInteger(val)) {
                    val = parseFloat(val.toFixed(3));
                }
                
                val += (s.suffix && val !== "0" && val !== 0) ? s.suffix : "";
                return RotationRenderer._createStatTableRow(actualLabel, (val === "0" || val === "0%") ? `<span class="text-dim">${val}</span>` : val);
            }).join('');

            const activeBuffs = Object.values(instData.activeBuffs);
            const teamSlots = typeof RosterState !== 'undefined' && RosterState.team ? RosterState.team : [{}, {}, {}];
            
            const providerColumnsHTML = teamSlots.map((slot, i) => {
                const unitName = slot.character || `Slot ${i + 1}`;
                const unitBuffs = activeBuffs.filter(b => b.provider === unitName || (b.source && b.source.includes(unitName)));
                
                // --- FIXED: Group the buffs by their mechanic source! ---
                const groupedBuffs = {};
                unitBuffs.forEach(b => {
                    const sourceMech = b.source || "System";
                    
                    // --- NEW: Initialize the object if it doesn't exist yet ---
                    if (!groupedBuffs[sourceMech]) {
                        groupedBuffs[sourceMech] = { stacks: b.stacks || 1, effects: [] };
                    } else {
                        // If one mechanic somehow has overlapping distinct stacks, take the highest
                        groupedBuffs[sourceMech].stacks = Math.max(groupedBuffs[sourceMech].stacks, b.stacks || 1);
                    }
                    
                    // Automatically add a % sign to raw decimals under 1.0 (like 0.10) for UI display
                    let displayVal = b.value !== undefined ? b.value : "-";
                    if (typeof b.value === 'number' && b.value > 0 && b.value < 1) displayVal = +(b.value * 100).toFixed(2) + "%"; 
                    
                    groupedBuffs[sourceMech].effects.push({
                        label: b.label || b.stat || b.name || "Effect",
                        value: displayVal
                    });
                });

                const cardsHTML = Object.keys(groupedBuffs).length > 0 ? Object.keys(groupedBuffs).map(source => {
                    const group = groupedBuffs[source];
                    // Clean up DB names (e.g., "Radiance Cleaver_Edge Breaker" -> "Radiance Cleaver Edge Breaker")
                    const cleanName = source.replace(/_/g, ' '); 
                    
                    return RotationRenderer._createBuffCard(cleanName, group.stacks, group.effects);
                }).join('') : `<div class="empty-buff-state">No buffs</div>`;
                
                return `<div class="buff-provider-col"><div class="buff-provider-header">${unitName}</div><div class="buff-list-container">${cardsHTML}</div></div>`;
            }).join('');
// --- Call the helper method to render the row HTML ---
            const formulaHTML = RotationRenderer._createFormulaRow(instData.calcBreakdown);

            return `
            <div class="dmg-accordion-section ${inst.isOpen ? 'is-open' : ''}">
                <div class="dmg-accordion-header">
                    <svg class="dmg-accordion-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
                    <span class="dmg-accordion-title">${inst.title}</span>
                    <span class="dmg-accordion-total">${inst.total || '0'}</span>
                </div>
                <div class="dmg-accordion-body">
                    <div class="panel-content-grid dmg-panel-top-row">${tagsHTML}</div>
                    ${formulaHTML} <div class="dmg-panel-main-grid">
                        <div class="dmg-panel-stats-col">
                            <div class="panel-header-tiny">Buff Totals</div>
                            <div class="table-wrapper"><table class="dmg-stat-table"><tbody>${statsHTML}</tbody></table></div>
                        </div>
                        <div class="dmg-panel-buffs-col">
                            <div class="panel-header-tiny">Active Buffs by Provider</div>
                            <div class="buff-provider-grid">${providerColumnsHTML}</div>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');

        return `<div class="dmg-accordion-container">${sectionsHTML}</div>`;
    },

    _renderOffsetPanel: (data) => {
        const reasonsHTML = (data.offsetReasons && data.offsetReasons.length > 0)
            ? data.offsetReasons.map(r => `
                <div class="buff-effect-row" style="margin-bottom: 6px; display: flex; justify-content: space-between; padding-right: 8px;">
                    <div style="display:flex; align-items:center;">
                        <svg class="buff-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 10 20 15 15 20"></polyline><path d="M4 4v7a4 4 0 0 0 4 4h12"></path></svg>
                        <span class="buff-effect-label">${r.label}</span>
                    </div>
                    <span class="buff-val-box text-bold ${r.isNegative ? 'text-gold' : (r.value === '0.00s' ? 'text-dim' : 'text-main')}">${r.value}</span>
                </div>`).join('')
            : `<div class="empty-buff-state" style="padding: 12px; margin-top: 8px;">Standard Execution (No Offset)</div>`;
            
        const offsetStr = (data.offset > 0 ? "+" : "") + data.offset.toFixed(2) + "s";const offsetClass = data.offset > 0 ? "text-gold" : (data.offset < 0 ? "text-main" : "text-dim");

        return `
            <div class="panel-header-main">Offset Breakdown</div>
            <div class="panel-content-grid" style="grid-template-columns: 1fr;">
                <div class="panel-info-item" style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="panel-info-label" style="margin-bottom:0;">Total Offset</span>
                    <span class="panel-info-value ${offsetClass}">${offsetStr}</span>
                </div>
            </div>
            <div class="panel-header-tiny" style="margin-top: 16px;">Offset Sources</div>
            <div class="buff-card" style="padding: 12px;">
                ${reasonsHTML}
            </div>
        `;
    },

    generatePanelContent: (type, unit, action, row) => {
        if (type === 'offset') {
            return RotationRenderer._renderOffsetPanel(RotationState.getData(row));
        }

        const config = PANEL_CONFIG[type];
        if (!config) return `<div class="panel-content-grid">${RotationRenderer._createPanelItem("Info", "No data available", "text-dim")}</div>`;
        
        let bodyHTML = '';
        if (config.type === "complex_dmg") bodyHTML = RotationRenderer._renderComplexDmgPanel(config, RotationState.getData(row));
        else if (config.type === "complex_time") bodyHTML = RotationRenderer._renderComplexTimePanel(config, RotationState.getData(row));
        else bodyHTML = RotationRenderer._renderStandardPanel(config, RotationState.getData(row));
        
        return `<div class="panel-header-main">${config.title}</div>${bodyHTML}`;
    }
};