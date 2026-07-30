// ==========================================================================
//   COMBAT CALCULATOR (Centralized Math & Stat Engine)
// ==========================================================================
const CombatCalculator = {
    /**
     * Calculates final aggregated stats for a character slot given active buffs.
     */
    calculateFinalStats: (unitName, activeBuffs = []) => {
        const slot = (typeof RosterState !== 'undefined') ? RosterState.team.find(t => t.character === unitName) || {} : {};
        const dbUnit = (typeof CHARACTER_DB !== 'undefined') ? CHARACTER_DB[unitName] || {} : {};
        const dbWeapon = (typeof WEAPON_DB !== 'undefined' && slot.weapon) ? WEAPON_DB[slot.weapon] || {} : {};
        
        const echoStats = slot.echoStats || { ...DEFAULT_ECHO_STATS };
        
        const baseAtk = (parseFloat(dbUnit.baseAtk) || 0) + (parseFloat(dbWeapon.baseAtk) || 0);
        const baseHP = (parseFloat(dbUnit.baseHP) || 0) + (parseFloat(dbWeapon.baseHP) || 0);
        const baseDef = (parseFloat(dbUnit.baseDef) || 0) + (parseFloat(dbWeapon.baseDef) || 0);
        
        const stats = {
            percentAtk: echoStats.percentAtk, percentHP: echoStats.percentHP, percentDef: echoStats.percentDef,
            flatAtk: echoStats.flatAtk, flatHP: echoStats.flatHP, flatDef: echoStats.flatDef,
            
            critRate: (parseFloat(dbUnit.baseCritRate) || 5) + echoStats.critRate,
            critDamage: (parseFloat(dbUnit.baseCritDmg) || 150) + echoStats.critDamage,
            
            energyRegen: 100 + echoStats.energyRegen, healingBonus: echoStats.healingBonus,
            skillDmgBonus: echoStats.skillDmgBonus, basicDmgBonus: echoStats.basicDmgBonus,
            heavyDmgBonus: echoStats.heavyDmgBonus, libDmgBonus: echoStats.libDmgBonus,
            glacioDmgBonus: echoStats.glacioDmgBonus, fusionDmgBonus: echoStats.fusionDmgBonus,
            electroDmgBonus: echoStats.electroDmgBonus, aeroDmgBonus: echoStats.aeroDmgBonus,
            spectroDmgBonus: echoStats.spectroDmgBonus, havocDmgBonus: echoStats.havocDmgBonus,
        };
        
        let talentAtkPct = 0;
        const injectPassiveStat = (type, val) => {
            if (!type || !val) return;
            const statKey = STAT_NAME_MAP[type];
            if (statKey && stats[statKey] !== undefined) {
                const parsedVal = parseFloat(val) || 0;
                stats[statKey] += parsedVal;
                if (statKey === 'percentAtk') talentAtkPct += parsedVal;
            }
        };
        
        injectPassiveStat(dbWeapon.subStatType, dbWeapon.subStatValue);
        injectPassiveStat(dbUnit.talentStat1, dbUnit.talentVal1);
        injectPassiveStat(dbUnit.talentStat2, dbUnit.talentVal2);
        
        activeBuffs.forEach(buff => {
            if (buff.stat) {
                let baseStatKey = (typeof STAT_NAME_MAP !== 'undefined' && STAT_NAME_MAP[buff.stat]) ? STAT_NAME_MAP[buff.stat] : buff.stat;
                
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
                
                let rawVal = buff.value;
                if (typeof rawVal === 'string' && rawVal.includes('/')) {
                    const rank = slot ? (parseInt(slot.rank) || 1) : 1;
                    rawVal = CommonUtils.parseRankValue(rawVal, rank);
                }
                const valStr = String(rawVal || "0");
                const isPct = valStr.includes('%');
                const numVal = parseFloat(valStr) || 0;
                
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
            atk: (Math.floor(baseAtk) * (1 + (stats.percentAtk - talentAtkPct) / 100)) +
                  Math.floor(baseAtk * talentAtkPct / 100) +
                  stats.flatAtk,
            hp: Math.floor(baseHP * (1 + stats.percentHP / 100) + stats.flatHP),
            def: Math.floor(baseDef * (1 + stats.percentDef / 100) + stats.flatDef),
            talentAtkPct: talentAtkPct
        };
    },

    /**
     * Aggregates active buff totals for a specific hit context.
     */
    aggregateBuffTotals: (stateContext, executingUnit, hitModifiers) => {
        const buffTotals = {
            percentAtk: 0, flatAtk: 0,
            percentHP: 0, flatHP: 0,
            percentDef: 0, flatDef: 0,
            critRate: 0, critDamage: 0,
            dmgBonus: 0, dmgAmp: 0, dmgTaken: 0,
            multiplicativeMult: 0, additiveMult: 0,
            reduceRes: 0, ignoreRes: 0,
            reduceDef: 0, ignoreDef: 0
        };

        const appliedBuffs = {};
        const activeBuffs = stateContext.activeBuffs || {};

        const modsSet = new Set((hitModifiers || []).map(m => String(m).toLowerCase().trim()));

        const tagSpecs = [
            { key: "basic", tags: ["basic"] },
            { key: "heavy", tags: ["heavy"] },
            { key: "skill", tags: ["skill"] },
            { key: "liberation", tags: ["liberation", "lib"] },
            { key: "lib ", tags: ["liberation", "lib"] },
            { key: "intro", tags: ["intro"] },
            { key: "outro", tags: ["outro"] },
            { key: "coordinated", tags: ["coordinated"] },
            { key: "glacio", tags: ["glacio"] },
            { key: "fusion", tags: ["fusion"] },
            { key: "electro", tags: ["electro"] },
            { key: "aero", tags: ["aero"] },
            { key: "spectro", tags: ["spectro"] },
            { key: "havoc", tags: ["havoc"] },
            { key: "physical", tags: ["physical"] }
        ];

        Object.keys(activeBuffs).forEach(key => {
            const buff = activeBuffs[key];
            if (!buff || (buff.duration <= 0 && buff.stacks <= 0)) return;

            const targetUnit = buff.target || "@Self";
            const appliesToSelf = (targetUnit === "@Self" || targetUnit === "@Equipper" || targetUnit === executingUnit) && (buff.provider === executingUnit || buff.provider === "System" || buff.target === executingUnit);
            const appliesToTeam = targetUnit === "@Team" || targetUnit === "Team";
            const appliesToActive = targetUnit === "Active" && stateContext.unit === executingUnit;

            if (!(appliesToSelf || appliesToTeam || appliesToActive)) return;

            if (buff.applyTo && Array.isArray(buff.applyTo) && buff.applyTo.length > 0) {
                const matchesTag = buff.applyTo.some(reqTag => modsSet.has(String(reqTag).toLowerCase().trim()));
                if (!matchesTag) return;
            }

            if (!buff.stat) return;
            const statKey = buff.stat;
            const sLower = statKey.toLowerCase().trim();

            let requiredTagFound = false;
            let tagMatched = true;

            for (const spec of tagSpecs) {
                if (sLower.includes(spec.key)) {
                    requiredTagFound = true;
                    if (spec.tags.some(t => modsSet.has(t))) {
                        tagMatched = true;
                        break;
                    } else {
                        tagMatched = false;
                    }
                }
            }

            if (requiredTagFound && !tagMatched) {
                return;
            }

            appliedBuffs[key] = buff;

            // Retrieve actual provider weapon rank from team state
            const providerUnit = buff.provider || executingUnit;
            const providerSlot = (typeof RosterState !== 'undefined' && RosterState.team) 
                ? RosterState.team.find(t => t.character === providerUnit) 
                : null;
            const rank = providerSlot ? (parseInt(providerSlot.rank) || 1) : 1;

            let rawVal = buff.value;
            if (typeof rawVal === 'string' && rawVal.includes('/')) {
                rawVal = CommonUtils.parseRankValue(rawVal, rank);
            }
            const valStr = String(rawVal || "0");
            const isPct = valStr.includes('%');
            let numVal = parseFloat(valStr) || 0;
            if (isPct) numVal /= 100;

            const stacks = buff.stacks || 1;
            const totalVal = numVal * stacks;

            // Prioritize specific multiplier keywords over generic "dmg"
            if (sLower.includes("amp") || sLower.includes("deepen")) buffTotals.dmgAmp += totalVal;
            else if (sLower.includes("taken")) buffTotals.dmgTaken += totalVal;
            else if (sLower.includes("multiplicative")) buffTotals.multiplicativeMult += totalVal;
            else if (sLower.includes("additive")) buffTotals.additiveMult += totalVal;
            else if (sLower.includes("reduce res") || sLower.includes("res shred")) buffTotals.reduceRes += totalVal;
            else if (sLower.includes("ignore res") || sLower.includes("res pen")) buffTotals.ignoreRes += totalVal;
            else if (sLower.includes("reduce def") || sLower.includes("def shred")) buffTotals.reduceDef += totalVal;
            else if (sLower.includes("ignore def")) buffTotals.ignoreDef += totalVal;
            else if (sLower.includes("crit rate") || sLower === "cr rate") buffTotals.critRate += totalVal;
            else if (sLower.includes("crit dmg") || sLower === "cr dmg") buffTotals.critDamage += totalVal;
            else if (sLower.includes("atk") && isPct) buffTotals.percentAtk += totalVal;
            else if (sLower.includes("atk") && !isPct) buffTotals.flatAtk += totalVal;
            else if (sLower.includes("hp") && isPct) buffTotals.percentHP += totalVal;
            else if (sLower.includes("hp") && !isPct) buffTotals.flatHP += totalVal;
            else if (sLower.includes("def") && isPct) buffTotals.percentDef += totalVal;
            else if (sLower.includes("def") && !isPct) buffTotals.flatDef += totalVal;
            else if (sLower.includes("dmg bonus") || sLower.includes("dmg%") || sLower.includes("damage bonus") || sLower.includes("dmg")) buffTotals.dmgBonus += totalVal;
        });

        return { buffTotals, appliedBuffs };
    },

    /**
     * Calculates damage for a specific hit configuration and state context snapshot.
     */
    calculateDamageInstance: (hitConfig, stateContext) => {
        let pctMult = 0; let flatMult = 0;
        const strVal = String(hitConfig.hitMult || "0").trim();
        const num = parseFloat(strVal) || 0;
        if (strVal.includes('%')) pctMult += (num / 100); else flatMult += num;

        const executingUnit = hitConfig.provider || stateContext.unit;
        const dmgTypes = hitConfig.dmgTypes || [];
        const castTypes = hitConfig.castTypes || [];
        const titleStr = hitConfig.title || "Active Hit";
        
        const actionId = hitConfig.actionId || "";
        const moveName = hitConfig.moveName || "";
        const formattedPointer = `@${executingUnit}(${moveName})`;
        
        const hitModifiers = Array.from(new Set([
            ...dmgTypes, 
            ...castTypes, 
            actionId, 
            moveName, 
            formattedPointer
        ].map(m => String(m).toLowerCase())));
        
        const scalarType = (hitConfig.scalar || "ATK").toLowerCase();

        const baseStats = CombatCalculator.calculateFinalStats(executingUnit, []);
        const getBaseStat = (key) => baseStats[key] || 0;

        const { buffTotals, appliedBuffs } = CombatCalculator.aggregateBuffTotals(stateContext, executingUnit, hitModifiers);

        let baseDmgBonus = 0;
        hitModifiers.forEach(type => {
            const statKey = (type === "liberation" ? "lib" : type) + "DmgBonus";
            if (getBaseStat(statKey)) baseDmgBonus += (getBaseStat(statKey) / 100);
        });

        const rawBaseAtk = getBaseStat('baseAtk');
        const talentPctDecimal = (getBaseStat('talentAtkPct') || 0) / 100;
        const basePercentAtkDecimal = (getBaseStat('percentAtk') || 0) / 100;
        const generalAtkPctDecimal = (basePercentAtkDecimal - talentPctDecimal) + buffTotals.percentAtk; 

        const totalAtk = Math.floor((Math.floor(rawBaseAtk) * (1 + generalAtkPctDecimal)) + Math.floor(Math.floor(rawBaseAtk) * talentPctDecimal) + getBaseStat('flatAtk'));
        const totalHP = getBaseStat('baseHP') * (1 + (getBaseStat('percentHP') / 100) + buffTotals.percentHP) + getBaseStat('flatHP') + buffTotals.flatHP;
        const totalDef = getBaseStat('baseDef') * (1 + (getBaseStat('percentDef') / 100) + buffTotals.percentDef) + getBaseStat('flatDef') + buffTotals.flatDef;

        let scalingStatVal = 0; let scalarBonusPct = 0;
        if (scalarType === "atk") { scalingStatVal = totalAtk; scalarBonusPct = buffTotals.percentAtk; }
        else if (scalarType === "hp") { scalingStatVal = totalHP; scalarBonusPct = buffTotals.percentHP; }
        else if (scalarType === "def") { scalingStatVal = totalDef; scalarBonusPct = buffTotals.percentDef; }

        const finalCritRate = (getBaseStat('critRate') / 100) + buffTotals.critRate;
        const finalCritDamage = (getBaseStat('critDamage') / 100) + buffTotals.critDamage;

        const unitLvl = 90;
        const enemyLvl = typeof RosterState !== 'undefined' && RosterState.enemy ? RosterState.enemy.level : 100;
        const baseRes = typeof RosterState !== 'undefined' && RosterState.enemy ? RosterState.enemy.res / 100 : 0.1;
        
        const defMult = RotationUtils.calcDefense(unitLvl, enemyLvl, buffTotals.ignoreDef, buffTotals.reduceDef);
        const resMultiplier = RotationUtils.calcResistance(baseRes, buffTotals.ignoreRes, buffTotals.reduceRes);
        const baseDmg = ((pctMult + buffTotals.additiveMult) * scalingStatVal) + flatMult; 

        let calculatedTotal = 0;
        let nonCritDmg = 0;
        let critDmg = 0;
        let formulaUsed = "Standard";
        const titleLower = titleStr.toLowerCase();
        
        if (hitConfig.isNegativeStatus) {
            formulaUsed = "NegativeStatus";
            const statusBaseDmg = 3674 * (flatMult / 10000);
            calculatedTotal = RotationUtils.calcNegativeStatusDmg(statusBaseDmg, buffTotals.dmgAmp, buffTotals.dmgTaken, buffTotals.multiplicativeMult, resMultiplier, defMult);
            nonCritDmg = calculatedTotal;
            critDmg = calculatedTotal;
        } else if (castTypes.some(c => c.toLowerCase().includes("tune")) || titleLower.includes("tune")) {
            formulaUsed = "Tune";
            calculatedTotal = RotationUtils.calcTuneDmg(baseDmg, buffTotals.dmgAmp, buffTotals.dmgTaken, buffTotals.multiplicativeMult);
            nonCritDmg = calculatedTotal;
            critDmg = calculatedTotal;
        } else {
            const cr = Math.min(1.0, Math.max(0.0, finalCritRate));
            calculatedTotal = RotationUtils.calcStandardDmg(baseDmg, (1 - cr) * 1 + cr * finalCritDamage, 1 + baseDmgBonus + buffTotals.dmgBonus, buffTotals.dmgAmp, buffTotals.dmgTaken, buffTotals.multiplicativeMult, resMultiplier, defMult);
            
            nonCritDmg = RotationUtils.calcStandardDmg(baseDmg, 1.0, 1 + baseDmgBonus + buffTotals.dmgBonus, buffTotals.dmgAmp, buffTotals.dmgTaken, buffTotals.multiplicativeMult, resMultiplier, defMult);
            critDmg = RotationUtils.calcStandardDmg(baseDmg, finalCritDamage, 1 + baseDmgBonus + buffTotals.dmgBonus, buffTotals.dmgAmp, buffTotals.dmgTaken, buffTotals.multiplicativeMult, resMultiplier, defMult);
        }

        let statBreakdown = { label: scalarType.toUpperCase() };
        if (scalarType === "atk") {
             statBreakdown = { ...statBreakdown, base: rawBaseAtk, pct: generalAtkPctDecimal + talentPctDecimal, flat: getBaseStat('flatAtk') + buffTotals.flatAtk };
        } else if (scalarType === "hp") {
             statBreakdown = { ...statBreakdown, base: getBaseStat('baseHP'), pct: (getBaseStat('percentHP') / 100) + buffTotals.percentHP, flat: getBaseStat('flatHP') + buffTotals.flatHP };
        } else if (scalarType === "def") {
             statBreakdown = { ...statBreakdown, base: getBaseStat('baseDef'), pct: (getBaseStat('percentDef') / 100) + buffTotals.percentDef, flat: getBaseStat('flatDef') + buffTotals.flatDef };
        }

        const { displayMult, calcBreakdown } = RotationRenderer.formatDamageBreakdown(calculatedTotal, formulaUsed, pctMult, flatMult, scalingStatVal, finalCritRate, finalCritDamage, baseDmgBonus, buffTotals, resMultiplier, defMult, statBreakdown);
        
        stateContext.enemyHp = Math.max(0, stateContext.enemyHp - calculatedTotal);
        
        return {
            title: titleStr,
            total: Math.floor(calculatedTotal),
            avg: Math.floor(calculatedTotal),
            nonCrit: Math.floor(nonCritDmg),
            crit: Math.floor(critDmg),
            isOpen: hitConfig.isOpen !== undefined ? hitConfig.isOpen : true, 
            data: {
                ...stateContext, 
                activeBuffs: appliedBuffs, 
                baseMult: displayMult, 
                calcBreakdown: calcBreakdown,
                castTypes: castTypes.length > 0 ? castTypes.join(', ') : "-",
                dmgTypes: dmgTypes.length > 0 ? dmgTypes.join(', ') : "-",
                scalarLabel: (hitConfig.scalar || "ATK").toUpperCase(),
                scalarValue: scalarBonusPct > 0 ? +(scalarBonusPct * 100).toFixed(2) : 0,
                critRate: +(buffTotals.critRate * 100).toFixed(2), critDmg: +(buffTotals.critDamage * 100).toFixed(2), dmgBonus: +(buffTotals.dmgBonus * 100).toFixed(2),
                multiplicativeMult: +(buffTotals.multiplicativeMult * 100).toFixed(2), additiveMult: +(buffTotals.additiveMult * 100).toFixed(2),
                dmgAmp: +(buffTotals.dmgAmp * 100).toFixed(2), dmgTaken: +(buffTotals.dmgTaken * 100).toFixed(2),
                reduceRes: +(buffTotals.reduceRes * 100).toFixed(2), ignoreRes: +(buffTotals.ignoreRes * 100).toFixed(2),
                reduceDef: +(buffTotals.reduceDef * 100).toFixed(2), ignoreDef: +(buffTotals.ignoreDef * 100).toFixed(2)
            }
        };
    }
};

window.CombatCalculator = CombatCalculator;
window.StatCalculator = CombatCalculator;