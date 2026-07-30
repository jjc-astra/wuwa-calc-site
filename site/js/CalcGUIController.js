// ==========================================================================
//   CALCULATOR GUI CONTROLLER
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    if (typeof DataLoader !== 'undefined') {
        await DataLoader.initDatabases();
    }

    buildTeamRows();
    generateEchoes();
    RosterUtils.bindRows();

    bindGlobalListeners();
    bindPlaceholderStyles();
    bindEchoMainStats();
    bindCollapsible();
    bindHeaderPreview();
    bindTeamPersistence();

    bindRotationBuilder();

    const container = document.getElementById('rotation-builder');
    const cachedRot = localStorage.getItem(LocalCacheManager.SAVE_KEY_ROT);
    if (cachedRot) {
        await LocalCacheManager.loadPreviousSession(container);
    }

    TooltipManager.init();
    setTimeout(() => {
        RosterRenderer.renderAll();
        document.querySelectorAll('.base-select').forEach(CommonUtils.updatePlaceholderStyle);
    }, 50);
});

// --- ROSTER BINDINGS ---

function buildTeamRows() {
    const roster = document.getElementById('team-roster');
    if (roster) roster.innerHTML = RosterUtils.generateCharCardHTML().repeat(3);
}

function generateEchoes() {
    document.querySelectorAll('.echo-container').forEach(c => c.innerHTML = RosterUtils.generateEchoesHTML());
}

function bindGlobalListeners() {
    const roster = document.getElementById('team-roster');
    if (!roster) return;

    roster.addEventListener('input', (e) => {
        RotationUtils.setCalcWarning('team');
        const target = e.target;
        if (target.classList.contains('base-slider')) RosterUtils.updateStatFromSlider(target.closest('.stat-row'), target.value);
        if (target.matches('.seq-input')) {
            CommonUtils.enforceLimit(target, 0, 6);
            const slotObj = RosterState.domMap.get(target.closest('.char-row'));
            if (slotObj) {
                RosterState.updateField(slotObj.index, 'sequence', parseInt(target.value) || 0);
                if (typeof RosterRenderer !== 'undefined' && RosterRenderer.renderIdleStats) RosterRenderer.renderIdleStats();
            }
        }
        if (target.matches('.rank-input')) {
            CommonUtils.enforceLimit(target, 1, 5);
            const slotObj = RosterState.domMap.get(target.closest('.char-row'));
            if (slotObj) {
                RosterState.updateField(slotObj.index, 'rank', parseInt(target.value) || 1);
                if (typeof RosterRenderer !== 'undefined' && RosterRenderer.renderIdleStats) RosterRenderer.renderIdleStats();
            }
        }
    });

    // Centralized event delegation routing map
    const rosterChangeHandlers = {
        'stat-select': (target) => RosterUtils.updateStatRow(target.closest('.stat-row'), true),
        'echo-main-stat-select': (target) => RosterUtils.handleEchoMainStatSelect(target.closest('.echo-card-wrap'), target.value),
        'char-select': (target) => handleCharSelectChange(target),
        'mode-select': (target) => RosterState.updateField(RosterState.domMap.get(target.closest('.char-row')).index, 'mode', target.value),
        'main-set-select': (target) => RosterUtils.handleSetSelect(target.closest('.panel-col'), target.value),
        'layout-select': (target) => RosterUtils.updateEchoMainStats(target.closest('.char-row'), target.value),
        'wep-select': (target) => RosterUtils.handleWeaponSelect(target.closest('.char-row'), target.value),
        'sub-set-select': (target) => RosterUtils.handleSubSetSelect(target.closest('.char-row'), target.value),
        'main-echo-select': (target) => RosterUtils.handleMainEchoSelect(target.closest('.char-row'), target.value)
    };

    roster.addEventListener('change', (e) => {
        RotationUtils.setCalcWarning('team');
        const target = e.target;
        if (target.classList.contains('base-select')) CommonUtils.updatePlaceholderStyle(target);

        for (const [cls, handler] of Object.entries(rosterChangeHandlers)) {
            if (target.classList.contains(cls)) {
                handler(target);
                break;
            }
        }
    });

    roster.addEventListener('click', (e) => {
        const target = e.target;
        if (target.closest('.quick-build-btn')) {
            e.preventDefault();
            const row = target.closest('.char-row');
            const charName = row.querySelector('.char-select').value;
            if (charName) {
                RosterUtils.applyRecommendedBuild(RosterState.domMap.get(row).index, charName);
                RotationUtils.setCalcWarning('team');
            }
        }
    });

    const defaults = ['CR Rate', 'CR DMG', 'ATK %', 'ER %', 'ATK'];
    document.querySelectorAll('.echo-list').forEach(list => {
        list.querySelectorAll('.stat-row').forEach((row, i) => {
            const sel = row.querySelector('.stat-select');
            if (sel.value === "" || sel.value === "N/A") sel.value = defaults[i] || 'N/A';
        });
    });

    const idleContainer = document.getElementById('idle-stats-container');
    if (idleContainer) {
        idleContainer.addEventListener('input', (e) => {
            const target = e.target;
            if (target.classList.contains('enemy-level-input')) {
                CommonUtils.enforceLimit(target, 1, 100);
                RosterState.enemy.level = parseInt(target.value) || 90;
                if (typeof RotationUtils !== 'undefined') RotationUtils.setCalcWarning('enemy');
            }
            if (target.classList.contains('enemy-res-input')) {
                CommonUtils.enforceLimit(target, -100, 100);
                RosterState.enemy.res = parseInt(target.value) || 10;
                if (typeof RotationUtils !== 'undefined') RotationUtils.setCalcWarning('enemy');
            }
            if (target.classList.contains('enemy-hp-input')) {
                const val = parseInt(target.value);
                RosterState.enemy.hp = val > 0 ? val : 3000000;
                if (typeof RotationUtils !== 'undefined') RotationUtils.setCalcWarning('enemy');
            }
        });
    }
}

