// ==========================================================================
//   UI COMPONENTS REGISTRY (Centralized Presentation Layer)
// ==========================================================================
const UIComponents = {
    /**
     * Generates standard character team row shell HTML.
     */
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

    /**
     * Parametric factory that assembles 5 customizable Echo Substat card listings.
     * Supports configurable sub-row ceilings or varying stat dictionaries.
     */
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

    /**
     * Extracts active character rosters from state records to build drop-down choices.
     */
    getCurrentTeamOptionsHTML() {
        let options = '<option value="" disabled hidden selected>-</option>';
        if (typeof RosterState !== 'undefined' && RosterState.team) {
            RosterState.team.forEach(s => {
                if (s.character) options += `<option value="${s.character}">${s.character}</option>`;
            });
        }
        return options;
    },

    /**
     * Paints localized asset badges onto the team toolbar preview slots.
     */
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
};