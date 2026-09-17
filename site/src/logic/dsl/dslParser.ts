import { DSL_POINTERS, DSL_PARSER_SCALAR_EXTRAS } from './dslRegistry';

export interface CompiledDSL {
  triggers: Array<{ event: string; modifiers: string[]; args: (string | number)[] }>;
  evaluate: (ctx: unknown, equipper?: string) => boolean;
  raw: string;
}

// Compiles DSL_POINTERS with specific overrides ahead of generic pointer roots to prevent greedy prefix matching, ensuring all properties resolve.
function validatePointerRegistry(): void {
  for (const pointer of Object.values(DSL_POINTERS)) {
    for (const prop of pointer.properties) {
      if (!prop.isMethod && !prop.fullOverride && !prop.targetKey) {
        console.warn(`[DSLParser] "${pointer.pointer}.${prop.propName}" has neither targetKey nor fullOverride -- it will not evaluate.`);
      }
    }
  }
}

function buildTranslationMaps(): { pointerMap: Record<string, string>; scalarMap: Record<string, string> } {
  validatePointerRegistry();
  const pointerMap: Record<string, string> = {};
  const scalarMap: Record<string, string> = {};

  for (const pointer of Object.values(DSL_POINTERS)) {
    for (const prop of pointer.properties) {
      if (prop.fullOverride) {
        const pattern = prop.regexPattern || prop.propName;
        pointerMap[`@${pointer.pointer}\\.${pattern}`] = prop.fullOverride;
      }
    }
  }
  for (const pointer of Object.values(DSL_POINTERS)) {
    if (pointer.targetVar) pointerMap[`@${pointer.pointer}`] = pointer.targetVar;
  }

  // Generic (pointer-agnostic) suffixes, longest-pattern-first so e.g. .MaxHP/.HPPct are matched
  // before the shorter .HP that would otherwise partially consume them.
  const scalarEntries: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const pointer of Object.values(DSL_POINTERS)) {
    for (const prop of pointer.properties) {
      if (!prop.fullOverride && !prop.isMethod && prop.targetKey) {
        const key = `\\.${prop.regexPattern || prop.propName}`;
        if (!seen.has(key)) { seen.add(key); scalarEntries.push([key, prop.targetKey]); }
      }
    }
  }
  for (const [key, val] of Object.entries(DSL_PARSER_SCALAR_EXTRAS)) {
    if (!seen.has(key)) { seen.add(key); scalarEntries.push([key, val]); }
  }
  scalarEntries.sort((a, b) => b[0].length - a[0].length);
  for (const [key, val] of scalarEntries) scalarMap[key] = val;

  return { pointerMap, scalarMap };
}

const { pointerMap: POINTER_MAP, scalarMap: SCALAR_MAP } = buildTranslationMaps();

type CompiledMathFn = (ctx: unknown, equipper?: string) => number;

export const DSLParser = {
  _mathCache: {} as Record<string, CompiledMathFn>,

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

    let triggers: Array<{ event: string; modifiers: string[]; args: (string | number)[] }>;
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
        // Keeps @Namespace(Move Name) shape intact (lowercased/trimmed) rather than flattening
        // to Namespace_MoveName -- must match TimelineEngine's castModifiers format exactly.
        mStr = mStr.replace(/@([A-Za-z0-9_ ]+)\(((?:[^)(]+|\([^)(]*\))*)\)/g, (_, p1, p2) => `@${p1}(${p2.trim()})`);
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

  // Frames vs seconds: @Move.TimeStart/Duration/GameTime/FreezeTime/DamageStart/DamageEnd/
  // SwapTime, and scalarMap's Time/GameTimeStart/SwapTime/ComboWindow/EchoSummonTime suffixes,
  // are all FRAMES. .Cooldown()/.PermanentDuration stay SECONDS -- see TimelineEngine's
  // _processGameTimeDecay for where the two domains cross.
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
    jsStr = jsStr.replace(/@([A-Za-z0-9_ ]+)\(((?:[^)(]+|\([^)(]*\))*)\)/g, (_, p1, p2) => '"' + p1 + '_' + p2.trim() + '"');

    for (const [key, val] of Object.entries(POINTER_MAP)) {
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

    for (const [key, val] of Object.entries(SCALAR_MAP)) {
      jsStr = jsStr.replace(new RegExp(key, 'gi'), val);
    }
    return jsStr;
  },

  _buildFunction: (condStr: string) => {
    if (condStr === 'true') return () => true;
    let jsStr = condStr;
    jsStr = DSLParser._resolveLogicalWrappers(jsStr);
    jsStr = jsStr.replace(/([@A-Za-z0-9_.()]+)\s*==\s*([\d.]+)\.\.([\d.]+)/g, '($1 >= $2 && $1 <= $3)');
    jsStr = DSLParser._translatePointers(jsStr);
    jsStr = jsStr.replace(/\bNOT\b/g, '!').replace(/\bAND\b/g, '&&').replace(/\bOR\b/g, '||');

    try {
      const compiledFn = new Function('ctx', 'equipper', `return ${jsStr};`);
      return (ctx: unknown, equipper?: string) => {
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

  evaluateMath: (mathStr: string, ctx: unknown, equipper?: string): number => {
    if (!mathStr || typeof mathStr !== 'string') return parseFloat(mathStr) || 0;
    if (!DSLParser._mathCache[mathStr]) {
      const jsStr = DSLParser._translatePointers(mathStr);
      try {
        DSLParser._mathCache[mathStr] = new Function('ctx', 'equipper', `return Number(${jsStr});`) as CompiledMathFn;
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
