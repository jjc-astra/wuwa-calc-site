const BuilderRenderer = {
    renderGrid: (searchTerm = "") => {
        const masterGrid = document.getElementById('character-grid');
        if (!masterGrid) return;
        
        masterGrid.innerHTML = '';
        masterGrid.style.display = 'flex';
        masterGrid.style.flexDirection = 'column';
        masterGrid.style.gap = '24px';
        masterGrid.style.overflow = 'Auto';
        
        const buildSection = (title, items, dbRef, imgFolder) => {
            // --- NEW: Filter the items based on the search box ---
            let filteredItems = items;
            if (searchTerm.trim() !== "") {
                const lowerTerm = searchTerm.toLowerCase();
                filteredItems = items.filter(item => item.toLowerCase().includes(lowerTerm));
            }
            
            // If the search filtered out everything in this category, don't render the header!
            if (!filteredItems || filteredItems.length === 0) return;
            
            const section = document.createElement('div');
            section.className = 'grid-section';
            
            section.innerHTML = `
                <div class="text-gold mb-4px" style="font-size: 1.1em; font-weight: bold; border-bottom: 1px solid #444; padding-bottom: 4px;">${title}</div>
                <div class="item-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(85px, 1fr)); gap: 12px; margin-top: 12px;"></div>
            `;
            const grid = section.querySelector('.item-grid');
            
            // Iterate over our newly filtered array instead of the raw items array
            filteredItems.forEach(itemName => {
                const el = document.createElement('div');
                el.className = 'char-grid-card';
                
                // --- NEW: Dynamic Grid Styling ---
                let rarityClass = 'rarity-none';
                let iconClass = 'char-icon';
                
                if (imgFolder === 'Characters' || imgFolder === 'Weapons') {
                    let rarity = (dbRef && dbRef[itemName]?.rarity) ? dbRef[itemName].rarity : 5;
                    rarityClass = `rarity-${rarity}`;
                } else if (imgFolder === 'Echo Sets' || imgFolder === 'System') { // ADDED SYSTEM HERE
                    iconClass += ' echo-set-icon';
                }
                
                // --- NEW: Dynamic Text Scaling & Wrapping ---
                // Characters keep normal size, everything else shrinks slightly
                const fontSize = (imgFolder === 'Characters') ? '0.8em' : '0.65em';
                
                el.innerHTML = `
                    <div class="${iconClass} ${rarityClass}">
                        <img class="char-grid-img opacity-0" src="">
                        <span class="char-fallback opacity-0">${itemName.charAt(0)}</span>
                    </div>
                    <div class="char-name-label" style="
                        font-size: ${fontSize}; 
                        line-height: 1.2; 
                        white-space: normal; 
                        display: -webkit-box; 
                        -webkit-line-clamp: 2; 
                        -webkit-box-orient: vertical;
                    ">${itemName}</div>
                `;
                
                if (typeof CommonUtils !== 'undefined') {
                    CommonUtils.updateImage(el, '.char-grid-img', '.char-fallback', imgFolder, itemName);
                }
                
                // Pass the specific image folder and rarity to the Editor when clicked!
                el.addEventListener('click', () => BuilderGUIController.openEditor(itemName, imgFolder, rarityClass === 'rarity-none' ? 5 : parseInt(rarityClass.replace('rarity-', ''))));
                grid.appendChild(el);
            });
            
            masterGrid.appendChild(section);
        };

        // Build all 4 sections dynamically using the DB!
        if (typeof CHARACTER_DB !== 'undefined') buildSection("Characters", Object.keys(CHARACTER_DB), CHARACTER_DB, 'Characters');
        if (typeof WEAPON_DB !== 'undefined') buildSection("Weapons", Object.keys(WEAPON_DB), WEAPON_DB, 'Weapons');
        if (typeof ALL_MAIN_ECHOES !== 'undefined') buildSection("Main Echoes", ALL_MAIN_ECHOES, null, 'Echoes');
        if (typeof SONATA_SETS !== 'undefined') buildSection("Echo Sets", SONATA_SETS, null, 'Echo Sets');
        // --- NEW: SYSTEM SECTION ---
        buildSection("System", ["Generic"], null, 'System');
    },

    buildBaseStatsForm: (itemName) => {
        const container = document.getElementById('base-stats-form');
        
        const renderGroup = (title, fieldsHTML) => `
            <div class="node-section mb-sm" style="background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px; overflow: hidden;">
                <div class="node-section-title text-gold" style="padding: 6px 12px; border-bottom: 1px solid var(--border); background: rgba(0,0,0,0.2); font-weight: bold; text-transform: uppercase; font-size: 0.8rem;">${title}</div>
                <div class="form-row" style="flex-wrap: wrap; padding: 12px;">
                    ${fieldsHTML}
                </div>
            </div>
        `;
        
        
        if (typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[itemName]) {
            const stats = CHARACTER_DB[itemName];
            const fCount = stats.forteCount || 1;
            
            // --- NEW: UI Grouping Helpers ---
        const makeInput = (key, label, defaultVal = '', placeholder = '') => `
            <div class="form-group flex-1" style="min-width: 120px;">
                <label class="form-label text-dim">${label}</label>
                <input type="text" class="form-input base-stat-input w-100" data-key="${key}" value="${stats[key] !== undefined ? stats[key] : defaultVal}" placeholder="${placeholder}">
            </div>
        `;

            const talentOpts = ["", "ATK %", "HP %", "DEF %", "CR Rate", "CR DMG", "Healing Bonus", "Glacio DMG", "Fusion DMG", "Electro DMG", "Aero DMG", "Spectro DMG", "Havoc DMG", "Physical DMG"];
            const makeSelect = (key, label, currentVal) => `
                <div class="form-group flex-1" style="min-width: 120px;">
                    <label class="form-label text-dim">${label}</label>
                    <select class="base-select base-stat-input w-100" data-key="${key}">
                        ${talentOpts.map(opt => `<option value="${opt}" ${currentVal === opt ? 'selected' : ''}>${opt || "None"}</option>`).join('')}
                    </select>
                </div>
            `;

            // 1. Identity Group
            let html = renderGroup("Identity", 
                makeInput('weaponType', 'Weapon Type') + 
                makeInput('element', 'Element') + 
                makeInput('rarity', 'Rarity', 5)
            );

            // 2. Base Values Group
            html += renderGroup("Base Values", 
                makeInput('baseAtk', 'Base ATK') + 
                makeInput('baseHP', 'Base HP') + 
                makeInput('baseDef', 'Base DEF') + 
                makeInput('baseCritRate', 'Base CR Rate', 5) + 
                makeInput('baseCritDmg', 'Base CR DMG', 150)
            );

            // 3. NEW: Inherent Talent Nodes
            html += renderGroup("Talent Nodes", 
                makeSelect('talentStat1', 'Stat Node 1', stats.talentStat1) + 
                makeInput('talentVal1', 'Value 1', '', 'e.g. 8%') + 
                makeSelect('talentStat2', 'Stat Node 2', stats.talentStat2) + 
                makeInput('talentVal2', 'Value 2', '', 'e.g. 12%')
            );

            // 4. Resources Group
            let resourceFields = makeInput('maxEnergy', 'Max Energy') + makeInput('forteCount', 'Forte Count');
            for (let i = 1; i <= fCount; i++) {
                const key = `maxForte${i}`;
                const label = `Max Forte ${i}`;
                resourceFields += makeInput(key, label);
            }
            html += renderGroup("Resources", resourceFields);

            container.innerHTML = html;

            // Automatically refresh the UI if you add a new Forte Pool!
            const countInput = container.querySelector('.base-stat-input[data-key="forteCount"]');
            if (countInput) {
                countInput.addEventListener('change', (e) => {
                    CHARACTER_DB[itemName].forteCount = parseInt(e.target.value) || 1;
                    BuilderRenderer.buildBaseStatsForm(itemName);
                    BuilderRenderer.buildMechanicsAccordion(itemName);
                });
            }
            
        } else if (typeof WEAPON_DB !== 'undefined' && WEAPON_DB[itemName]) {
            // Apply the same aesthetic groupings to Weapons!
            const stats = WEAPON_DB[itemName];
            const makeInput = (key, label, defaultVal = '', placeholder = '') => `
                <div class="form-group flex-1" style="min-width: 120px;">
                    <label class="form-label text-dim">${label}</label>
                    <input type="text" class="form-input base-stat-input w-100" data-key="${key}" value="${stats[key] !== undefined ? stats[key] : defaultVal}" placeholder="${placeholder}">
                </div>
            `;
            
            let html = renderGroup("Identity", makeInput('weaponType', 'Weapon Type') + makeInput('rarity', 'Rarity', 5));
            html += renderGroup("Base Stats", makeInput('baseAtk', 'Base ATK'));
            html += renderGroup("Sub Stat", makeInput('subStatType', 'Type', '', 'e.g. CR Rate') + makeInput('subStatValue', 'Value', '', 'e.g. 24.3%'));
            
            container.innerHTML = html;
        }
    },

    buildMechanicsAccordion: (itemName) => {
        const container = document.getElementById('mechanics-accordion');
        container.innerHTML = '';
        let targetCategories = [];
        let isCharacter = false;
        
        if (itemName === "Generic") {
            targetCategories = ["System Mechanics"];
        } else if (typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[itemName]) {
            targetCategories = BuilderState.categories;
            isCharacter = true;
        } else if (typeof WEAPON_DB !== 'undefined' && WEAPON_DB[itemName]) {
            targetCategories = ["Weapon Passive"];
        } else if (typeof SONATA_SETS !== 'undefined' && SONATA_SETS.includes(itemName)) {
            if (typeof TRIGGER_SETS !== 'undefined' && TRIGGER_SETS.includes(itemName)) targetCategories = ["3-pc Set Effect"];
            else targetCategories = ["2-pc Set Effect", "5-pc Set Effect"];
        } else {
            targetCategories = ["Echo Skill", "Echo Passive"];
        }

        targetCategories.forEach(cat => {
            const catEl = document.createElement('div');
            catEl.className = 'mechanic-category';
            catEl.dataset.category = cat;
            
            // --- FIXED: Dynamically pre-select accompanying templates based on category names ---
            const templateOptions = Object.keys(BuilderState.templates)
                .map(k => {
                    const isSelected = (k === cat || k.startsWith(cat)) ? 'selected' : '';
                    return `<option value="${k}" ${isSelected}>${BuilderState.templates[k].name}</option>`;
                }).join('');
                
            const dbC = (isCharacter && typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[itemName]) ? CHARACTER_DB[itemName] : {};
            const groupName = (dbC.skillGroupNames && dbC.skillGroupNames[cat]) ? dbC.skillGroupNames[cat] : "";
            
            catEl.innerHTML = `
                <div class="mechanic-header" style="display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
                        <span class="text-bold text-gold">${cat}</span>
                        ${isCharacter ? `<input type="text" class="form-input category-group-name" data-cat="${cat}" value="${groupName}" placeholder="Skill Category Name" style="height: 24px; font-size: 0.8rem; width: 280px; border-color: #444; background: rgba(0,0,0,0.2);">` : ''}
                    </div>
                    <div class="flex-row gap-sm w-auto">
                        <select class="base-select template-select w-150px">${templateOptions}</select>
                        <button class="base-btn text-xs add-node-btn">Add Node</button>
                    </div>
                </div>
                <div class="nodes-container"></div>
            `;

            // Auto-refresh the JSON output when typing the lore name!
            const nameInput = catEl.querySelector('.category-group-name');
            if (nameInput) nameInput.addEventListener('input', () => {
                if (typeof BuilderGUIController !== 'undefined') BuilderGUIController.refreshOutput();
            });

            catEl.querySelector('.add-node-btn').addEventListener('click', () => {
                const tmplKey = catEl.querySelector('.template-select').value;
                BuilderRenderer.addMechanicNode(catEl.querySelector('.nodes-container'), cat, null, null, tmplKey);
                BuilderGUIController.refreshOutput();
            });
            container.appendChild(catEl);
        });

        // --- NEW: SMART LOAD SORTING ---
        if (typeof MECHANICS_DB !== 'undefined') {
            Object.keys(MECHANICS_DB).forEach(key => {
                const mechData = MECHANICS_DB[key];
                
                // Read purely off the System prefix or System provider flag
                const belongsToCurrentPage = (itemName === "Generic") 
                    ? (key.startsWith("System_") || mechData.provider === "System")
                    : key.startsWith(itemName + "_");

                if (belongsToCurrentPage) {
                    let targetCategory = "Inherent Skill"; 
                    
                    // --- FIXED: Read the saved category first! Fall back to guessing if missing. ---
                    if (mechData.category && targetCategories.includes(mechData.category)) {
                        targetCategory = mechData.category;
                    } else if (itemName === "Generic") {
                        // Sort into Buffs vs System based on naming conventions
                        targetCategory = "System Mechanics";
                    } else if (!isCharacter) {
                        
                        if (targetCategories.includes("Echo Skill")) {
                            const isEchoPassive = mechData.isPassive || 
                                                  key.toLowerCase().includes("passive") || 
                                                  mechData.name.toLowerCase().includes("passive") || 
                                                  (mechData.triggerRule && mechData.triggerRule.trim().startsWith("ALWAYS"));
                            
                            targetCategory = isEchoPassive ? "Echo Passive" : "Echo Skill";
                        } 
                        // Sets & Weapons
                        else if (targetCategories.length === 1) {
                            targetCategory = targetCategories[0];
                        } else {
                            if (mechData.name.includes("2-pc") || key.includes("2pc")) targetCategory = "2-pc Set Effect";
                            else targetCategory = "5-pc Set Effect";
                        }
                        
                    } else {
                        targetCategory = BuilderUtils.guessCategory(mechData);
                    }

                    const categoryDiv = container.querySelector(`.mechanic-category[data-category="${targetCategory}"] .nodes-container`);
                    if (categoryDiv) BuilderRenderer.addMechanicNode(categoryDiv, targetCategory, key, mechData, null);
                }
            });
        }
    },

    bindAutocomplete: (input) => {
        if (!input || input.dataset.autocompleteBound) return;
        input.dataset.autocompleteBound = "true";

        const popup = document.createElement('div');
        popup.className = 'autocomplete-popup';
        input.parentNode.appendChild(popup);

        let activeIndex = 0;

        const bracketOptions = typeof DSL_SCHEMA !== 'undefined' ? DSL_SCHEMA.modifiers : [];
        const parenEvents = ["AfterHit", "OnTick"];
        const bracketEvents = typeof DSL_SCHEMA !== 'undefined' ? DSL_SCHEMA.events.filter(e => !["ALWAYS", "OnStart", "OnSwapIn", "OnSwapOut", "OnChange", ...parenEvents].includes(e)) : [];

        let dict = [];
        // --- NEW: Rules for the Effect ID Textbox ---
        if (input.classList.contains('eff-name')) {
            dict = [
                {
                    trigger: /@([a-zA-Z0-9_]+)\(([^)]*)$/,
                    matchGroup: 2, 
                    options: (match) => {
                        const namespace = match[1];
                        const effKeys = new Set();
                        
                        if (typeof MECHANICS_DB !== 'undefined') {
                            Object.values(MECHANICS_DB).forEach(mech => {
                                const effs = Array.isArray(mech.effects) ? mech.effects : [];
                                effs.forEach(e => { if (e.name) effKeys.add(e.name); });
                            });
                        }
                        
                        const liveEffs = Array.from(document.querySelectorAll('.mech-effects-container .type-tag')).map(t => {
                            try { return JSON.parse(t.dataset.val.replace(/&apos;/g, "'")); } catch(e) { return {}; }
                        });
                        liveEffs.forEach(e => { if (e.name) effKeys.add(e.name); });

                        return Array.from(effKeys)
                            .filter(k => k.startsWith(namespace + "_"))
                            .map(k => ({
                                val: k.replace(namespace + "_", ""), 
                                group: namespace === "System" ? "System Effects" : `${namespace} Effects`
                            })); 
                    },
                    prefix: '', append: ')'
                },
                {
                    trigger: /^@?([a-zA-Z]*)$/, 
                    options: () => {
                        const base = [{val: "System(", group: "Namespaces"}];
                        const chars = typeof CHARACTER_DB !== 'undefined' ? Object.keys(CHARACTER_DB).map(c => ({val: c.replace(/[^a-zA-Z0-9]/g, '') + "(", group: "Namespaces"})) : [];
                        return [...base, ...chars];
                    },
                    prefix: '@'
                }
            ];
        } else if (input.classList.contains('eff-stat')) {
            
            // 1. Pull base sheet stats STRICTLY from BuilderState
            const statKeys = typeof BuilderState !== 'undefined' && BuilderState.STAT_OPTIONS ? BuilderState.STAT_OPTIONS : [];
            const sheetStats = statKeys.map(v => ({val: v, group: "Sheet Stats"}));
            
            // 2. Base Physics Engine modifiers
            const combatMods = ["DMG Bonus", "DMG Amp", "Deepen", "DMG Taken", "Reduce RES", "RES Shred", "Ignore RES", "RES Pen", "Reduce DEF", "Ignore DEF", "Additive Mult", "Multiplicative Mult"].map(v => ({val: v, group: "Combat Modifiers"}));
            
            // 3. Dynamically generate advanced specific modifiers
            let specificMods = [];
            if (typeof BuilderState !== 'undefined' && BuilderState.DMG_OPTIONS) {
                BuilderState.DMG_OPTIONS.forEach(dmgType => {
                    ["DMG Bonus", "DMG Amp", "Deepen", "DMG Taken", "Ignore RES", "Ignore DEF", "Additive Mult", "Multiplicative Mult"].forEach(mod => {
                        specificMods.push({val: `${dmgType} ${mod}`, group: "Specific Modifiers"});
                    });
                });
            }

            // Deduplicate the combined list
            const allStats = [...sheetStats, ...combatMods, ...specificMods];
            const uniqueStats = [];
            const seen = new Set();
            allStats.forEach(obj => {
                if (!seen.has(obj.val)) {
                    seen.add(obj.val);
                    uniqueStats.push(obj);
                }
            });

            dict = [{ trigger: /(.*)/, options: uniqueStats, prefix: '' }];
            
        } else if (input.classList.contains('eff-target')) {
            // Pull Targets dynamically from DSL_SCHEMA
            const targetOptions = typeof DSL_SCHEMA !== 'undefined' ? DSL_SCHEMA.pointers.map(p => ({val: '@' + p, group: "Targets"})) : [];
            dict = [{ trigger: /(.*)/, options: targetOptions, prefix: '' }];
            
        } else {
            dict = [
                { trigger: /\b(?:On|After|Detonate)[a-zA-Z]*\[([^\]]*)$/i, options: bracketOptions.map(v => ({val: v, group: "Modifiers"})), append: ']', prefix: '' },
                { 
                    trigger: /@([a-zA-Z]*)$/, 
                    options: () => {
                        const base = typeof DSL_SCHEMA !== 'undefined' ? DSL_SCHEMA.pointers.map(p => ({val: p + (p === "System" ? "(" : "."), group: "Pointers"})) : [];
                        const chars = typeof CHARACTER_DB !== 'undefined' ? Object.keys(CHARACTER_DB).map(c => ({val: c.replace(/[^a-zA-Z0-9]/g, '') + "(", group: "Characters"})) : [];
                        return [...base, ...chars];
                    },
                    prefix: '@' 
                },
                {
                    trigger: /@([a-zA-Z0-9_]+)\(([^)]*)$/,
                    matchGroup: 2, 
                    options: (match) => {
                        const namespace = match[1];
                        const mechKeys = new Set();
                        const effKeys = new Set();
                        
                        // 1. Pull currently loaded mechanics
                        if (typeof MECHANICS_INDEX !== 'undefined') {
                            if (MECHANICS_INDEX[namespace]) MECHANICS_INDEX[namespace].forEach(k => mechKeys.add(k));
                            if (MECHANICS_INDEX['System']) MECHANICS_INDEX['System'].forEach(k => mechKeys.add(k));
                        }
                        if (typeof MECHANICS_DB !== 'undefined') {
                            Object.keys(MECHANICS_DB).forEach(k => mechKeys.add(k));
                            
                            // --- NEW: Feed all Effect IDs to the main DSL Autocomplete ---
                            Object.values(MECHANICS_DB).forEach(mech => {
                                const effs = Array.isArray(mech.effects) ? mech.effects : [];
                                effs.forEach(e => { if (e.name) effKeys.add(e.name); });
                            });
                        }

                        // 3. Pull live nodes currently being edited
                        const liveIds = Array.from(document.querySelectorAll('.mech-id')).map(i => i.value).filter(Boolean);
                        liveIds.forEach(k => mechKeys.add(k));
                        
                        const liveEffs = Array.from(document.querySelectorAll('.mech-effects-container .type-tag')).map(t => {
                            try { return JSON.parse(t.dataset.val.replace(/&apos;/g, "'")); } catch(e) { return {}; }
                        });
                        liveEffs.forEach(e => { if (e.name) effKeys.add(e.name); });

                        const results = [];
                        mechKeys.forEach(k => {
                            if (k.startsWith(namespace + "_")) results.push({ val: k.replace(namespace + "_", ""), group: namespace === "System" ? "System Mechanics" : `${namespace} Mechanics` });
                        });
                        effKeys.forEach(k => {
                            if (k.startsWith(namespace + "_")) results.push({ val: k.replace(namespace + "_", ""), group: namespace === "System" ? "System Effects" : `${namespace} Effects` });
                        });
                        return results;
                    },
                    prefix: '', append: ')'
                },
                { 
                    trigger: /\b((?:On|After|Det|AL)[a-zA-Z]*)$/i, 
                    options: (typeof DSL_SCHEMA !== 'undefined' ? DSL_SCHEMA.events : []).map(v => ({val: v, group: "Events"})), 
                    prefix: '', 
                    dynamicAppend: (val) => parenEvents.includes(val) ? '(' : (bracketEvents.includes(val) ? '[' : ' ')
                },
                { 
                    trigger: /@([a-zA-Z]+)\.([a-zA-Z]*)$/, 
                    matchGroup: 2, 
                    options: (match) => {
                        const pointer = match[1]; 
                        if (typeof DSL_SCHEMA === 'undefined' || !DSL_SCHEMA.properties[pointer]) return [];
                        let props = [...DSL_SCHEMA.properties[pointer]].map(p => ({val: p, group: "Properties"}));
                        if (pointer === "Self") {
                            const forteInput = document.querySelector('.base-stat-input[data-key="forteCount"]');
                            const fCount = forteInput ? (parseInt(forteInput.value, 10) || 0) : 0;
                            for (let i = 1; i <= fCount; i++) props.push({val: `Forte${i}`, group: "Properties"});
                        }
                        return props;
                    }, 
                    prefix: '.' 
                },
                {
                    // Fallback for clicking a completely empty DSL box
                    trigger: /^()$/, 
                    options: (typeof DSL_SCHEMA !== 'undefined' ? DSL_SCHEMA.events : []).map(v => ({val: v, group: "Events"})),
                    prefix: '', 
                    dynamicAppend: (val) => parenEvents.includes(val) ? '(' : (bracketEvents.includes(val) ? '[' : ' ')
                }
            ];
        }

        input.addEventListener('keydown', (e) => {
            if (popup.style.display !== 'block') return;
            const items = popup.querySelectorAll('.autocomplete-item');
            if (!items.length) return;

            if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = (activeIndex + 1) % items.length; updateHighlight(); } 
            else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = (activeIndex - 1 + items.length) % items.length; updateHighlight(); } 
            else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); items[activeIndex].dispatchEvent(new MouseEvent('mousedown')); } 
            else if (e.key === 'Escape') popup.style.display = 'none';
        });

        const updateHighlight = () => {
            popup.querySelectorAll('.autocomplete-item').forEach((item, i) => {
                if (i === activeIndex) { item.classList.add('is-active'); item.scrollIntoView({ block: 'nearest' }); } 
                else { item.classList.remove('is-active'); }
            });
        };

        const handleAutocomplete = (e) => {
            const val = input.value, cursorPos = input.selectionStart, textBeforeCursor = val.slice(0, cursorPos);
            let matched = false;
            
            for (const rule of dict) {
                const match = textBeforeCursor.match(rule.trigger);
                if (match) {
                    const groupIdx = rule.matchGroup || 1;
                    const searchStr = match[groupIdx] !== undefined ? match[groupIdx].toLowerCase() : match[0].toLowerCase(); 
                    const optionsList = typeof rule.options === 'function' ? rule.options(match) : rule.options;
                    
                    // --- FIXED: Multi-word, order-agnostic search filtering ---
                    const searchTerms = searchStr.trim().split(/\s+/).filter(Boolean);
                    
                    const matches = optionsList.filter(o => {
                        const optLower = o.val.toLowerCase();
                        if (searchTerms.length === 0) return true; // Show all if empty
                        // Every typed word must exist somewhere in the option string
                        return searchTerms.every(term => optLower.includes(term));
                    });
                    
                    if (matches.length > 0) {
                        
                        // Check exact match (ignoring extra trailing spaces) to auto-close
                        if (matches.length === 1 && matches[0].val.toLowerCase() === searchStr.trim() && e && e.type === 'input') {
                            popup.style.display = 'none';
                            matched = true;
                            break;
                        }

                        const grouped = {};
                        matches.forEach(m => {
                            if (!grouped[m.group]) grouped[m.group] = [];
                            grouped[m.group].push(m);
                        });

                        // ... (Rest of the rendering logic remains exactly the same) ...
                        let html = "";
                        let itemIdx = 0;
                        for (const [groupName, groupItems] of Object.entries(grouped)) {
                            html += `<div class="autocomplete-group-header" style="font-size: 0.75rem; color: #a0a0a0; padding: 4px 8px; background: #1a1a1a; font-weight: bold; text-transform: uppercase; border-bottom: 1px solid #333;">${groupName}</div>`;
                            groupItems.forEach(m => {
                                html += `<div class="autocomplete-item ${itemIdx === 0 ? 'is-active' : ''}" data-val="${m.val}">${rule.prefix || ''}${m.val}</div>`;
                                itemIdx++;
                            });
                        }

                        popup.innerHTML = html;
                        popup.style.display = 'block'; activeIndex = 0; matched = true;
                        
                        popup.querySelectorAll('.autocomplete-item').forEach(item => {
                            item.addEventListener('mouseenter', () => { popup.querySelectorAll('.autocomplete-item').forEach(i => i.classList.remove('is-active')); item.classList.add('is-active'); });
                            item.addEventListener('mousedown', (ev) => {
                                ev.preventDefault(); 
                                const completion = ev.target.dataset.val;
                                
                                let newVal = "";
                                let newCursorPos = 0;

                                if (input.classList.contains('eff-stat') || input.classList.contains('eff-target')) {
                                    newVal = completion;
                                    newCursorPos = completion.length;
                                } else {
                                    const replaceStart = cursorPos - match[groupIdx].length;
                                    newVal = val.slice(0, replaceStart) + completion;
                                    newCursorPos = replaceStart + completion.length;
                                    
                                    const appendStr = rule.append !== undefined ? rule.append : (rule.dynamicAppend ? rule.dynamicAppend(completion) : null);

                                    if (appendStr) {
                                        if (val.slice(cursorPos, cursorPos + appendStr.length) === appendStr) { newCursorPos += appendStr.length; newVal += val.slice(cursorPos); } 
                                        else { newVal += appendStr + val.slice(cursorPos); newCursorPos += appendStr.length; }
                                    } else {
                                        newVal += val.slice(cursorPos);
                                    }
                                    if (completion.endsWith('()') && !appendStr) newCursorPos -= 1; 
                                }

                                input.value = newVal; popup.style.display = 'none'; input.focus(); input.selectionStart = input.selectionEnd = newCursorPos;
                                BuilderGUIController.refreshOutput();
                                input.dispatchEvent(new Event('input', { bubbles: true })); 
                            });
                        });
                    }
                    break; 
                }
            }
            if (!matched) popup.style.display = 'none';
        };

        input.addEventListener('input', handleAutocomplete);
        input.addEventListener('focus', handleAutocomplete);
        input.addEventListener('click', handleAutocomplete);

        input.addEventListener('blur', () => setTimeout(() => popup.style.display = 'none', 150));
    },

    generateTagHTML: (val, label, extra = '') => `<div class="type-tag" ${extra} data-val='${val}'><span>${label}</span><button class="type-tag-remove">×</button></div>`,
    
    escapeJSON: (obj) => JSON.stringify(obj).replace(/'/g, "&apos;"),

    generateEffectInputsHTML: (type) => {
        const getForteOpts = () => {
            const dbC = (typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[BuilderState.activeChar]) ? CHARACTER_DB[BuilderState.activeChar] : {};
            const c = dbC.forteCount || 1;
            let str = ``;
            for (let i = 1; i <= c; i++) str += `<option value="forte${i}">Forte ${i}</option>`;
            return str;
        };

        // UI Helpers to match the rest of the Builder perfectly!
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
                <select class="base-select ${cls} w-100">
                    ${optionsHTML}
                </select>
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
                ${makeInput('eff-label', 'Display Name', 'Optional')}
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
                ${makeSelect('eff-name', 'Resource Type', '<option value="energy">Energy</option><option value="concerto">Concerto</option>' + getForteOpts() + '<option value="tune">Tune</option>')}
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

        // Wrap the layout in a clean column flexbox so the rows stack nicely!
        return `<div style="display: flex; flex-direction: column; gap: 8px; width: 100%;">${html}</div>`;
    },

    addMechanicNode: (container, category, existingId = null, existingData = null, templateKey = null) => {
        const isGen = BuilderState.activeChar === "Generic";
                   
        // --- FIXED: Stripped out broken JSON.parse wrappers since templates use real arrays ---
        let data = existingData || {
            ...(BuilderState.templates[templateKey] || { name: "New Mechanic", triggerRule: "", isPassive: isGen, isGeneric: isGen }),
            castTypes: BuilderState.templates[templateKey]?.castTypes || [],
            dmgTypes: BuilderState.templates[templateKey]?.dmgTypes || [],
            effects: BuilderState.templates[templateKey]?.effects ? new Function("return " + BuilderState.templates[templateKey].effects)() : [],
            isGeneric: isGen
        };

        // --- NEW: Default Damage Type to the Character's Element ---
        if (!existingData && !isGen && typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[BuilderState.activeChar]) {
            const charElement = CHARACTER_DB[BuilderState.activeChar].element;
            if (charElement) {
                const elements = ["Glacio", "Aero", "Electro", "Fusion", "Spectro", "Havoc", "Physical"];
                
                // If it's a completely blank non-passive node, pre-fill the element
                if (data.dmgTypes.length === 0 && !data.isPassive) {
                    data.dmgTypes = [charElement];
                } 
                // If the template has a placeholder element (like "Glacio"), swap it
                else {
                    data.dmgTypes = data.dmgTypes.map(t => elements.includes(t) ? charElement : t);
                }
            }
        }

        const pageOwner = isGen ? "System" : BuilderState.activeChar;
        const providerStr = data.provider || pageOwner;
        const nameStr = data.name || '';
        const nodeID = existingId || BuilderUtils.generateId(pageOwner, nameStr);

        const getCastLabel = (val) => val;
        
        const renderResTags = (obj, tStr) => Object.entries(obj).map(([key, val]) => {
            const dVal = Array.isArray(val) ? `[${val.map(v => v > 0 ? '+' + v : v).join(', ')}]` : (val > 0 ? '+' + val : val);
            return BuilderRenderer.generateTagHTML(BuilderRenderer.escapeJSON(val), `[${tStr.toUpperCase()}] ${key}: ${dVal}`, `data-key="${key}" data-timing="${tStr}"`);
        }).join('');

        const getForteOpts = () => {
            const dbC = (typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[BuilderState.activeChar]) ? CHARACTER_DB[BuilderState.activeChar] : {};
            const c = dbC.forteCount || 1;
            
            let str = ``;
            for (let i = 1; i <= c; i++) str += `<option value="forte${i}">Forte ${i}</option>`;
            return str;
        };

        // --- FIXED: Add this missing variable so the HTML template doesn't crash! ---
        const castResObj = data.castResources || {};
        const holdCfg = data.holdConfig || {};

        const node = document.createElement('div');
        node.className = 'mechanic-card collapsed'; 
        node.innerHTML = `
            <div class="mechanic-card-header collapsible-header">
                <div class="flex-row gap-sm align-center" style="pointer-events: none;">
                    <span class="collapse-icon">▼</span>
                    <span class="mech-banner-name">${nameStr || 'New Mechanic'}</span>
                </div>
                <button class="base-btn icon-btn remove-node-btn btn-danger icon-btn-sm" title="Delete Node">×</button>
            </div>

            <div class="node-section">
                <div class="node-section-title collapsible-header" style="display: flex; justify-content: space-between;">
                    <span>Identity</span><span class="collapse-icon">▼</span>
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
                <div class="node-section-title collapsible-header" style="display: flex; justify-content: space-between;">
                    <span>Combat Stats</span><span class="collapse-icon">▼</span>
                </div>
                <div class="section-content">
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Cast Types</label>
                            <div class="type-tag-container mech-cast-container">${(data.castTypes || []).map(t => BuilderRenderer.generateTagHTML(t, getCastLabel(t))).join('')}</div>
                            <div class="flex-row gap-sm mt-4px">
                                <select class="base-select add-cast-select flex-1">${BuilderState.CAST_OPTIONS.map(o => `<option value="${o}">${o}</option>`).join('')}</select>
                                <button class="base-btn icon-btn add-cast-btn icon-btn-sm">+</button>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Damage Types</label>
                            <div class="type-tag-container mech-dmg-container">${(data.dmgTypes || []).map(t => BuilderRenderer.generateTagHTML(t, t)).join('')}</div>
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
                            <input type="text" class="form-input mech-mult" 
                                value='${data.hitMults && data.hitMults.length > 0 ? JSON.stringify(data.hitMults) : ""}'
                                placeholder="e.g. 150% or [50%, 100%]">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group flex-1">
                            <label class="form-label">Resources</label>
                            <div class="type-tag-container mech-res-container">${renderResTags(castResObj, 'cast')}${renderResTags(data.hitResources || {}, 'hit')}</div>
                            <div class="flex-row gap-sm mt-4px">
                                <select class="base-select add-res-timing w-100px"><option value="cast">On Cast</option><option value="hit">Per Hit</option></select>
                                <select class="base-select add-res-type w-110px"><option value="energy">Energy</option><option value="concerto">Concerto</option>${getForteOpts()}<option value="tune">Tune</option></select>
                                <input type="text" class="form-input add-res-amt flex-1" placeholder="e.g. 10, -5">
                                <button class="base-btn icon-btn add-res-btn icon-btn-sm">+</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="node-section section-physics">
                <div class="node-section-title collapsible-header" style="display: flex; justify-content: space-between;">
                    <span>Priority & Physics</span><span class="collapse-icon">▼</span>
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
                        <div class="form-group"><label class="form-label">Priority</label><input type="number" step="1" class="form-input mech-priority" value="${data.priority ?? 0}"></div>
                        <div class="form-group relative"><label class="form-label">Combo Window</label><input type="text" class="form-input dsl-input mech-combo-win w-100" value="${data.comboWindow ?? ""}" placeholder="@Default.ComboWindow"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label class="form-label">Stance Required</label><select class="base-select mech-stance-req"><option value="Any" ${(!data.stanceReq || data.stanceReq === 'Any') ? 'selected' : ''}>Any</option><option value="Grounded" ${data.stanceReq === 'Grounded' ? 'selected' : ''}>Grounded</option><option value="Midair" ${data.stanceReq === 'Midair' ? 'selected' : ''}>Midair</option></select></div>
                        <div class="form-group"><label class="form-label">Stance Result</label><select class="base-select mech-stance-res"><option value="Retain" ${(!data.stanceResult || data.stanceResult === 'Retain') ? 'selected' : ''}>Retain</option><option value="Grounded" ${data.stanceResult === 'Grounded' ? 'selected' : ''}>Grounded</option><option value="Midair" ${data.stanceResult === 'Midair' ? 'selected' : ''}>Midair</option></select></div>
                        <div class="form-group relative"><label class="form-label">Transition Time</label><input type="text" class="form-input dsl-input mech-stance-time w-100" value="${data.stanceTime ?? ""}" placeholder="0.0"></div>
                    </div>
                </div>
            </div>

            <!-- --- NEW: Hold Physics Configuration Block --- -->
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
                <div class="node-section-title collapsible-header" style="display: flex; justify-content: space-between;">
                    <span>Timeline Logic</span><span class="collapse-icon">▼</span>
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
                            <div class="type-tag-container mech-cancels-container">${(data.cancelTimings || []).map(ct => BuilderRenderer.generateTagHTML(BuilderRenderer.escapeJSON(ct), `${ct.time}s${ct.hits ? ` | Hits: ${ct.hits}` : ''}${ct.triggerRule ? ` | Rule: ${ct.triggerRule}` : ''}`)).join('')}</div>
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
                <div class="node-section-title text-gold collapsible-header" style="display: flex; justify-content: space-between;">
                    <span>Effects Array</span><span class="collapse-icon">▼</span>
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
                                
                                // --- NEW: Add Stacks ---
                                if (eff.stacks !== undefined && eff.stacks > 1) lbl += ` | Stacks: ${eff.stacks}`;
                                
                                if (eff.duration) lbl += ` | Dur: ${eff.duration}s`;
                                if (eff.maxStacks !== undefined) lbl += ` | Max: ${eff.maxStacks}`;
                                if (eff.stackBehavior === "separate") lbl += ` | Separate`;
                                if (eff.expireBehavior && eff.expireBehavior !== "clear") lbl += ` | ${eff.expireBehavior}`;
                                if (eff.target && eff.target !== '@Self') lbl += ` | Target: ${eff.target}`;
                                if (eff.applyTo) lbl += ` | Req: ${Array.isArray(eff.applyTo) ? eff.applyTo.join(', ') : eff.applyTo}`;
                                if (eff.removeOnSwap) lbl += ` | Clr on Swap`;
                                
                                return BuilderRenderer.generateTagHTML(BuilderRenderer.escapeJSON(eff), lbl);
                            }).join('')}</div>
                            
                            <div class="flex-row gap-sm mt-4px align-start">
                            <select class="base-select add-effect-type w-105px">
                                    <option value="buff">Buff</option>
                                    <option value="buffAction">Buff Control</option>
                                    <option value="resource">Resource</option>
                                    <option value="tracker">Tracker</option>
                                    <option value="time_scale">Time Scale</option>
                            </select>
                                <div class="flex-row gap-sm eff-dynamic-fields flex-1 flex-wrap">${BuilderRenderer.generateEffectInputsHTML('buff')}</div>
                                <button class="base-btn icon-btn add-effect-btn icon-btn-sm align-self-start">+</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        BuilderRenderer.attachListeners(node);
        container.appendChild(node);
    },

    // --- NEW: Pure DOM Scraper. Extracts input values and returns raw Objects. ---
    extractFormData: () => {
        const baseStats = {};
        document.querySelectorAll('.base-stat-input').forEach(input => {
            let val = input.value;
            if (val === undefined || val.trim() === "") return; 
            if (!isNaN(val) && val.trim() !== "") val = parseFloat(val);
            baseStats[input.dataset.key] = val;
        });

        // --- NEW: Scrape the Category Lore Names ---
        const skillGroupNames = {};
        document.querySelectorAll('.category-group-name').forEach(input => {
            const val = input.value.trim();
            if (val) skillGroupNames[input.dataset.cat] = val;
        });
        if (Object.keys(skillGroupNames).length > 0) baseStats.skillGroupNames = skillGroupNames;

        const mechanicsObj = {};
        document.querySelectorAll('.mechanic-card').forEach(card => {
            const id = card.querySelector('.mech-id').value;
            if (!id || id.trim() === '') return;
            
            const obj = { name: card.querySelector('.mech-name').value };

            const categoryWrap = card.closest('.mechanic-category');
            if (categoryWrap && categoryWrap.dataset.category) {
                obj.category = categoryWrap.dataset.category;
            }

            const extractStr = (selector, key, ignore = null) => { const v = card.querySelector(selector)?.value?.trim(); if (v && v !== ignore) obj[key] = v; };
            const extractMixed = (selector, key) => { const v = BuilderUtils.parseMixed(card.querySelector(selector)?.value); if (v !== undefined) obj[key] = v; };
            const extractArr = (selector, key) => { const arr = Array.from(card.querySelectorAll(selector)).map(el => el.dataset.val); if (arr.length > 0) obj[key] = arr; };

            extractStr('.mech-provider', 'provider', BuilderState.activeChar);
            if (card.querySelector('.mech-is-passive').checked) obj.isPassive = true;
            if (card.querySelector('.mech-is-swap-in') && card.querySelector('.mech-is-swap-in').checked) obj.isSwapInDefault = true;
            extractStr('.mech-rule', 'triggerRule');

            extractArr('.mech-cast-container .type-tag', 'castTypes');
            extractArr('.mech-dmg-container .type-tag', 'dmgTypes');

            // Complex Arrays
            const resTags = Array.from(card.querySelectorAll('.mech-res-container .type-tag'));
            if (resTags.length > 0) {
                const castRes = {}, hitRes = {};
                resTags.forEach(el => {
                    const parsedVal = el.dataset.val.startsWith('[') ? JSON.parse(el.dataset.val) : parseFloat(el.dataset.val);
                    if (el.dataset.timing === 'hit') hitRes[el.dataset.key] = parsedVal;
                    else castRes[el.dataset.key] = parsedVal;
                });
                if (Object.keys(castRes).length > 0) obj.castResources = castRes;
                if (Object.keys(hitRes).length > 0) obj.hitResources = hitRes;
            }

            const cancelTags = Array.from(card.querySelectorAll('.mech-cancels-container .type-tag'));
            if (cancelTags.length > 0) obj.cancelTimings = cancelTags.map(el => JSON.parse(el.dataset.val.replace(/&apos;/g, "'")));

            const effectTags = Array.from(card.querySelectorAll('.mech-effects-container .type-tag'));
            if (effectTags.length > 0) obj.effects = effectTags.map(el => JSON.parse(el.dataset.val.replace(/&apos;/g, "'")));

            // Multipliers & Scalars
            const rawMult = card.querySelector('.mech-mult').value;
            const parsedMult = BuilderUtils.parseMultiplierString(rawMult);
            
            // --- FIXED: Strictly use arrays. Never use baseMult. ---
            if (Array.isArray(parsedMult)) {
                obj.hitMults = parsedMult;
            } else if (parsedMult !== undefined) {
                // If a value was explicitly parsed, assign it as a single-element array
                obj.hitMults = [parsedMult];
            }
            
            const scalarVal = card.querySelector('.mech-scalar').value;
            if (scalarVal) obj.scalar = scalarVal;

            // Simple Physics & Timings
            extractMixed('.mech-dur', 'actionDuration');
            extractMixed('.mech-cd', 'cooldown');
            extractMixed('.mech-swap', 'swapTiming');
            extractMixed('.mech-freeze', 'freezeTime');
            extractMixed('.mech-combo-win', 'comboWindow');
            extractMixed('.mech-stance-time', 'stanceTime');
            
            // Text Dropdowns
            extractStr('.mech-input', 'input');
            extractStr('.mech-input-type', 'inputType', 'Press');
            extractStr('.mech-stance-req', 'stanceReq', 'Any');
            extractStr('.mech-stance-res', 'stanceResult', 'Retain');

            // --- NEW: Extract Hold Configuration if input is Release ---
            if (obj.inputType === 'Release') {
                const holdCfg = {};
                
                const mode = card.querySelector('.mech-hold-mode')?.value;
                if (mode && mode !== 'pingpong') holdCfg.cursorMode = mode;
                
                const speed = parseFloat(card.querySelector('.mech-hold-speed')?.value);
                if (!isNaN(speed) && speed !== 100) holdCfg.cursorSpeed = speed;
                
                const maxVal = parseFloat(card.querySelector('.mech-hold-max')?.value);
                if (!isNaN(maxVal) && maxVal !== 100) holdCfg.maxCursorVal = maxVal;
                
                if (card.querySelector('.mech-hold-retain')?.checked) holdCfg.retainCursor = true;
                
                const wCenter = card.querySelector('.mech-hold-center')?.value?.trim();
                if (wCenter && wCenter !== '65') holdCfg.windowCenter = wCenter;
                
                const wSize = card.querySelector('.mech-hold-size')?.value?.trim();
                if (wSize && wSize !== '10') holdCfg.windowSize = wSize;
                
                if (Object.keys(holdCfg).length > 0) {
                    obj.holdConfig = holdCfg;
                }
            }
            
            const prio = parseInt(card.querySelector('.mech-priority').value, 10);
            if (!isNaN(prio) && prio !== 0) obj.priority = prio;

            // Damage Timeframe
            const dmgStart = BuilderUtils.parseMixed(card.querySelector('.mech-dmgstart').value);
            const dmgEnd = BuilderUtils.parseMixed(card.querySelector('.mech-dmgend').value);
            if (dmgStart !== undefined || dmgEnd !== undefined) {
                obj.damageTimeframe = {};
                if (dmgStart !== undefined) obj.damageTimeframe.start = dmgStart;
                if (dmgEnd !== undefined) obj.damageTimeframe.end = dmgEnd;
            }

            mechanicsObj[id] = obj;
        });

        return { baseStats, mechanicsObj };
    },

    attachListeners: (node) => {
        const updateId = () => {
            const nm = node.querySelector('.mech-name').value.trim();
            const pageOwner = BuilderState.activeChar === "Generic" ? "System" : BuilderState.activeChar;
            node.querySelector('.mech-id').value = nm ? BuilderUtils.generateId(pageOwner, nm) : '';
            node.querySelector('.mech-banner-name').innerText = nm || 'New Mechanic';
            BuilderGUIController.refreshOutput();
        };
        
        node.querySelector('.mech-name').addEventListener('input', updateId);
        node.querySelector('.mech-provider').addEventListener('input', BuilderGUIController.refreshOutput);
        
        // --- NEW: Stance Transition Disable Logic ---
        const stanceResSel = node.querySelector('.mech-stance-res');
        const stanceTimeInput = node.querySelector('.mech-stance-time');
        
        const updateStanceTimeState = () => {
            const container = stanceTimeInput.closest('.form-group');
            if (stanceResSel.value === 'Retain') {
                stanceTimeInput.disabled = true;
                stanceTimeInput.value = ""; // Clear it so it disappears from the output JSON!
                container.style.opacity = '0.4';
                container.style.pointerEvents = 'none';
            } else {
                stanceTimeInput.disabled = false;
                container.style.opacity = '1';
                container.style.pointerEvents = 'auto';
            }
        };

        stanceResSel.addEventListener('change', () => {
            updateStanceTimeState();
            BuilderGUIController.refreshOutput();
        });
        updateStanceTimeState();
        
        // --- NEW: Hold Physics Section Toggle Logic ---
        const inputTypeSel = node.querySelector('.mech-input-type');
        const holdConfigRow = node.querySelector('.hold-config-row');
        
        const updateHoldVisibility = () => {
            if (holdConfigRow && inputTypeSel) {
                if (inputTypeSel.value === 'Release') {
                    holdConfigRow.style.display = 'flex';
                } else {
                    holdConfigRow.style.display = 'none';
                }
            }
        };
        
        if (inputTypeSel) {
            inputTypeSel.addEventListener('change', () => {
                updateHoldVisibility();
                BuilderGUIController.refreshOutput();
            });
        }
        
        // Trigger live output updates for all the new hold inputs
        node.querySelectorAll('.mech-hold-mode, .mech-hold-speed, .mech-hold-max, .mech-hold-retain, .mech-hold-center, .mech-hold-size').forEach(el => {
            el.addEventListener('input', () => { BuilderGUIController.refreshOutput(); });
            el.addEventListener('change', () => { BuilderGUIController.refreshOutput(); });
        });

        // Run once on load to set initial state correctly
        updateHoldVisibility();

        // --- FIXED: Is Passive Section Toggle Logic ---
        const isPassiveCheck = node.querySelector('.mech-is-passive');
        const physicsSection = node.querySelector('.section-physics');

        const updatePassiveState = () => {
            const isPassive = isPassiveCheck.checked;
            
            // FIX: Use '' instead of 'block' so the stylesheet's .collapsed classes can take over!
            const displayState = isPassive ? 'none' : ''; 
            
            if (physicsSection) physicsSection.style.display = displayState;
        };

        isPassiveCheck.addEventListener('change', () => {
            updatePassiveState();
            BuilderGUIController.refreshOutput();
        });
        
        // Run once on load to set initial state correctly
        updatePassiveState();


        node.querySelector('.mechanic-card-header').addEventListener('click', (e) => {
            if (e.target.closest('button')) return; 
            node.classList.toggle('collapsed');
        });

        node.querySelectorAll('.node-section-title').forEach(header => {
            header.addEventListener('click', () => { header.closest('.node-section').classList.toggle('collapsed'); });
        });

        node.querySelectorAll('.dsl-input').forEach(el => BuilderRenderer.bindAutocomplete(el));

        const typeSel = node.querySelector('.add-effect-type');
        const dynFields = node.querySelector('.eff-dynamic-fields');

        const rebind = () => {
            dynFields.querySelectorAll('.dsl-input').forEach(el => BuilderRenderer.bindAutocomplete(el));
        };

        typeSel.addEventListener('change', () => { dynFields.innerHTML = BuilderRenderer.generateEffectInputsHTML(typeSel.value); rebind(); });
        rebind();

        node.addEventListener('click', (e) => {
            // 1. Handle Explicit Removals (Clicking the X)
            if (e.target.classList.contains('type-tag-remove')) { 
                e.target.closest('.type-tag').remove(); 
                BuilderGUIController.refreshOutput(); 
                return;
            }
            if (e.target.classList.contains('remove-node-btn')) { 
                node.remove(); 
                BuilderGUIController.refreshOutput(); 
                return;
            }

            // --- NEW: 2. Handle Tag Editing (Clicking the tag body) ---
            const tag = e.target.closest('.type-tag');
            if (tag) {
                const container = tag.parentElement;
                const rawVal = tag.dataset.val;

                // Route A: Cast Types
                if (container.classList.contains('mech-cast-container')) {
                    const sel = node.querySelector('.add-cast-select');
                    if (sel) sel.value = rawVal;
                }
                // Route B: Damage Types
                else if (container.classList.contains('mech-dmg-container')) {
                    const sel = node.querySelector('.add-dmg-select');
                    if (sel) sel.value = rawVal;
                }
                // Route C: Resources
                else if (container.classList.contains('mech-res-container')) {
                    node.querySelector('.add-res-timing').value = tag.dataset.timing;
                    node.querySelector('.add-res-type').value = tag.dataset.key;
                    
                    let amt = rawVal;
                    try { 
                        const parsed = JSON.parse(rawVal); 
                        if (Array.isArray(parsed)) amt = parsed.join(', ');
                    } catch(err) {}
                    node.querySelector('.add-res-amt').value = amt;
                }
                // Route D: Cancel Timings
                else if (container.classList.contains('mech-cancels-container')) {
                    try {
                        const cData = JSON.parse(rawVal);
                        node.querySelector('.add-cancel-time').value = cData.time !== undefined ? cData.time : '';
                        node.querySelector('.add-cancel-hits').value = cData.hits !== undefined ? cData.hits : '';
                        node.querySelector('.add-cancel-rule').value = cData.triggerRule || '';
                    } catch(err) {}
                }
                // Route E: Complex Effects Array
                else if (container.classList.contains('mech-effects-container')) {
                    try {
                        const effData = JSON.parse(rawVal);
                        
                        // Force the UI to rebuild the correct input layout
                        typeSel.value = effData.type || 'buff';
                        typeSel.dispatchEvent(new Event('change'));
                        
                        const setVal = (sel, val) => {
                            const el = dynFields.querySelector(sel);
                            if (el && val !== undefined) el.value = typeof val === 'object' ? JSON.stringify(val) : val;
                        };
                        
                        // Populate generic properties
                        setVal('.eff-name', effData.name);
                        
                        // Default target logic based on type
                        setVal('.eff-target', effData.target || '@Self');
                        setVal('.eff-apply-to', Array.isArray(effData.applyTo) ? effData.applyTo.join(', ') : effData.applyTo);
                        setVal('.eff-label', effData.label);
                        setVal('.eff-stat', effData.stat);
                        setVal('.eff-val', effData.value);
                        setVal('.eff-stacks', effData.stacks || 1);
                        setVal('.eff-dur', effData.duration);
                        setVal('.eff-max', effData.maxStacks);
                        setVal('.eff-stack-beh', effData.stackBehavior || 'resettable');
                        setVal('.eff-exp-beh', effData.expireBehavior || 'clear');
                        setVal('.eff-tracker-max', effData.max);
                        setVal('.eff-action', effData.action);
                        
                        const remSwap = dynFields.querySelector('.eff-rem-swap');
                        if (remSwap) remSwap.checked = !!effData.removeOnSwap;
                        
                    } catch(err) {
                        console.error("Failed to parse effect tag data", err);
                    }
                }
                
                // Pop the tag out to edit it
                tag.remove();
                BuilderGUIController.refreshOutput();
            }
        });

        const bindTags = (btnSel, selectSel, containerSel) => {
            node.querySelector(btnSel).addEventListener('click', () => {
                const selectEl = node.querySelector(selectSel), val = selectEl.value, label = selectEl.options[selectEl.selectedIndex].text; 
                if (!val) return;
                const container = node.querySelector(containerSel);
                if (!Array.from(container.querySelectorAll('.type-tag')).map(el => el.dataset.val).includes(val)) {
                    container.insertAdjacentHTML('beforeend', BuilderRenderer.generateTagHTML(val, label));
                    BuilderGUIController.refreshOutput();
                }
            });
        };
        bindTags('.add-cast-btn', '.add-cast-select', '.mech-cast-container');
        bindTags('.add-dmg-btn', '.add-dmg-select', '.mech-dmg-container');

        node.querySelector('.add-res-btn').addEventListener('click', () => {
            const timing = node.querySelector('.add-res-timing').value;
            const typeSel = node.querySelector('.add-res-type'), type = typeSel.value, label = typeSel.options[typeSel.selectedIndex].text;
            const amtStr = node.querySelector('.add-res-amt').value; if (!amtStr) return;
            
            const parsedMult = BuilderUtils.parseMultiplierString(node.querySelector('.mech-mult').value);
            const hitCount = Array.isArray(parsedMult) ? parsedMult.length : 1;
            const parts = amtStr.split(',').map(s => parseFloat(s.trim()) || 0);
            
            let dataVal, displayVal;
            if (timing === 'hit') {
                const valArr = parts.length === 1 ? Array(hitCount).fill(parts[0]) : Array.from({length: Math.max(hitCount, parts.length)}, (_, i) => parts[i] || 0);
                dataVal = JSON.stringify(valArr); displayVal = `[${valArr.map(v => v > 0 ? '+' + v : v).join(', ')}]`;
            } else {
                dataVal = parts[0]; displayVal = parts[0] > 0 ? '+' + parts[0] : parts[0];
            }
            
            const container = node.querySelector('.mech-res-container');
            container.querySelector(`.type-tag[data-key="${type}"][data-timing="${timing}"]`)?.remove();
            container.insertAdjacentHTML('beforeend', BuilderRenderer.generateTagHTML(dataVal, `[${timing.toUpperCase()}] ${label}: ${displayVal}`, `data-key="${type}" data-timing="${timing}"`));
            node.querySelector('.add-res-amt').value = ''; BuilderGUIController.refreshOutput();
        });

        node.querySelector('.add-cancel-btn').addEventListener('click', () => {
            const time = node.querySelector('.add-cancel-time').value, hits = node.querySelector('.add-cancel-hits').value, rule = node.querySelector('.add-cancel-rule').value.trim();
            if (!time) return; 
            const obj = { time: parseFloat(time) };
            if (hits) obj.hits = parseInt(hits, 10);
            if (rule) obj.triggerRule = rule;
            
            node.querySelector('.mech-cancels-container').insertAdjacentHTML('beforeend', BuilderRenderer.generateTagHTML(BuilderRenderer.escapeJSON(obj), `${obj.time}s${obj.hits ? ` | Hits: ${obj.hits}` : ''}${obj.triggerRule ? ` | Rule: ${obj.triggerRule}` : ''}`));
            node.querySelector('.add-cancel-time').value = ''; node.querySelector('.add-cancel-hits').value = ''; node.querySelector('.add-cancel-rule').value = '';
            BuilderGUIController.refreshOutput();
        });

        node.querySelector('.add-effect-btn').addEventListener('click', () => {
            const type = typeSel.value; let obj = { type };
            
            // --- FIXED: Seamlessly resolve @Namespace(Key) to Namespace_Key on extract! ---
            const getVal = (sel) => {
                let v = dynFields.querySelector(sel)?.value.trim() || '';
                if (sel === '.eff-name' || sel === '.eff-t-action') {
                    v = v.replace(/@([A-Za-z0-9_]+)\(([^)]+)\)/g, (match, p1, p2) => p1 + '_' + p2.trim());
                }
                return v;
            };
            const getNum = (sel) => { const v = getVal(sel); return v ? parseFloat(v) : undefined; };

            if (type === 'buff') {
                const tgt = getVal('.eff-target'); if (tgt && tgt !== '@Self') obj.target = tgt;
                obj.name = getVal('.eff-name'); const lbl = getVal('.eff-label'); if (lbl) obj.label = lbl;
                
                // --- NEW EXTRACTOR ---
                const applyTo = getVal('.eff-apply-to'); 
                if (applyTo) { 
                    const arr = applyTo.split(',').map(s=>s.trim()).filter(Boolean); 
                    if (arr.length > 0) obj.applyTo = arr; 
                }

                const stat = getVal('.eff-stat'); if (stat) obj.stat = stat;
                const v = getVal('.eff-val'); if (v) { const n = parseFloat(v); obj.value = (!isNaN(n) && n.toString() === v) ? n : v; }
                
                // Fetch the new stacks field
                const st = getNum('.eff-stacks'); if (st !== undefined && st !== 1) obj.stacks = st;
                
                const dur = getNum('.eff-dur'); if (dur !== undefined) obj.duration = dur;
                const max = getNum('.eff-max'); if (max !== undefined) obj.maxStacks = max;
                
                const sBeh = getVal('.eff-stack-beh'); if (sBeh === "separate") obj.stackBehavior = sBeh;
                const eBeh = getVal('.eff-exp-beh'); if (eBeh && eBeh !== "clear") obj.expireBehavior = eBeh;
                
                if (dynFields.querySelector('.eff-rem-swap')?.checked) obj.removeOnSwap = true;
            
            } else { 
                // --- RESTORED: Grab the Name and Target for all other effects! ---
                const tgt = getVal('.eff-target'); 
                if (tgt && tgt !== '@Self') obj.target = tgt;
                obj.name = getVal('.eff-name');
                
                if (type === 'tracker' || type === 'buffAction') { 
                    obj.action = getVal('.eff-action'); 
                    const v = getVal('.eff-val');
                    if (v) { 
                        // Allow strings for buffAction (ALL/HALF), otherwise try to parse floats
                        if (type === 'buffAction' && isNaN(v)) obj.value = v; 
                        else { const n = parseFloat(v); obj.value = (!isNaN(n) && n.toString() === v) ? n : v; } 
                    } 
                    if (type === 'tracker') { const tMax = getNum('.eff-tracker-max'); if (tMax !== undefined) obj.max = tMax; }
                }
                else if (type === 'resource' || type === 'time_scale') { 
                    const v = getVal('.eff-val'); 
                    if (v) {
                        if (type === 'time_scale' && v.includes('%')) obj.value = v;
                        else { const n = parseFloat(v); obj.value = (!isNaN(n) && n.toString() === v) ? n : v; } 
                    }
                    if (type === 'time_scale') { const dur = getNum('.eff-dur'); if (dur !== undefined) obj.duration = dur; }
                }
            }

            let label = obj.type.toUpperCase() + (obj.name ? ` | ${obj.name}` : '');
            
            
            if (obj.action) label += ` | Action: ${obj.action}`;
            else if (obj.stat) label += ` | ${obj.stat}: ${obj.value !== undefined ? obj.value : ''}`;
            else if (obj.value !== undefined) label += ` | Value: ${typeof obj.value === 'object' ? '{...}' : obj.value}`;
            if (obj.stacks !== undefined && obj.stacks > 1) label += ` | Stacks: ${obj.stacks}`;
            if (obj.duration) label += ` | Duration: ${obj.duration}s`;
            if (obj.maxStacks !== undefined) label += ` | Max Stacks: ${obj.maxStacks}`;
            if (obj.stackBehavior) label += ` | Behavior: ${obj.stackBehavior}`;
            if (obj.expireBehavior && obj.expireBehavior !== "clear") label += ` | ${obj.expireBehavior}`;
            if (obj.max !== undefined) label += ` | Max: ${obj.max}`;
            if (obj.target && obj.target !== '@Self') label += ` | Target: ${obj.target}`;
            if (obj.applyTo) label += ` | Req: ${obj.applyTo.join(', ')}`;
            if (obj.removeOnSwap) label += ` | Clr on Swap`;
            

            node.querySelector('.mech-effects-container').insertAdjacentHTML('beforeend', BuilderRenderer.generateTagHTML(BuilderRenderer.escapeJSON(obj), label));
            dynFields.innerHTML = BuilderRenderer.generateEffectInputsHTML(typeSel.value); rebind(); BuilderGUIController.refreshOutput();
        });

        // --- FIXED: Hover to sync and scroll JSON output (Optimized & Debounced) ---
        let hoverTimeout; // Store the timer so we can cancel it

        node.addEventListener('mouseenter', () => {
            // Cancel any pending search if we quickly moved to a new node
            clearTimeout(hoverTimeout);
            
            // Wait 150ms before running the heavy search
            hoverTimeout = setTimeout(() => {
                const id = node.querySelector('.mech-id').value;
                if (!id) return;
                const outBox = document.getElementById('json-output');
                if (!outBox) return;

                // OPTIMIZATION: Get all syntax keys directly instead of looping over every line
                const keys = outBox.querySelectorAll('.syntax-key');
                for (const keySpan of keys) {
                    if (keySpan.innerText.includes(`"${id}":`)) {
                        const line = keySpan.closest('.code-line');
                        if (!line) continue;
                        
                        // Clear old highlights
                        outBox.querySelectorAll('.code-highlighted').forEach(el => {
                            el.style.backgroundColor = '';
                            el.classList.remove('code-highlighted');
                        });
                        
                        // Highlight the target line
                        line.classList.add('code-highlighted');
                        line.style.backgroundColor = 'rgba(212, 175, 55, 0.25)'; 
                        line.style.transition = 'background-color 0.1s ease';
                        
                        // Safely scroll ONLY the output box
                        const outBoxRect = outBox.getBoundingClientRect();
                        const lineRect = line.getBoundingClientRect();
                        const scrollTopTarget = outBox.scrollTop + (lineRect.top - outBoxRect.top) - (outBoxRect.height / 2) + (lineRect.height / 2);
                        
                        outBox.scrollTo({ top: scrollTopTarget, behavior: 'auto' });
                        break;
                    }
                }
            }, 50); 
        });

        node.addEventListener('mouseleave', () => {
            // Cancel the search if the mouse leaves before 150ms is up!
            clearTimeout(hoverTimeout); 
            
            const outBox = document.getElementById('json-output');
            if (outBox) {
                outBox.querySelectorAll('.code-highlighted').forEach(el => {
                    el.style.backgroundColor = '';
                    el.classList.remove('code-highlighted');
                });
            }
        });
    }
};