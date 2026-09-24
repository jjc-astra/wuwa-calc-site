import { DSL_POINTERS, DSL_PARSER_SCALAR_EXTRAS } from './dslRegistry';
import { getNegativeStatusMult } from '../combat/negativeStatus';

export interface CompiledDSL {
  triggers: Array<{ event: string; modifiers: string[]; args: (string | number)[] }>;
  evaluate: (ctx: unknown, equipper?: string) => boolean;
}

// Index of the ')' matching the '(' at `openIdx`, or -1 if it never closes.
function findClosingParen(str: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function validatePointerRegistry(): void {
  const jsNameByMethod = new Map<string, string>();
  for (const pointer of Object.values(DSL_POINTERS)) {
    for (const prop of pointer.properties) {
      if (prop.isMethod) {
        if (!prop.jsName) {
          console.warn(`[DSLParser] "${pointer.pointer}.${prop.propName}" is a method with no jsName -- it will not evaluate.`);
        } else if (jsNameByMethod.get(prop.propName) !== undefined && jsNameByMethod.get(prop.propName) !== prop.jsName) {
          // Methods translate the same whichever pointer they follow, so one name can't compile two ways.
          console.warn(`[DSLParser] "${prop.propName}" maps to both "${jsNameByMethod.get(prop.propName)}" and "${prop.jsName}".`);
        } else {
          jsNameByMethod.set(prop.propName, prop.jsName);
        }
      } else if (!prop.fullOverride && !prop.targetKey) {
        console.warn(`[DSLParser] "${pointer.pointer}.${prop.propName}" has neither targetKey nor fullOverride -- it will not evaluate.`);
      }
    }
  }
}

// DSL_POINTERS as regex -> JS substitutions: full overrides ahead of bare pointer roots (so a
// root can't swallow a longer property), then the generic suffixes.
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

// '.BuffStacks(arg)' -> '.getBuffStacks("arg")' and its siblings, one rule per distinct method the
// registry declares. Matched case-insensitively, like the pointer rules.
const METHOD_RULES: Array<{ pattern: RegExp; jsName: string }> = [];
for (const pointer of Object.values(DSL_POINTERS)) {
  for (const prop of pointer.properties) {
    const name = prop.propName.replace(/\(\)$/, '');
    if (prop.isMethod && prop.jsName && !METHOD_RULES.some(rule => rule.jsName === prop.jsName)) {
      METHOD_RULES.push({ pattern: new RegExp(`\\.${name}\\(([^)]+)\\)`, 'gi'), jsName: prop.jsName });
    }
  }
}

type CompiledMathFn = (ctx: unknown, equipper: string | undefined, statusMult: typeof getNegativeStatusMult) => number;

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
      evaluate: DSLParser._buildFunction(conditionStr)
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
          const openParenIdx = startIdx + wrap.length;
          const endIdx = findClosingParen(jsStr, openParenIdx);
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

  // '@StatusMult(Aero Erosion, @Self.Tracker(Stacks))' becomes 'statusMult("Aero Erosion", (@Self.Tracker(Stacks)))'.
  // The stack count can be any expression, so the call's closing paren is found by balancing rather
  // than by regex, and this has to run before the generic '@Name(...)' rule, which would turn the
  // whole call into a string. The stack expression is left as DSL for the later passes to translate.
  _translateStatusMult: (jsStr: string): string => {
    const call = /@StatusMult\(/i;
    let found = call.exec(jsStr);
    while (found) {
      const open = found.index + found[0].length - 1;
      const close = findClosingParen(jsStr, open);
      if (close === -1) break;
      const [status = '', stacks = '0'] = DSLParser._splitArgs(jsStr.substring(open + 1, close));
      const statusName = status.trim().replace(/^["']|["']$/g, '');
      jsStr = `${jsStr.substring(0, found.index)}statusMult(${JSON.stringify(statusName)}, (${stacks.trim() || '0'}))${jsStr.substring(close + 1)}`;
      found = call.exec(jsStr);
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
        const startSearch = mathIdx + 5;
        const closingIdx = findClosingParen(jsStr, mathIdx + 4);
        if (closingIdx !== -1) {
          const inner = jsStr.substring(startSearch, closingIdx);
          jsStr = jsStr.substring(0, mathIdx) + '(' + inner + ')' + jsStr.substring(closingIdx + 1);
        } else break;
      } else processing = false;
    }

    jsStr = DSLParser._translateStatusMult(jsStr);
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

    for (const { pattern, jsName } of METHOD_RULES) {
      jsStr = jsStr.replace(pattern, (_, p1) => `.${jsName}(${wrapQuotes(p1)})`);
    }

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
      const compiledFn = new Function('ctx', 'equipper', 'statusMult', `return ${jsStr};`);
      return (ctx: unknown, equipper?: string) => {
        try {
          return compiledFn(ctx, equipper, getNegativeStatusMult);
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
        DSLParser._mathCache[mathStr] = new Function('ctx', 'equipper', 'statusMult', `return Number(${jsStr});`) as CompiledMathFn;
      } catch (e) {
        console.error(`[DSLParser] Error compiling math: "${mathStr}"`, e);
        return 0;
      }
    }
    try {
      return DSLParser._mathCache[mathStr](ctx, equipper, getNegativeStatusMult);
    } catch (e) {
      console.error(`[DSLParser] Error evaluating math: "${mathStr}"`, e);
      return 0;
    }
  }
};
