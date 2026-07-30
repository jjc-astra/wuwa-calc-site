// ==========================================================================
//   BUILDER CONTROLLER (The MVC Bridge)
// ==========================================================================
const BuilderGUIController = {
    init: async () => {
        await DataLoader.initDatabases();

        BuilderRenderer.renderGrid();
        document.getElementById('back-to-grid-btn').addEventListener('click', BuilderGUIController.closeEditor);
        document.getElementById('copy-char-btn').addEventListener('click', () => BuilderGUIController.copyJSON('char'));
        document.getElementById('copy-mech-btn').addEventListener('click', () => BuilderGUIController.copyJSON('mech'));
        document.getElementById('reset-builder-cache-btn').addEventListener('click', BuilderGUIController.resetCache);
        document.getElementById('view-editor').addEventListener('input', BuilderGUIController.refreshOutput);

        document.getElementById('grid-search-input').addEventListener('input', (e) => {
            BuilderRenderer.renderGrid(e.target.value);
        });

        if (typeof LocalCacheManager !== 'undefined') {
            await LocalCacheManager.loadBuilderSession();
        }
    },

    resetCache: async () => {
        if (confirm("Reset current builder cache? All custom nodes and modifications will revert back to pristine database records.")) {
            const activeChar = BuilderState.activeChar;

            localStorage.removeItem(LocalCacheManager.SAVE_KEY_BUILD_STATS);
            localStorage.removeItem(LocalCacheManager.SAVE_KEY_BUILD_MECH);

            if (typeof MECHANICS_DB !== 'undefined') {
                Object.keys(MECHANICS_DB).forEach(k => {
                    if (k.startsWith(activeChar + "_") || (activeChar === "Generic" && k.startsWith("System_"))) {
                        delete MECHANICS_DB[k];
                    }
                });
            }

            const indexKey = (activeChar === "Generic") ? "System" : activeChar;
            if (typeof MECHANICS_INDEX !== 'undefined' && MECHANICS_INDEX[indexKey]) {
                delete MECHANICS_INDEX[indexKey];
            }

            const fileName = activeChar.replace(/\s+/g, '_');
            if (typeof DataLoader !== 'undefined' && DataLoader.cache?.mechanics) {
                let mechFolder = BuilderState.activeFolder === 'Weapons' ? 'weapons' :
                                  BuilderState.activeFolder === 'Echo Sets' ? 'sets' :
                                  BuilderState.activeFolder === 'Echoes' ? 'echoes' : 'characters';
                DataLoader.cache.mechanics.delete(`${mechFolder}/${fileName}`);
            }

            await BuilderGUIController.openEditor(activeChar, BuilderState.activeFolder, BuilderState.activeRarity);
        }
    },

    openEditor: async (itemName, imgFolder = 'Characters', fallbackRarity = 5) => {
        BuilderState.activeChar = itemName;
        BuilderState.activeFolder = imgFolder;
        BuilderState.activeRarity = fallbackRarity;

        document.getElementById('view-grid').classList.add('d-none');
        document.getElementById('view-editor').classList.remove('d-none');
        document.getElementById('back-to-grid-btn').classList.remove('d-none');
        document.getElementById('editor-char-name').innerText = itemName + " Setup";

        const iconContainer = document.getElementById('editor-char-icon');
        iconContainer.className = `char-icon rarity-${fallbackRarity}`;
        iconContainer.querySelector('.char-fallback').innerText = itemName.charAt(0);

        if (typeof CommonUtils !== 'undefined') {
            CommonUtils.updateImage(iconContainer, '.char-grid-img', '.char-fallback', imgFolder, itemName);
        }

        const statsForm = document.getElementById('base-stats-form');
        const statsHeader = statsForm.previousElementSibling;

        if (typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[itemName]) {
            statsForm.style.display = ''; statsHeader.style.display = '';
            statsHeader.innerText = 'Base Stats (Lvl 90)';
            BuilderRenderer.buildBaseStatsForm(itemName);
        } else if (typeof WEAPON_DB !== 'undefined' && WEAPON_DB[itemName]) {
            statsForm.style.display = ''; statsHeader.style.display = '';
            statsHeader.innerText = 'Weapon Stats (Lvl 90)';
            BuilderRenderer.buildBaseStatsForm(itemName);
        } else {
            statsForm.style.display = 'none'; statsHeader.style.display = 'none';
            statsForm.innerHTML = '';
        }

        let mechFolder = 'characters';
        if (imgFolder === 'Weapons') mechFolder = 'weapons';
        else if (imgFolder === 'Echo Sets') mechFolder = 'sets';
        else if (imgFolder === 'Echoes') mechFolder = 'echoes';
        else if (imgFolder === 'System') mechFolder = 'generic';

        await DataLoader.loadMechanic(mechFolder, itemName);
        BuilderRenderer.buildMechanicsAccordion(itemName);
        BuilderGUIController.refreshOutput(true);
    },

    closeEditor: () => {
        if (typeof LocalCacheManager !== 'undefined') {
            LocalCacheManager.saveBuilderSession();
        }
        BuilderState.activeChar = null;
        document.getElementById('view-grid').classList.remove('d-none');
        document.getElementById('view-editor').classList.add('d-none');
        document.getElementById('back-to-grid-btn').classList.add('d-none');
    },

    refreshOutput: (immediate = false) => {
        if (!BuilderGUIController._debouncedRefresh) {
            BuilderGUIController._debouncedRefresh = CommonUtils.debounce(BuilderGUIController._executeRefresh, 250);
        }
        if (immediate === true) {
            BuilderGUIController._executeRefresh();
        } else {
            BuilderGUIController._debouncedRefresh();
        }
    },

    _executeRefresh: () => {
        if (!BuilderState.activeChar) return;
        const { baseStats, mechanicsObj } = BuilderRenderer.extractFormData();
        const isWeapon = typeof WEAPON_DB !== 'undefined' && !!WEAPON_DB[BuilderState.activeChar];

        const formattedData = BuilderUtils.formatJSONOutput(
            BuilderState.activeChar,
            baseStats,
            mechanicsObj,
            isWeapon
        );

        const outBox = document.getElementById('json-output');
        if (outBox) {
            outBox.dataset.charJson = formattedData.charJsonString;
            outBox.dataset.mechJson = formattedData.mechJsonString;
            outBox.innerHTML = formattedData.highlightedHTML;

            const charBtn = document.getElementById('copy-char-btn');
            const mechBtn = document.getElementById('copy-mech-btn');
            if (charBtn) charBtn.disabled = !formattedData.charJsonString;
            if (mechBtn) mechBtn.disabled = !formattedData.mechJsonString;
        }

        if (typeof LocalCacheManager !== 'undefined') {
            LocalCacheManager.saveBuilderSession();
            const resetBtn = document.getElementById('reset-builder-cache-btn');
            if (resetBtn) {
                resetBtn.disabled = !LocalCacheManager.hasBuilderCache();
            }
        }
    },

    copyJSON: (type) => {
        const outBox = document.getElementById('json-output');
        const textToCopy = type === 'char' ? outBox.dataset.charJson : outBox.dataset.mechJson;
        const btnId = type === 'char' ? 'copy-char-btn' : 'copy-mech-btn';

        if (!textToCopy) return;

        navigator.clipboard.writeText(textToCopy).then(() => {
            const btn = document.getElementById(btnId);
            const originalText = type === 'char' ? "Copy Character JSON" : "Copy Mechanics JSON";
            btn.innerText = "Copied!";
            setTimeout(() => btn.innerText = originalText, 2000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            alert("Clipboard copy failed. Please copy manually.");
        });
    }
};

document.addEventListener('DOMContentLoaded', BuilderGUIController.init);