function handleCharSelectChange(target) {
    const row = target.closest('.char-row');
    RosterUtils.handleCharSelect(row, target.value);
    const options = RosterUtils.getCurrentTeamOptionsHTML();
    document.querySelectorAll('.rotation-row .unit-select').forEach(s => {
        const oldVal = s.value;
        s.innerHTML = options;
        s.value = oldVal;
        if (!s.value) {
            const rotRow = s.closest('.rotation-row');
            RotationState.updateField(rotRow, 'unit', "");
            RotationState.updateField(rotRow, 'action', "");
            RotationUtils.updateActionOptions(rotRow, "");
        }
    });
    RotationUtils.runSimulation();
}

function bindEchoMainStats() {
    document.querySelectorAll('.layout-select').forEach(layoutSelect => {
        RosterUtils.updateEchoMainStats(layoutSelect.closest('.char-row'), layoutSelect.value);
    });
}

function bindPlaceholderStyles() {
    document.querySelectorAll('.base-select').forEach(CommonUtils.updatePlaceholderStyle);
}

function bindHeaderPreview() {
    const update = () => RosterUtils.updateHeaderPreview();
    const roster = document.getElementById('team-roster');
    if (roster) roster.addEventListener('change', () => requestAnimationFrame(update));
    update();
}

function bindCollapsible() {
    const headers = document.querySelectorAll('.section-header');
    const allWrappers = document.querySelectorAll('.section-wrapper');

    const setWrapperState = (wrapper, isOpen) => {
        const content = wrapper.querySelector('.collapsible-content');
        const icon = wrapper.querySelector('.toggle-icon');
        const preview = wrapper.querySelector('.header-preview');
        wrapper.classList.remove('anim-done');

        if (isOpen) {
            wrapper.classList.remove('is-collapsed');
            if (content) content.classList.remove('is-collapsed');
            if (icon) icon.classList.remove('collapsed');
            if (preview) preview.classList.remove('is-visible');
            setTimeout(() => { if (!wrapper.classList.contains('is-collapsed')) wrapper.classList.add('anim-done'); }, 300);
        } else {
            wrapper.classList.add('is-collapsed');
            if (content) content.classList.add('is-collapsed');
            if (icon) icon.classList.add('collapsed');
            if (preview) preview.classList.add('is-visible');
        }
    };

    headers.forEach(header => {
        header.addEventListener('click', (e) => {
            if (e.target.closest('button') && !e.target.classList.contains('toggle-icon')) return;
            if (e.target.tagName === 'INPUT') return;
            const targetWrapper = header.closest('.section-wrapper');
            const isCurrentlyOpen = !targetWrapper.classList.contains('is-collapsed');
            if (isCurrentlyOpen) {
                setWrapperState(targetWrapper, false);
                allWrappers.forEach(w => { if (w !== targetWrapper) setWrapperState(w, true); });
            } else {
                setWrapperState(targetWrapper, true);
                allWrappers.forEach(w => { if (w !== targetWrapper) setWrapperState(w, false); });
            }
        });
    });

    const step1 = document.getElementById('step1-wrapper');
    const step2 = document.getElementById('step2-wrapper');
    if (step1 && step2) { setWrapperState(step1, true); setWrapperState(step2, false); }
}

