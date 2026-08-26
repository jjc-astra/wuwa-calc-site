export interface CompiledDSL {
  triggers: Array<{ event: string; modifiers: string[]; args: (string | number)[] }>;
  evaluate: (ctx: any, equipper?: string) => boolean;
  raw: string;
}

export const DSLParser = {
  _mathCache: {} as Record<string, Function>,

  compile: (dslString: string): CompiledDSL | null => {
    if (!dslString) return null;
    let triggerStr = 'ALWAYS';
    let conditionStr = 'true';

    if (dslString.includes(' IF ')) {
      const parts = dslString.split(' IF ');
      triggerStr = parts[0].trim() || 'ALWAYS';
      conditionStr = parts[1].trim();
    } else if (dslString.startsWith('IF ')) {
      conditionStr = dslString.substring(3).trim();
    } else {
      triggerStr = dslString.trim();
    }

    if (conditionStr.startsWith('(') && conditionStr.endsWith(')')) {
      conditionStr = conditionStr.substring(1, conditionStr.length - 1);
    }

    let triggers: Array<{ event: string; modifiers: string[]; args: (string | number)[] }> = [];
    if (triggerStr.startsWith('ANY(') && triggerStr.endsWith(')')) {
      const inner = triggerStr.substring(4, triggerStr.length - 1);
      triggers = DSLParser._splitArgs(inner).map(t => DSLParser._parseTrigger(t));
    } else {
      triggers = [DSLParser._parseTrigger(triggerStr)];
    }

    return {
      triggers,
      evaluate: DSLParser._buildFunction(conditionStr),
      raw: dslString
    };
  },

  _parseTrigger: (str: string) => {
    let event = str;
    let modifiers: string[] = [];
    let args: (string | number)[] = [];

    const baseMatch = str.match(/^([A-Za-z]+)/);
    if (baseMatch) event = baseMatch[1];

    const argMatch = str.match(/\(([^)]+)\)/);
    if (argMatch) {
      args = argMatch[1].split(',').map(s => {
        const val = s.trim();
        const num = parseFloat(val);
        return isNaN(num) ? val : num;
      });
    }

    const modMatch = str.match(/\[(.*?)\]/);
    if (modMatch) {
      modifiers = modMatch[1].split(',').map(s => {
        let mStr = s.trim();
        mStr = mStr.replace(/@([A-Za-z0-9_]+)\(((?:[^)(]+|\([^)(]*\))*)\)/g, (_, p1, p2) => p1 + '_' + p2.trim());
        return mStr.toLowerCase();
      });
    }

    return { event, modifiers, args };
  },

  _splitArgs: (str: string): string[] => {
    const result: string[] = [];
    let current = '';
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (char === '(' || char === '[') depth++;
      else if (char === ')' || char === ']') depth--;
      else if (char === ',' && depth === 0) {
        result.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    if (current.trim()) result.push(current.trim());
    return result;
  },

  _resolveLogicalWrappers: (jsStr: string): string => {
    const wrappers = ['ANY', 'ALL', 'XOR', 'NOT'];
    let resolving = true;
    while (resolving) {
      resolving = false;
      for (const wrap of wrappers) {
        const search = wrap + '(';
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
            let resolved = '';
            const args = DSLParser._splitArgs(inner);

            if (wrap === 'ANY') resolved = '(' + args.join(' || ') + ')';
            else if (wrap === 'ALL') resolved = '(' + args.join(' && ') + ')';
            else if (wrap === 'NOT') resolved = '(!(' + inner + '))';
            else if (wrap === 'XOR') {
              resolved = args.length >= 2 ? `(Boolean(${args[0]}) !== Boolean(${args[1]}))` : '(false)';
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

  // Frames vs seconds cheat sheet for anyone authoring/reading DSL against this pointer table:
  // @Move.TimeStart/Duration/GameTime/FreezeTime/DamageStart/DamageEnd/SwapTime, and the
  // scalarMap's .TimeStart/.GameTimeStart/.SwapTime/.ComboWindow/.EchoSummonTime suffixes, are
  // all FRAMES (the row-scheduling/animation-duration domain). .Cooldown(...)/getCooldown and
  // .PermanentDuration stay SECONDS -- cooldowns and buff/effect lifetimes are a deliberate
  // exception to the frame migration (see TimelineEngine.ts's _processGameTimeDecay for the one
  // place these two domains cross).
  _translatePointers: (jsStr: string): string => {
    if (typeof jsStr !== 'string') return jsStr;
    let processing = true;
    while (processing) {
      const mathIdx = jsStr.toUpperCase().indexOf('MATH(');
      if (mathIdx !== -1) {
        let depth = 1;
        let closingIdx = -1;
        const startSearch = mathIdx + 5;
        for (let i = startSearch; i < jsStr.length; i++) {
          if (jsStr[i] === '(') depth++;
          else if (jsStr[i] === ')') {
            depth--;
            if (depth === 0) { closingIdx = i; break; }
          }
        }
        if (closingIdx !== -1) {
          const inner = jsStr.substring(startSearch, closingIdx);
          jsStr = jsStr.substring(0, mathIdx) + '(' + inner + ')' + jsStr.substring(closingIdx + 1);
        } else break;
      } else processing = false;
    }

    jsStr = jsStr.replace(/\bABS\b/gi, 'Math.abs');
    jsStr = jsStr.replace(/%(?!\s*[\d@a-zA-Z(_])/g, ' / 100');
    jsStr = jsStr.replace(/@([A-Za-z0-9_]+)\(((?:[^)(]+|\([^)(]*\))*)\)/g, (_, p1, p2) => '"' + p1 + '_' + p2.trim() + '"');

    const pointerMap: Record<string, string> = {
      '@Self\\.PrevAction': 'ctx.self.prevAction',
      '@Prev\\.(Unit|name)': 'ctx.prev.unit',
      '@Prev\\.Action': 'ctx.prev.action',
      '@Prev\\.CastTypes?': 'ctx.prev.castTypes',
      '@Next\\.name': 'ctx.next.name',
      '@Next\\.Action': 'ctx.next.action',
      '@Next\\.CastTypes?': 'ctx.next.castTypes',
      '@Next\\.Priority': 'ctx.next.priority',
      '@Self\\.name': 'ctx.self.name',
      '@Enemy\\.name': '"Enemy"',
      '@Active\\.name': 'ctx.active.name',
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
      '@Move\\.IsInHoldWindow': 'ctx.move.isInHoldWindow',
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

    const wrapQuotes = (arg: string) => {
      arg = arg.trim();
      return (arg.startsWith('"') || arg.startsWith("'")) ? arg : `"${arg}"`;
    };

    jsStr = jsStr.replace(/\.BuffStacks\(([^)]+)\)/gi, (_, p1) => `.getBuffStacks(${wrapQuotes(p1)})`);
    jsStr = jsStr.replace(/\.BuffMaxStacks\(([^)]+)\)/gi, (_, p1) => `.getBuffMaxStacks(${wrapQuotes(p1)})`);
    jsStr = jsStr.replace(/\.HasBuff\(([^)]+)\)/gi, (_, p1) => `.hasBuff(${wrapQuotes(p1)})`);
    jsStr = jsStr.replace(/\.Tracker\(([^)]+)\)/gi, (_, p1) => `.getTracker(${wrapQuotes(p1)})`);
    jsStr = jsStr.replace(/\.Stat\(([^)]+)\)/gi, (_, p1) => `.getStat(${wrapQuotes(p1)})`);
    jsStr = jsStr.replace(/\.Cooldown\(([^)]+)\)/gi, (_, p1) => `.getCooldown(${wrapQuotes(p1)})`);
    jsStr = jsStr.replace(/@StatusMult\(([^,]+),\s*([^)]+)\)/gi, (_, p1, p2) => `CombatCalculator.getNegativeStatusMult(${wrapQuotes(p1)}, ${p2})`);

    const scalarMap: Record<string, string> = {
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
      '\\.PermanentDuration': '.permanentDuration',
      '\\.BasicPriority': '.basicPriority',
      '\\.HeavyPriority': '.heavyPriority',
      '\\.SkillPriority': '.skillPriority',
      '\\.EchoPriority': '.echoPriority',
      '\\.DodgePriority': '.dodgePriority',
      '\\.JumpPriority': '.jumpPriority',
      '\\.LibPriority': '.libPriority',
      '\\.IntroPriority': '.introPriority',
      '\\.OutroPriority': '.outroPriority',
      '\\.Sequence': '.sequence'
    };

    for (const [key, val] of Object.entries(scalarMap)) {
      jsStr = jsStr.replace(new RegExp(key, 'gi'), val);
    }
    return jsStr;
  },

  _buildFunction: (condStr: string) => {
    if (condStr === 'true') return () => true;
    let jsStr = condStr;
    jsStr = DSLParser._resolveLogicalWrappers(jsStr);
    jsStr = jsStr.replace(/([@A-Za-z0-9_.\(\)]+)\s*==\s*([\d\.]+)\.\.([\d\.]+)/g, '($1 >= $2 && $1 <= $3)');
    jsStr = DSLParser._translatePointers(jsStr);
    jsStr = jsStr.replace(/\bNOT\b/g, '!').replace(/\bAND\b/g, '&&').replace(/\bOR\b/g, '||');

    try {
      const compiledFn = new Function('ctx', 'equipper', `return ${jsStr};`);
      return (ctx: any, equipper?: string) => {
        try {
          return compiledFn(ctx, equipper);
        } catch (e) {
          console.error(`[DSLParser] Runtime evaluation error: "${condStr}"`, e);
          return false;
        }
      };
    } catch (e) {
      console.error(`[DSLParser] Compilation error: "${condStr}"`, e);
      return () => false;
    }
  },

  evaluateMath: (mathStr: string, ctx: any, equipper?: string): number => {
    if (!mathStr || typeof mathStr !== 'string') return parseFloat(mathStr) || 0;
    if (!DSLParser._mathCache[mathStr]) {
      const jsStr = DSLParser._translatePointers(mathStr);
      try {
        DSLParser._mathCache[mathStr] = new Function('ctx', 'equipper', `return Number(${jsStr});`);
      } catch (e) {
        console.error(`[DSLParser] Error compiling math: "${mathStr}"`, e);
        return 0;
      }
    }
    try {
      return DSLParser._mathCache[mathStr](ctx, equipper);
    } catch (e) {
      console.error(`[DSLParser] Error evaluating math: "${mathStr}"`, e);
      return 0;
    }
  }
};