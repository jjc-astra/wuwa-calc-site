// MatchRule factories for AutocompleteInput modes.
import {
  DSL_POINTERS, DSL_EVENTS, DSL_EVENT_TOOLTIPS, DSL_MODIFIERS, DSL_MODIFIER_TOOLTIPS,
  DSL_FUNCTIONS, DSL_FUNCTION_TOOLTIPS, DSL_TYPE_METHODS, DSL_MATH_METHODS, DSL_MATH_METHOD_TOOLTIPS,
  DSL_LOGIC_TOOLTIPS
} from './dslRegistry';
import type { MatchRule, SuggestionItem } from './dslTypes';
import { BuilderState, CAST_TYPE_COLORS } from '../../data/db';
import { UNSCOPED_MOD_LABELS, SCOPEABLE_MOD_LABELS } from '../combat/combatRegistry';
import { DataLoader } from '../../utils/DataLoader';
import { MechanicKey, SYSTEM_NAMESPACE } from '../../utils/MechanicKey';
import { forteAliases } from '../../utils/ForteNames';
import type { MechanicNode, BaseStats } from '../../types';

// Every loaded and Builder node (Builder wins), with its namespace.
function forEachMechanic(builderMechanics: Record<string, MechanicNode>, visit: (key: string, mech: MechanicNode, namespace: string) => void): void {
  [DataLoader.mechanicsDB, builderMechanics].forEach(byKey =>
    Object.entries(byKey).forEach(([key, mech]) => visit(key, mech, MechanicKey.parse(key).namespace)));
}

const isVisibleNamespace = (namespace: string, currentNamespace: string | null): boolean =>
  namespace === SYSTEM_NAMESPACE || namespace === currentNamespace;

// @Namespace(Move Name) refs for System + the current unit, by `.name`.
function collectMechanicReferences(mechanics: Record<string, MechanicNode>, currentNamespace: string | null): SuggestionItem[] {
  const seen = new Set<string>();
  const results: SuggestionItem[] = [];
  forEachMechanic(mechanics, (key, mech, namespace) => {
    if (seen.has(key) || !mech.name || !isVisibleNamespace(namespace, currentNamespace)) return;
    seen.add(key);
    results.push({ val: `@${namespace}(${mech.name})`, group: `${namespace} Mechanics` });
  });
  return results;
}

// Effect names by their defining node's namespace.
function collectEffectNamesByNamespace(builderMechanics: Record<string, MechanicNode>): Record<string, Set<string>> {
  const byNamespace: Record<string, Set<string>> = {};
  forEachMechanic(builderMechanics, (_key, mech, namespace) => {
    (mech.effects || []).forEach(e => {
      // Only buffs and trackers have referenceable names.
      if (!e.name || (e.type && e.type !== 'buff' && e.type !== 'tracker')) return;
      (byNamespace[namespace] ??= new Set()).add(e.name);
    });
  });
  return byNamespace;
}

// Effect names with the namespace prefix stripped, for "@Namespace(...)".
function namespacedEffectNames(builderMechanics: Record<string, MechanicNode>, namespace: string): string[] {
  const names = collectEffectNamesByNamespace(builderMechanics)[namespace];
  return names ? [...new Set([...names].map(name => MechanicKey.stripNamespace(name, namespace)))] : [];
}

// Bare names of mechanics with a `cooldown`.
function collectCooldownReferences(builderMechanics: Record<string, MechanicNode>, currentNamespace: string | null): SuggestionItem[] {
  const seen = new Set<string>();
  const results: SuggestionItem[] = [];
  forEachMechanic(builderMechanics, (_key, mech, namespace) => {
    if (!mech.name || mech.cooldown === undefined || seen.has(mech.name) || !isVisibleNamespace(namespace, currentNamespace)) return;
    seen.add(mech.name);
    results.push({ val: mech.name, group: `${namespace} Cooldowns` });
  });
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
export function resolveLogicTooltip(key: string): string | undefined { return DSL_LOGIC_TOOLTIPS[key]; }

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
      const props = pointerDef.properties.map(p => ({ val: p.propName, group: 'Properties', pointer: pointerName }));
      if (pointerName === 'Self') {
        const fCount = parseInt(String(baseStats.forteCount ?? 1), 10);
        for (let i = 1; i <= fCount; i++) {
          props.push({ val: `Forte${i}`, group: 'Properties', pointer: pointerName });
          props.push({ val: `MaxForte${i}`, group: 'Properties', pointer: pointerName });
        }
        forteAliases(baseStats).forEach(alias => props.push({ val: alias, group: 'Properties', pointer: pointerName }));
      }
      return props;
    },
    prefix: '.'
  };
}