function bindTeamPersistence() {
    const importBtn = document.getElementById('team-import-btn');
    const exportBtn = document.getElementById('team-export-btn');
    const fileInput = document.getElementById('team-import-input');
    if (!importBtn || !exportBtn) return;

    exportBtn.addEventListener('click', () => {
        const teamData = RosterUtils.extractTeamData();
        const filename = RosterUtils.generateFilename("Team");
        const a = document.createElement('a');
        a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(teamData, null, 2));
        a.download = filename;
        a.click();
    });

    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                RosterUtils.applyTeamImport(JSON.parse(ev.target.result));
            } catch (err) {
                console.error('[CalcGUIController] Error importing team:', err);
                alert("Error loading team: " + err);
            }
        };
        reader.readAsText(file);
        fileInput.value = '';
    });
}

// --- ROTATION WIRING ---

function bindRotationBuilder() {
    const container = document.getElementById('rotation-builder');
    const headerRow = document.querySelector('.rotation-header-row');
    let state = { lastSelectedIndex: null, clipboard: null, captureOldValue: null };

    _initRotationUI(container, headerRow);
    _bindRotationSelection(container, state);
    _bindRotationCommands(container, state);
    _bindRotationExternal(container);
    _bindRotationEvents(container, headerRow, state);
}

function _initRotationUI(container, headerRow) {
    if (headerRow) headerRow.innerHTML = `<div></div><div>Unit</div><div>Action</div><div>Time</div><div>Timing</div><div>Offset</div><div>DMG</div><div>Fortes</div><div>Concerto</div><div>Energy</div><div>Tune</div>`;
    const initialRow = RotationUtils.createRow(RosterUtils.getCurrentTeamOptionsHTML());
    container.appendChild(initialRow);

    RotationState.insertRow(initialRow);
    RotationUtils.updateIndices(container);
    RotationUtils.updateActionButtons(container, null);

    window.addEventListener('resize', () => {
        if (!container || !headerRow) return;
        const w = container.offsetWidth - container.clientWidth;
        headerRow.style.paddingRight = `${15 + w}px`;
    });
}

function _bindRotationSelection(container, state) {
    container.addEventListener('click', (e) => {
        const wrap = e.target.closest('.check-wrap');
        if (!wrap) return;
        e.preventDefault();

        const cb = wrap.querySelector('.row-select-check');
        const row = wrap.closest('.rotation-row');
        const rows = Array.from(container.children);
        const currentIndex = rows.indexOf(row);
        const intendedState = !cb.checked;

        if (e.shiftKey && state.lastSelectedIndex !== null) {
            const start = Math.min(state.lastSelectedIndex, currentIndex);
            const end = Math.max(state.lastSelectedIndex, currentIndex);
            rows.forEach((r, i) => {
                const shouldSelect = (i >= start && i <= end);
                const rCb = r.querySelector('.row-select-check');
                if (rCb) rCb.checked = shouldSelect;
                r.classList.toggle('selected', shouldSelect);
            });
        } else {
            rows.forEach((r, i) => {
                if (i !== currentIndex) {
                    const rCb = r.querySelector('.row-select-check');
                    if (rCb) rCb.checked = false;
                    r.classList.remove('selected');
                }
            });
            cb.checked = intendedState;
            row.classList.toggle('selected', intendedState);
            state.lastSelectedIndex = intendedState ? currentIndex : null;
        }

        RotationUtils.updateActionButtons(container, state.clipboard);
    });
}

