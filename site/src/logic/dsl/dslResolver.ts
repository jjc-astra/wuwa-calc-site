// Shared MatchRule factories for every AutocompleteInput.tsx mode. These build the `options` data
// each MatchRule serves; the matching/insertion engine (handleAutocomplete/handleSelect) stays in
// AutocompleteInput.tsx, which is otherwise just the UI.
import {
  DSL_POINTERS, DSL_EVENTS, DSL_EVENT_TOOLTIPS, DSL_MODIFIERS, DSL_MODIFIER_TOOLTIPS,
  DSL_FUNCTIONS, DSL_FUNCTION_TOOLTIPS, DSL_TYPE_METHODS, DSL_MATH_METHODS, DSL_MATH_METHOD_TOOLTIPS
} from './dslRegistry';
import type { MatchRule, SuggestionItem } from './dslTypes';
import { BuilderState, CAST_TYPE_COLORS } from '../../data/db';
import { UNSCOPED_MOD_LABELS, SCOPEABLE_MOD_LABELS } from '../combat/combatRegistry';
import { DataLoader } from '../../utils/DataLoader';
import { MechanicKey } from '../../utils/MechanicKey';
import { forteAliases } from '../../utils/ForteNames';
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

// Effect names don't consistently carry their namespace (some repeat it, e.g.
// "Lumi_Outro..."; some don't). Deriving namespace from the defining node covers both.
export function collectEffectNamesByNamespace(builderMechanics: Record<string, MechanicNode>): Record<string, Set<string>> {
  const byNamespace: Record<string, Set<string>> = {};
  const addFrom = (mechanicsByKey: Record<string, MechanicNode>) => {
    Object.entries(mechanicsByKey).forEach(([key, mech]) => {
      const namespace = MechanicKey.parse(key).namespace;
      (mech.effects || []).forEach(e => {
        if (!e.name) return;
        // Buff and tracker effects both define a reusable name -- resource/time_scale/etc.
        // effects reuse `name` for something else entirely (e.g. a resource effect's `name` is
        // a pool key like "energy"/"forte1", not an identifier meant to be referenced elsewhere).
        if (e.type && e.type !== 'buff' && e.type !== 'tracker') return;
        if (!byNamespace[namespace]) byNamespace[namespace] = new Set();
        byNamespace[namespace].add(MechanicKey.stripNamespace(e.name, namespace));
      });
    });
  };
  addFrom(DataLoader.mechanicsDB);
  addFrom(builderMechanics);
  return byNamespace;
}

