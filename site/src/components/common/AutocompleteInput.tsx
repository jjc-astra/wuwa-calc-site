import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { DSL_SCHEMA, DSL_TOOLTIPS, BuilderState, CAST_TYPE_COLORS } from '../../data/db';
import { useBuilderStore } from '../../store/useBuilderStore';
import { DataLoader } from '../../utils/DataLoader';
import { tokenizeDSL } from '../../utils/DSLHighlight';
import { TooltipManager } from '../../utils/Common';
import type { MechanicNode } from '../../types';

interface AutocompleteInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mode?: 'general' | 'eff-name' | 'eff-stat' | 'eff-target' | 'eff-applies-during' | 'dsl-value';
  value: string;
  onValueChange: (val: string) => void;
  statOptions?: string[];
  dmgOptions?: string[];
}

interface SuggestionItem {
  val: string;
  group: string;
  prefix?: string;
  append?: string;
  /** Lookup key into DSL_TOOLTIPS when it differs from `val` (e.g. a pointer's trailing '.'/'(' stripped). */
  tooltipKey?: string;
  /** For the Properties group: which pointer (Self/Enemy/Move/...) this property belongs to. */
  pointer?: string;
  /** Display text, when it should differ from the text actually inserted (`val`). */
  label?: string;
}

// Resolves an autocomplete item to its DSL_TOOLTIPS description, if one is configured for its group.
function resolveTooltip(item: SuggestionItem, group: string): string | undefined {
  const key = item.tooltipKey ?? item.val;
  switch (group) {
    case 'Events': return DSL_TOOLTIPS.events[key];
    case 'Modifiers': return DSL_TOOLTIPS.modifiers[key];
    case 'Pointers':
    case 'Targets':
      return DSL_TOOLTIPS.pointers[key];
    case 'Properties':
      return item.pointer ? DSL_TOOLTIPS.properties[item.pointer]?.[key] : undefined;
    case 'Sheet Stats':
      return DSL_TOOLTIPS.sheetStats[key];
    case 'Combat Modifiers':
    case 'Specific Modifiers':
      return DSL_TOOLTIPS.statModifiers[key];
    case 'Continue':
      // See EventManager.ts's requiredModifiers check: every listed modifier must match, so
      // comma-separated entries are an AND filter (e.g. OnHit[Skill, Fusion] = Skill AND Fusion), not an OR.
      return key === ',' ? 'Combines with AND — the action must match every listed modifier, not just one.' : undefined;
    default:
      return undefined;
  }
}

interface MatchRule {
  trigger: RegExp;
  matchGroup?: number;
  options: SuggestionItem[] | ((match: RegExpMatchArray) => SuggestionItem[]);
  prefix?: string;
  append?: string;
  dynamicAppend?: (val: string) => string | null;
  /** Marks a rule where multiple comma-separated values can be typed (e.g. On Hit[...]'s
   *  modifiers, or Applies During's bare tag list). */
  commaList?: boolean;
  /** The bracket-close character a commaList rule's "Continue" prompt should also offer (e.g.
   *  ']' for On Hit[...]) -- omitted for a commaList rule with no enclosing bracket syntax
   *  (Applies During), where "add another" is the only continue action. */
  commaCloses?: string;
}

// For a commaList rule's captured bracket content, splits on ',' to find the segment currently
// being typed (for search/replace) and the segments already committed (to exclude from suggestions).
function getCommaSegmentInfo(fullCaptured: string): { currentTerm: string; replaceLength: number; chosenTerms: string[] } {
  const segments = fullCaptured.split(',');
  const rawLast = segments[segments.length - 1];
  const currentTerm = rawLast.trim();
  const leadingWhitespaceLen = rawLast.length - rawLast.replace(/^\s+/, '').length;
  const replaceLength = rawLast.length - leadingWhitespaceLen;
  const chosenTerms = segments.slice(0, -1).map(s => s.trim()).filter(Boolean);
  return { currentTerm, replaceLength, chosenTerms };
}