function _bindRotationCommands(container, state) {
    const performDelete = () => {
        const selected = Array.from(container.querySelectorAll('.rotation-row.selected'));
        const toDelete = selected.filter(r => r !== container.lastElementChild);
        if (toDelete.length > 0) {
            history.execute(new DeleteRowsCommand(container, toDelete));
            state.lastSelectedIndex = null;
            RotationUtils.updateActionButtons(container, state.clipboard);
        }
    };

    const performInsert = (direction) => {
        const selected = container.querySelector('.rotation-row.selected');
        if (!selected) return;
        const activeData = RotationState.data;
        const currentIndex = activeData.indexOf(RotationState.getData(selected));
        if (currentIndex === -1) return;
        const targetIndex = Math.min(currentIndex + direction, activeData.length - 1);
        const newRow = RotationUtils.createRow(RosterUtils.getCurrentTeamOptionsHTML(), targetIndex);
        newRow.querySelector('.unit-select').value = "";
        history.execute(new AddRowCommand(container, newRow, targetIndex));
    };

    const performCopy = () => {
        const validRows = Array.from(container.querySelectorAll('.rotation-row.selected')).filter(row => row !== container.lastElementChild);
        if (validRows.length > 0) state.clipboard = RotationUtils.extractData(validRows);

        container.querySelectorAll('.rotation-row.selected').forEach(r => {
            r.classList.remove('selected');
            const cb = r.querySelector('.row-select-check');
            if (cb) cb.checked = false;
        });
        RotationUtils.updateActionButtons(container, state.clipboard);
    };

    const performPaste = () => {
        if (!state.clipboard || state.clipboard.length === 0) return;
        const selectedRows = Array.from(container.querySelectorAll('.rotation-row.selected')).filter(row => row !== container.lastElementChild);
        const factory = (targetIndex) => RotationUtils.createRow(RosterUtils.getCurrentTeamOptionsHTML(), targetIndex);
        const result = RotationUtils.generatePasteCommands(container, state.clipboard, selectedRows, factory);

        if (result.commands.length > 0) {
            history.execute(new CompositeCommand(result.commands));
            RotationUtils.runSimulation();
        }

        container.querySelectorAll('.rotation-row.selected').forEach(r => {
            r.classList.remove('selected');
            const cb = r.querySelector('.row-select-check');
            if (cb) cb.checked = false;
        });
        RotationUtils.updateActionButtons(container, state.clipboard);
    };

    const bindBtn = (id, action) => { const btn = document.getElementById(id); if (btn) btn.addEventListener('click', action); };
    bindBtn('rot-del-btn', performDelete);
    bindBtn('rot-up-btn', () => performInsert(0));
    bindBtn('rot-down-btn', () => performInsert(1));
    bindBtn('rot-copy-btn', performCopy);
    bindBtn('rot-paste-btn', performPaste);
    bindBtn('rot-undo-btn', () => history.undo());
    bindBtn('rot-redo-btn', () => history.redo());

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            const active = document.activeElement;
            if (active.tagName !== 'TEXTAREA' && !active.isContentEditable && !(active.tagName === 'INPUT' && !['checkbox','radio','button'].includes(active.type))) {
                e.preventDefault();
                performDelete();
            }
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); history.undo(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); history.redo(); }
    });

    history.onChangeCallback = (canUndo, canRedo) => {
        const uBtn = document.getElementById('rot-undo-btn'); if (uBtn) uBtn.disabled = !canUndo;
        const rBtn = document.getElementById('rot-redo-btn'); if (rBtn) rBtn.disabled = !canRedo;
    };
}

