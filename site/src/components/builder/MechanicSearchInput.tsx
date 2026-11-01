import React, { useMemo, useRef, useState } from 'react';
import { computePopupPosition } from '../../utils/popupPosition';
import { usePopupDismiss } from '../../hooks/usePopupDismiss';
import { AutocompletePopup } from '../common/AutocompletePopup';
import { CloseIcon } from '../common/icons';
import { SEARCH_GROUPS, termMatches, type SearchTerm } from './mechanicSearch';

const MAX_SUGGESTIONS = 50;

interface MechanicSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Every term of the open entity's nodes. */
  terms: SearchTerm[];
}

/** The open entity's node filter, suggesting the terms its nodes are found by. */
export const MechanicSearchInput: React.FC<MechanicSearchInputProps> = ({ value, onChange, terms }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [popupPos, setPopupPos] = useState<React.CSSProperties>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  usePopupDismiss(isOpen, () => setIsOpen(false), { popupRef, ignoreScrollFrom: [inputRef] });

  // Matching labels, unique per group, in group order.
  const suggestions = useMemo(() => {
    if (!value.trim()) return [];
    const labelsByGroup = new Map<string, Set<string>>();
    terms.forEach(t => {
      if (!termMatches(t.label, value)) return;
      if (!labelsByGroup.has(t.group)) labelsByGroup.set(t.group, new Set());
      labelsByGroup.get(t.group)!.add(t.label);
    });
    return SEARCH_GROUPS.flatMap(group => [...(labelsByGroup.get(group) ?? [])].sort().map(label => ({ group, label })))
      .slice(0, MAX_SUGGESTIONS);
  }, [terms, value]);
  // Nothing to complete once the value is exactly the only suggestion.
  const exact = suggestions.length > 0 && suggestions.every(s => s.label.toLowerCase() === value.trim().toLowerCase());
  const showPopup = isOpen && suggestions.length > 0 && !exact;

  const groups = SEARCH_GROUPS.map(group => ({ group, items: suggestions.filter(s => s.group === group) }))
    .filter(g => g.items.length > 0);
  // Popup order, for keyboard and click indexes.
  const ordered = groups.flatMap(g => g.items);

  const open = () => {
    setIsOpen(true);
    setActiveIndex(0);
    if (inputRef.current) setPopupPos(computePopupPosition(inputRef.current.getBoundingClientRect(), { maxHeight: 320, gap: 2 }));
  };
  const select = (index: number) => {
    const picked = ordered[index];
    if (picked) onChange(picked.label);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (showPopup) setIsOpen(false);
      else onChange('');
      return;
    }
    if (!showPopup) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % ordered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (i - 1 + ordered.length) % ordered.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      select(activeIndex);
    }
  };

  return (
    <div className="mechanic-search">
      <input
        ref={inputRef}
        type="text"
        spellCheck={false}
        className="form-input mechanic-search-input"
        placeholder="Search mechanics, effects, tags, inputs, flags, resources..."
        value={value}
        onChange={e => {
          onChange(e.target.value);
          open();
        }}
        onFocus={open}
        onBlur={() => setTimeout(() => setIsOpen(false), 200)}
        onKeyDown={handleKeyDown}
      />
      {value && (
        <button type="button" className="base-btn icon-btn icon-btn-sm mechanic-search-clear" aria-label="Clear search" onClick={() => onChange('')}>
          <CloseIcon size={12} />
        </button>
      )}
      {showPopup && (
        <AutocompletePopup groups={groups} activeIndex={activeIndex} onActiveChange={setActiveIndex} onSelect={select} popupRef={popupRef} style={popupPos} />
      )}
    </div>
  );
};
