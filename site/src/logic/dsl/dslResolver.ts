// Shared MatchRule factories for AutocompleteInput.tsx's 'general' and 'dsl-value' modes -- the
// two branches that read the DSL pointer/property/event schema (the other 5 modes are driven by
// builder-local mechanics/effects state, not this schema, and keep their own bespoke rules).
// The matching/insertion engine (handleAutocomplete/handleSelect in AutocompleteInput.tsx) is
// untouched; these factories only build the `options` data each MatchRule serves.
import {
  DSL_POINTERS, DSL_EVENTS, DSL_EVENT_TOOLTIPS, DSL_MODIFIERS, DSL_MODIFIER_TOOLTIPS,
  DSL_FUNCTIONS, DSL_FUNCTION_TOOLTIPS, DSL_TYPE_METHODS, DSL_MATH_METHODS, DSL_MATH_METHOD_TOOLTIPS
} from './dslRegistry';
import type { MatchRule, SuggestionItem } from './dslTypes';
import { DataLoader } from '../../utils/DataLoader';
import { MechanicKey } from '../../utils/MechanicKey';
import type { MechanicNode, BaseStats } from '../../types';

// Every mechanic node as an @Namespace(Move Name) ref, scoped to System + the current unit. Uses
// `.name`, not the raw key, since that's what CombatCalculator's hitModifiers carries as
// `moveName`. Shared by makeEventModifierBracketRule below and AutocompleteInput.tsx's own
// 'eff-applies-during' mode.
export function collectMechanicReferences(mechanics: Record<string, MechanicNode>, currentNamespace: string | null): SuggestionItem[] {
  const seen = new Set<string>();
  const results: SuggestionItem[] = [];
  const addFrom = (mechanicsByKey: Record<string, MechanicNode>) => {
    Object.entries(mechanicsByKey).forEach(([key, mech]) => {
      if (seen.has(key) || !mech.name) return;
      const namespace = MechanicKey.parse(key).namespace;
      if (namespace !== 'System' && namespace !== currentNamespace) return;
      seen.add(key);
      results.push({ val: `@${namespace}(${mech.name})`, group: namespace === 'System' ? 'System Mechanics' : `${namespace} Mechanics` });
    });
  };
  addFrom(DataLoader.mechanicsDB);
  addFrom(mechanics);
  return results;
}

export function resolveEventTooltip(key: string): string | undefined { return DSL_EVENT_TOOLTIPS[key]; }
export function resolveModifierTooltip(key: string): string | undefined { return DSL_MODIFIER_TOOLTIPS[key]; }
export function resolvePointerTooltip(key: string): string | undefined { return DSL_POINTERS[key]?.tooltip; }
export function resolveFunctionTooltip(key: string): string | undefined { return DSL_FUNCTION_TOOLTIPS[key]; }
export function resolvePropertyTooltip(pointer: string, key: string): string | undefined {
  return DSL_POINTERS[pointer]?.properties.find(p => p.propName === key)?.tooltip;
}
export function resolveSystemMethodTooltip(key: string): string | undefined {
  return DSL_MATH_METHOD_TOOLTIPS[key] ?? Object.values(DSL_TYPE_METHODS).flat().find(m => m.name === key)?.tooltip;
}

export function makePointerRootRule(): MatchRule {
  return {
    trigger: /@([a-zA-Z]*)$/,
    options: () => {
      const base = Object.values(DSL_POINTERS).map(p => ({
        val: p.pointer + (p.usesCallSyntax ? '(' : '.'),
        group: 'Pointers',
        tooltipKey: p.pointer
      }));
      const fns = DSL_FUNCTIONS.map(f => ({ val: f, group: 'Functions', tooltipKey: f }));
      const chars = Object.keys(DataLoader.characterDB).map(c => ({
        val: c.replace(/[^A-Za-z0-9 ]/g, '') + '(',
        group: 'Characters'
      }));
      const echoes = DataLoader.allMainEchoes.map(e => ({
        val: e.replace(/[^A-Za-z0-9 ]/g, '') + '(',
        group: 'Echoes'
      }));
      return [...base, ...fns, ...chars, ...echoes];
    },
    prefix: '@'
  };
}

export function makePropertyRule(baseStats: BaseStats): MatchRule {
  return {
    trigger: /@([a-zA-Z]+)\.([a-zA-Z]*)$/,
    matchGroup: 2,
    options: (match) => {
      const pointerName = match[1];
      const pointerDef = DSL_POINTERS[pointerName];
      if (!pointerDef) return [];
      const props = pointerDef.properties
        .filter(p => !p.hidden)
        .map(p => ({ val: p.propName, group: 'Properties', pointer: pointerName }));
      if (pointerName === 'Self') {
        const fCount = parseInt(String(baseStats.forteCount ?? 1), 10);
        for (let i = 1; i <= fCount; i++) {
          props.push({ val: `Forte${i}`, group: 'Properties', pointer: pointerName });
          props.push({ val: `MaxForte${i}`, group: 'Properties', pointer: pointerName });
        }
      }
      return props;
    },
    prefix: '.'
  };
}

export function makeMethodChainRule(): MatchRule {
  return {
    // Not DSL properties -- native JS methods on a property that's already a real array/string.
    trigger: /@([a-zA-Z]+)\.([A-Za-z]+)\.([a-zA-Z]*)$/,
    matchGroup: 3,
    options: (match) => {
      const [, pointerName, propName] = match;
      const prop = DSL_POINTERS[pointerName]?.properties.find(p => p.propName === propName);
      if (!prop) return [];
      const methods = DSL_TYPE_METHODS[prop.type] || [];
      const group = prop.type === 'string[]' ? 'Array Methods' : prop.type === 'string' ? 'String Methods' : null;
      if (!group) return [];
      return methods.map(m => ({ val: m.name, group }));
    },
    prefix: '.'
  };
}

export function makeMathRule(): MatchRule {
  return {
    // Math is a plain JS global, not DSL syntax -- Math.min/max/floor/etc. already work.
    trigger: /\bMath\.([a-zA-Z]*)$/i,
    matchGroup: 1,
    options: DSL_MATH_METHODS.map(m => ({ val: m, group: 'Math Functions' })),
    prefix: ''
  };
}

export function makeEventModifierBracketRule(activeChar: string | null, mechanics: Record<string, MechanicNode>): MatchRule {
  const currentNamespace = MechanicKey.toNamespace(activeChar);
  return {
    // OnCast[Self, ...] etc.: modifiers + move refs, scoped to System + current unit.
    trigger: /\b(?:On|After)[a-zA-Z]*\[([^\]]*)$/i,
    options: () => [
      ...DSL_MODIFIERS.map(v => ({ val: v, group: 'Modifiers' })),
      ...collectMechanicReferences(mechanics, currentNamespace)
    ],
    prefix: '',
    commaList: true,
    commaCloses: ']'
  };
}

export function makeEventListRule(trigger: RegExp): MatchRule {
  const parenEvents: string[] = ['AfterHit', 'OnTick'];
  const bracketEvents: string[] = DSL_EVENTS.filter(
    e => !['ALWAYS', 'OnStart', 'OnSwapIn', 'OnSwapOut', 'OnUnitChange', ...parenEvents].includes(e)
  );
  return {
    trigger,
    options: DSL_EVENTS.map(v => ({ val: v, group: 'Events' })),
    prefix: '',
    dynamicAppend: (val) => parenEvents.includes(val) ? '(' : (bracketEvents.includes(val) ? '[' : ' ')
  };
}
