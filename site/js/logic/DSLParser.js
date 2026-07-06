/*
    =========================================
      DSL (DOMAIN-SPECIFIC LANGUAGE) RULES
      Syntax guide for writing 'triggerRule'
    =========================================
    
    Format: "TRIGGER[Modifiers] IF (CONDITION)"
    Example: "OnCast[Heavy, Fusion] IF (@Self.Energy >= 50 && @Self.HasBuff(@System(Attack Boost)))"

    --- 1. EVENTS (When does this check fire?) ---
    ALWAYS          : Always active / Passive
    OnStart         : Fires at the very beginning of the timeline
    OnCast          : Fires the exact moment a move is declared
    OnHit           : Fires exactly when damage is calculated
    AfterHit        : Fires immediately after damage calculations finish
    OnSwapIn        : Fires when this character takes the field
    OnSwapOut       : Fires when this character leaves the field
    OnChange        : Fires when ANY character swap happens
    Detonate        : Fires when a specific tracker is consumed via "detonate" action
    OnTick(x, y)    : Fires 'y' times, every 'x' seconds (e.g., OnTick(1.5, 3))
    OnTrackerAdd    : Fires when a tracker's value increases
    OnTrackerRemove : Fires when a tracker's value decreases
    OnTrackerConsume: Fires when a tracker is explicitly consumed or wiped

    --- 2. MODIFIERS (Fast-Fail filtering) ---
    Add inside brackets [] to strictly filter the event.
    Action Types:  [Basic], [Heavy], [Skill], [Liberation], [Intro], [Outro], [Echo]
    Element Types: [Glacio], [Fusion], [Electro], [Aero], [Spectro], [Havoc], [Physical]
    Trackers:      Use inside brackets for Tracker events or Detonate (e.g., OnTrackerConsume[Bullets])
    
    --- 3. LOGICAL WRAPPERS ---
    ANY(A, B)       : Triggers if ANY of the comma-separated events occur.
    ALL(A, B)       : Triggers if ALL comma-separated events are true.
    XOR(A, B)       : Triggers if exclusively ONE is true, but not both.
    NOT(A)          : Inverts the condition.

    --- 4. CONTEXT POINTERS (For the IF condition) ---
    @Namespace(Key) : Translates human-readable names to strict DB IDs (e.g., @Sanhua(Basic 1) -> "Sanhua_Basic1")

    @Self           : The character that owns this mechanic
      .HP             -> (Float) Current health percentage (0.0 to 1.0)
      .Energy         -> (Int) Current Resonance Energy
      .Concerto       -> (Int) Current Concerto Energy
      .Forte          -> (Int) Current Forte Gauge / Stacks
      .Tune           -> (Int) Current Tune level
      .HasBuff(ID)    -> (Boolean/Int) Returns 1 if the buff is active, 0 otherwise
      .Tracker(ID)    -> (Int) Returns the current value of a tracker
      .Cooldown(ID)   -> (Float) Returns the current cooldown remaining on an action
      .Stat(Name)     -> (Float) Returns the fully aggregated value of a stat
      .PrevAction     -> (String) The database ID of the character's personal last action
    
    @Enemy         : The enemy being hit
      .HP             -> (Float) Current raw enemy health points
      .MaxHP          -> (Float) Maximum raw enemy health points
      .HPPct          -> (Float) Enemy health percentage (0.0 to 1.0)
      .HasBuff(ID)    -> (Boolean/Int) Check if enemy has a debuff
    
    @Move           : The action currently being performed
      .Name           -> (String) The friendly name
      .CastTypes      -> (Array) e.g., ["Heavy"]
      .DmgTypes       -> (Array) e.g., ["Fusion", "Physical"]
      .TimeStart      -> (Float) Real timeline start time
      .Duration       -> (Float) Total action duration
      .GameTime       -> (Float) In-game decayed time (post-freeze)
      .FreezeTime     -> (Float) Time stop duration
      .DamageStart    -> (Float) Frame/time damage window starts
      .DamageEnd      -> (Float) Frame/time damage window ends
      
    @Prev           : The move that occurred immediately before this one (Returns the Unit Name if used alone)
      .Action         -> (String) The database ID (e.g. "Sanhua_Basic1")
      .CastTypes      -> (Array) e.g., ["Outro"]
      .Unit           -> (String) The character who performed the previous move

    @Next           : The move occurring immediately after this one (Returns the Unit Name if used alone)
      .Name           -> (String) The character swapping in
      .Action         -> (String) The database ID of the interrupting move
      .CastTypes      -> (Array) e.g., ["Intro", "Skill"]
      .Priority       -> (Int) The priority level of the interrupting move

    @Active         : The character physically on the field (Returns the Unit Name directly)
      
    @Team           : Array of character names currently in the party
    @TeamOthers     : Array of character names currently in the party, excluding the equipper
    @Equipper       : The specific unit that triggered the mechanic

    --- 5. OPERATORS ---
    ==, >=, <=, <, >  : Standard math comparisons
    AND, OR           : Standard AND / OR logic
    X..Y              : "Between" syntax. Example: "@Self.HP == 0.0..0.5"
*/

