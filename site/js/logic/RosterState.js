// =========================================
//   ROSTER STATE (Source of Truth)
// =========================================

// Map UI dropdown names to your internal variable keys
const STAT_NAME_MAP = {
    "HP": "flatHP", "HP %": "percentHP",
    "ATK": "flatAtk", "ATK %": "percentAtk",
    "DEF": "flatDef", "DEF %": "percentDef",
    "CR Rate": "critRate", "CR DMG": "critDamage",
    "ER %": "energyRegen", "Healing Bonus": "healingBonus",
    "Skill DMG": "skillDmgBonus", "Basic DMG": "basicDmgBonus",
    "Heavy DMG": "heavyDmgBonus", "Lib DMG": "libDmgBonus",
    "Glacio DMG": "glacioDmgBonus", "Fusion DMG": "fusionDmgBonus",
    "Electro DMG": "electroDmgBonus", "Aero DMG": "aeroDmgBonus",
    "Spectro DMG": "spectroDmgBonus", "Havoc DMG": "havocDmgBonus"
};

const DEFAULT_ECHO_STATS = {
    flatHP: 0, percentHP: 0, flatAtk: 0, percentAtk: 0, flatDef: 0, percentDef: 0,
    critRate: 0, critDamage: 0, energyRegen: 0, healingBonus: 0,
    skillDmgBonus: 0, basicDmgBonus: 0, heavyDmgBonus: 0, libDmgBonus: 0,
    glacioDmgBonus: 0, fusionDmgBonus: 0, electroDmgBonus: 0, aeroDmgBonus: 0, spectroDmgBonus: 0, havocDmgBonus: 0
};

const RosterState = {
    team: [],
    domMap: new WeakMap(),
    
    enemy: { level: 100, res: 20, hp: 3000000 },

    init: () => {
        RosterState.team = [ RosterState.createEmptySlot(0), RosterState.createEmptySlot(1), RosterState.createEmptySlot(2) ];
    },

    createEmptySlot: (index) => {
        return {
            index: index, character: "", sequence: 0, mode: "None", weapon: "", rank: 1,
            layout: "4 3 3 1 1", mainSet: "", subSet: "", mainEcho: "",
            
            echoes: Array(5).fill(null).map(() => ({
                mainStat: "",
                substats: Array(5).fill(null).map((_, i) => ({
                    name: (typeof DEFAULT_SUBSTATS !== 'undefined' && DEFAULT_SUBSTATS[i]) ? DEFAULT_SUBSTATS[i] : "N/A",
                    value: ""
                }))
            })),
            
            echoStats: { ...DEFAULT_ECHO_STATS },
            domRef: null
        };
    },

    // Link a DOM row to a Slot Index
    registerRow: (index, domRow) => {
        if (!RosterState.team[index]) RosterState.team[index] = RosterState.createEmptySlot(index);
        
        const slot = RosterState.team[index];
        slot.domRef = domRow;
        RosterState.domMap.set(domRow, slot);
        return slot;
    },

    getSlot: (index) => RosterState.team[index],
    
    // Generic Field Update
    updateField: (index, field, value) => {
        const slot = RosterState.team[index];
        if (slot) {
            slot[field] = value;
            return true;
        }
        return false;
    },

    // Specific Echo Update
    updateEcho: (slotIndex, echoIndex, field, value, subIndex = null) => {
        const slot = RosterState.team[slotIndex];
        if (!slot) return;
        const echo = slot.echoes[echoIndex];
        
        if (field === 'substat' && subIndex !== null) {
            // Update Substat Name or Value
            if (typeof value === 'object') {
                echo.substats[subIndex] = { ...echo.substats[subIndex], ...value };
            }
        } else {
            echo[field] = value;
        }
    },
    
    // NEW: Aggregation Function
    calculateEchoStats: (slotIndex) => {
        const slot = RosterState.team[slotIndex];
        if (!slot) return;

        slot.echoStats = { ...DEFAULT_ECHO_STATS };

        const costs = COST_DISTRIBUTION[slot.layout || "4 3 3 1 1"] || [4, 3, 3, 1, 1];

        // Iterate through all 5 echoes and sum their stats
        slot.echoes.forEach((echo, i) => {
            const cost = costs[i];

            // 1. Process Secondary Fixed Main Stat (Based entirely on cost)
            if (typeof SECONDARY_MAIN_STATS !== 'undefined' && SECONDARY_MAIN_STATS[cost]) {
                const secStat = SECONDARY_MAIN_STATS[cost];
                slot.echoStats[secStat.stat] += secStat.value;
            }

            // 2. Process Primary Main Stat
            if (echo.mainStat && typeof MAIN_STAT_VALUES !== 'undefined' && MAIN_STAT_VALUES[cost] && MAIN_STAT_VALUES[cost][echo.mainStat]) {
                const internalKey = STAT_NAME_MAP[echo.mainStat];
                if (internalKey) {
                    slot.echoStats[internalKey] += MAIN_STAT_VALUES[cost][echo.mainStat];
                }
            }

            // 3. Process Substats
            echo.substats.forEach(sub => {
                if (sub.name !== "N/A" && sub.value && STAT_NAME_MAP[sub.name]) {
                    const internalKey = STAT_NAME_MAP[sub.name];
                    const numValue = parseFloat(sub.value);
                    if (!isNaN(numValue)) {
                        slot.echoStats[internalKey] += numValue;
                    }
                }
            });
        });
    }
};

// Initialize immediately
RosterState.init();