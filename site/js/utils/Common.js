// =========================================
//   COMMON UTILITIES & TOOLTIPS
// =========================================
// --- CONSTANTS ---
const EXTENSION = ".webp"; 
const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

const TooltipManager = {
    el: null,
    init() {
        if (this.el) return;
        this.el = document.createElement('div');
        this.el.className = 'global-tooltip';
        document.body.appendChild(this.el);
    },
    attach(target, contentGetter) {
        if (!target) return;
        target.addEventListener('mouseenter', () => {
            const content = contentGetter(); 
            if (!content) return;
            this.el.innerHTML = content;
            this.el.style.display = 'block';
            
            const rect = target.getBoundingClientRect();
            const tipRect = this.el.getBoundingClientRect();
            
            let top = rect.top - tipRect.height - 8;
            let left = rect.left + (rect.width / 2) - (tipRect.width / 2);
            
            if (top < 0) top = rect.bottom + 8; 
            if (left < 10) left = 10;
            if (left + tipRect.width > window.innerWidth - 10) left = window.innerWidth - tipRect.width - 10;
            
            this.el.style.top = `${top}px`;
            this.el.style.left = `${left}px`;
        });
        target.addEventListener('mouseleave', () => this.el.style.display = 'none');
        window.addEventListener('scroll', () => this.el.style.display = 'none', true);
    }
};

const CommonUtils = {
    debounce: (func, delay) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), delay);
        };
    },
    createOptions: (list, selectedValue, placeholderText = "Select...") => {
        let html = `<option value="" disabled hidden ${!selectedValue ? 'selected' : ''}>${placeholderText}</option>`;
        list.forEach(item => {
            const isSelected = item === selectedValue ? 'selected' : '';
            html += `<option value="${item}" ${isSelected}>${item}</option>`;
        });
        return html;
    },

    enforceLimit: (input, min, max) => {
        let val = parseInt(input.value);
        if (isNaN(val)) return;
        if (val > max) input.value = max;
        if (val < min) input.value = min;
    },

    updatePlaceholderStyle: (select) => {
        if (select.value === "") select.classList.remove('has-value');
        else select.classList.add('has-value');
    },

    updateImage: (row, imgSelector, txtSelector, folder, rawValue) => {
        const img = row.querySelector(imgSelector);
        const txt = row.querySelector(txtSelector);
        
        // 1. Cleared State
        if (!rawValue || rawValue === "") {
            if (img) {
                img.classList.remove('opacity-1');
                img.classList.add('opacity-0');
                img.src = TRANSPARENT_PIXEL;
            }
            if(txt) {
                txt.classList.remove('opacity-0');
                txt.innerText = "?";
            }
            return;
        }

        // --- FIXED: Attach Load Lifecycles BEFORE setting the src! ---
        // This prevents the race condition where cached images fire 'load' instantly.
        if (img) {
            img.onload = () => {
                img.classList.remove('opacity-0');
                img.classList.add('opacity-1');
                if(txt) txt.classList.add('opacity-0');
            };
            img.onerror = () => {
                img.classList.remove('opacity-1');
                img.classList.add('opacity-0');
                img.src = TRANSPARENT_PIXEL;
                if(txt) {
                    txt.classList.remove('opacity-0');
                    txt.innerText = "?";
                }
            };
        }
        
        // 3. Fallback text while loading
        if(txt) txt.innerText = rawValue[0];

        // 4. Generate Path and Trigger Load (This will safely trigger the onload above)
        if (img) img.src = CommonUtils.getIconPath(rawValue, folder);
    },

    getIconPath: (name, folder) => {
        if(!name) return TRANSPARENT_PIXEL;
        const n = name.startsWith("Rover") ? "Rover" : name;
        return CommonUtils.getImage(`${folder}/Icon_${n.replaceAll(' ', '')}${EXTENSION}`);
    },
    
    getImage: (path) => {
        return `../images/${path}`;
    },

    getData: (path) => {
        return `../data/${path}`;
    }
};