// Every mechanic node's own key already carries its namespace as a Folder_ prefix (e.g.
// "System_Dodge", "Lumi_Outro"), but the *effects* it defines don't consistently follow the same
// rule: a character-specific buff often repeats its own namespace in the name ("Lumi_Outro Skill
// DMG Amp"), while the shared Negative Status Dictionary's own effects (System_
// NegativeStatus_Dictionary) are just bare, globally-unique names ("Fusion Burst", "Glacio
// Chafe") with no "System_" prefix at all -- there's nothing globally ambiguous about them, so
// they were never given one. Deriving the namespace from the *node* an effect is defined in
// (not from the effect's own name) is the one rule that covers both conventions: an explicit
// self-prefix on the name gets stripped for display (so "Lumi_Outro Skill DMG Amp" still shows
// as "Outro Skill DMG Amp" under Lumi), and a bare name is kept exactly as authored.
function collectEffectNamesByNamespace(builderMechanics: Record<string, MechanicNode>): Record<string, Set<string>> {
  const byNamespace: Record<string, Set<string>> = {};
  const addFrom = (mechanicsByKey: Record<string, MechanicNode>) => {
    Object.entries(mechanicsByKey).forEach(([key, mech]) => {
      const namespace = key.startsWith('System_') ? 'System' : key.split('_')[0];
      (mech.effects || []).forEach(e => {
        if (!e.name) return;
        if (!byNamespace[namespace]) byNamespace[namespace] = new Set();
        const bare = e.name.startsWith(namespace + '_') ? e.name.slice(namespace.length + 1) : e.name;
        byNamespace[namespace].add(bare);
      });
    });
  };
  addFrom(DataLoader.mechanicsDB);
  addFrom(builderMechanics);
  return byNamespace;
}

// Every mechanic node as an @Namespace(Move Name) reference -- Applies During's "specific move"
// suggestions. Uses the node's own `.name` (its display name, e.g. "Pounce"), not the raw key,
// since that's exactly what CombatCalculator.ts's hitModifiers set carries as `moveName` for
// runtime matching -- suggesting anything else would silently never match a real hit.
// Restricted to System + the currently-open unit -- a buff can only ever fire on hits from its
// own owner or a shared System mechanic, so every other character/weapon/echo/set's moves are
// never valid here and would just be noise.
function collectMechanicReferences(builderMechanics: Record<string, MechanicNode>, currentNamespace: string | null): SuggestionItem[] {
  const seen = new Set<string>();
  const results: SuggestionItem[] = [];
  const addFrom = (mechanicsByKey: Record<string, MechanicNode>) => {
    Object.entries(mechanicsByKey).forEach(([key, mech]) => {
      if (seen.has(key) || !mech.name) return;
      const namespace = key.startsWith('System_') ? 'System' : key.split('_')[0];
      if (namespace !== 'System' && namespace !== currentNamespace) return;
      seen.add(key);
      results.push({ val: `@${namespace}(${mech.name})`, group: namespace === 'System' ? 'System Mechanics' : `${namespace} Mechanics` });
    });
  };
  addFrom(DataLoader.mechanicsDB);
  addFrom(builderMechanics);
  return results;
}