const DSLParser = {
    _mathCache: {}, // <-- ADDED: Memory cache for compiled math

    compile: (dslString) => {
        if (!dslString) return null;

        let triggerStr = "ALWAYS";
        let conditionStr = "true";

        if (dslString.includes(" IF ")) {
            const parts = dslString.split(" IF ");
            triggerStr = parts[0].trim() || "ALWAYS";
            conditionStr = parts[1].trim();
        } else if (dslString.startsWith("IF ")) {
            conditionStr = dslString.substring(3).trim();
        } else {
            triggerStr = dslString.trim();
        }

        if (conditionStr.startsWith("(") && conditionStr.endsWith(")")) {
            conditionStr = conditionStr.substring(1, conditionStr.length - 1);
        }

        let triggers = [];
        if (triggerStr.startsWith("ANY(") && triggerStr.endsWith(")")) {
            const inner = triggerStr.substring(4, triggerStr.length - 1);
            triggers = DSLParser._splitArgs(inner).map(t => DSLParser._parseTrigger(t));
        } else {
            triggers = [DSLParser._parseTrigger(triggerStr)];
        }

        return {
            triggers: triggers,
            evaluate: DSLParser._buildFunction(conditionStr),
            raw: dslString
        };
    },

    _parseTrigger: (str) => {
        let event = str;
        let modifiers = [];
        let args = []; 

        // 1. Extract the base Event name (letters only at the start)
        const baseMatch = str.match(/^([A-Za-z]+)/);
        if (baseMatch) {
            event = baseMatch[1];
        }

        // 2. Extract Arguments inside parentheses (e.g., (All) or (1.5, 3))
        const argMatch = str.match(/\(([^)]+)\)/);
        if (argMatch) {
            args = argMatch[1].split(",").map(s => {
                const val = s.trim();
                const num = parseFloat(val);
                // FIXED: Keep 'All' as a string, but convert '3' to a number
                return isNaN(num) ? val : num; 
            });
        }

        // 3. Extract Modifiers inside brackets (e.g., [Heavy, Fusion])
        const modMatch = str.match(/\[(.*?)\]/);
        if (modMatch) {
            modifiers = modMatch[1].split(",").map(s => s.trim());
        }

        return { event, modifiers, args };
    },

    _splitArgs: function(str) {
        const result = [];
        let current = "";
        let depth = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str[i];
            if (char === '(' || char === '[') depth++; 
            else if (char === ')' || char === ']') depth--;
            else if (char === ',' && depth === 0) {
                result.push(current.trim());
                current = "";
                continue;
            }
            current += char;
        }
        if (current.trim()) result.push(current.trim());
        return result;
    },

    _resolveLogicalWrappers: function(jsStr) {
        const wrappers = ["ANY", "ALL", "XOR", "NOT"];
        let resolving = true;
        while(resolving) {
            resolving = false;
            for (const wrap of wrappers) {
                const search = wrap + "(";
                const startIdx = jsStr.toUpperCase().indexOf(search); 
                
                if (startIdx !== -1) {
                    let depth = 0;
                    let endIdx = -1;
                    
                    const openParenIdx = startIdx + wrap.length; 
                    
                    for (let i = openParenIdx; i < jsStr.length; i++) {
                        if (jsStr[i] === '(') depth++;
                        else if (jsStr[i] === ')') {
                            depth--;
                            if (depth === 0) { endIdx = i; break; }
                        }
                    }
                    if (endIdx !== -1) {
                        const inner = jsStr.substring(openParenIdx + 1, endIdx);
                        let resolved = "";
                        const args = DSLParser._splitArgs(inner);
                        
                        if (wrap === "ANY") resolved = "(" + args.join(" || ") + ")";
                        else if (wrap === "ALL") resolved = "(" + args.join(" && ") + ")";
                        else if (wrap === "NOT") resolved = "(!(" + inner + "))";
                        else if (wrap === "XOR") {
                            if (args.length >= 2) resolved = `(Boolean(${args[0]}) !== Boolean(${args[1]}))`;
                            else resolved = "(false)";
                        }
                        
                        jsStr = jsStr.substring(0, startIdx) + resolved + jsStr.substring(endIdx + 1);
                        resolving = true;
                        break; 
                    }
                }
            }
        }
        return jsStr;
    },

    _translatePointers: (jsStr) => {
        if (typeof jsStr !== 'string') return jsStr;

        // --- FIXED: Recursively strip out any outer MATH(...) wrappers while perfectly honoring nested parentheses ---
        let processing = true;
        while (processing) {
            let mathIdx = jsStr.toUpperCase().indexOf("MATH(");
            if (mathIdx !== -1) {
                let depth = 1;
                let closingIdx = -1;
                let startSearch = mathIdx + 5;
                
                for (let i = startSearch; i < jsStr.length; i++) {
                    if (jsStr[i] === '(') depth++;
                    else if (jsStr[i] === ')') {
                        depth--;
                        if (depth === 0) {
                            closingIdx = i;
                            break;
                        }
                    }
                }
                if (closingIdx !== -1) {
                    const inner = jsStr.substring(startSearch, closingIdx);
                    jsStr = jsStr.substring(0, mathIdx) + "(" + inner + ")" + jsStr.substring(closingIdx + 1);
                } else {
                    break;
                }
            } else {
                processing = false;
            }
        }

        // --- FIXED: Map human-readable ABS operators cleanly to native Math methods ---
        jsStr = jsStr.replace(/\bABS\b/gi, "Math.abs");

        // --- FIXED: Convert Percentages safely without breaking native JavaScript Modulo (%) ---
        jsStr = jsStr.replace(/%(?!\s*[\d@a-zA-Z(_])/g, " / 100");

        // Regex now safely matches nested parentheses like (Yellow Form)
        jsStr = jsStr.replace(/@([A-Za-z0-9_]+)\(((?:[^)(]+|\([^)(]*\))*)\)/g, (match, p1, p2) => '"' + p1 + '_' + p2.trim() + '"');

        // 2. Map all static pointers dynamically
        const pointerMap = {
            // Nested Properties
            '@Self\\.PrevAction': 'ctx.self.prevAction',
            '@Prev\\.(Unit|name)': 'ctx.prev.unit',
            '@Prev\\.Action': 'ctx.prev.action',
            '@Prev\\.CastTypes?': 'ctx.prev.castTypes',
            
            // Next Move Properties
            '@Next\\.name': 'ctx.next.name',
            '@Next\\.Action': 'ctx.next.action',
            '@Next\\.CastTypes?': 'ctx.next.castTypes',
            '@Next\\.Priority': 'ctx.next.priority',

            '@Self\\.name': 'ctx.self.name',
            '@Enemy\\.name': '"Enemy"',
            '@Active\\.name': 'ctx.active.name',

            // Move Properties
            '@Move\\.Name': 'ctx.move.name',
            '@Move\\.CastTypes?': 'ctx.move.castTypes',
            '@Move\\.DmgTypes?': 'ctx.move.dmgTypes',
            '@Move\\.TimeStart': 'ctx.move.timeStart',
            '@Move\\.Duration': 'ctx.move.duration',
            '@Move\\.GameTime': 'ctx.move.gameTimePassed',
            '@Move\\.FreezeTime': 'ctx.move.freezeTime',
            '@Move\\.DamageStart': 'ctx.move.damageTimeframe.start',
            '@Move\\.DamageEnd': 'ctx.move.damageTimeframe.end',
            '@Move\\.SwapTime': 'ctx.move.swapTiming',
            '@Move\\.BaseMult': 'ctx.move.baseMult',
            '@Move\\.HitMults': 'ctx.move.hitMults',

            // Base Objects
            '@Self': 'ctx.self',
            '@Enemy': 'ctx.enemy',
            '@Active': 'ctx.active',
            '@TeamOthers': 'ctx.teamOthers',
            '@Team': 'ctx.team',
            '@Equipper': 'equipper',
            '@Prev': 'ctx.prev.unit',
            '@Next': 'ctx.next.name',
            '@Move': 'ctx.move',
            '@Default': 'ctx.default'
        };

        for (const [key, val] of Object.entries(pointerMap)) {
            jsStr = jsStr.replace(new RegExp(key + '(?![A-Za-z0-9_])', 'gi'), val);
        }

        const wrapQuotes = (arg) => {
            arg = arg.trim();
            if (arg.startsWith('"') || arg.startsWith("'")) return arg;
            return `"${arg}"`;
        };
        
        jsStr = jsStr.replace(/\.BuffStacks\(([^)]+)\)/gi, (m, p1) => `.getBuffStacks(${wrapQuotes(p1)})`);
        jsStr = jsStr.replace(/\.BuffMaxStacks\(([^)]+)\)/gi, (m, p1) => `.getBuffMaxStacks(${wrapQuotes(p1)})`);
        jsStr = jsStr.replace(/\.HasBuff\(([^)]+)\)/gi, (m, p1) => `.hasBuff(${wrapQuotes(p1)})`);
        jsStr = jsStr.replace(/\.Tracker\(([^)]+)\)/gi, (m, p1) => `.getTracker(${wrapQuotes(p1)})`);
        jsStr = jsStr.replace(/\.Stat\(([^)]+)\)/gi, (m, p1) => `.getStat(${wrapQuotes(p1)})`);
        jsStr = jsStr.replace(/\.Cooldown\(([^)]+)\)/gi, (m, p1) => `.getCooldown(${wrapQuotes(p1)})`);
        jsStr = jsStr.replace(/@StatusMult\(([^,]+),\s*([^)]+)\)/gi, (m, p1, p2) => `RotationUtils.getNegativeStatusMult(${wrapQuotes(p1)}, ${p2})`);

        // 4. Scalar Property Lowercasing (Unified & Order-Protected)
        const scalarMap = {
            '\\.MaxHP': '.maxHp',
            '\\.HPPct': '.hpPct',
            '\\.HP': '.hp',
            '\\.MaxEnergy': '.maxEnergy',
            '\\.Energy': '.energy',
            '\\.MaxConcerto': '.maxConcerto',
            '\\.Concerto': '.concerto',
            '\\.MaxForte([0-9]+)': '.maxForte$1',
            '\\.Forte([0-9]+)': '.forte$1', 
            '\\.MaxTune': '.maxTune',
            '\\.Tune': '.tune', 
            '\\.TimeStart': '.timeStart',
            '\\.GameTimeStart': '.gameTimeStart',
            '\\.SwapTime': '.swapTime',
            '\\.ComboWindow': '.comboWindow',
            '\\.EchoSummonTime': '.echoSummonTime',
            '\\.Sequence': '.sequence'
        };

        for (const [key, val] of Object.entries(scalarMap)) {
            jsStr = jsStr.replace(new RegExp(key, 'gi'), val);
        }

        return jsStr;
    },

    _buildFunction: (condStr) => {
        if (condStr === "true") return (ctx) => true;

        let jsStr = condStr;

        jsStr = DSLParser._resolveLogicalWrappers(jsStr);

        jsStr = jsStr.replace(/([@A-Za-z0-9_.\(\)]+)\s*==\s*([\d\.]+)\.\.([\d\.]+)/g, "($1 >= $2 && $1 <= $3)");
        
        jsStr = DSLParser._translatePointers(jsStr);
        jsStr = jsStr.replace(/\bNOT\b/g, "!");
        jsStr = jsStr.replace(/\bAND\b/g, "&&");
        jsStr = jsStr.replace(/\bOR\b/g, "||");

        try {
            const compiledFn = new Function("ctx", "equipper", `return ${jsStr};`);
            return (ctx, equipper) => {
                try { 
                    return compiledFn(ctx, equipper); 
                } 
                catch (e) { 
                    console.error(`[DSLParser] Runtime error evaluating compiled rule: "${condStr}"`, e);
                    return false; 
                } 
            };
        } catch (e) {
            console.error(`[DSLParser] Compilation Error. Failed to parse rule: "${condStr}"`, e);
            return (ctx) => false;
        }
    },

    evaluateMath: (mathStr, ctx, equipper) => {
        if (!mathStr || typeof mathStr !== 'string') return parseFloat(mathStr) || 0;

        // 1. Check if we've already compiled this exact string
        if (!DSLParser._mathCache[mathStr]) {
            let jsStr = DSLParser._translatePointers(mathStr);
            try {
                // 2. Compile and store it in the cache for future use
                DSLParser._mathCache[mathStr] = new Function("ctx", "equipper", `return Number(${jsStr});`);
            } catch (e) { 
                console.error(`[DSLParser] Error compiling dynamic math string: "${mathStr}"`, e);
                return 0; 
            }
        }

        // 3. Execute the cached function
        try {
            return DSLParser._mathCache[mathStr](ctx, equipper);
        } catch (e) {
            console.error(`[DSLParser] Error evaluating cached math string: "${mathStr}"`, e);
            return 0;
        }
    }
};