// Bare mechanic names (not @Namespace(...) refs) for mechanics that declare a `cooldown` --
// these are the only valid targets for a Buff/CD Control effect's cooldown side, since the
// engine keys a cooldown by the move's plain `.name`, not a namespaced reference.
export function collectCooldownReferences(builderMechanics: Record<string, MechanicNode>, currentNamespace: string | null): SuggestionItem[] {
  const seen = new Set<string>();
  const results: SuggestionItem[] = [];
  const addFrom = (mechanicsByKey: Record<string, MechanicNode>) => {
    Object.entries(mechanicsByKey).forEach(([key, mech]) => {
      if (!mech.name || mech.cooldown === undefined || seen.has(mech.name)) return;
      const namespace = MechanicKey.parse(key).namespace;
      if (namespace !== 'System' && namespace !== currentNamespace) return;
      seen.add(mech.name);
      results.push({ val: mech.name, group: namespace === 'System' ? 'System Cooldowns' : `${namespace} Cooldowns` });
    });
  };
  addFrom(DataLoader.mechanicsDB);
  addFrom(builderMechanics);
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
        forteAliases(baseStats).forEach(alias => props.push({ val: alias, group: 'Properties', pointer: pointerName }));
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

// 'general' mode: completing inside an already-typed "@Namespace(" reference -- mechanics + effect names.
export function makeNamespaceRefRule(mechanics: Record<string, MechanicNode>): MatchRule {
  return {
    trigger: /@([a-zA-Z0-9_ ]+)\(([^)]*)$/,
    matchGroup: 2,
    options: (match) => {
      const namespace = match[1];
      const mechKeys = new Set<string>();
      Object.keys(DataLoader.mechanicsDB).forEach(k => mechKeys.add(k));
      Object.keys(mechanics).forEach(k => mechKeys.add(k));

      const results: SuggestionItem[] = [];
      mechKeys.forEach(k => {
        if (k.startsWith(namespace + '_')) {
          results.push({
            val: k.replace(namespace + '_', ''),
            group: namespace === 'System' ? 'System Mechanics' : `${namespace} Mechanics`
          });
        }
      });

      const byNamespace = collectEffectNamesByNamespace(mechanics);
      (byNamespace[namespace] ? Array.from(byNamespace[namespace]) : []).forEach(name => {
        results.push({
          val: name,
          group: namespace === 'System' ? 'System Effects' : `${namespace} Effects`
        });
      });
      return results;
    },
    prefix: '',
    append: ')'
  };
}

// 'eff-name' mode: an effect's own reusable `name` field -- own unit's effects first, then
// System's, with an explicit "@Namespace(" opt-in for referencing another namespace's effect.
export function makeEffectNameRules(activeChar: string | null, mechanics: Record<string, MechanicNode>): MatchRule[] {
  const currentNamespace = MechanicKey.toNamespace(activeChar);
  return [
    {
      // Completing inside a typed "@Namespace(" shorthand. Namespace allows spaces since some
      // echo names carry them (e.g. "Impermanence Heron").
      trigger: /@([a-zA-Z0-9_ ]+)\(([^)]*)$/,
      matchGroup: 2,
      options: (match) => {
        const namespace = match[1];
        const byNamespace = collectEffectNamesByNamespace(mechanics);
        const names = byNamespace[namespace] ? Array.from(byNamespace[namespace]) : [];
        return names.map(name => ({
          val: name,
          group: namespace === 'System' ? 'System Effects' : `${namespace} Effects`
        }));
      },
      prefix: '',
      append: ')'
    },
    {
      // Plain typing (no leading @, the overwhelmingly common case): this unit's own existing
      // effect names first, then System's -- not every character in the game.
      trigger: /^([a-zA-Z0-9_ ]*)$/,
      options: () => {
        const byNamespace = collectEffectNamesByNamespace(mechanics);
        const ownNames = (byNamespace[currentNamespace] ? Array.from(byNamespace[currentNamespace]) : [])
          .map(name => ({ val: name, group: `${currentNamespace} Effects` }));
        const systemNames = currentNamespace !== 'System'
          ? (byNamespace['System'] ? Array.from(byNamespace['System']) : []).map(name => ({ val: name, group: 'System Effects' }))
          : [];
        return [...ownNames, ...systemNames];
      },
      prefix: ''
    },
    {
      // Explicit opt-in only (typing "@"): the @Namespace(Name) shorthand that flattenDslShorthand
      // turns into the "Namespace_Name" convention some effects use -- not the default suggestion.
      trigger: /^@([a-zA-Z]*)$/,
      options: () => {
        const base = [{ val: 'System(', group: 'Namespaces' }];
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

// 'eff-cd-name' mode: bare mechanic names for the cooldown side of a Buff/CD Control effect.
export function makeCooldownNameRule(activeChar: string | null, mechanics: Record<string, MechanicNode>): MatchRule {
  const currentNamespace = MechanicKey.toNamespace(activeChar);
  return {
    trigger: /(.*)/,
    options: () => collectCooldownReferences(mechanics, currentNamespace),
    prefix: ''
  };
}

// 'eff-stat' mode: sheet stats, unscoped combat modifiers, and per-element/move-type modifiers.
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

  const combined = [...sheetStats, ...combatMods, ...specificMods];
  const uniqueStats: SuggestionItem[] = [];
  const seen = new Set<string>();
  combined.forEach(obj => {
    if (!seen.has(obj.val)) {
      seen.add(obj.val);
      uniqueStats.push(obj);
    }
  });
  return { trigger: /(.*)/, options: uniqueStats, prefix: '' };
}

// 'eff-target' mode: every DSL pointer as an '@Pointer' target value.
export function makeTargetRule(): MatchRule {
  return {
    trigger: /(.*)/,
    options: Object.values(DSL_POINTERS).map(p => ({ val: '@' + p.pointer, group: 'Targets', tooltipKey: p.pointer })),
    prefix: ''
  };
}

// 'eff-applies-during' mode: Cast Type or a move ref -- never a dmg type/element, already scoped
// by a Stat Modifier like "Fusion DMG Bonus".
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