function _bindRotationExternal(container) {
    const exportBtn = document.getElementById('rot-export-btn');
    const importBtn = document.getElementById('rot-import-btn');
    const fileInput = document.getElementById('rot-import-input');
    const calcBtn = document.getElementById('rot-calc-btn');
    const energyToggle = document.getElementById('rot-start-energy');
    const concertoToggle = document.getElementById('rot-start-concerto');

    if (energyToggle) {
        energyToggle.addEventListener('change', (e) => {
            RotationState.startEnergy = e.target.checked;
            RotationUtils.runSimulation();
        });
    }
    if (concertoToggle) {
        concertoToggle.addEventListener('change', (e) => {
            RotationState.startConcerto = e.target.checked;
            RotationUtils.runSimulation();
        });
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            const rotationData = RotationUtils.extractData();
            if (rotationData.length === 0) return alert("Rotation is empty.");
            const exportObject = {
                rotation: rotationData,
                team: RosterUtils.extractTeamData(),
                settings: { startEnergy: RotationState.startEnergy, startConcerto: RotationState.startConcerto }
            };
            const a = document.createElement('a');
            a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObject, null, 2));
            a.download = RosterUtils.generateFilename("Rotation");
            a.click();
        });
    }

    if (importBtn && fileInput) {
        importBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (ev) => {
                try {
                    const rawData = JSON.parse(ev.target.result);
                    let rotData = Array.isArray(rawData) ? rawData : rawData.rotation;
                    if (rawData.settings) {
                        RotationState.startEnergy = rawData.settings.startEnergy !== false;
                        RotationState.startConcerto = rawData.settings.startConcerto === true;
                        if (energyToggle) energyToggle.checked = RotationState.startEnergy;
                        if (concertoToggle) concertoToggle.checked = RotationState.startConcerto;
                    }
                    if (rawData.team) {
                        await RosterUtils.applyTeamImport(rawData.team);
                    }
                    if (rotData) {
                        RotationUtils.applyRotationImport(container, rotData, () => RotationUtils.createRow(RosterUtils.getCurrentTeamOptionsHTML()));
                        if (typeof history !== 'undefined') history.clear();
                        RotationUtils.runSimulation();
                    }
                } catch (err) {
                    console.error('[CalcGUIController] Error loading rotation:', err);
                    alert("Error loading rotation.");
                }
            };
            reader.readAsText(file);
            fileInput.value = '';
        });
    }

    if (calcBtn) {
        const warnLabel = document.createElement('span');
        warnLabel.id = 'rot-calc-warning';
        warnLabel.className = 'calc-warning-msg';
        warnLabel.innerHTML = `<span id="rot-calc-warning-text">STATS CHANGED</span><svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
        calcBtn.parentNode.insertBefore(warnLabel, calcBtn);

        calcBtn.addEventListener('click', () => {
            if (typeof RotationUtils !== 'undefined' && typeof RotationUtils.runSimulation === 'function') {
                RotationUtils.runSimulation();
            }
            RotationUtils.calculateDamage();
            RotationUtils.setCalcWarning(null);
            LocalCacheManager.saveCurrentSession();
        });
    }
}

function _bindRotationEvents(container, headerRow, state) {
    container.addEventListener('row-structure-change', () => {
        RotationUtils.updateIndices(container);
        if (headerRow) { const w = container.offsetWidth - container.clientWidth; headerRow.style.paddingRight = `${15 + w}px`; }
        RotationUtils.runSimulation();
    });

    container.addEventListener('click', (e) => {
        const accordionHeader = e.target.closest('.dmg-accordion-header');
        if (accordionHeader) { accordionHeader.closest('.dmg-accordion-section').classList.toggle('is-open'); return; }

        const trigger = e.target.closest('.sub-panel-trigger');
        if (!trigger) return;

        const row = trigger.closest('.rotation-row');
        const panel = row.querySelector('.sub-panel');
        const data = RotationState.getData(row);
        if (!data || !panel) return;

        if (trigger.dataset.trigger === 'offset' && data.timing === 'Simultaneous') return;
        if (trigger.dataset.trigger === 'dmg' && (!data.damageInstances || data.damageInstances.length === 0)) return;

        const isAlreadyActive = trigger.classList.contains('is-active');
        row.querySelectorAll('.sub-panel-trigger').forEach(t => t.classList.remove('is-active'));
        if (isAlreadyActive) {
            panel.classList.remove('is-open');
            setTimeout(() => { if (!panel.classList.contains('is-open')) panel.innerHTML = ''; }, 200);
        } else {
            trigger.classList.add('is-active');
            panel.innerHTML = RotationRenderer.generatePanelContent(trigger.dataset.trigger, data.unit, data.action, row);
            panel.classList.add('is-open');
        }
    });

    container.addEventListener('focusin', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') state.captureOldValue = e.target.value;
    });

    container.addEventListener('change', (e) => {
        const target = e.target;
        const row = target.closest('.rotation-row');
        if (target.classList.contains('base-select')) CommonUtils.updatePlaceholderStyle(target);
        if (history.isExecuting || target.type === 'checkbox') return;

        const isInput = target.classList.contains('unit-select') ||
                         target.classList.contains('move-select') ||
                         target.classList.contains('timing-select') ||
                         target.classList.contains('offset-input');

        if (!isInput) return;

        if (state.captureOldValue !== null && state.captureOldValue !== target.value) {
            const editCmd = new EditValueCommand(target, state.captureOldValue, target.value);
            if (target.classList.contains('unit-select') && row === container.lastElementChild) {
                const newRow = RotationUtils.createRow(RosterUtils.getCurrentTeamOptionsHTML());
                const addCmd = new AddRowCommand(container, newRow, container.children.length);
                history.execute(new CompositeCommand([editCmd, addCmd]));
                requestAnimationFrame(() => container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' }));
            } else {
                history.execute(editCmd);
            }
            state.captureOldValue = target.value;

            if (target.classList.contains('timing-select') && target.value === 'Simultaneous') {
                const activeOffsetTrigger = row.querySelector('.sub-panel-trigger[data-trigger="offset"].is-active');
                if (activeOffsetTrigger) {
                    activeOffsetTrigger.classList.remove('is-active');
                    const panel = row.querySelector('.sub-panel');
                    if (panel) {
                        panel.classList.remove('is-open');
                        setTimeout(() => { if (!panel.classList.contains('is-open')) panel.innerHTML = ''; }, 200);
                    }
                }
            }
        }
    });

    // --- DRAG AND DROP ---
    let draggedRows = [];
    container.addEventListener('dragstart', (e) => {
        const row = e.target.closest('.rotation-row');
        if (!row || row === container.lastElementChild) { e.preventDefault(); return; }
        draggedRows = row.classList.contains('selected')
            ? Array.from(container.querySelectorAll('.rotation-row.selected')).filter(r => r !== container.lastElementChild)
            : [row];
        draggedRows.forEach(r => r.classList.add('is-dragging'));
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
    });

    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const targetRow = e.target.closest('.rotation-row');
        if (!targetRow || draggedRows.includes(targetRow)) return;

        const rect = targetRow.getBoundingClientRect();
        const isBelow = e.clientY > (rect.top + rect.height / 2);

        container.querySelectorAll('.rotation-row').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
        if (targetRow !== container.lastElementChild) {
            targetRow.classList.add(isBelow ? 'drag-over-bottom' : 'drag-over-top');
        } else {
            targetRow.classList.add('drag-over-top');
        }
    });

    container.addEventListener('dragleave', (e) => {
        const targetRow = e.target.closest('.rotation-row');
        if (targetRow) targetRow.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    container.addEventListener('drop', (e) => {
        e.preventDefault();
        container.querySelectorAll('.rotation-row').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom', 'is-dragging'));
        if (draggedRows.length === 0) return;

        const targetRow = e.target.closest('.rotation-row');
        if (!targetRow || draggedRows.includes(targetRow)) { draggedRows = []; return; }

        const rect = targetRow.getBoundingClientRect();
        const isBelow = e.clientY > (rect.top + rect.height / 2);
        const rowsArray = Array.from(container.children);
        let targetIndex = rowsArray.indexOf(targetRow);

        if (isBelow && targetRow !== container.lastElementChild) targetIndex++;

        history.execute(new MoveRowsCommand(container, draggedRows, targetIndex));
        draggedRows = [];
        container.dispatchEvent(new CustomEvent('row-structure-change'));
    });

    container.addEventListener('dragend', () => {
        container.querySelectorAll('.rotation-row').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom', 'is-dragging'));
        draggedRows = [];
    });
}