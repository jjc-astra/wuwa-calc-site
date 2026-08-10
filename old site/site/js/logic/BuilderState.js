const BuilderState = {
    activeChar: null,
    
    // --- PERSISTENCE: Retain layout context flags across sessions ---
    activeFolder: "Characters",
    activeRarity: 5,
    
    categories: [
        "Basic Attack", "Resonance Skill", "Resonance Liberation", 
        "Forte Circuit", "Intro", "Outro", "Inherent Skill", "Tune Break", "Resonance Chain"
    ],

    CAST_OPTIONS: [
        "Basic", "Heavy", "Skill", "Liberation", 
        "Intro", "Outro", "Coordinated", "TuneBreak", "TuneRupture", 
        "Dodge", "Jump", "Echo", "Utility", "Heal"
    ],

    DMG_OPTIONS: [
        "Basic", "Heavy", "Skill", "Liberation","Intro", "Outro", "Coordinated",
        "Spectro", "Fusion", "Glacio", "Aero", "Electro", "Havoc", "Physical",
        "Spectro Frazzle", "Aero Erosion", "Electro Flare", "Electro Rage", 
        "Fusion Burst", "Glacio Chafe", "Echo", "TuneBreak", "TuneRupture"
    ],

    STAT_OPTIONS: [
        "HP", "HP %", "ATK", "ATK %", "DEF", "DEF %", 
        "CR Rate", "CR DMG", "ER %", "Healing Bonus",
    ],

    templates: {
        "Basic Attack": {
            name: "Basic Attack 1",
            castTypes: ["Basic"],
            dmgTypes: ["Glacio", "Basic"],
            hitMults: ["50%"],
            actionDuration: 0.5,
            swapTiming: "@Default.SwapTime",
            comboWindow: "@Default.ComboWindow",
            isSwapInDefault: true,
            input: "Basic",
            inputType: "Press",
            stanceReq: "Grounded"
        },
        "Resonance Skill": {
            name: "Resonance Skill",
            castTypes: ["Skill"],
            dmgTypes: ["Glacio", "Skill"],
            hitMults: ["100%"],
            actionDuration: 0.8,
            cooldown: 10.0,
            input: "Skill",
            inputType: "Press",
            priority: 100,
            stanceReq: "Any"
        },
        "Resonance Liberation": {
            name: "Resonance Liberation",
            castTypes: ["Liberation"],
            dmgTypes: ["Glacio", "Liberation"],
            hitMults: ["200%"],
            actionDuration: 2.1,
            freezeTime: 2.0,
            cooldown: 25.0,
            triggerRule: "IF (@Self.Energy >= @Self.MaxEnergy)",
            comboWindow: "@Default.ComboWindow",
            input: "Liberation",
            inputType: "Press",
            priority:1000,
            stanceReq: "Any",
            stanceResult: "Grounded"
        },
        "Forte Circuit": {
            name: "Forte Heavy Attack",
            castTypes: ["Heavy"],
            dmgTypes: ["Glacio", "Heavy"],
            hitMults: ["150%"],
            actionDuration: 1.0,
            triggerRule: "IF (@Self.Forte1 >= @Self.MaxForte1)",
            input: "Basic",
            inputType: "Hold",
            stanceReq: "Grounded"
        },
        "Forte Release": {
            name: "Forte Hold Release",
            castTypes: ["Heavy"],
            dmgTypes: ["Glacio", "Heavy"],
            hitMults: ["200%"],
            actionDuration: 0.5,
            triggerRule: "IF (@Self.HasBuff(Forte_Holding))",
            input: "Basic",
            inputType: "Release",
            stanceReq: "Grounded",
            holdConfig: {
                cursorSpeed: 100,
                cursorMode: "pingpong",
                retainCursor: false,
                maxCursorVal: 100,
                windowCenter: "50",
                windowSize: "20"
            }
        },
        "Intro Skill": {
            name: "Intro Skill",
            isSwapInDefault: true,
            triggerRule: "IF (@Prev.CastTypes.includes('Outro'))",
            castTypes: ["Intro"],
            castResources: {
                "concerto": 10
            },
            dmgTypes: ["Glacio", "Intro"],
            hitMults: ["100%"],
            actionDuration: 1,
            comboWindow: "@Default.ComboWindow",
            isSwapInDefault: true,
            stanceReq: "Any",
            stanceResult: "Grounded",
            priority: 1000
        },
        "Outro Skill": {
            name: "Outro Skill",
            castResources: {
                "concerto": -100
            },
            triggerRule: "IF (@Self.Concerto >= 100)",
            effects: `[
                { type: 'buff', name: 'Outro Buff', target: '@Next', duration: 14.0, stat: 'Deepen', value: '20%', removeOnSwap: true }
            ]`
        },
        "Inherent Skill": {
            name: "Inherent Skill 1",
            isPassive: true,
            triggerRule: "ALWAYS",
            effects: `[
                { type: 'buff', name: 'Inherent Buff', target: '@Self', duration: 9999, stat: 'ATK %', value: '10%' }
            ]`
        },
        "Resonance Chain": {
            name: "Sequence 1",
            isPassive: true,
            triggerRule: "IF (@Self.Sequence >= 1)",
            effects: `[
                { type: 'buff', name: 'S1 Buff', target: '@Self', duration: 9999, stat: 'CR Rate', value: '10%' }
            ]`
        }
    },
};