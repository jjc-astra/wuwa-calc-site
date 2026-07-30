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
            let filteredItems = items;
            if (searchTerm.trim() !== "") {
                const lowerTerm = searchTerm.toLowerCase();
                filteredItems = items.filter(item => item.toLowerCase().includes(lowerTerm));
            }
            if (!filteredItems || filteredItems.length === 0) return;

            const section = document.createElement('div');
            section.className = 'grid-section';
            section.innerHTML = `
                <div class="text-gold mb-4px" style="font-size: 1.1em; font-weight: bold; border-bottom: 1px solid #444; padding-bottom: 4px;">${title}</div>
                <div class="item-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(85px, 1fr)); gap: 12px; margin-top: 12px;"></div>
            `;
            const grid = section.querySelector('.item-grid');

            filteredItems.forEach(itemName => {
                const el = document.createElement('div');
                el.className = 'char-grid-card';
                let rarityClass = 'rarity-none';
                let iconClass = 'char-icon';

                if (imgFolder === 'Characters' || imgFolder === 'Weapons') {
                    let rarity = (dbRef && dbRef[itemName]?.rarity) ? dbRef[itemName].rarity : 5;
                    rarityClass = `rarity-${rarity}`;
                } else if (imgFolder === 'Echo Sets' || imgFolder === 'System') {
                    iconClass += ' echo-set-icon';
                }

                const fontSize = (imgFolder === 'Characters') ? '0.8em' : '0.65em';
                el.innerHTML = `
                    <div class="${iconClass} ${rarityClass}">
                        <img class="char-grid-img opacity-0" src="">
                        <span class="char-fallback opacity-0">${itemName.charAt(0)}</span>
                    </div>
                    <div class="char-name-label" style="font-size: ${fontSize}; line-height: 1.2; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${itemName}</div>
                `;

                if (typeof CommonUtils !== 'undefined') {
                    CommonUtils.updateImage(el, '.char-grid-img', '.char-fallback', imgFolder, itemName);
                }

                el.addEventListener('click', () => BuilderGUIController.openEditor(itemName, imgFolder, rarityClass === 'rarity-none' ? 5 : parseInt(rarityClass.replace('rarity-', ''))));
                grid.appendChild(el);
            });

            masterGrid.appendChild(section);
        };

        if (typeof CHARACTER_DB !== 'undefined') buildSection("Characters", Object.keys(CHARACTER_DB), CHARACTER_DB, 'Characters');
        if (typeof WEAPON_DB !== 'undefined') buildSection("Weapons", Object.keys(WEAPON_DB), WEAPON_DB, 'Weapons');
        if (typeof ALL_MAIN_ECHOES !== 'undefined') buildSection("Main Echoes", ALL_MAIN_ECHOES, null, 'Echoes');
        if (typeof SONATA_SETS !== 'undefined') buildSection("Echo Sets", SONATA_SETS, null, 'Echo Sets');
        buildSection("System", ["Generic"], null, 'System');
    },

    buildBaseStatsForm: (itemName) => {
        const container = document.getElementById('base-stats-form');

        if (typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[itemName]) {
            const stats = CHARACTER_DB[itemName];
            const fCount = stats.forteCount || 1;

            const makeInput = (key, label, defaultVal = '', placeholder = '') => `
                <div class="form-group flex-1" style="min-width: 120px;">
                    <label class="form-label text-dim">${label}</label>
                    <input type="text" class="form-input base-stat-input w-100" data-key="${key}" value="${stats[key] !== undefined ? stats[key] : defaultVal}" placeholder="${placeholder}">
                </div>`;
            const talentOpts = ["", "ATK %", "HP %", "DEF %", "CR Rate", "CR DMG", "Healing Bonus", "Glacio DMG", "Fusion DMG", "Electro DMG", "Aero DMG", "Spectro DMG", "Havoc DMG", "Physical DMG"];
            const makeSelect = (key, label, currentVal) => `
                <div class="form-group flex-1" style="min-width: 120px;">
                    <label class="form-label text-dim">${label}</label>
                    <select class="base-select base-stat-input w-100" data-key="${key}">
                        ${talentOpts.map(opt => `<option value="${opt}" ${currentVal === opt ? 'selected' : ''}>${opt || "None"}</option>`).join('')}
                    </select>
                </div>`;

            let html = Templates.Builder.generateGroupWrapper("Identity",
                makeInput('weaponType', 'Weapon Type') + makeInput('element', 'Element') + makeInput('rarity', 'Rarity', 5)
            );
            html += Templates.Builder.generateGroupWrapper("Base Values",
                makeInput('baseAtk', 'Base ATK') + makeInput('baseHP', 'Base HP') + makeInput('baseDef', 'Base DEF') + makeInput('baseCritRate', 'Base CR Rate', 5) + makeInput('baseCritDmg', 'Base CR DMG', 150)
            );
            html += Templates.Builder.generateGroupWrapper("Talent Nodes",
                makeSelect('talentStat1', 'Stat Node 1', stats.talentStat1) + makeInput('talentVal1', 'Value 1', '', 'e.g. 8%') + makeSelect('talentStat2', 'Stat Node 2', stats.talentStat2) + makeInput('talentVal2', 'Value 2', '', 'e.g. 12%')
            );

            let resourceFields = makeInput('maxEnergy', 'Max Energy') + makeInput('forteCount', 'Forte Count');
            for (let i = 1; i <= fCount; i++) {
                resourceFields += makeInput(`maxForte${i}`, `Max Forte ${i}`);
            }
            html += Templates.Builder.generateGroupWrapper("Resources", resourceFields);
            container.innerHTML = html;

            const countInput = container.querySelector('.base-stat-input[data-key="forteCount"]');
            if (countInput) {
                countInput.addEventListener('change', (e) => {
                    CHARACTER_DB[itemName].forteCount = parseInt(e.target.value) || 1;
                    BuilderRenderer.buildBaseStatsForm(itemName);
                    BuilderRenderer.buildMechanicsAccordion(itemName);
                });
            }
        } else if (typeof WEAPON_DB !== 'undefined' && WEAPON_DB[itemName]) {
            const stats = WEAPON_DB[itemName];
            const makeInput = (key, label, defaultVal = '', placeholder = '') => `
                <div class="form-group flex-1" style="min-width: 120px;">
                    <label class="form-label text-dim">${label}</label>
                    <input type="text" class="form-input base-stat-input w-100" data-key="${key}" value="${stats[key] !== undefined ? stats[key] : defaultVal}" placeholder="${placeholder}">
                </div>`;

            let html = Templates.Builder.generateGroupWrapper("Identity", makeInput('weaponType', 'Weapon Type') + makeInput('rarity', 'Rarity', 5));
            html += Templates.Builder.generateGroupWrapper("Base Stats", makeInput('baseAtk', 'Base ATK'));
            html += Templates.Builder.generateGroupWrapper("Sub Stat", makeInput('subStatType', 'Type', '', 'e.g. CR Rate') + makeInput('subStatValue', 'Value', '', 'e.g. 24.3%'));
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

        if (typeof MECHANICS_DB !== 'undefined') {
            Object.keys(MECHANICS_DB).forEach(key => {
                const mechData = MECHANICS_DB[key];
                const belongsToCurrentPage = (itemName === "Generic") 
                    ? (key.startsWith("System_") || mechData.provider === "System")
                    : key.startsWith(itemName + "_");

                if (belongsToCurrentPage) {
                    let targetCategory = "Inherent Skill";
                    if (mechData.category && targetCategories.includes(mechData.category)) {
                        targetCategory = mechData.category;
                    } else if (itemName === "Generic") {
                        targetCategory = "System Mechanics";
                    } else if (!isCharacter) {
                        if (targetCategories.includes("Echo Skill")) {
                            const isEchoPassive = mechData.isPassive || key.toLowerCase().includes("passive") || mechData.name.toLowerCase().includes("passive") || (mechData.triggerRule && mechData.triggerRule.trim().startsWith("ALWAYS"));
                            targetCategory = isEchoPassive ? "Echo Passive" : "Echo Skill";
                        } else if (targetCategories.length === 1) {
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

    bindAutocomplete: (input) => BuilderRenderer._bindAutocompleteInternal(input),
    generateTagHTML: (val, label, extra = '') => Templates.Builder.generateTagHTML(val, label, extra),
    escapeJSON: (obj) => JSON.stringify(obj).replace(/'/g, "&apos;"),
    generateEffectInputsHTML: (type) => Templates.Builder.generateEffectInputsHTML(type),

    addMechanicNode: (container, category, existingId = null, existingData = null, templateKey = null) => {
        const isGen = BuilderState.activeChar === "Generic";
        let data = existingData || {
            ...(BuilderState.templates[templateKey] || { name: "New Mechanic", triggerRule: "", isPassive: isGen, isGeneric: isGen }),
            castTypes: BuilderState.templates[templateKey]?.castTypes || [],
            dmgTypes: BuilderState.templates[templateKey]?.dmgTypes || [],
            effects: BuilderState.templates[templateKey]?.effects ? new Function("return " + BuilderState.templates[templateKey].effects)() : [],
            isGeneric: isGen
        };

        if (!existingData && !isGen && typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[BuilderState.activeChar]) {
            const charElement = CHARACTER_DB[BuilderState.activeChar].element;
            if (charElement) {
                const elements = ["Glacio", "Aero", "Electro", "Fusion", "Spectro", "Havoc", "Physical"];
                if (data.dmgTypes.length === 0 && !data.isPassive) {
                    data.dmgTypes = [charElement];
                } else {
                    data.dmgTypes = data.dmgTypes.map(t => elements.includes(t) ? charElement : t);
                }
            }
        }

        const pageOwner = isGen ? "System" : BuilderState.activeChar;
        const providerStr = data.provider || pageOwner;
        const nameStr = data.name || '';
        const nodeID = existingId || BuilderUtils.generateId(pageOwner, nameStr);

        const node = document.createElement('div');
        node.className = 'mechanic-card collapsed';
        node.innerHTML = Templates.Builder.generateNodeCardHTML(data, nodeID, providerStr, nameStr);

        BuilderRenderer.attachListeners(node);
        container.appendChild(node);
    },

    extractFormData: () => {
        const baseStats = {};
        document.querySelectorAll('.base-stat-input').forEach(input => {
            let val = input.value;
            if (val === undefined || val.trim() === "") return;
            if (!isNaN(val) && val.trim() !== "") val = parseFloat(val);
            baseStats[input.dataset.key] = val;
        });

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

            const rawMult = card.querySelector('.mech-mult').value;
            const parsedMult = BuilderUtils.parseMultiplierString(rawMult);
            if (Array.isArray(parsedMult)) {
                obj.hitMults = parsedMult;
            } else if (parsedMult !== undefined) {
                obj.hitMults = [parsedMult];
            }

            const scalarVal = card.querySelector('.mech-scalar').value;
            if (scalarVal) obj.scalar = scalarVal;

            extractMixed('.mech-dur', 'actionDuration');
            extractMixed('.mech-cd', 'cooldown');
            extractMixed('.mech-swap', 'swapTiming');
            extractMixed('.mech-freeze', 'freezeTime');
            extractMixed('.mech-combo-win', 'comboWindow');
            extractMixed('.mech-stance-time', 'stanceTime');

            extractStr('.mech-input', 'input');
            extractStr('.mech-input-type', 'inputType', 'Press');
            extractStr('.mech-stance-req', 'stanceReq', 'Any');
            extractStr('.mech-stance-res', 'stanceResult', 'Retain');

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
                if (Object.keys(holdCfg).length > 0) obj.holdConfig = holdCfg;
            }

            const prio = extractMixed('.mech-priority', 'priority');
            if (!isNaN(prio) && prio !== 0) obj.priority = prio;

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

        const stanceResSel = node.querySelector('.mech-stance-res');
        const stanceTimeInput = node.querySelector('.mech-stance-time');
        const updateStanceTimeState = () => {
            const container = stanceTimeInput.closest('.form-group');
            if (stanceResSel.value === 'Retain') {
                stanceTimeInput.disabled = true;
                stanceTimeInput.value = "";
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

        const inputTypeSel = node.querySelector('.mech-input-type');
        const holdConfigRow = node.querySelector('.hold-config-row');
        const updateHoldVisibility = () => {
            if (holdConfigRow && inputTypeSel) {
                holdConfigRow.style.display = inputTypeSel.value === 'Release' ? 'flex' : 'none';
            }
        };

        if (inputTypeSel) {
            inputTypeSel.addEventListener('change', () => {
                updateHoldVisibility();
                BuilderGUIController.refreshOutput();
            });
        }

        node.querySelectorAll('.mech-hold-mode, .mech-hold-speed, .mech-hold-max, .mech-hold-retain, .mech-hold-center, .mech-hold-size').forEach(el => {
            el.addEventListener('input', () => { BuilderGUIController.refreshOutput(); });
            el.addEventListener('change', () => { BuilderGUIController.refreshOutput(); });
        });
        updateHoldVisibility();

        const isPassiveCheck = node.querySelector('.mech-is-passive');
        const physicsSection = node.querySelector('.section-physics');
        const updatePassiveState = () => {
            const isPassive = isPassiveCheck.checked;
            if (physicsSection) physicsSection.style.display = isPassive ? 'none' : '';
        };
        isPassiveCheck.addEventListener('change', () => {
            updatePassiveState();
            BuilderGUIController.refreshOutput();
        });
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

            const tag = e.target.closest('.type-tag');
            if (tag) {
                const container = tag.parentElement;
                const rawVal = tag.dataset.val;

                if (container.classList.contains('mech-cast-container')) {
                    const sel = node.querySelector('.add-cast-select');
                    if (sel) sel.value = rawVal;
                } else if (container.classList.contains('mech-dmg-container')) {
                    const sel = node.querySelector('.add-dmg-select');
                    if (sel) sel.value = rawVal;
                } else if (container.classList.contains('mech-res-container')) {
                    node.querySelector('.add-res-timing').value = tag.dataset.timing;
                    node.querySelector('.add-res-type').value = tag.dataset.key;
                    let amt = rawVal;
                    try {
                        const parsed = JSON.parse(rawVal);
                        if (Array.isArray(parsed)) amt = parsed.join(', ');
                    } catch(err) {}
                    node.querySelector('.add-res-amt').value = amt;
                } else if (container.classList.contains('mech-cancels-container')) {
                    try {
                        const cData = JSON.parse(rawVal);
                        node.querySelector('.add-cancel-time').value = cData.time !== undefined ? cData.time : '';
                        node.querySelector('.add-cancel-hits').value = cData.hits !== undefined ? cData.hits : '';
                        node.querySelector('.add-cancel-rule').value = cData.triggerRule || '';
                    } catch(err) {}
                } else if (container.classList.contains('mech-effects-container')) {
                    try {
                        const effData = JSON.parse(rawVal);
                        typeSel.value = effData.type || 'buff';
                        typeSel.dispatchEvent(new Event('change'));

                        const setVal = (sel, val) => {
                            const el = dynFields.querySelector(sel);
                            if (el && val !== undefined) el.value = typeof val === 'object' ? JSON.stringify(val) : val;
                        };

                        setVal('.eff-name', effData.name);
                        setVal('.eff-target', effData.target || '@Self');
                        setVal('.eff-apply-to', Array.isArray(effData.applyTo) ? effData.applyTo.join(', ') : effData.applyTo);
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
                    container.insertAdjacentHTML('beforeend', Templates.Builder.generateTagHTML(val, label));
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
            container.insertAdjacentHTML('beforeend', Templates.Builder.generateTagHTML(dataVal, `[${timing.toUpperCase()}] ${label}: ${displayVal}`, `data-key="${type}" data-timing="${timing}"`));
            node.querySelector('.add-res-amt').value = ''; BuilderGUIController.refreshOutput();
        });

        node.querySelector('.add-cancel-btn').addEventListener('click', () => {
            const time = node.querySelector('.add-cancel-time').value, hits = node.querySelector('.add-cancel-hits').value, rule = node.querySelector('.add-cancel-rule').value.trim();
            if (!time) return;

            const obj = { time: parseFloat(time) };
            if (hits) obj.hits = parseInt(hits, 10);
            if (rule) obj.triggerRule = rule;

            node.querySelector('.mech-cancels-container').insertAdjacentHTML('beforeend', Templates.Builder.generateTagHTML(BuilderRenderer.escapeJSON(obj), `${obj.time}s${obj.hits ? ` | Hits: ${obj.hits}` : ''}${obj.triggerRule ? ` | Rule: ${obj.triggerRule}` : ''}`));
            node.querySelector('.add-cancel-time').value = ''; node.querySelector('.add-cancel-hits').value = ''; node.querySelector('.add-cancel-rule').value = '';
            BuilderGUIController.refreshOutput();
        });

        node.querySelector('.add-effect-btn').addEventListener('click', () => {
            const type = typeSel.value; let obj = { type };
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
                obj.name = getVal('.eff-name');
                const applyTo = getVal('.eff-apply-to');
                if (applyTo) {
                    const arr = applyTo.split(',').map(s=>s.trim()).filter(Boolean);
                    if (arr.length > 0) obj.applyTo = arr;
                }
                const stat = getVal('.eff-stat'); if (stat) obj.stat = stat;
                const v = getVal('.eff-val'); if (v) { const n = parseFloat(v); obj.value = (!isNaN(n) && n.toString() === v) ? n : v; }
                const st = getNum('.eff-stacks'); if (st !== undefined && st !== 1) obj.stacks = st;
                const dur = getNum('.eff-dur'); if (dur !== undefined) obj.duration = dur;
                const max = getNum('.eff-max'); if (max !== undefined) obj.maxStacks = max;
                const sBeh = getVal('.eff-stack-beh'); if (sBeh === "separate") obj.stackBehavior = sBeh;
                const eBeh = getVal('.eff-exp-beh'); if (eBeh && eBeh !== "clear") obj.expireBehavior = eBeh;
                if (dynFields.querySelector('.eff-rem-swap')?.checked) obj.removeOnSwap = true;
            } else {
                const tgt = getVal('.eff-target');
                if (tgt && tgt !== '@Self') obj.target = tgt;
                obj.name = getVal('.eff-name');
                if (type === 'tracker' || type === 'buffAction') {
                    obj.action = getVal('.eff-action');
                    const v = getVal('.eff-val');
                    if (v) {
                        if (type === 'buffAction' && isNaN(v)) obj.value = v;
                        else { const n = parseFloat(v); obj.value = (!isNaN(n) && n.toString() === v) ? n : v; }
                    }
                    if (type === 'tracker') { const tMax = getNum('.eff-tracker-max'); if (tMax !== undefined) obj.max = tMax; }
                } else if (type === 'resource' || type === 'time_scale') {
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

            node.querySelector('.mech-effects-container').insertAdjacentHTML('beforeend', Templates.Builder.generateTagHTML(BuilderRenderer.escapeJSON(obj), label));
            dynFields.innerHTML = Templates.Builder.generateEffectInputsHTML(typeSel.value); rebind(); BuilderGUIController.refreshOutput();
        });

        let hoverTimeout;
        node.addEventListener('mouseenter', () => {
            clearTimeout(hoverTimeout);
            hoverTimeout = setTimeout(() => {
                const id = node.querySelector('.mech-id').value;
                if (!id) return;
                const outBox = document.getElementById('json-output');
                if (!outBox) return;
                const keys = outBox.querySelectorAll('.syntax-key');
                for (const keySpan of keys) {
                    if (keySpan.innerText.includes(`"${id}":`)) {
                        const line = keySpan.closest('.code-line');
                        if (!line) continue;
                        outBox.querySelectorAll('.code-highlighted').forEach(el => {
                            el.style.backgroundColor = '';
                            el.classList.remove('code-highlighted');
                        });
                        line.classList.add('code-highlighted');
                        line.style.backgroundColor = 'rgba(212, 175, 55, 0.25)';
                        line.style.transition = 'background-color 0.1s ease';
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
            clearTimeout(hoverTimeout);
            const outBox = document.getElementById('json-output');
            if (outBox) {
                outBox.querySelectorAll('.code-highlighted').forEach(el => {
                    el.style.backgroundColor = '';
                    el.classList.remove('code-highlighted');
                });
            }
        });
    },

    _bindAutocompleteInternal: (input) => {
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
            const statKeys = typeof BuilderState !== 'undefined' && BuilderState.STAT_OPTIONS ? BuilderState.STAT_OPTIONS : [];
            const sheetStats = statKeys.map(v => ({val: v, group: "Sheet Stats"}));
            const combatMods = ["DMG Bonus", "DMG Amp", "Deepen", "DMG Taken", "Reduce RES", "RES Shred", "Ignore RES", "RES Pen", "Reduce DEF", "Ignore DEF", "Additive Mult", "Multiplicative Mult"].map(v => ({val: v, group: "Combat Modifiers"}));
            let specificMods = [];
            if (typeof BuilderState !== 'undefined' && BuilderState.DMG_OPTIONS) {
                BuilderState.DMG_OPTIONS.forEach(dmgType => {
                    ["DMG Bonus", "DMG Amp", "Deepen", "DMG Taken", "Ignore RES", "Ignore DEF", "Additive Mult", "Multiplicative Mult"].forEach(mod => {
                        specificMods.push({val: `${dmgType} ${mod}`, group: "Specific Modifiers"});
                    });
                });
            }
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
                        if (typeof MECHANICS_INDEX !== 'undefined') {
                            if (MECHANICS_INDEX[namespace]) MECHANICS_INDEX[namespace].forEach(k => mechKeys.add(k));
                            if (MECHANICS_INDEX['System']) MECHANICS_INDEX['System'].forEach(k => mechKeys.add(k));
                        }
                        if (typeof MECHANICS_DB !== 'undefined') {
                            Object.keys(MECHANICS_DB).forEach(k => mechKeys.add(k));
                            Object.values(MECHANICS_DB).forEach(mech => {
                                const effs = Array.isArray(mech.effects) ? mech.effects : [];
                                effs.forEach(e => { if (e.name) effKeys.add(e.name); });
                            });
                        }
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
                    const searchTerms = searchStr.trim().split(/\s+/).filter(Boolean);

                    const matches = optionsList.filter(o => {
                        const optLower = o.val.toLowerCase();
                        if (searchTerms.length === 0) return true;
                        return searchTerms.every(term => optLower.includes(term));
                    });

                    if (matches.length > 0) {
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
    }
};