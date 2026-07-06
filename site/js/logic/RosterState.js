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

// =========================================
//   STAT CALCULATOR (Centralized Math Engine)
// =========================================
const StatCalculator = {
    calculateFinalStats: (unitName, activeBuffs = []) => {
        const slot = (typeof RosterState !== 'undefined') ? RosterState.team.find(t => t.character === unitName) || {} : {};
        const dbUnit = (typeof CHARACTER_DB !== 'undefined') ? CHARACTER_DB[unitName] || {} : {};
        const dbWeapon = (typeof WEAPON_DB !== 'undefined' && slot.weapon) ? WEAPON_DB[slot.weapon] || {} : {};
        
        // --- CLEANED: Structural Guarantee ---
        const echoStats = slot.echoStats || { ...DEFAULT_ECHO_STATS };

        // --- FIXED: Wrap base stats in parseFloat to prevent string concatenation bugs if the JSON has "5%"! ---
        const baseAtk = (parseFloat(dbUnit.baseAtk) || 0) + (parseFloat(dbWeapon.baseAtk) || 0);
        const baseHP = (parseFloat(dbUnit.baseHP) || 0) + (parseFloat(dbWeapon.baseHP) || 0);
        const baseDef = (parseFloat(dbUnit.baseDef) || 0) + (parseFloat(dbWeapon.baseDef) || 0);

        const stats = {
            percentAtk: echoStats.percentAtk, percentHP: echoStats.percentHP, percentDef: echoStats.percentDef,
            flatAtk: echoStats.flatAtk, flatHP: echoStats.flatHP, flatDef: echoStats.flatDef,
            
            // --- FIXED: Safely parse Crit defaults ---
            critRate: (parseFloat(dbUnit.baseCritRate) || 5) + echoStats.critRate,
            critDamage: (parseFloat(dbUnit.baseCritDmg) || 150) + echoStats.critDamage,
            
            energyRegen: 100 + echoStats.energyRegen, healingBonus: echoStats.healingBonus,
            skillDmgBonus: echoStats.skillDmgBonus, basicDmgBonus: echoStats.basicDmgBonus,
            heavyDmgBonus: echoStats.heavyDmgBonus, libDmgBonus: echoStats.libDmgBonus,
            glacioDmgBonus: echoStats.glacioDmgBonus, fusionDmgBonus: echoStats.fusionDmgBonus,
            electroDmgBonus: echoStats.electroDmgBonus, aeroDmgBonus: echoStats.aeroDmgBonus,
            spectroDmgBonus: echoStats.spectroDmgBonus, havocDmgBonus: echoStats.havocDmgBonus,
        };

        // --- NEW: Inject Weapon Substats & Character Talents dynamically! ---
        let talentAtkPct = 0;
        const injectPassiveStat = (type, val) => {
            if (!type || !val) return;
            const statKey = STAT_NAME_MAP[type];
            if (statKey && stats[statKey] !== undefined) {
                const parsedVal = parseFloat(val) || 0;
                stats[statKey] += parsedVal;
                // NEW: Keep a specific record of the Talent ATK for the damage formula
                if (statKey === 'percentAtk') talentAtkPct += parsedVal;
            }
        };

        // Apply permanent gear/talent passives to the bucket before Rotation buffs
        injectPassiveStat(dbWeapon.subStatType, dbWeapon.subStatValue);
        injectPassiveStat(dbUnit.talentStat1, dbUnit.talentVal1);
        injectPassiveStat(dbUnit.talentStat2, dbUnit.talentVal2);

        activeBuffs.forEach(buff => {
            if (buff.stat) {
                let baseStatKey = (typeof STAT_NAME_MAP !== 'undefined' && STAT_NAME_MAP[buff.stat]) ? STAT_NAME_MAP[buff.stat] : buff.stat;
                
                // --- FIXED: Dynamically map visual buff names to internal DB stat keys ---
                if (stats[baseStatKey] === undefined) {
                    const sLower = buff.stat.toLowerCase();
                    if (sLower.includes("basic") && sLower.includes("dmg")) baseStatKey = "basicDmgBonus";
                    else if (sLower.includes("heavy") && sLower.includes("dmg")) baseStatKey = "heavyDmgBonus";
                    else if (sLower.includes("skill") && sLower.includes("dmg")) baseStatKey = "skillDmgBonus";
                    else if ((sLower.includes("liberation") || sLower.includes("lib")) && sLower.includes("dmg")) baseStatKey = "libDmgBonus";
                    else if (sLower.includes("glacio") && sLower.includes("dmg")) baseStatKey = "glacioDmgBonus";
                    else if (sLower.includes("fusion") && sLower.includes("dmg")) baseStatKey = "fusionDmgBonus";
                    else if (sLower.includes("electro") && sLower.includes("dmg")) baseStatKey = "electroDmgBonus";
                    else if (sLower.includes("aero") && sLower.includes("dmg")) baseStatKey = "aeroDmgBonus";
                    else if (sLower.includes("spectro") && sLower.includes("dmg")) baseStatKey = "spectroDmgBonus";
                    else if (sLower.includes("havoc") && sLower.includes("dmg")) baseStatKey = "havocDmgBonus";
                    else if (sLower.includes("physical") && sLower.includes("dmg")) baseStatKey = "physicalDmgBonus";
                }

                const valStr = String(buff.value || "0");
                const isPct = valStr.includes('%');
                const numVal = parseFloat(valStr) || 0;

                // --- NEW: Auto-route between Flat and Percent pools based purely on the % sign ---
                if (isPct) {
                    if (baseStatKey === "flatAtk") baseStatKey = "percentAtk";
                    else if (baseStatKey === "flatHP") baseStatKey = "percentHP";
                    else if (baseStatKey === "flatDef") baseStatKey = "percentDef";
                } else {
                    if (baseStatKey === "percentAtk") baseStatKey = "flatAtk";
                    else if (baseStatKey === "percentHP") baseStatKey = "flatHP";
                    else if (baseStatKey === "percentDef") baseStatKey = "flatDef";
                }

                if (stats[baseStatKey] !== undefined) {
                    stats[baseStatKey] += numVal * (buff.stacks || 1);
                }
            }
        });

        return {
            ...stats,
            baseAtk: baseAtk, baseHP: baseHP, baseDef: baseDef,
            
            // EXACT MATCH TO YOUR MATH.FLOOR FORMULA
            atk: (Math.floor(baseAtk) * (1 + (stats.percentAtk - talentAtkPct) / 100)) + 
                 Math.floor(baseAtk * talentAtkPct / 100) + 
                 stats.flatAtk,
            hp: Math.floor(baseHP * (1 + stats.percentHP / 100) + stats.flatHP),
            def: Math.floor(baseDef * (1 + stats.percentDef / 100) + stats.flatDef),
            talentAtkPct: talentAtkPct // Passed down so RotationState can use it safely
        };
    }
};

// Initialize immediately
RosterState.init();