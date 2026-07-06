// ==========================================================================
//   GLOBAL MECHANICS CONSTANTS (Single Source of Truth)
// ==========================================================================
const MECHANICS_NOTATION = {
    SANHUA: {
        CURSOR_PERIOD: 200,      // Total duration of a full up-and-down ping-pong loop (2s)
        CURSOR_MIDPOINT: 100,    // The peak switch turn frame on the modulo track (1s)
        FORTE_WIN_CENTER: 65,    // Default center point alignment for Frostbite gauge
        BASE_WIN_SIZE: 10,       // Base window size with 0 Clarity stacks
        STACK_SCALING: 20,       // Added window size per 1 stack of Clarity
        MAX_CURSOR_VAL: 100      // Upper scale limit for tracking the cursor gauge
    },
    GAUGES: {
        DEFAULT_MAX: 100         // Default upper capacity boundary for unmapped metrics
    }
};


// --- Input Bindings Mapping ---
const INPUT_BINDINGS = {
    "Basic": "Left Click",
    "Skill": "E",
    "Jump": "Space",
    "Dodge": "Right Click / Shift",
    "Liberation": "R",
    "Utility": "T",
    "Echo": "Q"
};

// =========================================
//   UI CONFIGURATION & STAT DB
// =========================================

const SET_LAYOUTS = ["4 3 3 1 1", "4 4 1 1 1"];

const MAIN_STATS_4_COST = ["CR Rate", "CR DMG", "ATK %", "HP %", "DEF %", "Healing Bonus"];
const MAIN_STATS_3_COST = ["Fusion DMG", "Electro DMG", "Aero DMG", "Spectro DMG", "Havoc DMG", "Glacio DMG", "ATK %", "HP %", "DEF %", "ER %"];
const MAIN_STATS_1_COST = ["ATK %", "HP %", "DEF %"];

const MAIN_STAT_VALUES = {
    4: { "CR Rate": 22.0, "CR DMG": 44.0, "ATK %": 33.0, "HP %": 33.0, "DEF %": 41.8, "Healing Bonus": 26.4 },
    3: { "Fusion DMG": 30.0, "Electro DMG": 30.0, "Aero DMG": 30.0, "Spectro DMG": 30.0, "Havoc DMG": 30.0, "Glacio DMG": 30.0, "ATK %": 30.0, "HP %": 30.0, "DEF %": 38.0, "ER %": 32.0 },
    1: { "ATK %": 18.0, "HP %": 22.8, "DEF %": 22.8 }
};

const SECONDARY_MAIN_STATS = {
    4: { stat: "flatAtk", value: 150 },
    3: { stat: "flatAtk", value: 100 },
    1: { stat: "flatHP", value: 2280 }
};

// --- SUBSTAT DATA ---
const COMMON_DMG_PCT = [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6];
const STAT_DB = {
    "CR Rate": { values: [6.3, 6.9, 7.5, 8.1, 8.7, 9.3, 9.9, 10.5], defaultIndex: 2 },
    "CR DMG": { values: [12.6, 13.8, 15.0, 16.2, 17.4, 18.6, 19.8, 21.0], defaultIndex: 2 },
    "ATK %": { values: COMMON_DMG_PCT, defaultIndex: 3 },
    "HP %": { values: COMMON_DMG_PCT, defaultIndex: 3 },
    "DEF %": { values: [8.1, 9.0, 10.0, 10.9, 11.8, 12.8, 13.8, 14.7], defaultIndex: 3 },
    "ER %": { values: [6.8, 7.6, 8.4, 9.2, 10.0, 10.8, 11.6, 12.4], defaultIndex: 3 },
    "Skill DMG": { values: COMMON_DMG_PCT, defaultIndex: 3 },
    "Basic DMG": { values: COMMON_DMG_PCT, defaultIndex: 3 },
    "Heavy DMG": { values: COMMON_DMG_PCT, defaultIndex: 3 },
    "Lib DMG":   { values: COMMON_DMG_PCT, defaultIndex: 3 },
    
    // Flat Stats
    "HP":  { values: [320, 360, 390, 430, 470, 510, 540, 580], defaultIndex: 3 },
    "ATK": { values: [30, 40, 50, 60], defaultIndex: 2 },
    "DEF": { values: [40, 50, 60, 70], defaultIndex: 2 }
};

const DEFAULT_SUBSTATS = ['CR Rate', 'CR DMG', 'ATK %', 'ER %', 'ATK'];

const CHARS_WITH_MODES = ["Lynae","Aemeath"];
const COST_DISTRIBUTION = { "4 3 3 1 1": [4, 3, 3, 1, 1], "4 4 1 1 1": [4, 4, 1, 1, 1] };

