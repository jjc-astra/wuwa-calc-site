// =========================================
//   ROTATION RENDERER (View Layer)
// =========================================
const RotationRenderer = {
    generateRowGridHTML: (optionsHTML) => Templates.Rotation.generateRowGridHTML(optionsHTML),

    formatDamageBreakdown: (calculatedTotal, formulaUsed, pctMult, flatMult, scalingStatVal, finalCritRate, finalCritDamage, baseDmgBonus, buffTotals, resMultiplier, defMult, statBreakdown = null) => {
        let displayMult = "";
        const totalPctMult = pctMult + buffTotals.additiveMult;
        if (totalPctMult > 0) displayMult += +(totalPctMult * 100).toFixed(6) + "%";
        if (totalPctMult > 0 && flatMult > 0) displayMult += " + ";
        if (flatMult > 0) displayMult += +(flatMult).toFixed(6);
        if (displayMult === "") displayMult = "0";

        let statStr = `${Math.floor(scalingStatVal)}`;
        if (statBreakdown && statBreakdown.base) {
            const label = statBreakdown.label ? `(${statBreakdown.label}) ` : "";
            const pctStr = statBreakdown.pct !== 0 ? ` * ${(1 + statBreakdown.pct).toFixed(3)}` : ` * 1.000`;
            const flatStr = statBreakdown.flat > 0 ? ` + ${Math.floor(statBreakdown.flat)}` : ``;
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
                data.timing = "Auto";
            }
        } else {
            setVal('.timing-select', data.timing);
        }

        if (typeof RotationUtils !== 'undefined') RotationUtils.updateForteVisibility(row, data.unit);
        const timeInput = row.querySelector('.sub-panel-trigger[data-trigger="time"] .num-input');
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
        const updateGauge = (name, val, maxVal, isGlowing = false) => {
            const el = row.querySelector(`.gauge-dial[data-name="${name}"], .gauge-vertical[data-name="${name}"]`);
            if (!el) return;
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
                } else {
                    const doubleMax = maxVal * 2;
                    fValue = (progress % doubleMax > maxVal) ? (doubleMax - (progress % doubleMax)) : (progress % doubleMax);
                }

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

    refreshOpenSubpanels: (container) => {
        const builder = container || document.getElementById('rotation-builder');
        if (!builder) return;

        builder.querySelectorAll('.rotation-row').forEach(row => {
            const activeTrigger = row.querySelector('.sub-panel-trigger.is-active');
            const panel = row.querySelector('.sub-panel');

            if (activeTrigger && panel && panel.classList.contains('is-open')) {
                const data = RotationState.getData(row);
                if (data) {
                    const type = activeTrigger.dataset.trigger;
                    panel.innerHTML = RotationRenderer.generatePanelContent(type, data.unit, data.action, row);
                }
            }
        });
    },

    generatePanelContent: (type, unit, action, row) => {
        if (type === 'offset') {
            return Templates.Rotation.renderOffsetPanel(RotationState.getData(row));
        }
        const config = PANEL_CONFIG[type];
        if (!config) return `<div class="panel-content-grid">${Templates.Rotation.createPanelItem("Info", "No data available", "text-dim")}</div>`;

        let bodyHTML = '';
        if (config.type === "complex_dmg") bodyHTML = Templates.Rotation.renderComplexDmgPanel(config, RotationState.getData(row));
        else if (config.type === "complex_time") bodyHTML = Templates.Rotation.renderComplexTimePanel(config, RotationState.getData(row));
        else bodyHTML = Templates.Rotation.renderStandardPanel(config, RotationState.getData(row));

        return `<div class="panel-header-main">${config.title}</div>${bodyHTML}`;
    }
};