export const AutocompleteInput: React.FC<AutocompleteInputProps> = ({
  mode = 'general',
  value,
  onValueChange,
  statOptions = [],
  dmgOptions = [],
  className = '',
  placeholder,
  onBlur,
  ...rest
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [popupHtml, setPopupHtml] = useState<Array<{ group: string; items: SuggestionItem[] }>>([]);
  const [flatSuggestions, setFlatSuggestions] = useState<Array<{ item: SuggestionItem; rule: MatchRule; match: RegExpMatchArray }>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [popupPos, setPopupPos] = useState<React.CSSProperties>({});

  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const { mechanics, baseStats, activeChar } = useBuilderStore();

  // Popup is portaled to <body> (see the render below) so it always escapes the node sub-panel's
  // clipping/scrolling, the way Dropdown.tsx's popup does -- computed in fixed coordinates from
  // the real input's own rect, not the small relative-positioned wrapper div, since the wrapper
  // is what the old position:absolute popup used to (wrongly) anchor to.
  const POPUP_MAX_HEIGHT = 260;
  const positionPopup = () => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUpward = spaceBelow < POPUP_MAX_HEIGHT && spaceAbove > spaceBelow;
    setPopupPos({
      position: 'fixed',
      left: rect.left,
      minWidth: rect.width,
      maxWidth: Math.max(rect.width, window.innerWidth - rect.left - 8),
      ...(openUpward
        ? { bottom: window.innerHeight - rect.top + 2, maxHeight: Math.min(POPUP_MAX_HEIGHT, spaceAbove - 8) }
        : { top: rect.bottom + 2, maxHeight: Math.min(POPUP_MAX_HEIGHT, spaceBelow - 8) })
    });
  };

  // A portaled popup can't cheaply track every scrollable ancestor's scroll offset -- close
  // instead of drifting off-anchor, same tradeoff Dropdown.tsx's usePositionedSelectPopup makes.
  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = (e: Event) => {
      if (popupRef.current && e.target instanceof Node && popupRef.current.contains(e.target)) return;
      // The input itself fires a native (non-bubbling, but still capture-visible) 'scroll' event
      // whenever its own text scrolls internally -- typing/completing past the visible width, or
      // a completion moving the caret beyond it (see handleSelect's programmatic
      // selectionStart/End set). That's this component's own onScroll={syncScroll} territory
      // (keeps the highlight overlay lined up with the real input), not a "the anchor moved"
      // signal -- treating it as one closed the popup the instant a long "Applies During" value
      // (or any long DSL value) started needing internal scroll, i.e. right after it opened.
      if (e.target === inputRef.current) return;
      setIsOpen(false);
    };
    const close = () => setIsOpen(false);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [isOpen]);

  const tokens = useMemo(() => tokenizeDSL(value), [value]);
  const syncScroll = () => {
    if (inputRef.current) setScrollLeft(inputRef.current.scrollLeft);
  };
  useEffect(() => {
    syncScroll();
  }, [value]);

  // Closing the dropdown (select, blur, Escape) can unmount a hovered item without a
  // mouseleave event ever firing, which would otherwise leave its tooltip stuck on screen.
  useEffect(() => {
    if (!isOpen) TooltipManager.hide();
  }, [isOpen]);

  const parenEvents = ['AfterHit', 'OnTick'];
  const bracketEvents = DSL_SCHEMA.events.filter(
    e => !['ALWAYS', 'OnStart', 'OnSwapIn', 'OnSwapOut', 'OnChange', ...parenEvents].includes(e)
  );

  // Auto-scroll popup container to keep the active keyboard selection in view
  useEffect(() => {
    if (!isOpen || !popupRef.current) return;
    const activeItem = popupRef.current.querySelector('.autocomplete-item.is-active');
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, isOpen]);

  const getRules = (): MatchRule[] => {
    if (mode === 'eff-name') {
      return [
        {
          trigger: /@([a-zA-Z0-9_]+)\(([^)]*)$/,
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
          trigger: /^@?([a-zA-Z]*)$/,
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

    if (mode === 'eff-stat') {
      const sheetStats = (statOptions.length > 0 ? statOptions : BuilderState.STAT_OPTIONS).map(v => ({
        val: v,
        group: 'Sheet Stats'
      }));
      const combatMods = [
        'DMG Bonus', 'DMG Amp', 'Deepen', 'DMG Boost', 'DMG Taken', 'Reduce RES', 'RES Shred',
        'Ignore RES', 'RES Pen', 'Reduce DEF', 'Ignore DEF', 'Additive Mult', 'Multiplicative Mult'
      ].map(v => ({ val: v, group: 'Combat Modifiers' }));

      const specificMods: SuggestionItem[] = [];
      const dmgList = dmgOptions.length > 0 ? dmgOptions : BuilderState.DMG_OPTIONS;
      dmgList.forEach(dmgType => {
        ['DMG Bonus', 'DMG Amp', 'Deepen', 'DMG Taken', 'Ignore RES', 'Ignore DEF', 'Additive Mult', 'Multiplicative Mult'].forEach(mod => {
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
      return [{ trigger: /(.*)/, options: uniqueStats, prefix: '' }];
    }

    if (mode === 'eff-target') {
      return [{
        trigger: /(.*)/,
        options: DSL_SCHEMA.pointers.map(p => ({ val: '@' + p, group: 'Targets', tooltipKey: p })),
        prefix: ''
      }];
    }

    if (mode === 'eff-applies-during') {
      // Cast Type (Basic/Heavy/Skill/...) or a specific move (@Provider(Move Name)) -- never a
      // dmg type/element, which a Stat Modifier like "Fusion DMG Bonus" already scopes to on its
      // own (see CombatCalculator.ts's baseDmgBonus, a separate mechanism from this field).
      const castTypes = Object.keys(CAST_TYPE_COLORS).map(ct => ({ val: ct, group: 'Cast Type' }));
      const currentNamespace = activeChar === 'Generic' ? 'System' : activeChar;
      const mechanicRefs = collectMechanicReferences(mechanics, currentNamespace);
      return [{
        trigger: /(.*)/,
        options: [...castTypes, ...mechanicRefs],
        prefix: '',
        commaList: true
      }];
    }

    if (mode === 'dsl-value') {
      // Plain DSL math-expression fields (Priority, Combo Window, Freeze/Swap Time) -- just
      // pointer + pointer-property completion (@Default, then @Default.HeavyPriority etc.), no
      // event/bracket suggestions since these fields never hold a trigger rule.
      return [
        {
          trigger: /@([a-zA-Z]*)$/,
          options: () => {
            const base = DSL_SCHEMA.pointers.map(p => ({
              val: p + (p === 'System' ? '(' : '.'),
              group: 'Pointers',
              tooltipKey: p
            }));
            const chars = Object.keys(DataLoader.characterDB).map(c => ({
              val: c.replace(/[^a-zA-Z0-9]/g, '') + '(',
              group: 'Characters'
            }));
            return [...base, ...chars];
          },
          prefix: '@'
        },
        {
          trigger: /@([a-zA-Z]+)\.([a-zA-Z]*)$/,
          matchGroup: 2,
          options: (match) => {
            const pointer = match[1];
            const propsMap = DSL_SCHEMA.properties as Record<string, string[]>;
            if (!propsMap[pointer]) return [];
            const props = propsMap[pointer].map(p => ({ val: p, group: 'Properties', pointer }));
            if (pointer === 'Self') {
              const fCount = parseInt((baseStats.forteCount as any) || '1', 10);
              for (let i = 1; i <= fCount; i++) props.push({ val: `Forte${i}`, group: 'Properties', pointer });
            }
            return props;
          },
          prefix: '.'
        }
      ];
    }

    // General DSL Input Rules
    const currentNamespace = activeChar === 'Generic' ? 'System' : activeChar;
    return [
      {
        // OnCast[Self, ...] etc. -- static cast/dmg-type modifiers plus a specific move
        // reference (@Lumi(Move Name)), matching how TimelineEngine.ts's castModifiers set
        // actually carries a cast move (see DSLParser.ts's _parseTrigger). Scoped to System +
        // the currently-open unit for the same reason as Applies During's mechanic list.
        trigger: /\b(?:On|After|Detonate)[a-zA-Z]*\[([^\]]*)$/i,
        options: () => [
          ...DSL_SCHEMA.modifiers.map(v => ({ val: v, group: 'Modifiers' })),
          ...collectMechanicReferences(mechanics, currentNamespace)
        ],
        prefix: '',
        commaList: true,
        commaCloses: ']'
      },
      {
        trigger: /@([a-zA-Z]*)$/,
        options: () => {
          const base = DSL_SCHEMA.pointers.map(p => ({
            val: p + (p === 'System' ? '(' : '.'),
            group: 'Pointers',
            tooltipKey: p
          }));
          const chars = Object.keys(DataLoader.characterDB).map(c => ({
            val: c.replace(/[^a-zA-Z0-9]/g, '') + '(',
            group: 'Characters'
          }));
          return [...base, ...chars];
        },
        prefix: '@'
      },
      {
        trigger: /@([a-zA-Z0-9_]+)\(([^)]*)$/,
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
      },
      {
        trigger: /\b((?:On|After|Det|AL)[a-zA-Z]*)$/i,
        options: DSL_SCHEMA.events.map(v => ({ val: v, group: 'Events' })),
        prefix: '',
        dynamicAppend: (val) => parenEvents.includes(val) ? '(' : (bracketEvents.includes(val) ? '[' : ' ')
      },
      {
        trigger: /@([a-zA-Z]+)\.([a-zA-Z]*)$/,
        matchGroup: 2,
        options: (match) => {
          const pointer = match[1];
          const propsMap = DSL_SCHEMA.properties as Record<string, string[]>;
          if (!propsMap[pointer]) return [];
          const props = propsMap[pointer].map(p => ({ val: p, group: 'Properties', pointer }));
          if (pointer === 'Self') {
            const fCount = parseInt((baseStats.forteCount as any) || '1', 10);
            for (let i = 1; i <= fCount; i++) props.push({ val: `Forte${i}`, group: 'Properties', pointer });
          }
          return props;
        },
        prefix: '.'
      },
      {
        trigger: /^()$/,
        options: DSL_SCHEMA.events.map(v => ({ val: v, group: 'Events' })),
        prefix: '',
        dynamicAppend: (val) => parenEvents.includes(val) ? '(' : (bracketEvents.includes(val) ? '[' : ' ')
      }
    ];
  };

  const handleAutocomplete = () => {
    const input = inputRef.current;
    if (!input) return;

    const val = input.value;
    const cursorPos = input.selectionStart || 0;
    const textBeforeCursor = val.slice(0, cursorPos);
    const rules = getRules();

    let matched = false;
    for (const rule of rules) {
      const match = textBeforeCursor.match(rule.trigger);
      if (match) {
        const groupIdx = rule.matchGroup || 1;
        const fullCaptured = match[groupIdx] !== undefined ? match[groupIdx] : match[0];
        const optionsList = typeof rule.options === 'function' ? rule.options(match) : rule.options;

        let searchStr: string;
        let matches: SuggestionItem[];

        if (rule.commaList) {
          const { currentTerm, chosenTerms } = getCommaSegmentInfo(fullCaptured);
          searchStr = currentTerm.toLowerCase();
          const available = optionsList.filter(o => !chosenTerms.includes(o.val));
          matches = searchStr === '' ? available : available.filter(o => o.val.toLowerCase().includes(searchStr));
        } else {
          searchStr = fullCaptured.toLowerCase();
          const searchTerms = searchStr.trim().split(/\s+/).filter(Boolean);
          matches = optionsList.filter(o => {
            const optLower = o.val.toLowerCase();
            if (searchTerms.length === 0) return true;
            return searchTerms.every(term => optLower.includes(term));
          });
        }

        if (matches.length > 0) {
          if (!rule.commaList && matches.length === 1 && matches[0].val.toLowerCase() === searchStr.trim()) {
            setIsOpen(false);
            matched = true;
            break;
          }

          const grouped: Record<string, SuggestionItem[]> = {};
          const flatList: Array<{ item: SuggestionItem; rule: MatchRule; match: RegExpMatchArray }> = [];

          matches.forEach(m => {
            if (!grouped[m.group]) grouped[m.group] = [];
            grouped[m.group].push(m);
            flatList.push({ item: m, rule, match });
          });

          const groupsArr = Object.entries(grouped).map(([groupName, items]) => ({
            group: groupName,
            items
          }));

          setPopupHtml(groupsArr);
          setFlatSuggestions(flatList);
          setActiveIndex(0);
          setIsOpen(true);
          positionPopup();
          matched = true;
          break;
        }
      }
    }

    if (!matched) setIsOpen(false);
  };

  // After finishing one comma-list entry (e.g. a modifier inside On Hit[...]), offer to add
  // another or close the bracket, instead of guessing which one the user wants. closeChar is the
  // rule's own commaCloses -- omitted entirely for a bracket-less commaList field (Applies
  // During), where "add another" is the only continue action.
  const showContinueOptions = (closeChar?: string) => {
    const items: SuggestionItem[] = [{ val: ',', group: 'Continue', label: ',  (add another)' }];
    if (closeChar) items.push({ val: closeChar, group: 'Continue', label: `${closeChar}  (close)` });
    const dummyRule: MatchRule = { trigger: /(?:)/, options: items, prefix: '' };
    const flatList = items.map(item => ({ item, rule: dummyRule, match: [''] as unknown as RegExpMatchArray }));
    setPopupHtml([{ group: 'Continue', items }]);
    setFlatSuggestions(flatList);
    setActiveIndex(0);
    setIsOpen(true);
    positionPopup();
  };

  const handleSelect = (entry: { item: SuggestionItem; rule: MatchRule; match: RegExpMatchArray }) => {
    const input = inputRef.current;
    if (!input) return;

    const { item, rule, match } = entry;

    if (item.group === 'Continue') {
      const val = input.value;
      const cursorPos = input.selectionStart || 0;
      const insertText = item.val === ',' ? ', ' : item.val;
      const newVal = val.slice(0, cursorPos) + insertText + val.slice(cursorPos);
      const newCursorPos = cursorPos + insertText.length;

      onValueChange(newVal);
      setIsOpen(false);

      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.selectionStart = inputRef.current.selectionEnd = newCursorPos;
          if (item.val === ',') handleAutocomplete();
        }
      }, 0);
      return;
    }

    const val = input.value;
    const cursorPos = input.selectionStart || 0;
    const groupIdx = rule.matchGroup || 1;
    const completion = item.val;

    let newVal = '';
    let newCursorPos = 0;

    if (mode === 'eff-stat' || mode === 'eff-target') {
      newVal = completion;
      newCursorPos = completion.length;
    } else if (rule.commaList) {
      const fullCaptured = match[groupIdx] !== undefined ? match[groupIdx] : match[0];
      const { replaceLength } = getCommaSegmentInfo(fullCaptured);
      const replaceStart = cursorPos - replaceLength;

      newVal = val.slice(0, replaceStart) + completion + val.slice(cursorPos);
      newCursorPos = replaceStart + completion.length;
    } else {
      const matchLength = match[groupIdx] !== undefined ? match[groupIdx].length : match[0].length;
      const replaceStart = cursorPos - matchLength;

      // rule.prefix (e.g. '@') is only actually present in `val` when the trigger regex matched
      // it as part of the full match but *outside* the captured group (e.g. the optional '@?' in
      // eff-name's namespace rule) -- match[0] is longer than the captured group in that case.
      // When nothing beyond the captured group matched (an empty/no-'@'-yet field), that prefix
      // was never typed and has to be inserted here, or a selection like "System(" would land
      // without its leading '@' at all.
      const matchedExtra = match[0].length - matchLength;
      const needsPrefix = !!rule.prefix && matchedExtra < rule.prefix.length;
      const insertedPrefix = needsPrefix ? rule.prefix! : '';

      newVal = val.slice(0, replaceStart) + insertedPrefix + completion;
      newCursorPos = replaceStart + insertedPrefix.length + completion.length;

      const appendStr = rule.append !== undefined
        ? rule.append
        : (rule.dynamicAppend ? rule.dynamicAppend(completion) : null);

      if (appendStr) {
        if (val.slice(cursorPos, cursorPos + appendStr.length) === appendStr) {
          newCursorPos += appendStr.length;
          newVal += val.slice(cursorPos);
        } else {
          newVal += appendStr + val.slice(cursorPos);
          newCursorPos += appendStr.length;
        }
      } else {
        newVal += val.slice(cursorPos);
      }

      if (completion.endsWith('()') && !appendStr) newCursorPos -= 1;
    }

    onValueChange(newVal);
    setIsOpen(false);

    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.selectionStart = inputRef.current.selectionEnd = newCursorPos;
        if (rule.commaList) {
          showContinueOptions(rule.commaCloses);
        } else {
          handleAutocomplete();
        }
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || flatSuggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev + 1) % flatSuggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev - 1 + flatSuggestions.length) % flatSuggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      handleSelect(flatSuggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="relative w-100 m-0 p-0">
      <div className={`form-input dsl-input w-100 dsl-highlight-overlay ${className}`} aria-hidden="true">
        <div className="dsl-highlight-content" style={{ transform: `translateX(-${scrollLeft}px)` }}>
          {tokens.map((t, i) => (
            <span key={i} style={{ color: t.color }}>{t.text}</span>
          ))}
        </div>
      </div>
      <input
        ref={inputRef}
        type="text"
        className={`form-input dsl-input dsl-input-real w-100 ${className}`}
        value={value}
        onChange={e => {
          onValueChange(e.target.value);
          handleAutocomplete();
        }}
        onFocus={handleAutocomplete}
        onClick={handleAutocomplete}
        onBlur={e => { onBlur?.(e); setTimeout(() => setIsOpen(false), 200); }}
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        placeholder={placeholder}
        {...rest}
      />
      {isOpen && popupHtml.length > 0 && createPortal(
        <div ref={popupRef} className="autocomplete-popup" style={{ display: 'block', ...popupPos }}>
          {(() => {
            let globalIdx = 0;
            return popupHtml.map(g => (
              <React.Fragment key={g.group}>
                <div
                  className="autocomplete-group-header"
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-dim)',
                    padding: 'var(--space-1) var(--space-3)',
                    background: 'var(--bg-well)',
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    borderBottom: '1px solid var(--border)'
                  }}
                >
                  {g.group}
                </div>
                {g.items.map((item, i) => {
                  const currentIdx = globalIdx++;
                  const flatEntry = flatSuggestions[currentIdx];
                  const label = item.label ?? `${flatEntry?.rule.prefix || ''}${item.val}`;
                  const tooltip = resolveTooltip(item, g.group);
                  return (
                    <div
                      key={i}
                      className={`autocomplete-item ${currentIdx === activeIndex ? 'is-active' : ''}`}
                      onMouseDown={e => {
                        e.preventDefault();
                        if (flatEntry) handleSelect(flatEntry);
                      }}
                      onMouseEnter={e => {
                        setActiveIndex(currentIdx);
                        if (tooltip) {
                          TooltipManager.show(e.currentTarget, `<div class="tooltip-val">${label}</div><div style="margin-top:2px;">${tooltip}</div>`);
                        }
                      }}
                      onMouseLeave={() => TooltipManager.hide()}
                    >
                      {label}
                    </div>
                  );
                })}
              </React.Fragment>
            ));
          })()}
        </div>,
        document.body
      )}
    </div>
  );
};