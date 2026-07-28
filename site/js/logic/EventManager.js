// =========================================
//   EVENT MANAGER (Passive Listener Hub)
// =========================================

const EventManager = {
    listeners: {},

    reset: () => {
        EventManager.listeners = {
            OnStart: [], OnCast: [], OnHit: [], AfterHit: [],
            OnSwapIn: [], OnSwapOut: [], OnChange: [], OnTick: [], Detonate: [],
            OnTrackerAdd: [], OnTrackerRemove: [], OnTrackerConsume: [],
            OnBuffAdd: [], OnBuffRemove: [], OnBuffUpdate: [], OnBuffExpire: [],
            ALWAYS: []
        };
    },

    registerMechanic: (mechanic, equipperName) => {
        // --- FIXED: Only treat isPassive as ALWAYS if there is NO trigger rule defined! ---
        const hasNoRule = !mechanic.triggerRule || mechanic.triggerRule.trim() === "";
        const ruleToCompile = hasNoRule && mechanic.isPassive ? "ALWAYS" : mechanic.triggerRule;
        
        const compiledRule = DSLParser.compile(ruleToCompile);
        if (!compiledRule) return;

        compiledRule.triggers.forEach(t => {
            if (!EventManager.listeners[t.event]) EventManager.listeners[t.event] = [];

            EventManager.listeners[t.event].push({
                ...mechanic,
                equipper: equipperName, 
                triggerEvent: t.event,
                evaluate: compiledRule.evaluate,
                requiredModifiers: t.modifiers 
            });
        });
    },

    emit: (eventType, actionModifiers, rowId, activeUnitName, extraPayload = null) => {
        let bucket = EventManager.listeners[eventType] || [];

        // Inject ALWAYS listeners into the background of all standard event checks
        if (eventType !== "ALWAYS" && eventType !== "OnStart") {
            const alwaysBucket = EventManager.listeners["ALWAYS"] || [];
            bucket = [...bucket, ...alwaysBucket];
        }

        if (!bucket || bucket.length === 0) return [];

        // --- NEW: Sort the bucket so high priority passives execute first! ---
        bucket.sort((a, b) => (b.priority || 0) - (a.priority || 0));

        const triggeredEffects = [];
        const stateData = (typeof RotationState !== 'undefined') ? RotationState.getData(rowId) : null;

        // --- FIXED: Cache contexts so we evaluate off-field units correctly without lag ---
        const ctxCache = {};
        const getCtx = (unit) => {
            const key = unit || "System";
            if (!ctxCache[key]) {
                ctxCache[key] = (typeof ContextManager !== 'undefined') ? ContextManager.buildContext(rowId, key) : null;
            }
            return ctxCache[key];
        };

        for (const listener of bucket) {
            
            // --- FIXED: The [Self] Fast-Filter ---
            if (listener.requiredModifiers && listener.requiredModifiers.includes("self")) {
                if (activeUnitName !== listener.equipper) continue;
            }

            // --- FIXED: Strictly enforce required tags, even if the action has no tags! ---
            if (listener.requiredModifiers && listener.requiredModifiers.length > 0) {
                let hasAll = true;
                for (const mod of listener.requiredModifiers) {
                    if (mod === "self") continue; 
                    if (!actionModifiers || !actionModifiers.has(mod)) {
                        hasAll = false;
                        break;
                    }
                }
                if (!hasAll) continue; 
            }

            // --- FIXED: Fetch the exact context for the character who owns this mechanic! ---
            const ctx = getCtx(listener.equipper || activeUnitName);
            if (!ctx) continue;

            // --- TIME-BASED EVENTS (OnTick) ---
            if (eventType === "OnTick") {
                const { gameTimePassed, getTimeScale } = extraPayload || {};
                const timePassed = gameTimePassed || 0;
                if (timePassed <= 0) continue;

                const timerKey = `__sys_timer_${listener.name}`;
                const countKey = `__sys_count_${listener.name}`;

                let currentTimer = (stateData && stateData.trackers[timerKey]) ? stateData.trackers[timerKey] : 0;
                let currentCount = (stateData && stateData.trackers[countKey]) ? stateData.trackers[countKey] : 0;

                // --- NEW: Apply the dynamic time_scale to this specific tick! ---
                const speedMult = getTimeScale ? getTimeScale(listener.name) : 1.0;
                currentTimer += (timePassed * speedMult);
                
                // Extract interval and limits (e.g., OnTick[1.5, 5])
                let interval = 1.0; 
                let maxTicks = Infinity;

                if (listener.requiredModifiers && listener.requiredModifiers.length > 0) {
                    const parsedInterval = parseFloat(listener.requiredModifiers[0]);
                    if (!isNaN(parsedInterval)) interval = parsedInterval;
                    
                    if (listener.requiredModifiers.length > 1) {
                        const parsedMax = parseInt(listener.requiredModifiers[1]);
                        if (!isNaN(parsedMax)) maxTicks = parsedMax;
                    }
                }

                // Flush as many ticks as fit into the accumulated time
                while (currentTimer >= interval && currentCount < maxTicks) {
                    currentTimer -= interval;
                    currentCount++;

                    if (listener.evaluate(ctx, listener.equipper)) {

                        if (listener.hitMults && listener.hitMults.length > 0) {
                            let finalHitMults = listener.hitMults.map(mult => {
                                // --- NEW: Dynamic Math Snapshotting for arrays ---
                                if (typeof mult === 'string' && mult.startsWith("MATH(")) {
                                    const mathStr = mult.substring(5, mult.length - 1);
                                    return DSLParser.evaluateMath(mathStr, ctx, listener.equipper);
                                }
                                return mult;
                            });

                            triggeredEffects.push({
                                type: "procced_mechanic",
                                source: listener.name,
                                provider: listener.equipper || activeUnitName,
                                mechanicData: { ...listener, hitMults: finalHitMults } 
                            });
                        }

                        (listener.effects || []).forEach(eff => {
                            const resolvedEffect = { ...eff }; 
                            if (!resolvedEffect.source) resolvedEffect.source = listener.name;
                            if (resolvedEffect.target === "@Equipper") resolvedEffect.target = listener.equipper;
                            
                            const p = resolvedEffect.provider;
                            if (!p || p === "System" || p === "@Equipper" || p === listener.name || p === listener.provider) {
                                resolvedEffect.provider = listener.equipper || activeUnitName;
                            }
                            triggeredEffects.push(resolvedEffect);
                        });
                    }
                }

                // --- FIX: Save back to stateData so it inherits properly down the timeline ---
                if (stateData) {
                    stateData.trackers[timerKey] = currentTimer;
                    stateData.trackers[countKey] = currentCount;
                }
            }
            
            // --- AFTERHIT LOGIC WITH THRESHOLDS ---
            else if (eventType === "AfterHit") {
                // If DSL says AfterHit[3], args are passed into modifiers instead of args
                const reqHit = (listener.requiredModifiers && listener.requiredModifiers.length > 0) ? listener.requiredModifiers[0] : null;
                const { hitIndex, totalHits } = extraPayload || { hitIndex: 1, totalHits: 1 };
                
                let matchesHit = true;
                if (reqHit !== null && reqHit !== undefined && reqHit !== "Self") {
                    const reqHitStr = String(reqHit).toLowerCase();
                    if (reqHitStr === 'all') {
                        matchesHit = (hitIndex === totalHits); 
                    } else {
                        matchesHit = (hitIndex === parseInt(reqHit));
                    }
                }
                
                if (matchesHit && listener.evaluate(ctx, listener.equipper)) {
                    (listener.effects || []).forEach(eff => {
                        const resolvedEffect = { ...eff };
                        if (!resolvedEffect.source) resolvedEffect.source = listener.name;
                        if (resolvedEffect.target === "@Equipper") resolvedEffect.target = listener.equipper;
                        
                        const p = resolvedEffect.provider;
                        if (!p || p === "System" || p === "@Equipper" || p === listener.name || p === listener.provider) {
                            resolvedEffect.provider = listener.equipper || activeUnitName;
                        }
                        triggeredEffects.push(resolvedEffect);
                    });
                    if (listener.cooldown) {
                        triggeredEffects.push({ type: "cooldown", name: listener.name, target: listener.equipper, value: listener.cooldown });
                    }
                }
            }
            
            // --- Normal Events (OnCast, OnHit, Detonate, OnSwap, ALWAYS, etc.) ---
            else {
                const isAlways = listener.triggerEvent === "ALWAYS";
                
                if (listener.evaluate(ctx, listener.equipper)) {
                    

                    // Prevent ALWAYS listeners from spamming damage on every single background event check
                    if ((listener.hitMults && listener.hitMults.length > 0) && (!isAlways || eventType === "ALWAYS")) {
                        let finalHitMults = listener.hitMults.map(mult => {
                            if (typeof mult === 'string' && mult.startsWith("MATH(")) {
                                const mathStr = mult.substring(5, mult.length - 1);
                                return DSLParser.evaluateMath(mathStr, ctx, listener.equipper);
                            }
                            return mult;
                        });

                        triggeredEffects.push({
                            type: "procced_mechanic",
                            source: listener.name,
                            provider: listener.equipper || activeUnitName,
                            mechanicData: { ...listener, hitMults: finalHitMults } 
                        });
                    }

                    (listener.effects || []).forEach(eff => {
                        // Prevent ALWAYS from spamming trackers in the background
                        if (isAlways && eventType !== "ALWAYS" && eff.type && eff.type !== "buff") return;

                        const resolvedEffect = { ...eff }; 
                        
                        if (!resolvedEffect.source) resolvedEffect.source = listener.name;
                        if (resolvedEffect.target === "@Equipper") resolvedEffect.target = listener.equipper;
                        
                        const p = resolvedEffect.provider;
                        if (!p || p === "System" || p === "@Equipper" || p === listener.name || p === listener.provider) {
                            resolvedEffect.provider = listener.equipper || activeUnitName;
                        }

                        triggeredEffects.push(resolvedEffect);
                    });

                    if (listener.cooldown && (!isAlways || eventType === "ALWAYS")) {
                        triggeredEffects.push({
                            type: "cooldown",
                            name: listener.name,
                            target: listener.equipper,
                            value: listener.cooldown
                        });
                    }
                } else if (isAlways) {
                    // --- NEW: If an ALWAYS condition becomes FALSE, actively strip its buffs! ---
                    (listener.effects || []).forEach(eff => {
                        if (eff.type === "buff" || !eff.type) {
                            const p = eff.provider || listener.equipper || activeUnitName;
                            let t = eff.target || "@Self";
                            if (t === "@Equipper") t = listener.equipper;

                            triggeredEffects.push({
                                type: "buffAction",
                                action: "remove",
                                value: "ALL",
                                name: eff.name,
                                target: t,
                                provider: p
                            });
                        }
                    });
                }
            }
        }
        return triggeredEffects;
    }
};