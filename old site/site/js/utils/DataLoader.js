const DataLoader = {
    cache: { mechanics: new Set() }, // Tracks what we've already loaded to prevent duplicate network requests

    loadJSON: async (path) => {
        try {
            const res = await fetch(`${path}?t=${new Date().getTime()}`);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return await res.json();
        } catch (e) {
            // --- UPDATED: Verbose Error Logging ---
            console.error(`[DataLoader] Failed to load JSON from ${path}. The file may be missing, or there is a syntax error in the JSON.`, e);
            return null;
        }
    },

    initDatabases: async () => {
        // 1. Load the core UI lists
        window.CHARACTER_DB = await DataLoader.loadJSON(CommonUtils.getData('db_characters.json')) || {};
        window.WEAPON_DB = await DataLoader.loadJSON(CommonUtils.getData('db_weapons.json')) || {};
        window.BUILD_DB = await DataLoader.loadJSON(CommonUtils.getData('db_builds.json')) || {};
        
        // --- NEW: Generate Dropdown Arrays from the fetched data ---
        window.CHAR_LIST = Object.keys(window.CHARACTER_DB);
        window.WEAPONS_BY_TYPE = { "Broadblade": [], "Sword": [], "Rectifier": [], "Gauntlets": [], "Pistols": [] };
        Object.keys(window.WEAPON_DB).forEach(weaponName => {
            const type = window.WEAPON_DB[weaponName].weaponType;
            if (window.WEAPONS_BY_TYPE[type]) window.WEAPONS_BY_TYPE[type].push(weaponName);
        });

        // 2. Load Echo Sets
        const echoData = await DataLoader.loadJSON(CommonUtils.getData(('db_echoes.json'))) || {};
        window.SET_ECHO_MAPPING = echoData.SET_ECHO_MAPPING || {};
        window.SONATA_SETS = Object.keys(window.SET_ECHO_MAPPING);
        window.ALL_MAIN_ECHOES = [...new Set(Object.values(window.SET_ECHO_MAPPING).flat())];
        window.TRIGGER_SETS = echoData.TRIGGER_SETS || [];

        // 3. Initialize Mechanics
        if (!window.MECHANICS_DB) window.MECHANICS_DB = {};
        if (!window.MECHANICS_INDEX) window.MECHANICS_INDEX = {}; // --- NEW: Initialize the Index ---
        
        await DataLoader.loadMechanic('generic', 'generic');
    },

    loadMechanic: async (folder, itemName) => {
        if (!itemName) return;
        
        // Sanitize name for file paths (e.g., "Verdant Summit" -> "Verdant_Summit")
        const fileName = itemName.replace(/\s+/g, '_');
        const cacheKey = `${folder}/${fileName}`;

        if (DataLoader.cache.mechanics.has(cacheKey)) return; // Already loaded!

        const data = await DataLoader.loadJSON(CommonUtils.getData((`mechanics/${folder}/${fileName}.json`)));
        if (data) {
            window.MECHANICS_INDEX = window.MECHANICS_INDEX || {}; // Failsafe

            // --- NEW: Populate DB and build the Index simultaneously ---
            for (const [key, mechData] of Object.entries(data)) {
                
                window.MECHANICS_DB[key] = mechData; // Keep the flat physics database!
                
                // Sort purely by the ID prefix, safely ignoring @Equipper!
                const indexKey = key.startsWith('System_') ? 'System' : key.split('_')[0];
                
                // Add it to that specific character's/system's index array
                if (!window.MECHANICS_INDEX[indexKey]) window.MECHANICS_INDEX[indexKey] = [];
                if (!window.MECHANICS_INDEX[indexKey].includes(key)) window.MECHANICS_INDEX[indexKey].push(key);
            }

            DataLoader.cache.mechanics.add(cacheKey);
            console.log(`Loaded Mechanics: ${cacheKey}`);
        }
    }
    
};