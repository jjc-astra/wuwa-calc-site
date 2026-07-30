// ==========================================================================
//   UNIFIED UI TEMPLATE STORE
// ==========================================================================
const Templates = {
    // =========================================
    //   1. ROSTER & TEAM TEMPLATES
    // =========================================
    Roster: {
        generateCharCardHTML() {
            return `
            <div class="char-row">
                <div class="panel-col" style="position: relative;">
                    <button class="base-btn icon-btn quick-build-btn" title="Load Recommended Build" style="position: absolute; top: 0px; left: 5px; z-index: 10;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                    </button>
                    <div class="avatar avatar-lg avatar-circle avatar-wrapper mb-sm">
                        <span class="char-text">?</span><img class="char-img avatar-img" src="${TRANSPARENT_PIXEL}">
                    </div>
                    <div class="flex-col gap-sm">
                        <select class="base-select char-select text-bold" required>${CommonUtils.createOptions(CHAR_LIST, null, "Character")}</select>
                        <div class="flex-row gap-sm seq-mode-row">
                            <div class="base-num-box seq-box"><span class="text-xs text-bold text-dim">SEQ</span><input type="number" class="num-input seq-input" value="0" min="0" max="6"></div>
                            <select class="base-select mode-select"><option value="None">None</option><option value="Strain">Strain</option><option value="Rupture">Rupture</option></select>
                        </div>
                    </div>
                </div>
                <div class="panel-col">
                    <div class="avatar avatar-lg avatar-rect avatar-wrapper mb-sm">
                        <span class="wep-text">?</span><img class="wep-img avatar-img" src="${TRANSPARENT_PIXEL}">
                    </div>
                    <div class="flex-col gap-sm">
                        <select class="base-select wep-select text-bold" required disabled><option value="" disabled hidden selected>Select Character First</option></select>
                        <div class="base-num-box"><span class="text-xs text-bold text-dim">RANK</span><input type="number" class="num-input rank-input" value="1" min="1" max="5"></div>
                    </div>
                </div>
                <div class="panel-col sets-col">
                    <div class="set-header">Sonata Sets</div>
                    <div class="flex-col gap-sm">
                        <div class="flex-row gap-sm">
                            <div class="avatar avatar-sm" style="visibility:hidden"></div>
                            <select class="base-select layout-select">${CommonUtils.createOptions(SET_LAYOUTS, "4 3 3 1 1")}</select>
                        </div>
                        <div class="flex-row gap-sm">
                            <div class="avatar avatar-sm avatar-wrapper"><span class="main-set-text">?</span><img class="main-set-img avatar-img" src="${TRANSPARENT_PIXEL}"></div>
                            <select class="base-select main-set-select" required>${CommonUtils.createOptions(SONATA_SETS, null, "Main Set")}</select>
                        </div>
                        <div class="flex-row gap-sm sub-set-row d-none">
                            <div class="avatar avatar-sm avatar-wrapper"><span class="sub-set-text">?</span><img class="sub-set-img avatar-img" src="${TRANSPARENT_PIXEL}"></div>
                            <select class="base-select sub-set-select" required>${CommonUtils.createOptions(SONATA_SETS, null, "Sub Set")}</select>
                        </div>
                        <div class="flex-row gap-sm main-echo-row d-none">
                            <div class="avatar avatar-sm avatar-wrapper"><span class="main-echo-text">?</span><img class="main-echo-img avatar-img" src="${TRANSPARENT_PIXEL}"></div>
                            <select class="base-select main-echo-select" required>${CommonUtils.createOptions(ALL_MAIN_ECHOES, null, "Main Echo")}</select>
                        </div>
                    </div>
                </div>
                <div class="echo-container"></div>
            </div>`;
        },

        generateEchoesHTML(options = {}) {
            const rowLimit = options.rowsPerCard || 5;
            const targetDatabase = options.statDatabase || STAT_DB;
            const statOptions = `<option>N/A</option>` + Object.keys(targetDatabase).map(key => `<option>${key}</option>`).join('');
            let statsHTML = '';

            for (let i = 0; i < rowLimit; i++) {
                statsHTML += `
                <li class="stat-row" data-stat-index="${i}">
                    <select class="base-select stat-select">${statOptions}</select>
                    <input type="range" class="base-slider" min="0" max="0" step="1" value="0">
                    <div class="base-num-box stat-num-box"><input type="number" class="num-input stat-value" value="" readonly></div>
                </li>`;
            }

            let allCards = '';
            for (let i = 0; i < 5; i++) {
                allCards += `
                <div class="base-card echo-card-wrap" data-echo-index="${i}">
                    <div class="echo-header"><select class="base-select echo-main-stat-select"><option value="" disabled hidden selected>Echo ${i+1}</option></select></div>
                    <ul class="echo-list">${statsHTML}</ul>
                </div>`;
            }
            return allCards;
        },

        getCurrentTeamOptionsHTML() {
            let options = '<option value="" disabled hidden selected>-</option>';
            if (typeof RosterState !== 'undefined' && RosterState.team) {
                RosterState.team.forEach(s => {
                    if (s.character) options += `<option value="${s.character}">${s.character}</option>`;
                });
            }
            return options;
        },

        updateHeaderPreview(previewContainer) {
            if (!previewContainer || typeof RosterState === 'undefined') return;
            let html = '';
            RosterState.team.forEach((s, i) => {
                const charName = s.character;
                const wepName = s.weapon;
                const seq = s.sequence || "0";
                const rank = s.rank || "1";

                html += `
                <div class="preview-slot" data-index="${i}">
                    <div class="preview-avatar preview-circle preview-avatar-wrap" title="${charName || 'No Character'}">
                        <span class="preview-char-initial p-char-txt">?</span>
                        <img class="preview-img-abs p-char-img opacity-0" src="${TRANSPARENT_PIXEL}">
                    </div>
                    <span class="preview-badge">S${seq}</span><span style="color:#555; margin:0 5px;">/</span>
                    <div class="preview-avatar preview-rect preview-avatar-wrap" title="${wepName || 'No Weapon'}">
                        <span class="preview-char-initial p-wep-txt">?</span>
                        <img class="preview-img-abs p-wep-img opacity-0" src="${TRANSPARENT_PIXEL}">
                    </div>
                    <span class="preview-badge">R${rank}</span>
                </div>`;
            });
            previewContainer.innerHTML = html;

            RosterState.team.forEach((s, i) => {
                const slotDom = previewContainer.querySelector(`.preview-slot[data-index="${i}"]`);
                if (slotDom && typeof CommonUtils !== 'undefined') {
                    CommonUtils.updateImage(slotDom, '.p-char-img', '.p-char-txt', 'Characters', s.character);
                    CommonUtils.updateImage(slotDom, '.p-wep-img', '.p-wep-txt', 'Weapons', s.weapon);
                }
            });
        }
    },

    // =========================================
    //   2. ROTATION & TIMELINE TEMPLATES
    // =========================================
    Rotation: {
        generateRowGridHTML(optionsHTML) {
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

        createPanelItem(label, value, extraClass = "") {
            return `<div class="panel-info-item"><span class="panel-info-label">${label}</span><div class="panel-info-value ${extraClass}">${value}</div></div>`;
        },

        createStatTableRow(label, value) {
            return `<tr><td class="stat-table-label">${label}</td><td class="stat-table-value">${value}</td></tr>`;
        },

        createBuffCard(source, effects) {
            return `
            <div class="buff-card">
                <div class="buff-card-header">
                    <span class="buff-source">${source}</span>
                </div>
                <div class="buff-card-body">
                    ${effects.map(e => `
                        <div class="buff-effect-row" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;">
                            <div class="buff-label-wrap" style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; overflow: hidden;">
                                <svg class="buff-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0; width: 14px; height: 14px;">
                                    <polyline points="15 10 20 15 15 20"></polyline>
                                    <path d="M4 4v7a4 4 0 0 0 4 4h12"></path>
                                </svg>
                                <span class="buff-effect-label" style="flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${e.label}">${e.label}:</span>
                            </div>
                            <div class="buff-value-wrap" style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                                <span class="buff-val-box">${e.value}</span>
                                <span class="buff-stacks">x${e.stacks || 1}</span>
                            </div>
                        </div>`).join('')}
                </div>
            </div>`;
        },

        createFormulaRow(formulaStr) {
            if (!formulaStr) return "";
            return `
            <div class="dmg-formula-container">
                <div class="panel-header-tiny">Calculation Breakdown</div>
                <div class="dmg-formula-box text-dim">${formulaStr}</div>
            </div>`;
        },

        renderStandardPanel(config, data) {
            return `<div class="panel-content-grid">${config.fields.map(f => {
                const u = data.unit;
                let displayVal = undefined;
                let stateVal = data[f.key];
                if (f.key === "tune" && data.enemyTune !== undefined) stateVal = data.enemyTune;
                if (stateVal && typeof stateVal === 'object' && !Array.isArray(stateVal)) {
                    stateVal = stateVal[u];
                }
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
                    if (String(f.key).toLowerCase().includes('delta') && rawVal > 0) {
                        displayVal = "+" + displayVal;
                    }
                } else {
                    displayVal = rawVal;
                }
                return Templates.Rotation.createPanelItem(f.label, displayVal + (f.suffix || ""), f.highlight);
            }).join('')}</div>`;
        },

        renderComplexTimePanel(config, data) {
            const groupsHTML = config.groups.map(group => {
                const fieldsHTML = group.fields.map(f => {
                    let rawVal = data[f.key] !== undefined ? data[f.key] : f.default;
                    let displayVal = typeof rawVal === 'number' && !Number.isInteger(rawVal) ? parseFloat(rawVal.toFixed(3)) : rawVal;
                    return Templates.Rotation.createPanelItem(f.label, displayVal + (f.suffix || ""), f.highlight);
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

        renderComplexDmgPanel(config, data) {
            if (!data || !data.damageInstances || data.damageInstances.length === 0) {
                return `<div class="empty-buff-state" style="padding: 20px; text-align: center; color: var(--text-dim);">No damage instances dealt by this action.</div>`;
            }
            let instances = data.damageInstances;

            const sectionsHTML = instances.map(inst => {
                const instData = inst.data || { activeBuffs: {} };
                let avgVal = typeof inst.avg === 'number' ? inst.avg : (typeof inst.total === 'number' ? inst.total : parseFloat(String(inst.total || 0).replace(/,/g, '')) || 0);
                let nonCritVal = inst.nonCrit;
                let critVal = inst.crit;

                if (nonCritVal === undefined || critVal === undefined) {
                    let cr = instData.critRate !== undefined ? instData.critRate : 0;
                    let cd = instData.critDmg !== undefined ? instData.critDmg : 150;
                    if (typeof cr === 'string') cr = parseFloat(cr) || 0;
                    if (cr > 1) cr = cr / 100;
                    cr = Math.min(1.0, Math.max(0.0, cr));
                    if (typeof cd === 'string') cd = parseFloat(cd) || 150;
                    if (cd > 10) cd = cd / 100;
                    const critMult = (1 - cr) + (cr * cd);
                    if (critMult > 0) {
                        nonCritVal = avgVal / critMult;
                        critVal = nonCritVal * cd;
                    } else {
                        nonCritVal = avgVal;
                        critVal = avgVal;
                    }
                }

                const tagsHTML = config.tags.map(t => {
                    const rawVals = Array.isArray(t.keys) ? t.keys.map(k => instData[k]).filter(Boolean) : [instData[t.key]].filter(Boolean);
                    const cleanVals = rawVals.map(v => (typeof v === 'number' && !Number.isInteger(v)) ? parseFloat(v.toFixed(3)) : v);
                    let displayVal = cleanVals.length > 0 ? cleanVals.join(', ') : (t.default || '-');
                    return Templates.Rotation.createPanelItem(t.label, displayVal !== '-' && t.suffix ? displayVal + t.suffix : displayVal, t.highlight || "");
                }).join('');

                const statsHTML = config.stats.map(s => {
                    let actualLabel = s.label;
                    let actualKey = s.key;
                    if (s.label === "Scalar" || s.key === "scalar") {
                        actualLabel = instData.scalarLabel || "ATK";
                        actualKey = "scalarValue"; 
                    }
                    let val = instData[actualKey] !== undefined ? instData[actualKey] : "0";
                    if (typeof val === 'number' && !Number.isInteger(val)) {
                        val = parseFloat(val.toFixed(3));
                    }
                    val += (s.suffix && val !== "0" && val !== 0) ? s.suffix : "";
                    return Templates.Rotation.createStatTableRow(actualLabel, (val === "0" || val === "0%") ? `<span class="text-dim">${val}</span>` : val);
                }).join('');

                const activeBuffs = Object.values(instData.activeBuffs);
                const teamSlots = typeof RosterState !== 'undefined' && RosterState.team ? RosterState.team : [{}, {}, {}];

                const providerColumnsHTML = teamSlots.map((slot, i) => {
                    const unitName = slot.character || `Slot ${i + 1}`;
                    const unitBuffs = activeBuffs.filter(b => b.provider === unitName || (b.source && b.source.includes(unitName)));

                    const wepName = slot.weapon ? slot.weapon.trim() : "";
                    const mainSet = slot.mainSet ? slot.mainSet.trim() : "";
                    const subSet = slot.subSet ? slot.subSet.trim() : "";
                    const mainEcho = slot.mainEcho ? slot.mainEcho.trim() : "";

                    const groupedBuffs = {};

                    unitBuffs.forEach(b => {
                        let sourceMech = (b.source || "System").replace(/_/g, ' ').trim();
                        let cardHeader = sourceMech;
                        const lowerSource = sourceMech.toLowerCase();

                        if (wepName && lowerSource.includes(wepName.toLowerCase())) {
                            cardHeader = wepName;
                        } else if (typeof WEAPON_DB !== 'undefined') {
                            const matchedWep = Object.keys(WEAPON_DB).find(w => lowerSource.startsWith(w.toLowerCase()));
                            if (matchedWep) cardHeader = matchedWep;
                        }

                        const isSetEffect = lowerSource.includes("2-pc") || lowerSource.includes("3-pc") || lowerSource.includes("5-pc") || 
                                            lowerSource.includes("2 pc") || lowerSource.includes("3 pc") || lowerSource.includes("5 pc");
                        const isMainEcho = mainEcho && (
                            lowerSource.includes(mainEcho.toLowerCase()) || 
                            (b.name && b.name.toLowerCase().includes(mainEcho.toLowerCase()))
                        );

                        if (isSetEffect) {
                            const lowerEffName = (b.name || "").toLowerCase();
                            if (subSet && (lowerSource.includes(subSet.toLowerCase()) || lowerEffName.includes(subSet.toLowerCase()))) {
                                cardHeader = subSet;
                            } else if (mainSet && (lowerSource.includes(mainSet.toLowerCase()) || lowerEffName.includes(mainSet.toLowerCase()))) {
                                cardHeader = mainSet;
                            } else {
                                const is3Pc = lowerSource.includes("3-pc") || lowerSource.includes("3 pc") || lowerEffName.includes("3-pc");
                                const is2Pc = lowerSource.includes("2-pc") || lowerSource.includes("2 pc") || lowerEffName.includes("2-pc");
                                if (is3Pc) {
                                    cardHeader = mainSet || "3-pc Set";
                                } else if (is2Pc && subSet) {
                                    cardHeader = subSet;
                                } else if (mainSet) {
                                    cardHeader = mainSet;
                                }
                            }
                        } else if (isMainEcho) {
                            cardHeader = mainSet || mainEcho;
                        }

                        if (!groupedBuffs[cardHeader]) {
                            groupedBuffs[cardHeader] = { effects: [] };
                        }

                        let displayVal = b.value !== undefined ? b.value : "-";
                        if (typeof b.value === 'number' && b.value > 0 && b.value < 1) {
                            displayVal = +(b.value * 100).toFixed(2) + "%";
                        }

                        const tokenize = (str) => (str || "")
                            .toLowerCase()
                            .replace(/_/g, ' ')
                            .replace(/\bs([1-6])\b/g, 'sequence $1')
                            .replace(/\bseq\b/g, 'sequence')
                            .replace(/[^a-z0-9\s]/g, ' ')
                            .split(/\s+/)
                            .filter(Boolean);

                        const noiseWords = new Set([
                            "buff", "effect", "slot", "main", "stat", "bonus", "amp", "tier",
                            "team", "self", "next", "active", "enemy", "others", "all", "group"
                        ]);

                        const knownWords = new Set([
                            ...tokenize(cardHeader),
                            ...tokenize(unitName),
                            ...tokenize(b.stat),
                            ...noiseWords
                        ]);

                        let rawEffName = (b.name || sourceMech).replace(/_/g, ' ').trim();
                        if (unitName) {
                            const unitRegex = new RegExp(`^${unitName.replace(/[^a-zA-Z0-9]/g, '\\$&')}\\s*[-:_]?\\s*`, 'i');
                            rawEffName = rawEffName.replace(unitRegex, '').trim();
                        }

                        let cleanEffName = rawEffName;
                        if (cardHeader && cardHeader.toLowerCase() !== rawEffName.toLowerCase()) {
                            const headerRegex = new RegExp(`\\b${cardHeader.replace(/[^a-zA-Z0-9]/g, '\\$&')}\\b`, 'gi');
                            cleanEffName = cleanEffName.replace(headerRegex, '').trim();
                        }
                        cleanEffName = cleanEffName.replace(/^[-:_:=]+\s*/, '').replace(/\s*[-:_:=]+$/, '').trim();

                        let displayEffName = cleanEffName;
                        if (b.stat) {
                            const statTokens = tokenize(b.stat);
                            statTokens.forEach(st => {
                                if (st.length > 1) {
                                    const stRegex = new RegExp(`\\b${st.replace(/[^a-zA-Z0-9]/g, '\\$&')}\\b`, 'gi');
                                    displayEffName = displayEffName.replace(stRegex, '').trim();
                                }
                            });
                        }
                        displayEffName = displayEffName.replace(/^[-:_:=]+\s*/, '').replace(/\s*[-:_:=]+$/, '').trim();

                        const effTokens = tokenize(cleanEffName);
                        const uniqueTokens = effTokens.filter(w => !knownWords.has(w));
                        const isRedundant = uniqueTokens.length === 0 || !displayEffName;

                        let rowLabel = "";
                        if (isRedundant) {
                            rowLabel = b.stat || cleanEffName || rawEffName || "Effect";
                        } else {
                            rowLabel = b.stat ? `${displayEffName} (${b.stat})` : displayEffName;
                        }

                        groupedBuffs[cardHeader].effects.push({
                            label: rowLabel,
                            value: displayVal,
                            stacks: b.stacks || 1
                        });
                    });

                    const cardsHTML = Object.keys(groupedBuffs).length > 0 ? Object.keys(groupedBuffs).map(source => {
                        const group = groupedBuffs[source];
                        return Templates.Rotation.createBuffCard(source, group.effects);
                    }).join('') : `<div class="empty-buff-state">No buffs</div>`;

                    return `<div class="buff-provider-col"><div class="buff-provider-header">${unitName}</div><div class="buff-list-container">${cardsHTML}</div></div>`;
                }).join('');

                const formulaHTML = Templates.Rotation.createFormulaRow(instData.calcBreakdown);

                return `
                <div class="dmg-accordion-section ${inst.isOpen ? 'is-open' : ''}">
                    <div class="dmg-accordion-header" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                        <div class="flex-row align-center gap-sm">
                            <svg class="dmg-accordion-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
                            <span class="dmg-accordion-title">${inst.title}</span>
                        </div>
                        <div class="dmg-accordion-breakdown-values flex-row align-center" style="gap: 12px; margin-left: auto;">
                            <div class="flex-row align-center" style="padding-right: 12px; border-right: 1px solid rgba(255, 255, 255, 0.15); gap: 6px;">
                                <span class="text-dim" style="font-size: 0.7rem; font-weight: 600; letter-spacing: 0.5px;">NON-CRIT</span>
                                <span style="color: #ccc; font-size: 0.85rem; font-weight: 700;">${Math.floor(nonCritVal).toLocaleString()}</span>
                            </div>
                            <div class="flex-row align-center" style="padding-right: 12px; border-right: 1px solid rgba(255, 255, 255, 0.15); gap: 6px;">
                                <span class="text-dim" style="font-size: 0.7rem; font-weight: 600; letter-spacing: 0.5px;">CRIT</span>
                                <span style="color: #e2c044; font-size: 0.85rem; font-weight: 700;">${Math.floor(critVal).toLocaleString()}</span>
                            </div>
                            <div class="flex-row align-center" style="gap: 6px;">
                                <span class="text-dim" style="font-size: 0.7rem; font-weight: 600; letter-spacing: 0.5px;">AVG</span>
                                <span style="color: #ffaa00; font-size: 0.85rem; font-weight: 700;">${Math.floor(avgVal).toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                    <div class="dmg-accordion-body">
                        <div class="panel-content-grid dmg-panel-top-row">${tagsHTML}</div>
                        ${formulaHTML}
                        <div class="dmg-panel-main-grid">
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

        renderOffsetPanel(data) {
            const reasonsHTML = (data.offsetReasons && data.offsetReasons.length > 0)
                ? data.offsetReasons.map((r, i, arr) => {
                    const isLast = i === arr.length - 1;
                    return `
                    <div class="buff-effect-row" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; ${!isLast ? 'margin-bottom: 8px;' : ''}">
                        <div class="buff-label-wrap" style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; overflow: hidden;">
                            <svg class="buff-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0; width: 14px; height: 14px;">
                                <polyline points="15 10 20 15 15 20"></polyline>
                                <path d="M4 4v7a4 4 0 0 0 4 4h12"></path>
                            </svg>
                            <span class="buff-effect-label" style="flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${r.label}">${r.label}:</span>
                        </div>
                        <div class="buff-value-wrap" style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                            <span class="buff-val-box text-bold ${r.isNegative ? 'text-main' : (r.value === '0.00s' ? 'text-dim' : 'text-gold')}">${r.value}</span>
                        </div>
                    </div>`;
                }).join('')
                : `<div class="empty-buff-state" style="padding: 12px;">Standard Execution (No Offset)</div>`;

            const offsetVal = data.offset || 0;
            const offsetStr = (offsetVal > 0 ? "+" : "") + offsetVal.toFixed(2) + "s";
            const offsetClass = offsetVal > 0 ? "text-gold" : (offsetVal < 0 ? "text-main" : "text-dim");

            return `
                <div class="panel-header-main">Offset Breakdown</div>
                <div class="panel-content-grid" style="grid-template-columns: 1fr; margin-bottom: 16px;">
                    <div class="panel-info-item" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px;">
                        <span class="panel-info-label" style="margin-bottom: 0;">Total Offset</span>
                        <span class="panel-info-value ${offsetClass} text-bold" style="font-size: 1rem;">${offsetStr}</span>
                    </div>
                </div>
                <div class="panel-header-tiny" style="margin-bottom: 8px;">Offset Sources</div>
                <div class="buff-card" style="padding: 12px;">
                    ${reasonsHTML}
                </div>
            `;
        }
    },

    // =========================================
    //   3. MECHANICS BUILDER TEMPLATES
    // =========================================
    Builder: {
        generateTagHTML(val, label, extra = '') {
            return `<div class="type-tag" ${extra} data-val='${val}'><span>${label}</span><button class="type-tag-remove"> </button></div>`;
        },

        generateGroupWrapper(title, fieldsHTML) {
            return `
            <div class="node-section mb-sm" style="background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px; overflow: hidden;">
                <div class="node-section-title text-gold" style="padding: 6px 12px; border-bottom: 1px solid var(--border); background: rgba(0,0,0,0.2); font-weight: bold; text-transform: uppercase; font-size: 0.8rem;">${title}</div>
                <div class="form-row" style="flex-wrap: wrap; padding: 12px;">
                    ${fieldsHTML}
                </div>
            </div>`;
        },

        generateEffectInputsHTML(type) {
            const dbC = (typeof CHARACTER_DB !== 'undefined' && BuilderState.activeChar && CHARACTER_DB[BuilderState.activeChar]) ? CHARACTER_DB[BuilderState.activeChar] : {};
            const c = dbC.forteCount || 1;
            let forteOpts = ``;
            for (let i = 1; i <= c; i++) forteOpts += `<option value="forte${i}">Forte ${i}</option>`;

            const makeInput = (cls, label, placeholder, val = '', inputType = 'text', step = '') => `
                <div class="form-group flex-1" style="min-width: 90px; margin: 0;">
                    <label class="form-label text-dim">${label}</label>
                    <div class="relative w-100 m-0 p-0">
                        <input type="${inputType}" ${step ? `step="${step}"` : ''} class="form-input ${cls} w-100" placeholder="${placeholder}" value="${val}">
                    </div>
                </div>
            `;
            const makeSelect = (cls, label, optionsHTML) => `
                <div class="form-group flex-1" style="min-width: 100px; margin: 0;">
                    <label class="form-label text-dim">${label}</label>
                    <select class="base-select ${cls} w-100">${optionsHTML}</select>
                </div>
            `;
            const makeCheckbox = (cls, label) => `
                <div class="form-group flex-1" style="min-width: 130px; margin: 0;">
                    <label class="form-label text-dim" style="opacity:0; margin-bottom:2px; height: 14px;">_</label>
                    <div class="relative w-100 m-0 p-0">
                        <label class="toolbar-toggle-label w-100" style="margin: 0; height: 32px; display: flex; align-items: center; justify-content: center; box-sizing: border-box;">
                            <input type="checkbox" class="${cls}"> <span>${label}</span>
                        </label>
                    </div>
                </div>
            `;

            let html = '';
            if (type === 'buff') html = `
                <div class="flex-row w-100 gap-sm m-0">
                    ${makeInput('eff-name dsl-input', 'Effect ID', 'e.g. Fusion Burst')}
                    ${makeInput('eff-target dsl-input', 'Target Entity', '', '@Self')}
                    ${makeInput('eff-apply-to dsl-input', 'Limit to Tags', 'e.g. Skill, Heavy')}
                </div>
                <div class="flex-row w-100 gap-sm m-0">
                    ${makeInput('eff-stat dsl-input', 'Stat Modifier', 'e.g. reduceDef')}
                    ${makeInput('eff-val dsl-input', 'Stat Value', 'e.g. 5% or 0.2')}
                    ${makeInput('eff-stacks', 'Stacks Applied', '1', '1', 'number', '1')}
                    ${makeInput('eff-max', 'Max Stacks Cap', 'Limit', '', 'number', '1')}
                </div>
                <div class="flex-row w-100 gap-sm m-0">
                    ${makeInput('eff-dur', 'Duration (s)', 'Time', '', 'number', '0.1')}
                    ${makeSelect('eff-stack-beh', 'Stack Logic', '<option value="resettable">Refresh Timers</option><option value="separate">Separate Timers</option>')}
                    ${makeSelect('eff-exp-beh', 'On Expiration', '<option value="clear">Clear All</option><option value="drop_one">Drop 1 Stack</option><option value="drop_half">Drop Half</option>')}
                    ${makeCheckbox('eff-rem-swap', 'Clear on Swap')}
                </div>
            `;
            else if (type === 'buffAction') html = `
                <div class="flex-row w-100 gap-sm m-0">
                    ${makeInput('eff-name dsl-input', 'Target Effect ID', 'e.g. Fusion Burst')}
                    ${makeInput('eff-target dsl-input', 'Target Entity', '', '@Self')}
                </div>
                <div class="flex-row w-100 gap-sm m-0">
                    ${makeSelect('eff-action', 'Action Type', '<option value="remove">Remove / Consume</option><option value="pause">Pause Timer</option><option value="resume">Resume Timer</option><option value="extend">Extend Time</option>')}
                    ${makeInput('eff-val', 'Action Value', 'ALL, HALF, or Num')}
                </div>
            `;
            else if (type === 'tracker') html = `
                <div class="flex-row w-100 gap-sm m-0">
                    ${makeInput('eff-name dsl-input', 'Tracker ID', 'e.g. Bullets')}
                    ${makeSelect('eff-action', 'Action Type', '<option value="add">Add (+/-)</option><option value="set">Set (=)</option><option value="consume">Consume (Zero)</option><option value="detonate">Detonate</option>')}
                </div>
                <div class="flex-row w-100 gap-sm m-0">
                    ${makeInput('eff-val dsl-input', 'Tracker Value', 'Amount')}
                    ${makeInput('eff-tracker-max', 'Max Stacks Cap', 'Limit', '', 'number', '1')}
                </div>
            `;
            else if (type === 'resource') html = `
                <div class="flex-row w-100 gap-sm m-0">
                    ${makeSelect('eff-name', 'Resource Type', '<option value="energy">Energy</option><option value="concerto">Concerto</option>' + forteOpts + '<option value="tune">Tune</option>')}
                    ${makeInput('eff-val dsl-input', 'Resource Value', 'Amount (e.g. 10 or -5)')}
                </div>
            `;
            else if (type === 'time_scale') html = `
                <div class="flex-row w-100 gap-sm m-0">
                    ${makeInput('eff-name dsl-input', 'Timer / Buff ID', 'Specific ID or ALL')}
                    ${makeInput('eff-target dsl-input', 'Target Entity', '', '@Self')}
                </div>
                <div class="flex-row w-100 gap-sm m-0">
                    ${makeInput('eff-val', 'Time Speed / Scale', '-50% (Fast) / 50% (Slow)')}
                    ${makeInput('eff-dur', 'Duration (s)', 'Time', '', 'number', '0.1')}
                </div>
            `;
            return `<div style="display: flex; flex-direction: column; gap: 8px; width: 100%;">${html}</div>`;
        },

        generateNodeCardHTML(data, nodeID, providerStr, nameStr) {
            const castResObj = data.castResources || {};
            const holdCfg = data.holdConfig || {};
            const renderResTags = (obj, tStr) => Object.entries(obj).map(([key, val]) => {
                const dVal = Array.isArray(val) ? `[${val.map(v => v > 0 ? '+' + v : v).join(', ')}]` : (val > 0 ? '+' + val : val);
                return Templates.Builder.generateTagHTML(BuilderRenderer.escapeJSON(val), `[${tStr.toUpperCase()}] ${key}: ${dVal}`, `data-key="${key}" data-timing="${tStr}"`);
            }).join('');

            const dbC = (typeof CHARACTER_DB !== 'undefined' && BuilderState.activeChar && CHARACTER_DB[BuilderState.activeChar]) ? CHARACTER_DB[BuilderState.activeChar] : {};
            const c = dbC.forteCount || 1;
            let forteOpts = ``;
            for (let i = 1; i <= c; i++) forteOpts += `<option value="forte${i}">Forte ${i}</option>`;

            const chevronIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
            const closeIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

            return `
                <div class="mechanic-card-header collapsible-header">
                    <div class="flex-row gap-sm align-center" style="pointer-events: none;">
                        <span class="collapse-icon">${chevronIcon}</span>
                        <span class="mech-banner-name">${nameStr || 'New Mechanic'}</span>
                    </div>
                    <button class="base-btn icon-btn remove-node-btn btn-danger icon-btn-sm" title="Delete Node">${closeIcon}</button>
                </div>
                <div class="node-section">
                    <div class="node-section-title collapsible-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Identity</span><span class="collapse-icon">${chevronIcon}</span>
                    </div>
                    <div class="section-content">
                        <div class="form-row">
                            <div class="form-group flex-05"><label class="form-label">Provider</label><input type="text" class="form-input mech-provider" value="${providerStr}"></div>
                            <div class="form-group"><label class="form-label">Display Name</label><input type="text" class="form-input mech-name" value="${nameStr}"></div>
                            <div class="form-group"><label class="form-label text-accent">ID (Read-Only)</label><input type="text" class="form-input mech-id input-readonly" value="${nodeID}" readonly></div>
                        </div>
                        <div class="form-row flags-row m-0 mt-4px">
                            <label class="checkbox-label"><input type="checkbox" class="mech-is-passive" ${data.isPassive ? "checked" : ""}><span>Is Passive</span></label>
                            <label class="checkbox-label" style="margin-left: 12px;"><input type="checkbox" class="mech-is-swap-in" ${data.isSwapInDefault ? "checked" : ""}><span>Default Swap-In</span></label>
                        </div>
                    </div>
                </div>
                <div class="node-section section-combat">
                    <div class="node-section-title collapsible-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Combat Stats</span><span class="collapse-icon">${chevronIcon}</span>
                    </div>
                    <div class="section-content">
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">Cast Types</label>
                                <div class="type-tag-container mech-cast-container">${(data.castTypes || []).map(t => Templates.Builder.generateTagHTML(t, t)).join('')}</div>
                                <div class="flex-row gap-sm mt-4px">
                                    <select class="base-select add-cast-select flex-1">${BuilderState.CAST_OPTIONS.map(o => `<option value="${o}">${o}</option>`).join('')}</select>
                                    <button class="base-btn icon-btn add-cast-btn icon-btn-sm">+</button>
                                </div>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Damage Types</label>
                                <div class="type-tag-container mech-dmg-container">${(data.dmgTypes || []).map(t => Templates.Builder.generateTagHTML(t, t)).join('')}</div>
                                <div class="flex-row gap-sm mt-4px">
                                    <select class="base-select add-dmg-select flex-1">${BuilderState.DMG_OPTIONS.map(o => `<option value="${o}">${o}</option>`).join('')}</select>
                                    <button class="base-btn icon-btn add-dmg-btn icon-btn-sm">+</button>
                                </div>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group flex-05">
                                <label class="form-label">Scalar Stat</label>
                                <select class="base-select mech-scalar">
                                    <option value="" ${!data.scalar ? 'selected' : ''}>None</option>
                                    <option value="ATK" ${data.scalar === 'ATK' ? 'selected' : ''}>ATK</option>
                                    <option value="DEF" ${data.scalar === 'DEF' ? 'selected' : ''}>DEF</option>
                                    <option value="HP" ${data.scalar === 'HP' ? 'selected' : ''}>HP</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Multiplier String</label>
                                <input type="text" class="form-input mech-mult" value='${data.hitMults && data.hitMults.length > 0 ? JSON.stringify(data.hitMults) : ""}' placeholder="e.g. 150% or [50%, 100%]">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group flex-1">
                                <label class="form-label">Resources</label>
                                <div class="type-tag-container mech-res-container">${renderResTags(castResObj, 'cast')}${renderResTags(data.hitResources || {}, 'hit')}</div>
                                <div class="flex-row gap-sm mt-4px">
                                    <select class="base-select add-res-timing w-100px"><option value="cast">On Cast</option><option value="hit">Per Hit</option></select>
                                    <select class="base-select add-res-type w-110px"><option value="energy">Energy</option><option value="concerto">Concerto</option>${forteOpts}<option value="tune">Tune</option></select>
                                    <input type="text" class="form-input add-res-amt flex-1" placeholder="e.g. 10, -5">
                                    <button class="base-btn icon-btn add-res-btn icon-btn-sm">+</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="node-section section-physics">
                    <div class="node-section-title collapsible-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Priority & Physics</span><span class="collapse-icon">${chevronIcon}</span>
                    </div>
                    <div class="section-content">
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">Input Binding</label>
                                <select class="base-select mech-input">
                                    <option value="" ${!data.input ? 'selected' : ''}>None</option>
                                    <option value="Basic" ${data.input === 'Basic' ? 'selected' : ''}>Basic</option>
                                    <option value="Skill" ${data.input === 'Skill' ? 'selected' : ''}>Skill</option>
                                    <option value="Jump" ${data.input === 'Jump' ? 'selected' : ''}>Jump</option>
                                    <option value="Dodge" ${data.input === 'Dodge' ? 'selected' : ''}>Dodge</option>
                                    <option value="Liberation" ${data.input === 'Liberation' ? 'selected' : ''}>Liberation</option>
                                    <option value="Utility" ${data.input === 'Utility' ? 'selected' : ''}>Utility</option>
                                    <option value="Echo" ${data.input === 'Echo' ? 'selected' : ''}>Echo</option>
                                </select>
                            </div>
                            <div class="form-group"><label class="form-label">Input Type</label><select class="base-select mech-input-type"><option value="Press" ${(!data.inputType || data.inputType === 'Press') ? 'selected' : ''}>Press</option><option value="Hold" ${data.inputType === 'Hold' ? 'selected' : ''}>Hold</option><option value="Release" ${data.inputType === 'Release' ? 'selected' : ''}>Release</option></select></div>
                            <div class="form-group"><label class="form-label">Priority</label><input type="text" class="form-input dsl-input mech-priority w-100" value="${data.priority ?? 0}" placeholder="@Default.basicPriority"></div>
                            <div class="form-group relative"><label class="form-label">Combo Window</label><input type="text" class="form-input dsl-input mech-combo-win w-100" value="${data.comboWindow ?? ""}" placeholder="@Default.ComboWindow"></div>
                        </div>
                        <div class="form-row">
                            <div class="form-group"><label class="form-label">Stance Required</label><select class="base-select mech-stance-req"><option value="Any" ${(!data.stanceReq || data.stanceReq === 'Any') ? 'selected' : ''}>Any</option><option value="Grounded" ${data.stanceReq === 'Grounded' ? 'selected' : ''}>Grounded</option><option value="Midair" ${data.stanceReq === 'Midair' ? 'selected' : ''}>Midair</option></select></div>
                            <div class="form-group"><label class="form-label">Stance Result</label><select class="base-select mech-stance-res"><option value="Retain" ${(!data.stanceResult || data.stanceResult === 'Retain') ? 'selected' : ''}>Retain</option><option value="Grounded" ${data.stanceResult === 'Grounded' ? 'selected' : ''}>Grounded</option><option value="Midair" ${data.stanceResult === 'Midair' ? 'selected' : ''}>Midair</option></select></div>
                            <div class="form-group relative"><label class="form-label">Transition Time</label><input type="text" class="form-input dsl-input mech-stance-time w-100" value="${data.stanceTime ?? ""}" placeholder="0.0"></div>
                        </div>
                    </div>
                </div>
                <div class="form-row hold-config-row mt-sm" style="display: none; background: rgba(212,175,55,0.05); padding: 8px; border: 1px solid rgba(212,175,55,0.2); border-radius: 4px; flex-direction: column; gap: 8px;">
                    <div class="w-100 text-gold text-bold" style="font-size: 0.8rem;">Hold Physics Configuration</div>
                    <div class="flex-row gap-sm w-100 flex-wrap">
                        <div class="form-group flex-1">
                            <label class="form-label">Cursor Mode</label>
                            <select class="base-select mech-hold-mode">
                                <option value="pingpong" ${holdCfg.cursorMode === 'pingpong' ? 'selected' : ''}>Ping-Pong</option>
                                <option value="clamp" ${holdCfg.cursorMode === 'clamp' ? 'selected' : ''}>Clamp</option>
                                <option value="loop" ${holdCfg.cursorMode === 'loop' ? 'selected' : ''}>Loop</option>
                            </select>
                        </div>
                        <div class="form-group flex-1"><label class="form-label">Speed</label><input type="number" class="form-input mech-hold-speed" value="${holdCfg.cursorSpeed ?? 100}"></div>
                        <div class="form-group flex-1"><label class="form-label">Max Value</label><input type="number" class="form-input mech-hold-max" value="${holdCfg.maxCursorVal ?? 100}"></div>
                        <label class="checkbox-label align-self-end" style="height: 32px; display: flex; align-items: center;"><input type="checkbox" class="mech-hold-retain" ${holdCfg.retainCursor ? 'checked' : ''}><span>Retain Cursor</span></label>
                    </div>
                    <div class="flex-row gap-sm w-100">
                        <div class="form-group relative flex-1"><label class="form-label">Window Center (DSL)</label><input type="text" class="form-input dsl-input mech-hold-center w-100" value="${holdCfg.windowCenter ?? '65'}" placeholder="e.g. 65"></div>
                        <div class="form-group relative flex-1"><label class="form-label">Window Size (DSL)</label><input type="text" class="form-input dsl-input mech-hold-size w-100" value="${holdCfg.windowSize ?? '10'}" placeholder="e.g. 10"></div>
                    </div>
                </div>
                <div class="node-section section-timeline">
                    <div class="node-section-title collapsible-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Timeline Logic</span><span class="collapse-icon">${chevronIcon}</span>
                    </div>
                    <div class="section-content">
                        <div class="form-row">
                            <div class="form-group relative flex-1">
                                <label class="form-label">Trigger Rule (DSL)</label>
                                <input type="text" class="form-input dsl-input mech-rule w-100" value="${data.triggerRule || ""}" placeholder="e.g. IF (@Self.Energy > 50)">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group relative"><label class="form-label">Action Duration</label><input type="text" class="form-input dsl-input mech-dur w-100" value="${data.actionDuration ?? ""}" placeholder="e.g. 1.2"></div>
                            <div class="form-group">
                                <label class="form-label split-label">
                                    <span>DMG Start</span><span>/</span><span>End Time</span>
                                </label>
                                <div class="timeframe-split-box">
                                    <div class="relative flex-1"><input type="text" class="form-input dsl-input mech-dmgstart w-100" value="${data.damageTimeframe?.start ?? ""}" placeholder="0.2"></div>
                                    <div class="relative flex-1"><input type="text" class="form-input dsl-input mech-dmgend w-100" value="${data.damageTimeframe?.end ?? ""}" placeholder="0.8"></div>
                                </div>
                            </div>
                            <div class="form-group relative"><label class="form-label">Freeze Time</label><input type="text" class="form-input dsl-input mech-freeze w-100" value="${data.freezeTime ?? ""}" placeholder="e.g. 0.5"></div>
                            <div class="form-group relative"><label class="form-label">Swap Time</label><input type="text" class="form-input dsl-input mech-swap w-100" value="${data.swapTiming ?? ""}" placeholder="e.g. @Default.SwapTime"></div>
                            <div class="form-group relative"><label class="form-label">Cooldown</label><input type="text" class="form-input dsl-input mech-cd w-100" value="${data.cooldown ?? ""}" placeholder="e.g. 12.0"></div>
                        </div>
                        <div class="form-row">
                            <div class="form-group flex-1">
                                <label class="form-label">Cancel Timings</label>
                                <div class="type-tag-container mech-cancels-container">${(data.cancelTimings || []).map(ct => Templates.Builder.generateTagHTML(BuilderRenderer.escapeJSON(ct), `${ct.time}s${ct.hits ? ` | Hits: ${ct.hits}` : ''}${ct.triggerRule ? ` | Rule: ${ct.triggerRule}` : ''}`)).join('')}</div>
                                <div class="flex-row gap-sm mt-4px">
                                    <input type="number" step="0.01" class="form-input add-cancel-time w-80px" placeholder="0.3">
                                    <input type="number" step="1" class="form-input add-cancel-hits w-120px" placeholder="Hits (opt)">
                                    <div class="relative flex-1 m-0"><input type="text" class="form-input dsl-input add-cancel-rule w-100" placeholder="Rule (opt)"></div>
                                    <button class="base-btn icon-btn add-cancel-btn icon-btn-sm">+</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="node-section section-effects">
                    <div class="node-section-title text-gold collapsible-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Effects Array</span><span class="collapse-icon">${chevronIcon}</span>
                    </div>
                    <div class="section-content">
                        <div class="form-row">
                            <div class="form-group flex-1 m-0">
                                <div class="type-tag-container mech-effects-container mb-4px">${(Array.isArray(data.effects) ? data.effects : []).map(eff => {
                                    let lbl = eff.type ? eff.type.toUpperCase() : 'EFFECT';
                                    if (eff.name) lbl += ` | ${eff.name}`;
                                    if (eff.action) lbl += ` | Action: ${eff.action}`;
                                    else if (eff.stat) lbl += ` | ${eff.stat}: ${eff.value !== undefined ? eff.value : ''}`;
                                    else if (eff.value !== undefined) lbl += ` | Value: ${typeof eff.value === 'object' ? '{...}' : eff.value}`;
                                    if (eff.stacks !== undefined && eff.stacks > 1) lbl += ` | Stacks: ${eff.stacks}`;
                                    if (eff.duration) lbl += ` | Dur: ${eff.duration}s`;
                                    if (eff.maxStacks !== undefined) lbl += ` | Max: ${eff.maxStacks}`;
                                    if (eff.stackBehavior === "separate") lbl += ` | Separate`;
                                    if (eff.expireBehavior && eff.expireBehavior !== "clear") lbl += ` | ${eff.expireBehavior}`;
                                    if (eff.target && eff.target !== '@Self') lbl += ` | Target: ${eff.target}`;
                                    if (eff.applyTo) lbl += ` | Req: ${Array.isArray(eff.applyTo) ? eff.applyTo.join(', ') : eff.applyTo}`;
                                    if (eff.removeOnSwap) lbl += ` | Clr on Swap`;
                                    return Templates.Builder.generateTagHTML(BuilderRenderer.escapeJSON(eff), lbl);
                                }).join('')}</div>
                                <div class="flex-row gap-sm mt-4px align-start">
                                    <select class="base-select add-effect-type w-105px">
                                        <option value="buff">Buff</option>
                                        <option value="buffAction">Buff Control</option>
                                        <option value="resource">Resource</option>
                                        <option value="tracker">Tracker</option>
                                        <option value="time_scale">Time Scale</option>
                                    </select>
                                    <div class="flex-row gap-sm eff-dynamic-fields flex-1 flex-wrap">${Templates.Builder.generateEffectInputsHTML('buff')}</div>
                                    <button class="base-btn icon-btn add-effect-btn icon-btn-sm align-self-start">+</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
    }
};

// Backward compatibility bridge
const UIComponents = Templates.Roster;