export function makeMethodChainRule(): MatchRule {
  return {
    // Native JS array/string methods.
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
    trigger: /\bMath\.([a-zA-Z]*)$/i,
    matchGroup: 1,
    options: DSL_MATH_METHODS.map(m => ({ val: m, group: 'Math Functions' })),
    prefix: ''
  };
}

export function makeEventModifierBracketRule(activeChar: string | null, mechanics: Record<string, MechanicNode>): MatchRule {
  const currentNamespace = MechanicKey.toNamespace(activeChar);
  return {
    // Bracketed modifiers, optionally after event args: AfterHit(3)[...].
    trigger: /\b(?:On|After)[a-zA-Z]*(?:\([^)]*\))?\[([^\]]*)$/i,
    options: () => [
      ...DSL_MODIFIERS.map(v => ({ val: v, group: 'Modifiers' })),
      ...collectMechanicReferences(mechanics, currentNamespace)
    ],
    prefix: '',
    commaList: true,
    commaCloses: ']'
  };
}

// Inside an IF condition (where ALL/XOR/NOT are valid).
const isInConditionClause = (beforeCursor: string): boolean => / IF |^IF /.test(beforeCursor);

const PAREN_EVENTS: string[] = ['AfterHit', 'OnTick'];
const BRACKET_EVENTS: string[] = DSL_EVENTS.filter(
  e => !['ALWAYS', 'OnStart', 'OnSwapIn', 'OnSwapOut', 'OnUnitChange', ...PAREN_EVENTS].includes(e)
);
const eventOpener = (val: string): string => (PAREN_EVENTS.includes(val) ? '(' : BRACKET_EVENTS.includes(val) ? '[' : ' ');

export function makeEventListRule(trigger: RegExp): MatchRule {
  const logicWrappers = ['ANY', 'ALL', 'XOR', 'NOT'];
  return {
    trigger,
    options: (match) => {
      const beforeCursor = (match.input ?? '').slice(0, match.index ?? 0);
      const items: SuggestionItem[] = [
        ...DSL_EVENTS.map(v => ({ val: v, group: 'Events' })),
        { val: 'ANY', group: 'Logic' }
      ];
      if (isInConditionClause(beforeCursor)) {
        items.push({ val: 'ALL', group: 'Logic' }, { val: 'XOR', group: 'Logic' }, { val: 'NOT', group: 'Logic' });
      }
      return items;
    },
    prefix: '',
    dynamicAppend: (val) => (logicWrappers.includes(val) ? '(' : eventOpener(val))
  };
}

// Offers "[" after AfterHit(...)/OnTick(...).
export function makeEventArgsCloseRule(): MatchRule {
  return {
    trigger: /\b(?:AfterHit|OnTick)\([^()]*\)()$/i,
    matchGroup: 1,
    options: [{ val: '[', group: 'Syntax', label: '[  (add modifiers)' }],
    prefix: ''
  };
}

// Top-level events inside ANY(...).
export function makeAnyTriggerListRule(): MatchRule {
  return {
    // 1: preceding ANY content; 2: the token being typed.
    trigger: /\bANY\(([\s\S]*?)([A-Za-z]*)$/i,
    matchGroup: 2,
    options: (match) => {
      const inner = match[1] ?? '';
      let depth = 0;
      let lastTopLevelComma = 0;
      for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === '(' || ch === '[') depth++;
        else if (ch === ')' || ch === ']') {
          depth--;
          // ANY(...) already closed.
          if (depth < 0) return [];
        } else if (ch === ',' && depth === 0) {
          lastTopLevelComma = i + 1;
        }
      }
      // Only at top level, at the start of an entry.
      if (depth !== 0 || inner.slice(lastTopLevelComma).trim() !== '') return [];
      return DSL_EVENTS.map(v => ({ val: v, group: 'Events' }));
    },
    prefix: '',
    dynamicAppend: eventOpener
  };
}

// 'general': inside a typed "@Namespace(" reference.
export function makeNamespaceRefRule(mechanics: Record<string, MechanicNode>): MatchRule {
  return {
    trigger: /@([a-zA-Z0-9_ ]+)\(([^)]*)$/,
    matchGroup: 2,
    options: (match) => {
      const namespace = match[1];
      const mechKeys = new Set([...Object.keys(DataLoader.mechanicsDB), ...Object.keys(mechanics)]);
      return [
        ...[...mechKeys]
          .filter(k => MechanicKey.belongsTo(k, namespace))
          .map(k => ({ val: MechanicKey.stripNamespace(k, namespace), group: `${namespace} Mechanics` })),
        ...namespacedEffectNames(mechanics, namespace).map(name => ({ val: name, group: `${namespace} Effects` }))
      ];
    },
    prefix: '',
    append: ')'
  };
}

