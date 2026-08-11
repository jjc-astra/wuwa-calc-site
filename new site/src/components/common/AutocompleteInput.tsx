import React, { useState, useRef, useEffect, useMemo } from 'react';
import { DSL_SCHEMA, DSL_TOOLTIPS, BuilderState } from '../../data/db';
import { useBuilderStore } from '../../store/useBuilderStore';
import { DataLoader } from '../../utils/DataLoader';
import { tokenizeDSL } from '../../utils/DSLHighlight';
import { TooltipManager } from '../../utils/Common';

interface AutocompleteInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mode?: 'general' | 'eff-name' | 'eff-stat' | 'eff-target';
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
}

export const AutocompleteInput: React.FC<AutocompleteInputProps> = ({
  mode = 'general',
  value,
  onValueChange,
  statOptions = [],
  dmgOptions = [],
  className = '',
  placeholder,
  ...rest
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [popupHtml, setPopupHtml] = useState<Array<{ group: string; items: SuggestionItem[] }>>([]);
  const [flatSuggestions, setFlatSuggestions] = useState<Array<{ item: SuggestionItem; rule: MatchRule; match: RegExpMatchArray }>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const { mechanics, baseStats } = useBuilderStore();

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
            const effKeys = new Set<string>();
            Object.values(DataLoader.mechanicsDB).forEach(mech => {
              (mech.effects || []).forEach(e => {
                if (e.name) effKeys.add(e.name);
              });
            });
            Object.values(mechanics).forEach(mech => {
              (mech.effects || []).forEach(e => {
                if (e.name) effKeys.add(e.name);
              });
            });
            return Array.from(effKeys)
              .filter(k => k.startsWith(namespace + '_'))
              .map(k => ({
                val: k.replace(namespace + '_', ''),
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
        'DMG Bonus', 'DMG Amp', 'Deepen', 'DMG Taken', 'Reduce RES', 'RES Shred',
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

    // General DSL Input Rules
    return [
      {
        trigger: /\b(?:On|After|Detonate)[a-zA-Z]*\[([^\]]*)$/i,
        options: DSL_SCHEMA.modifiers.map(v => ({ val: v, group: 'Modifiers' })),
        append: ']',
        prefix: ''
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
          const effKeys = new Set<string>();

          Object.keys(DataLoader.mechanicsDB).forEach(k => mechKeys.add(k));
          Object.keys(mechanics).forEach(k => mechKeys.add(k));

          Object.values(DataLoader.mechanicsDB).forEach(m => {
            (m.effects || []).forEach(e => { if (e.name) effKeys.add(e.name); });
          });
          Object.values(mechanics).forEach(m => {
            (m.effects || []).forEach(e => { if (e.name) effKeys.add(e.name); });
          });

          const results: SuggestionItem[] = [];
          mechKeys.forEach(k => {
            if (k.startsWith(namespace + '_')) {
              results.push({
                val: k.replace(namespace + '_', ''),
                group: namespace === 'System' ? 'System Mechanics' : `${namespace} Mechanics`
              });
            }
          });
          effKeys.forEach(k => {
            if (k.startsWith(namespace + '_')) {
              results.push({
                val: k.replace(namespace + '_', ''),
                group: namespace === 'System' ? 'System Effects' : `${namespace} Effects`
              });
            }
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
        const searchStr = match[groupIdx] !== undefined ? match[groupIdx].toLowerCase() : match[0].toLowerCase();
        const optionsList = typeof rule.options === 'function' ? rule.options(match) : rule.options;
        const searchTerms = searchStr.trim().split(/\s+/).filter(Boolean);

        const matches = optionsList.filter(o => {
          const optLower = o.val.toLowerCase();
          if (searchTerms.length === 0) return true;
          return searchTerms.every(term => optLower.includes(term));
        });

        if (matches.length > 0) {
          if (matches.length === 1 && matches[0].val.toLowerCase() === searchStr.trim()) {
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
          matched = true;
          break;
        }
      }
    }

    if (!matched) setIsOpen(false);
  };

  const handleSelect = (entry: { item: SuggestionItem; rule: MatchRule; match: RegExpMatchArray }) => {
    const input = inputRef.current;
    if (!input) return;

    const { item, rule, match } = entry;
    const val = input.value;
    const cursorPos = input.selectionStart || 0;
    const groupIdx = rule.matchGroup || 1;
    const completion = item.val;

    let newVal = '';
    let newCursorPos = 0;

    if (mode === 'eff-stat' || mode === 'eff-target') {
      newVal = completion;
      newCursorPos = completion.length;
    } else {
      const matchLength = match[groupIdx] !== undefined ? match[groupIdx].length : match[0].length;
      const replaceStart = cursorPos - matchLength;

      newVal = val.slice(0, replaceStart) + completion;
      newCursorPos = replaceStart + completion.length;

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
        onBlur={() => setTimeout(() => setIsOpen(false), 200)}
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        placeholder={placeholder}
        {...rest}
      />
      {isOpen && popupHtml.length > 0 && (
        <div ref={popupRef} className="autocomplete-popup" style={{ display: 'block' }}>
          {(() => {
            let globalIdx = 0;
            return popupHtml.map(g => (
              <React.Fragment key={g.group}>
                <div
                  className="autocomplete-group-header"
                  style={{
                    fontSize: '0.75rem',
                    color: '#a0a0a0',
                    padding: '4px 8px',
                    background: '#1a1a1a',
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    borderBottom: '1px solid #333'
                  }}
                >
                  {g.group}
                </div>
                {g.items.map((item, i) => {
                  const currentIdx = globalIdx++;
                  const flatEntry = flatSuggestions[currentIdx];
                  const label = `${flatEntry?.rule.prefix || ''}${item.val}`;
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
        </div>
      )}
    </div>
  );
};