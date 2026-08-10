// =========================================
//   ROSTER RENDERER (View Layer)
//   Strictly handles updating DOM attributes based on RosterState
// =========================================

const RosterRenderer = {
    renderAll: () => {
        RosterState.team.forEach(slot => RosterRenderer.updateSlotVisuals(slot));
        RosterUtils.updateHeaderPreview();
    },

    generateCharCardHTML: () => UIComponents.generateCharCardHTML(),
    generateEchoesHTML: () => UIComponents.generateEchoesHTML(),
    getCurrentTeamOptionsHTML: () => UIComponents.getCurrentTeamOptionsHTML(),
    updateHeaderPreview: () => {
        const container = document.getElementById('header-team-preview');
        UIComponents.updateHeaderPreview(container);
    },

    renderIdleStats: () => {
        const container = document.getElementById('idle-stats-container');
        if (!container) return;

        let html = '';
        RosterState.team.forEach((slot, i) => {
            if (!slot.character) {
                html += `<div class="idle-stat-card opacity-0" style="pointer-events:none;"></div>`;
                return;
            }
            
            const stats = RosterUtils.calculateIdleStats(i);
            const dbUnit = typeof CHARACTER_DB !== 'undefined' ? CHARACTER_DB[slot.character] || {} : {};
            const eleName = dbUnit.element || 'Element';
            const eleKey = eleName.toLowerCase() + 'DmgBonus';
            const eleVal = stats[eleKey] || 0;

            const renderRow = (lbl, val, suffix='') => `
                <div class="stat-row-display">
                    <span class="text-dim">${lbl}</span><span class="stat-val">${val}${suffix}</span>
                </div>`;

            // Interleaved perfectly to match the 2-column CSS Grid layout from the game
            html += `
            <div class="idle-stat-card">
                <div class="idle-stat-header"><span>${slot.character}</span><span class="text-dim text-xs" style="font-weight:normal;">Idle Stats</span></div>
                <div class="idle-stat-grid">
                    ${renderRow('HP', Math.floor(stats.hp))}
                    ${renderRow('Res. Skill DMG', stats.skillDmgBonus.toFixed(1), '%')}
                    ${renderRow('ATK', Math.floor(stats.atk))}
                    ${renderRow('Basic Attack DMG', stats.basicDmgBonus.toFixed(1), '%')}
                    ${renderRow('DEF', Math.floor(stats.def))}
                    ${renderRow('Heavy Attack DMG', stats.heavyDmgBonus.toFixed(1), '%')}
                    ${renderRow('Energy Regen', stats.energyRegen.toFixed(1), '%')}
                    ${renderRow('Res. Liberation DMG', stats.libDmgBonus.toFixed(1), '%')}
                    ${renderRow('Crit. Rate', stats.critRate.toFixed(1), '%')}
                    ${renderRow(eleName + ' DMG Bonus', eleVal.toFixed(1), '%')}
                    ${renderRow('Crit. DMG', stats.critDamage.toFixed(1), '%')}
                    ${renderRow('Healing Bonus', stats.healingBonus.toFixed(1), '%')}
                </div>
            </div>`;
        });

        // Attach Enemy Form
        html += `
        <div class="idle-stat-card enemy-stat-card" style="min-width: 200px; flex: 0.5;">
            <div class="idle-stat-header"><span style="color:#ff5555;">Enemy Target</span></div>
            <div class="idle-stat-grid" style="display:flex; flex-direction:column; gap:12px; margin-top: 8px;">
                <div class="stat-row-display">
                    <span class="text-dim">Level</span>
                    <input type="number" class="num-input enemy-level-input" value="${RosterState.enemy.level}" style="width: 50px; background: #222; border: 1px solid #555; border-radius:3px; font-size:0.85rem; padding: 2px 4px; color: #ff9999;">
                </div>
                <div class="stat-row-display">
                    <span class="text-dim">Base RES</span>
                    <div style="display:flex; align-items:center;">
                        <input type="number" class="num-input enemy-res-input" value="${RosterState.enemy.res}" style="width: 50px; background: #222; border: 1px solid #555; border-radius:3px; font-size:0.85rem; padding: 2px 4px; color: #ff9999;">
                        <span class="text-dim ml-sm" style="margin-left:4px;">%</span>
                    </div>
                </div>
                
                <div class="stat-row-display">
                    <span class="text-dim">Max HP</span>
                    <input type="number" class="num-input enemy-hp-input" value="${RosterState.enemy.hp}" style="width: 80px; background: #222; border: 1px solid #555; border-radius:3px; font-size:0.85rem; padding: 2px 4px; color: #ff9999;">
                </div>
                
                <div class="text-dim text-xs" style="margin-top:auto; font-style:italic;">These default stats apply to all damage calculations.</div>
            </div>
        </div>`;

        container.innerHTML = html;
    },

    // Orchestrator method for a single character slot
    updateSlotVisuals: (slot) => {
        const row = slot.domRef;
        if (!row) return;

        RosterRenderer._updateCharacter(row, slot);
        RosterRenderer._updateWeapon(row, slot);
        RosterRenderer._updateSets(row, slot);
        RosterRenderer._updateEchoes(row, slot);

        row.querySelectorAll('.base-select').forEach(CommonUtils.updatePlaceholderStyle);
        
        // --- NEW: Trigger Idle Stats refresh whenever the UI changes ---
        if (typeof RosterRenderer.renderIdleStats === 'function') RosterRenderer.renderIdleStats();
        
        // --- FIXED: Force the Header Preview to update since programmatic script changes don't fire DOM 'change' events ---
        if (typeof RosterUtils.updateHeaderPreview === 'function') RosterUtils.updateHeaderPreview();
    },

    _updateCharacter: (row, slot) => {
        const charSel = row.querySelector('.char-select');
        const seqInput = row.querySelector('.seq-input');
        const modeSel = row.querySelector('.mode-select');

        // Sync basic inputs
        if(charSel.value !== slot.character) charSel.value = slot.character;
        if(seqInput.value != slot.sequence) seqInput.value = slot.sequence;
        
        // Show/Hide specific mode drop downs depending on character mechanics
        if (CHARS_WITH_MODES.includes(slot.character)){
            row.classList.add('has-mode');
            if(modeSel.value !== slot.mode) modeSel.value = slot.mode;
        } else {
            row.classList.remove('has-mode');
        }
        CommonUtils.updateImage(row, '.char-img', '.char-text', 'Characters', slot.character);
    },

    _updateWeapon: (row, slot) => {
        const wepSel = row.querySelector('.wep-select');
        const rankInput = row.querySelector('.rank-input');

        if (slot.character) {
            // Dynamically fetch valid weapons based on character type
            const charData = CHARACTER_DB[slot.character] || {};
            const weapons = WEAPONS_BY_TYPE[charData.weaponType] || [];
            
            // --- FIXED: Rebuild if disabled, empty, or the weapon type has changed! ---
            if (wepSel.disabled || wepSel.options.length <= 1 || wepSel.dataset.weaponType !== charData.weaponType) {
                wepSel.innerHTML = CommonUtils.createOptions(weapons, slot.weapon, "Weapon");
                wepSel.disabled = false;
                wepSel.dataset.weaponType = charData.weaponType; // Save the type so it doesn't rebuild unnecessarily next time
            } else if (wepSel.value !== slot.weapon) {
                 wepSel.value = slot.weapon;
            }
        } else {
            // Lock weapon dropdown if no character is selected
            wepSel.innerHTML = '<option value="" disabled hidden selected>Select Character First</option>';
            wepSel.disabled = true;
            delete wepSel.dataset.weaponType; // Clear the saved type
        }
        
        if(rankInput.value != slot.rank) rankInput.value = slot.rank;
        CommonUtils.updateImage(row, '.wep-img', '.wep-text', 'Weapons', slot.weapon);
    },

    _updateSets: (row, slot) => {
        const layoutSel = row.querySelector('.layout-select');
        const mainSetSel = row.querySelector('.main-set-select');
        const subSetSel = row.querySelector('.sub-set-select');
        const mainEchoSel = row.querySelector('.main-echo-select');
        const subSetRow = row.querySelector('.sub-set-row');
        const mainEchoRow = row.querySelector('.main-echo-row');

        if(layoutSel.value !== slot.layout) layoutSel.value = slot.layout;
        if(mainSetSel.value !== slot.mainSet) mainSetSel.value = slot.mainSet;
        if(subSetSel.value !== slot.subSet) subSetSel.value = slot.subSet;

        // Certain sets trigger a 2-piece/2-piece split layout
        if (TRIGGER_SETS.includes(slot.mainSet)) {
            subSetRow.classList.remove('d-none'); subSetRow.classList.add('d-flex');
        } else {
            subSetRow.classList.add('d-none'); subSetRow.classList.remove('d-flex');
        }

        if (!slot.mainSet) {
            // Hide main echo if no set is chosen
            mainEchoRow.classList.add('d-none'); mainEchoRow.classList.remove('d-flex');
        } else {
            mainEchoRow.classList.remove('d-none'); mainEchoRow.classList.add('d-flex');
            
            // Build allowed echo list by merging arrays
            let allowedEchoes = [];
            if (SET_ECHO_MAPPING[slot.mainSet]) allowedEchoes.push(...SET_ECHO_MAPPING[slot.mainSet]);
            if (TRIGGER_SETS.includes(slot.mainSet) && slot.subSet && SET_ECHO_MAPPING[slot.subSet]) allowedEchoes.push(...SET_ECHO_MAPPING[slot.subSet]);
            
            // Remove duplicates
            allowedEchoes = [...new Set(allowedEchoes)];
            if (allowedEchoes.length === 0) allowedEchoes = ALL_MAIN_ECHOES;

            // Clear state if the previously selected echo is no longer valid for the new set
            if (slot.mainEcho && !allowedEchoes.includes(slot.mainEcho)) {
                slot.mainEcho = ""; RosterState.updateField(slot.index, 'mainEcho', "");
            }
            mainEchoSel.innerHTML = CommonUtils.createOptions(allowedEchoes, slot.mainEcho, "Main Echo");
            mainEchoSel.value = allowedEchoes.includes(slot.mainEcho) ? slot.mainEcho : "";
        }

        CommonUtils.updateImage(row, '.main-set-img', '.main-set-text', 'Echo Sets', slot.mainSet);
        CommonUtils.updateImage(row, '.sub-set-img', '.sub-set-text', 'Echo Sets', slot.subSet);
        CommonUtils.updateImage(row, '.main-echo-img', '.main-echo-text', 'Echoes', slot.mainEcho);
    },

    _updateEchoes: (row, slot) => {
        const cardWraps = row.querySelectorAll('.echo-card-wrap');
        slot.echoes.forEach((echoData, i) => {
            const card = cardWraps[i];
            if(!card) return;
            
            const msSelect = card.querySelector('.echo-main-stat-select');
            if(msSelect.value !== echoData.mainStat) msSelect.value = echoData.mainStat;
            CommonUtils.updatePlaceholderStyle(msSelect);

            const statRows = card.querySelectorAll('.stat-row');
            echoData.substats.forEach((sub, k) => {
                const sr = statRows[k];
                if(!sr) return;
                const sel = sr.querySelector('.stat-select');
                const slider = sr.querySelector('.base-slider');
                const num = sr.querySelector('.stat-value');

                if(sel.value !== sub.name) sel.value = sub.name;
                
                if (sub.name === "N/A") {
                    // Disable slider for unselected stats
                    slider.disabled = true; slider.classList.add('opacity-0'); num.value = "";
                } else {
                    // Sync slider index to dictionary values
                    slider.disabled = false; slider.classList.remove('opacity-0');
                    if (STAT_DB[sub.name]) {
                        slider.max = STAT_DB[sub.name].values.length - 1;
                        const idx = STAT_DB[sub.name].values.indexOf(parseFloat(sub.value));
                        if(idx > -1) slider.value = idx;
                    }
                    if(num.value != sub.value) num.value = sub.value;
                }
            });
        });
    },

};