// 'eff-name': own unit's effect names, then System's; "@" for other namespaces.
export function makeEffectNameRules(activeChar: string | null, mechanics: Record<string, MechanicNode>): MatchRule[] {
  const currentNamespace = MechanicKey.toNamespace(activeChar);
  return [
    {
      // Inside "@Namespace(" (namespaces may contain spaces).
      trigger: /@([a-zA-Z0-9_ ]+)\(([^)]*)$/,
      matchGroup: 2,
      options: (match) => {
        const namespace = match[1];
        return namespacedEffectNames(mechanics, namespace).map(name => ({ val: name, group: `${namespace} Effects` }));
      },
      prefix: '',
      append: ')'
    },
    {
      // Plain typing: own effects, then System's.
      trigger: /^([a-zA-Z0-9_ ]*)$/,
      options: () => {
        const byNamespace = collectEffectNamesByNamespace(mechanics);
        const namesIn = (namespace: string) => [...(byNamespace[namespace] ?? [])].map(name => ({ val: name, group: `${namespace} Effects` }));
        return [...namesIn(currentNamespace), ...(currentNamespace !== SYSTEM_NAMESPACE ? namesIn(SYSTEM_NAMESPACE) : [])];
      },
      prefix: ''
    },
    {
      // Typing "@": @Namespace(Name) shorthand.
      trigger: /^@([a-zA-Z]*)$/,
      options: () => {
        const base = [{ val: `${SYSTEM_NAMESPACE}(`, group: 'Namespaces' }];
        const chars = Object.keys(DataLoader.characterDB).map(c => ({
          val: c.replace(/[^a-zA-Z0-9]/g, '') + '(',
          group: 'Namespaces'
        }));
        return [...base, ...chars];
      },
      prefix: '@'
    }
  ];
}

// 'eff-cd-name': bare mechanic names with cooldowns.
export function makeCooldownNameRule(activeChar: string | null, mechanics: Record<string, MechanicNode>): MatchRule {
  const currentNamespace = MechanicKey.toNamespace(activeChar);
  return {
    trigger: /(.*)/,
    options: () => collectCooldownReferences(mechanics, currentNamespace),
    prefix: ''
  };
}

// 'eff-stat': sheet stats and combat modifiers.
export function makeStatRule(statOptions: string[], dmgOptions: string[]): MatchRule {
  const sheetStats = (statOptions.length > 0 ? statOptions : BuilderState.STAT_OPTIONS).map(v => ({
    val: v,
    group: 'Sheet Stats'
  }));
  const combatMods = UNSCOPED_MOD_LABELS.map(v => ({ val: v, group: 'Combat Modifiers' }));

  const specificMods: SuggestionItem[] = [];
  const dmgList = dmgOptions.length > 0 ? dmgOptions : BuilderState.DMG_OPTIONS;
  dmgList.forEach(dmgType => {
    SCOPEABLE_MOD_LABELS.forEach(mod => {
      specificMods.push({ val: `${dmgType} ${mod}`, group: 'Specific Modifiers', tooltipKey: mod });
    });
  });

  const seen = new Set<string>();
  const uniqueStats = [...sheetStats, ...combatMods, ...specificMods].filter(item => !seen.has(item.val) && !!seen.add(item.val));
  return { trigger: /(.*)/, options: uniqueStats, prefix: '' };
}

// 'eff-target': every DSL pointer.
export function makeTargetRule(): MatchRule {
  return {
    trigger: /(.*)/,
    options: Object.values(DSL_POINTERS).map(p => ({ val: '@' + p.pointer, group: 'Targets', tooltipKey: p.pointer })),
    prefix: ''
  };
}

// 'eff-applies-during': cast types or move refs.
export function makeAppliesDuringRule(activeChar: string | null, mechanics: Record<string, MechanicNode>): MatchRule {
  const castTypes = Object.keys(CAST_TYPE_COLORS).map(ct => ({ val: ct, group: 'Cast Type' }));
  const currentNamespace = MechanicKey.toNamespace(activeChar);
  const mechanicRefs = collectMechanicReferences(mechanics, currentNamespace);
  return {
    trigger: /(.*)/,
    options: [...castTypes, ...mechanicRefs],
    prefix: '',
    commaList: true
  };
}