const LocalCacheManager = {
    SAVE_KEY_TEAM: "wuwa_calc_team_cache",
    SAVE_KEY_ROT: "wuwa_calc_rotation_cache",
    
    SAVE_KEY_BUILD_CHAR: "wuwa_builder_active_char",
    SAVE_KEY_BUILD_STATS: "wuwa_builder_stats",
    SAVE_KEY_BUILD_MECH: "wuwa_builder_mechanics",
    SAVE_KEY_BUILD_FOLDER: "wuwa_builder_folder",
    SAVE_KEY_BUILD_RARITY: "wuwa_builder_rarity",

    // --- AUTOMATED WORKSPACE SAVERS ---
    saveCurrentSession: () => {
        try {
            if (typeof RosterUtils !== 'undefined') {
                localStorage.setItem(LocalCacheManager.SAVE_KEY_TEAM, JSON.stringify(RosterUtils.extractTeamData()));
            }
            if (typeof RotationUtils !== 'undefined') {
                localStorage.setItem(LocalCacheManager.SAVE_KEY_ROT, JSON.stringify(RotationUtils.extractData()));
            }
        } catch (e) { console.error("[Cache] Calc save failed:", e); }
    },

    saveBuilderSession: () => {
        try {
            if (typeof BuilderState !== 'undefined' && BuilderState.activeChar && typeof BuilderRenderer !== 'undefined') {
                const { baseStats, mechanicsObj } = BuilderRenderer.extractFormData();
                localStorage.setItem(LocalCacheManager.SAVE_KEY_BUILD_CHAR, BuilderState.activeChar);
                localStorage.setItem(LocalCacheManager.SAVE_KEY_BUILD_STATS, JSON.stringify(baseStats));
                localStorage.setItem(LocalCacheManager.SAVE_KEY_BUILD_MECH, JSON.stringify(mechanicsObj));
                localStorage.setItem(LocalCacheManager.SAVE_KEY_BUILD_FOLDER, BuilderState.activeFolder);
                localStorage.setItem(LocalCacheManager.SAVE_KEY_BUILD_RARITY, BuilderState.activeRarity);
            }
        } catch (e) { console.error("[Cache] Builder save failed:", e); }
    },

    // --- AUTOMATED WORKSPACE LOADERS (Hydration Targets) ---
    loadPreviousSession: async (container) => {
        try {
            const cachedTeam = localStorage.getItem(LocalCacheManager.SAVE_KEY_TEAM);
            const cachedRot = localStorage.getItem(LocalCacheManager.SAVE_KEY_ROT);
            if (cachedTeam && typeof RosterUtils !== 'undefined') {
                await RosterUtils.applyTeamImport(JSON.parse(cachedTeam));
            }
            if (cachedRot && typeof RotationUtils !== 'undefined' && container) {
                RotationUtils.applyRotationImport(container, JSON.parse(cachedRot), () => 
                    RotationUtils.createRow(RosterUtils.getCurrentTeamOptionsHTML())
                );
                if (typeof history !== 'undefined') history.clear();
                RotationUtils.runSimulation();
            }
        } catch (e) { console.error("[Cache] Calc restore failed:", e); }
    },

    loadBuilderSession: async () => {
        try {
            const activeChar = localStorage.getItem(LocalCacheManager.SAVE_KEY_BUILD_CHAR);
            if (!activeChar) return; // Exit cleanly if no active session exists

            const cachedStats = localStorage.getItem(LocalCacheManager.SAVE_KEY_BUILD_STATS);
            const cachedMech = localStorage.getItem(LocalCacheManager.SAVE_KEY_BUILD_MECH);
            const folder = localStorage.getItem(LocalCacheManager.SAVE_KEY_BUILD_FOLDER) || "Characters";
            const rarity = parseInt(localStorage.getItem(LocalCacheManager.SAVE_KEY_BUILD_RARITY)) || 5;

            // Re-hydrate State Engine
            BuilderState.activeChar = activeChar;
            BuilderState.activeFolder = folder;
            BuilderState.activeRarity = rarity;

            // Intercept global databases to append user modifications prior to painting properties
            if (cachedStats) {
                const parsedStats = JSON.parse(cachedStats);
                if (typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[activeChar]) Object.assign(CHARACTER_DB[activeChar], parsedStats);
                else if (typeof WEAPON_DB !== 'undefined' && WEAPON_DB[activeChar]) Object.assign(WEAPON_DB[activeChar], parsedStats);
            }
            if (cachedMech && typeof MECHANICS_DB !== 'undefined') {
                Object.assign(window.MECHANICS_DB, JSON.parse(cachedMech));
            }

            // Sync structural DOM visibility flags matching editor panel activation states
            document.getElementById('view-grid').classList.add('d-none');
            document.getElementById('view-editor').classList.remove('d-none');
            document.getElementById('back-to-grid-btn').classList.remove('d-none');
            document.getElementById('editor-char-name').innerText = activeChar + " Setup";

            const iconContainer = document.getElementById('editor-char-icon');
            iconContainer.className = `char-icon rarity-${rarity}`;
            iconContainer.querySelector('.char-fallback').innerText = activeChar.charAt(0);
            
            if (typeof CommonUtils !== 'undefined') {
                CommonUtils.updateImage(iconContainer, '.char-grid-img', '.char-fallback', folder, activeChar);
            }

            // Paint elements dynamically via UI generators
            BuilderRenderer.buildBaseStatsForm(activeChar);
            BuilderRenderer.buildMechanicsAccordion(activeChar);
            BuilderGUIController.refreshOutput(true);
            console.log(`[Cache] Successfully restored workspace for: ${activeChar}`);
        } catch (e) { console.error("[Cache] Builder restore failed:", e); }
    },
    clearBuilderCache: () => {
        localStorage.removeItem(LocalCacheManager.SAVE_KEY_BUILD_STATS);
        localStorage.removeItem(LocalCacheManager.SAVE_KEY_BUILD_MECH);
        localStorage.removeItem(LocalCacheManager.SAVE_KEY_BUILD_FOLDER);
        localStorage.removeItem(LocalCacheManager.SAVE_KEY_BUILD_RARITY);
    },
    
    hasBuilderCache: () => {
        // True only if actual data modifications are sitting in the browser cache
        return !!(localStorage.getItem(LocalCacheManager.SAVE_KEY_BUILD_STATS) || 
                  localStorage.getItem(LocalCacheManager.SAVE_KEY_BUILD_MECH));
    }
};
