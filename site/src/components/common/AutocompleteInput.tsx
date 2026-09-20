import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { SHEET_STAT_TOOLTIPS } from '../../data/db';
import { MOD_LABEL_TOOLTIPS } from '../../logic/combat/combatRegistry';
import {
  resolveEventTooltip, resolveModifierTooltip, resolvePointerTooltip, resolveFunctionTooltip,
  resolvePropertyTooltip, resolveSystemMethodTooltip,
  makePointerRootRule, makePropertyRule, makeMethodChainRule, makeMathRule,
  makeEventModifierBracketRule, makeEventListRule, makeNamespaceRefRule,
  makeEffectNameRules, makeCooldownNameRule, makeStatRule, makeTargetRule, makeAppliesDuringRule
} from '../../logic/dsl/dslResolver';
import { useBuilderStore } from '../../store/useBuilderStore';
import { tokenizeDSL } from '../../utils/DSLHighlight';
import { forteAliases } from '../../utils/ForteNames';
import { TooltipManager } from '../../utils/Common';
import type { SuggestionItem, MatchRule } from '../../logic/dsl/dslTypes';

interface AutocompleteInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mode?: 'general' | 'eff-name' | 'eff-cd-name' | 'eff-stat' | 'eff-target' | 'eff-applies-during' | 'dsl-value';
  value: string;
  onValueChange: (val: string) => void;
  statOptions?: string[];
  dmgOptions?: string[];
}

// Resolves an autocomplete item to its tooltip description, if one is configured for its group.
function resolveTooltip(item: SuggestionItem, group: string): string | undefined {
  const key = item.tooltipKey ?? item.val;
  switch (group) {
    case 'Events': return resolveEventTooltip(key);
    case 'Modifiers': return resolveModifierTooltip(key);
    case 'Pointers':
    case 'Targets':
      return resolvePointerTooltip(key);
    case 'Functions':
      return resolveFunctionTooltip(key);
    case 'Array Methods':
    case 'String Methods':
    case 'Math Functions':
      return resolveSystemMethodTooltip(key);
    case 'Properties':
      return item.pointer ? resolvePropertyTooltip(item.pointer, key) : undefined;
    case 'Sheet Stats':
      return SHEET_STAT_TOOLTIPS[key];
    case 'Combat Modifiers':
    case 'Specific Modifiers':
      return (MOD_LABEL_TOOLTIPS as Record<string, string>)[key];
    case 'Continue':
      // Comma-separated entries are an AND filter (EventManager.ts's requiredModifiers check).
      return key === ',' ? 'Combines with AND — the action must match every listed modifier, not just one.' : undefined;
    default:
      return undefined;
  }
}

// Splits a commaList's captured content on ',': the segment being typed (search/replace)
// vs already-committed segments (excluded from suggestions).
function getCommaSegmentInfo(fullCaptured: string): { currentTerm: string; replaceLength: number; chosenTerms: string[] } {
  const segments = fullCaptured.split(',');
  const rawLast = segments[segments.length - 1];
  const currentTerm = rawLast.trim();
  const leadingWhitespaceLen = rawLast.length - rawLast.replace(/^\s+/, '').length;
  const replaceLength = rawLast.length - leadingWhitespaceLen;
  const chosenTerms = segments.slice(0, -1).map(s => s.trim()).filter(Boolean);
  return { currentTerm, replaceLength, chosenTerms };
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

  // Portaled to <body> (like Dropdown.tsx) to escape clipping, positioned via the real input's rect.
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

  // Can't cheaply track every scrollable ancestor -- close instead of drifting off-anchor (same as Dropdown.tsx).
  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = (e: Event) => {
      if (popupRef.current && e.target instanceof Node && popupRef.current.contains(e.target)) return;
      // Input's own text-scroll fires 'scroll' too (syncScroll's job) -- ignore it or popup closes while typing.
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

  const tokens = useMemo(() => tokenizeDSL(value, forteAliases(baseStats)), [value, baseStats]);
  const syncScroll = () => {
    if (inputRef.current) setScrollLeft(inputRef.current.scrollLeft);
  };
  useEffect(() => {
    syncScroll();
  }, [value]);

  // Closing (select/blur/Escape) can unmount a hovered item without mouseleave firing, leaving a stuck tooltip.
  useEffect(() => {
    if (!isOpen) TooltipManager.hide();
  }, [isOpen]);

  // Auto-scroll popup container to keep the active keyboard selection in view
  useEffect(() => {
    if (!isOpen || !popupRef.current) return;
    const activeItem = popupRef.current.querySelector('.autocomplete-item.is-active');
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, isOpen]);

  const getRules = (): MatchRule[] => {
    if (mode === 'eff-name') return makeEffectNameRules(activeChar, mechanics);
    if (mode === 'eff-cd-name') return [makeCooldownNameRule(activeChar, mechanics)];
    if (mode === 'eff-stat') return [makeStatRule(statOptions, dmgOptions)];
    if (mode === 'eff-target') return [makeTargetRule()];
    if (mode === 'eff-applies-during') return [makeAppliesDuringRule(activeChar, mechanics)];

    if (mode === 'dsl-value') {
      // Math-only fields (Priority, Combo/Freeze/Swap Time): pointer+property completion, no events/brackets.
      return [
        makePointerRootRule(),
        makePropertyRule(baseStats),
        makeMethodChainRule(),
        makeMathRule()
      ];
    }

    // General DSL Input Rules
    return [
      makeEventModifierBracketRule(activeChar, mechanics),
      makePointerRootRule(),
      makeNamespaceRefRule(mechanics),
      makeEventListRule(/\b((?:On|After|Det|AL)[a-zA-Z]*)$/i),
      makePropertyRule(baseStats),
      makeMethodChainRule(),
      makeMathRule(),
      makeEventListRule(/^()$/)
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

  // After one comma-list entry, offer add-another or close-bracket rather than guessing.
  // closeChar is omitted for a bracket-less field (e.g. Applies During).
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

    let newVal: string;
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

      // rule.prefix (e.g. '@') is in `val` only if the regex matched it outside the capture group; else insert it here.
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
            <span
              key={i}
              style={t.invalid
                ? { color: t.color, textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' }
                : { color: t.color }}
            >
              {t.text}
            </span>
          ))}
        </div>
      </div>
      <input
        ref={inputRef}
        type="text"
        spellCheck={false}
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