const SIM_CONSTANTS = { DEFAULT_ROW_DURATION: 1.5, MAX_SEQUENCE: 6, MAX_WEAPON_RANK: 5, LEVEL_CAP: 90 };

// =========================================
//   GLOBAL GAME DEFAULTS
// =========================================
const GAME_DEFAULTS = {
    swapTime: 0.15,
    comboWindow: 0.5,
    echoSummonTime: .17
};

// =========================================
//   DSL (DOMAIN-SPECIFIC LANGUAGE) SCHEMA
// =========================================
const DSL_SCHEMA = {
    events: [
        "ALWAYS", "OnStart", "OnCast", "OnHit", "AfterHit", 
        "OnSwapIn", "OnSwapOut", "OnChange", "Detonate", "OnTick", 
        "OnTrackerAdd", "OnTrackerRemove", "OnTrackerConsume", 
        "OnBuffAdd", "OnBuffRemove", "OnBuffUpdate"
    ],
    modifiers: [
        "Self",
        "Basic", "Heavy", "Skill", "Liberation", 
        "Intro", "Outro", "Coordinated", "TuneBreak", "TuneRupture", 
        "Dodge", "Jump", "Echo", "Utility", "Heal",
        "Spectro", "Fusion", "Glacio", "Aero", "Electro", "Havoc", "Physical",
        "Defense", "HP", "ATK",
        "Spectro Frazzle", "Aero Erosion", "Electro Flare", "Electro Rage", "Fusion Burst", "Glacio Chafe"
    ],
    pointers: [
        "Self", "Enemy", "Team", "TeamOthers", "Active",
        "Next", "Prev", "Equipper", "System", "Move", "Default"
    ],
    properties: {
        "Self": ["HP", "Energy", "Concerto", "Sequence", "PrevAction", "Name", "BuffStacks()", "HasBuff()", "Tracker()", "Memory()", "Cooldown()", "Stat()"],
        "Enemy": ["HP", "MaxHP", "HPPct", "BuffStacks()", "HasBuff()", "Tune"],
        "Move": ["Name", "CastTypes", "DmgTypes", "TimeStart", "Duration", "GameTime", "FreezeTime", "DamageStart", "DamageEnd", "SwapTime", "BaseMult", "HitMults"],
        "Prev": ["Action", "CastTypes", "Unit"],
        "Next": ["Name", "Action", "CastTypes", "Priority"],
        "Active": ["Name"],
        "Default": ["SwapTime", "ComboWindow", "EchoSummonTime"]
    }
};

const PANEL_CONFIG = {
    "dmg": {
        title: "Detailed Damage Breakdown",
        type: "complex_dmg", 
        // ... keep structural layout arrays the same ...
    },
    "concerto": {
        title: "Concerto Energy Breakdown",
        fields: [
            { label: "Generated", key: "concerto_Delta", default: "+0" }, 
            { label: "Current", key: "concerto", default: "0" }
        ]
    },
    "energy": {
        title: "Resonance Energy Breakdown",
        fields: [
            { label: "Generated", key: "energy_Delta", default: "+0.0" }, 
            { label: "Current", key: "energy", default: "0.0" }
        ]
    },
    
    // --- FORTE POOLS 1-6 REMOVED FROM MANIFEST LAYER ---
    
    "tune": {
        title: "Tune Break Build Breakdown",
        fields: [
            { label: "Generated", key: "tune_Delta", default: "+0", suffix: "%" },
            { label: "Tune Progress", key: "tune", default: "0", suffix: "%" },
        ]
    },
    "time": {
        title: "Advanced Timeline Breakdown",
        type: "complex_time",
        groups: [ /* ... keep configuration unchanged ... */ ]
    },
    "offset": {
        title: "Action Alignment Breakdown",
        fields: [
            { label: "Offset Value", key: "offset", default: "0.00", highlight: "text-main" }
        ]
    }
};

// ==========================================================================
//   DYNAMIC FACTORY INTERRATION: Hydrate Forte Manifests 1-6 Programmatically
// ==========================================================================
for (let i = 1; i <= 6; i++) {
    const deltaKey = (i === 1) ? "forte_Delta" : `forte${i}_Delta`;
    const staticKey = (i === 1) ? "forte" : `forte${i}`;
    
    PANEL_CONFIG[`forte${i}`] = {
        title: `Forte ${i} Breakdown`,
        fields: [
            { label: "Generated", key: deltaKey, default: "+0" },
            { label: "Current", key: staticKey, default: "0" }
        ]
    };
}
