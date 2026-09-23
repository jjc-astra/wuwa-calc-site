import React, { useState } from 'react';
import { useRotationStore } from '../../store/useRotationStore';
import { useRosterStore } from '../../store/useRosterStore';
import { DataLoader } from '../../utils/DataLoader';
import { BuilderUtils } from '../../utils/BuilderUtils';
import { BUILDER_CATEGORIES } from '../../data/db';
import { ContextManager } from '../../logic/ContextManager';
import { getMechanicOwners, getCastableMechanics, OWNER_KIND_ORDER } from '../../logic/MechanicOwners';
import type { MechanicOwner } from '../../logic/MechanicOwners';
import type { TeamSlot } from '../../types';
import { DSLParser } from '../../logic/dsl/dslParser';
import { DialGauge, VerticalGauge, MultiForteGauge } from './Gauge';
import { SubPanel } from './SubPanel';
import { Dropdown } from '../common/Dropdown';
import type { DropdownGroup } from '../common/Dropdown';
import { TooltipManager, getCharacterThemeColor } from '../../utils/Common';
import { teamCharacters } from '../../utils/TeamUtils';
import { toFrames, secondsToFrames, framesToSeconds, formatFramesAsSeconds } from '../../utils/Frames';
import { applyBuilderOverridesFor } from '../../workers/builderOverridePayload';


interface RotationRowProps {
  index: number;
  row: any;
  isSelected: boolean;
  activeTrigger: string | null;
  onSelectRow: (index: number, shiftKey: boolean) => void;
  onTriggerClick: (index: number, trigger: string) => void;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  dragOverPosition: 'top' | 'bottom' | null;
  isLastRow?: boolean;
  isLoopStart?: boolean;
  isLoopStartOverride?: boolean;
  loopErrors?: string[];
  loopWarnings?: string[];
  onLoopMarkerDragStart?: (e: React.DragEvent) => void;
  onLoopMarkerDragEnd?: (e: React.DragEvent) => void;
  onResetLoopStart?: () => void;
  isLoopEnd?: boolean;
  onLoopEndMarkerDragStart?: (e: React.DragEvent) => void;
  onLoopEndMarkerDragEnd?: (e: React.DragEvent) => void;
  onResetLoopEnd?: () => void;
  // Derived by RotationBuilder (loopEndIndex + 1, when that row has content), not a persisted flag.
  isEndRotationStart?: boolean;
  endRotationStartsEarlier?: boolean;
  onToggleEndRotationStartsEarlier?: (val: boolean) => void;
  // A Hold Repeat block's boundary rows -- unlike Loop Start/End, several independent blocks can
  // exist, so each carries its own groupId (row.repeatBlockStart/repeatBlockEnd) rather than a
  // single rotation-wide flag.
  isRepeatStart?: boolean;
  repeatCount?: number;
  onRepeatCountChange?: (n: number) => void;
  onRepeatMarkerDragStart?: (e: React.DragEvent) => void;
  onRepeatMarkerDragEnd?: (e: React.DragEvent) => void;
  onRemoveRepeatBlock?: () => void;
  isRepeatEnd?: boolean;
  onRepeatEndMarkerDragStart?: (e: React.DragEvent) => void;
  // Overrides `timing` on just the block's last repetition (e.g. it needs "Full" instead of
  // "Auto" to not get cut short before what comes right after the block ends).
  repeatFinalTiming?: string;
  onRepeatFinalTimingChange?: (val: string | undefined) => void;
}

interface TimingOption {
  val: string;
  label: string;
  title?: string;
}

interface ActionOption {
  id: string;
  name: string;
  priority?: number | string;
}

interface ActionGroup {
  label: string;
  options: ActionOption[];
}

export const RotationRow: React.FC<RotationRowProps> = ({
  index,
  row,
  isSelected,
  activeTrigger,
  onSelectRow,
  onTriggerClick,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  dragOverPosition,
  isLastRow,
  isLoopStart,
  isLoopStartOverride,
  loopErrors,
  loopWarnings,
  onLoopMarkerDragStart,
  onLoopMarkerDragEnd,
  onResetLoopStart,
  isLoopEnd,
  onLoopEndMarkerDragStart,
  onLoopEndMarkerDragEnd,
  onResetLoopEnd,
  isEndRotationStart,
  endRotationStartsEarlier,
  onToggleEndRotationStartsEarlier,
  isRepeatStart,
  repeatCount,
  onRepeatCountChange,
  onRepeatMarkerDragStart,
  onRepeatMarkerDragEnd,
  onRemoveRepeatBlock,
  isRepeatEnd,
  onRepeatEndMarkerDragStart,
  repeatFinalTiming,
  onRepeatFinalTimingChange
}) => {
  const { updateRowField, updateRowFields, setRowUnit, isStale } = useRotationStore();
  const { team } = useRosterStore();
  const [isDraggable, setIsDraggable] = useState(true);
  const [offsetDraft, setOffsetDraft] = useState<string | null>(null);
  const [repeatCountDraft, setRepeatCountDraft] = useState<string | null>(null);

  const teamUnits = teamCharacters(team);
  const selectedUnit = row.unit || '';

  const dbChar: Record<string, any> = selectedUnit ? DataLoader.characterDB[selectedUnit] || {} : {};
  const themeColor = getCharacterThemeColor(dbChar);

  // Build categorized action groups filtered by DSL trigger rules
  const getActionGroups = (): ActionGroup[] => {
    if (!selectedUnit) return [];
    const ctx = ContextManager.buildContext(row, selectedUnit, team);
    const skillGroupNames = dbChar.skillGroupNames || {};
    const slot = team.find(t => t.character === selectedUnit);
    const activeMode = slot?.mode && slot.mode !== 'None' ? slot.mode : null;

    // A move that sets Hold_Start (the Press half of a hold) vs. a Release carrying holdConfig
    const isHoldStarter = (m: any): boolean =>
      Array.isArray(m.effects) && m.effects.some((e: any) => e?.type === 'tracker' && e.name === 'Hold_Start' && e.action === 'set');
    const isHoldReleaser = (m: any): boolean => m.inputType === 'Release' && !!m.holdConfig;

    // Genuine validity only -- the "keep selected" carve-out is handled separately below,
    // so it can't look like a real contender when picking a group's winner.
    const checkValid = (m: any) => {
      if (!m || m.isPassive) return false;
      if (m.modeScope && m.modeScope !== 'both' && activeMode && m.modeScope !== activeMode) return false;
      if (m.triggerRule && m.triggerRule.trim() !== '') {
        if (!m._compiledRule || typeof m._compiledRule.evaluate !== 'function') {
          m._compiledRule = DSLParser.compile(m.triggerRule);
        }
        if (m._compiledRule && typeof m._compiledRule.evaluate === 'function' && ctx) {
          if (!m._compiledRule.evaluate(ctx, selectedUnit)) return false;
        }
      }
      // A hold's Press and Release sharing the same `input` are one group automatically
      if (ctx) {
        const holdingThisInput = ctx.self.getTracker('Hold_Unit') === selectedUnit && ctx.self.getTracker('Hold_Input') === m.input;
        if (isHoldReleaser(m) && !holdingThisInput) return false;
        if (isHoldStarter(m) && holdingThisInput) return false;
      }
      return true;
    };

    const resolvePriority = (m: any) =>
      typeof m.priority === 'number' ? m.priority : (m.priority ? DSLParser.evaluateMath(String(m.priority), ctx, selectedUnit) : 0);

    interface Candidate { id: string; m: any; groupLabel: string; isValid: boolean }
    const candidates: Candidate[] = [];

    // Every owner the unit draws castable moves from (its own, the equipped echo/weapon/sets,
    // System), sorted so a same-input tie resolves character > echo > System as before.
    const owners = getMechanicOwners([slot ?? ({ character: selectedUnit } as TeamSlot)])
      .sort((a, b) => OWNER_KIND_ORDER.indexOf(a.kind) - OWNER_KIND_ORDER.indexOf(b.kind));
    const groupLabelFor = (owner: MechanicOwner, m: any): string => {
      if (owner.kind === 'system') return 'System';
      if (owner.kind === 'echo') return 'Echo Skill';
      if (owner.kind !== 'character') return owner.name;
      const cat = m.category || BuilderUtils.guessCategory(m);
      const groupName = skillGroupNames[cat];
      return groupName ? `${cat}: ${groupName}` : cat;
    };
    const seenKeys = new Set<string>();
    owners.forEach(owner => {
      getCastableMechanics(owner).forEach(({ key, mech }) => {
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        const isValid = checkValid(mech);
        if (isValid || key === row.action) candidates.push({ id: key, m: mech, groupLabel: groupLabelFor(owner, mech), isValid });
      });
    });

    // --- COLLAPSE CANDIDATES THAT SHARE THE SAME INPUT ---
    // Only one mechanic fires per (input, inputType) -- keep the highest-priority valid one.
    // stanceReq excluded from the key (airborne state is estimated, not tracked): both variants stay selectable.
    // Current selection is never dropped, but the winner is chosen only from valid members.
    const byInputKey = new Map<string, Candidate[]>();
    const finalCandidates: Candidate[] = [];
    candidates.forEach(c => {
      if (!c.m.input) { finalCandidates.push(c); return; }
      const key = `${c.m.input}|${c.m.inputType || 'None'}|${c.m.stanceReq || ''}`;
      if (!byInputKey.has(key)) byInputKey.set(key, []);
      byInputKey.get(key)!.push(c);
    });
    byInputKey.forEach(group => {
      if (group.length === 1) { finalCandidates.push(group[0]); return; }
      const validMembers = group.filter(c => c.isValid);
      const winnerPool = validMembers.length > 0 ? validMembers : group;
      const winner = winnerPool.reduce((best, cur) => (resolvePriority(cur.m) > resolvePriority(best.m) ? cur : best));
      finalCandidates.push(winner);
      const current = group.find(c => c.id === row.action && c.id !== winner.id);
      if (current) finalCandidates.push(current);
    });

    // --- BUILD GROUPS ---
    // An echo isn't its own rotation row, so its moves need the echo's own name in the label
    // (the character row alone doesn't say which echo) -- skip when the author already baked
    // the echo name into `.name` themselves, so it doesn't show up doubled.
    const echoName = slot?.mainEcho;
    const labelFor = (m: any, id: string, groupLabel: string): string => {
      const bare = m.name || id;
      if (groupLabel !== 'Echo Skill' || !echoName) return bare;
      return bare.toLowerCase().startsWith(echoName.toLowerCase()) ? bare : `${echoName} ${bare}`;
    };
    const groupsMap: Record<string, ActionOption[]> = {};
    finalCandidates.forEach(({ id, m, groupLabel }) => {
      if (!groupsMap[groupLabel]) groupsMap[groupLabel] = [];
      groupsMap[groupLabel].push({ id, name: labelFor(m, id, groupLabel), priority: m.priority });
    });

    // --- SORT OPTIONS WITHIN EACH GROUP BY PRIORITY (Highest First) ---
    Object.keys(groupsMap).forEach(label => {
      groupsMap[label].sort((a, b) => {
        const prioA = typeof a.priority === 'number' ? a.priority : (a.priority ? DSLParser.evaluateMath(String(a.priority), ctx, selectedUnit) : 0);
        const prioB = typeof b.priority === 'number' ? b.priority : (b.priority ? DSLParser.evaluateMath(String(b.priority), ctx, selectedUnit) : 0);
        return prioB - prioA;
      });
    });

    // --- ORDER GROUPS TO MATCH THE UNIT PAGE ---
    // groupLabel may be '<category>: <skillGroupName>' -- strip the suffix before matching
    // BUILDER_CATEGORIES. Echo Skill sorts right after the unit's own categories; System sorts last.
    const groupOrder = [...BUILDER_CATEGORIES, 'Echo Skill'];
    const groupRank = (label: string): number => {
      if (label === 'System') return groupOrder.length;
      const category = label.includes(': ') ? label.slice(0, label.indexOf(': ')) : label;
      const idx = groupOrder.indexOf(category);
      return idx === -1 ? groupOrder.length - 1 : idx;
    };

    return Object.entries(groupsMap)
      .map(([label, options]) => ({ label, options }))
      .sort((a, b) => groupRank(a.label) - groupRank(b.label));
  };

  const actionGroups = getActionGroups();

  const handleUnitChange = async (newUnit: string) => {
    if (newUnit) {
      await DataLoader.loadMechanic('characters', newUnit);
      const slot = team.find(t => t.character === newUnit);
      if (slot?.mainEcho) {
        await DataLoader.loadMechanic('echoes', slot.mainEcho);
      }
      applyBuilderOverridesFor(slot?.mainEcho ? [newUnit, slot.mainEcho] : [newUnit]);
    }
    setRowUnit(index, newUnit);
  };

  const handleActionChange = (newAction: string) => {
    updateRowField(index, 'action', newAction);
  };

  const handleTimingChange = (newTiming: string) => {
    updateRowField(index, 'timing', newTiming);
  };

  // Buffered locally so live "X.XX" formatting doesn't stomp a lone "-" or trailing "." mid-typing.
  // Committed on blur/Enter.
  const handleOffsetInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setOffsetDraft(e.target.value);
  };

  const commitOffsetDraft = () => {
    if (offsetDraft === null) return;
    const num = secondsToFrames(parseFloat(offsetDraft) || 0);
    setOffsetDraft(null);
    updateRowFields(index, { offset: num, manualOffset: num });
  };

  const handleOffsetKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setOffsetDraft(null);
      e.currentTarget.blur();
    }
  };

  // Buffers local input and commits on blur to prevent intermediate store dispatches or recalculations while typing.
  const commitRepeatCountDraft = () => {
    if (repeatCountDraft === null) return;
    const draft = repeatCountDraft;
    setRepeatCountDraft(null);
    onRepeatCountChange?.(parseInt(draft, 10) || 1);
  };

  const handleRepeatCountKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setRepeatCountDraft(null);
      e.currentTarget.blur();
    }
  };

  const stepRepeatCount = (delta: number) => {
    setRepeatCountDraft(null);
    onRepeatCountChange?.(Math.max(1, (repeatCount ?? 2) + delta));
  };

  const timeStart = row.gameTimeStart !== undefined ? formatFramesAsSeconds(toFrames(row.gameTimeStart)) : '0.00s';
  // row.offset is Frames; convert to seconds (sign preserved) for the offset-pos/neg styling below.
  const offsetVal = framesToSeconds(toFrames(row.offset || 0));
  const offsetStr = `${offsetVal > 0 ? '+' : ''}${offsetVal.toFixed(2)}`;
  const isOffsetEditable = row.timing === 'Simultaneous' || row.timing === 'Manual';
  const totalDmg = (row.damageInstances || []).reduce((acc: number, d: any) => acc + (d.total || 0), 0);

  const availableTimings: TimingOption[] = row.availableTimings || [
    { val: 'Auto', label: 'Auto', title: 'Quickest valid timing for all hits' },
    { val: 'Full', label: 'Full', title: 'Full Duration' }
  ];

  const rowErrors: string[] = row.errorMsgs || [];
  const rowWarnings: string[] = row.warningMsgs || [];
  const hasError = rowErrors.length > 0;
  const hasWarning = rowWarnings.length > 0;

  // Every error/warning analyzeLoop found in the loop's second rep -- each gets its own panel
  // instead of collapsing into a truncated "(+N more)" label.
  const loopIssues = [
    ...(loopErrors || []).map(text => ({ text, isError: true })),
    ...(loopWarnings || []).map(text => ({ text, isError: false }))
  ];

  let dragClass = '';
  if (dragOverPosition === 'top') dragClass = 'drag-over-top';
  if (dragOverPosition === 'bottom') dragClass = 'drag-over-bottom';

  return (
    <div
      className={`rotation-row ${isSelected ? 'selected' : ''} ${dragClass}`}
      style={{ '--char-theme-raw': themeColor } as React.CSSProperties}
      draggable={!isLastRow && isDraggable}
      onDragStart={e => onDragStart(e, index)}
      onDragOver={e => onDragOver(e, index)}
      onDragLeave={onDragLeave}
      onDrop={e => onDrop(e, index)}
    >
      {isEndRotationStart && (
        <>
          <div
            className="ending-rotation-cut"
          >
            <div className="ending-rotation-cut-track">
              <svg className="ending-rotation-cut-ff" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="1,4 11,12 1,20" />
                <polygon points="12,4 22,12 12,20" />
              </svg>
            </div>
          </div>
          <div
            className="end-rotation-tag"
            onMouseEnter={e => TooltipManager.show(e.currentTarget, '<div>The tail of the 2-Minute window.</div>')}
            onMouseLeave={() => TooltipManager.hide()}
          >
            <span className="loop-tag-icon">⟳</span>
            <span className="loop-tag-label">END ROTATION</span>
            <label
              className="end-rotation-check-wrap"
              onClick={e => e.stopPropagation()}
              onMouseEnter={e => { e.stopPropagation(); TooltipManager.show(e.currentTarget, '<div>Cuts one loop cycle so the Ending Rotation replaces the final loop instead of appending after it.</div>'); }}
              onMouseLeave={() => TooltipManager.hide()}
            >
              <span>Extend Last Loop</span>
              <input
                type="checkbox"
                checked={!!endRotationStartsEarlier}
                onChange={e => onToggleEndRotationStartsEarlier?.(e.target.checked)}
              />
              <span className="check-visual" />
            </label>
          </div>
        </>
      )}

      {isLoopStart && (
        <>
          <div
            className="loop-start-tag"
            draggable
            onDragStart={onLoopMarkerDragStart}
            onDragEnd={onLoopMarkerDragEnd}
            onMouseEnter={e => { if (loopIssues.length === 0) TooltipManager.show(e.currentTarget, '<div>Loop begins here — drag to move</div>'); }}
            onMouseLeave={() => TooltipManager.hide()}
          >
            <span className="loop-tag-icon">⟳</span>
            <span className="loop-tag-label">LOOP START</span>
            {isLoopStartOverride && (
              <button
                className="loop-tag-reset"
                onClick={e => { e.stopPropagation(); onResetLoopStart?.(); }}
                onMouseEnter={e => { e.stopPropagation(); TooltipManager.show(e.currentTarget, '<div>Reset to auto-detected position</div>'); }}
                onMouseLeave={() => TooltipManager.hide()}
              >
                ↺
              </button>
            )}
          </div>
          {loopIssues.map(({ text, isError }, i) => (
            <div key={i} className={`loop-issue-strip ${isError ? 'is-error-strip' : 'is-warning-strip'}`}>
              {isError ? '✕' : '⚠'} {text}
            </div>
          ))}
        </>
      )}

      {isRepeatStart && (
        <div
          className="repeat-start-tag"
          draggable
          onDragStart={onRepeatMarkerDragStart}
          onDragEnd={onRepeatMarkerDragEnd}
          onMouseEnter={e => TooltipManager.show(e.currentTarget, '<div>Repeat block begins here — drag to move</div>')}
          onMouseLeave={() => TooltipManager.hide()}
        >
          <span className="loop-tag-icon">↻</span>
          <span className="loop-tag-label">REPEAT START</span>
          <span
            className="repeat-count-pill"
            draggable={false}
            onMouseDown={e => e.stopPropagation()}
            onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}
          >
            <span className="repeat-count-x">×</span>
            <input
              type="text"
              inputMode="numeric"
              className="repeat-count-input"
              style={{ width: `${String(repeatCountDraft !== null ? repeatCountDraft : (repeatCount ?? 2)).length}ch` }}
              value={repeatCountDraft !== null ? repeatCountDraft : (repeatCount ?? 2)}
              onClick={e => e.stopPropagation()}
              onFocus={() => setRepeatCountDraft(String(repeatCount ?? 2))}
              onChange={e => setRepeatCountDraft(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={commitRepeatCountDraft}
              onKeyDown={handleRepeatCountKeyDown}
            />
            <span className="repeat-count-steppers">
              <button
                type="button"
                className="repeat-count-step"
                tabIndex={-1}
                onClick={e => { e.stopPropagation(); stepRepeatCount(1); }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 15 12 9 18 15" /></svg>
              </button>
              <button
                type="button"
                className="repeat-count-step"
                tabIndex={-1}
                onClick={e => { e.stopPropagation(); stepRepeatCount(-1); }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
            </span>
          </span>
          <button
            className="loop-tag-reset"
            onClick={e => { e.stopPropagation(); onRemoveRepeatBlock?.(); }}
            onMouseEnter={e => { e.stopPropagation(); TooltipManager.show(e.currentTarget, '<div>Remove this repeat block</div>'); }}
            onMouseLeave={() => TooltipManager.hide()}
          >
            ✕
          </button>
        </div>
      )}
      <div className="row-grid-layer">
        {/* Index & Checkbox Cell */}
        <div
          className={`index-cell ${hasError ? 'is-error' : hasWarning ? 'is-warning' : ''}`}
          onMouseEnter={e => {
            if (rowErrors.length === 0 && rowWarnings.length === 0) return;
            const html = [
              ...rowErrors.map(msg => `<div class="text-red text-bold">${msg}</div>`),
              ...rowWarnings.map(msg => `<div class="text-gold text-bold">${msg}</div>`)
            ].join('');
            TooltipManager.show(e.currentTarget, html);
          }}
          onMouseLeave={() => TooltipManager.hide()}
        >
          <span className="row-index">{index + 1}</span>
          <svg className="status-icon icon-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <svg className="status-icon icon-warn" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <label
            className="check-wrap"
            onClick={e => {
              e.preventDefault();
              onSelectRow(index, e.shiftKey);
            }}
          >
            <input type="checkbox" className="row-select-check" checked={isSelected} readOnly />
            <span className="check-visual" />
          </label>
        </div>

        {/* Unit Select */}
        <Dropdown
          className={`base-select unit-select text-bold ${selectedUnit ? 'has-value' : ''}`}
          value={selectedUnit}
          onChange={handleUnitChange}
          placeholder="-"
          options={teamUnits.map(u => ({ value: u, label: u }))}
          accentColor={themeColor}
        />

        {/* Categorized Action Select */}
        <Dropdown
          className={`base-select move-select ${row.action ? 'has-value' : ''}`}
          value={row.action || ''}
          disabled={!selectedUnit}
          onChange={handleActionChange}
          placeholder={selectedUnit ? 'Select Action' : 'Select Unit'}
          options={actionGroups.map((group): DropdownGroup => ({
            label: group.label,
            options: group.options.map(a => ({ value: a.id, label: a.name }))
          }))}
          accentColor={themeColor}
        />

        {/* Time Trigger */}
        <div
          className={`col-time center-content sub-panel-trigger ${activeTrigger === 'time' ? 'is-active' : ''}`}
          onClick={() => onTriggerClick(index, 'time')}
        >
          <div className="base-num-box" style={{ width: '100%', padding: '2px 0.3125rem' }}>
            <input type="text" className="num-input text-xs" value={timeStart} readOnly />
          </div>
        </div>

        {/* Timing Select */}
        <Dropdown
          className="base-select timing-select text-xs has-value"
          value={row.timing || 'Auto'}
          onChange={handleTimingChange}
          options={availableTimings.map((t: TimingOption) => ({ value: t.val, label: t.label, tooltip: t.title }))}
          accentColor={themeColor}
        />

        {/* Offset Trigger -- Disabled for Manual and Simultaneous*/}
        <div
          className={`sub-panel-trigger ${activeTrigger === 'offset' ? 'is-active' : ''}`}
          onClick={() => { if (!isOffsetEditable) onTriggerClick(index, 'offset'); }}
        >
          <div className={`base-num-box ${offsetVal > 0 ? 'offset-pos' : offsetVal < 0 ? 'offset-neg' : ''}`} style={{ width: '100%', padding: '2px 0.3125rem' }}>
            <input
              type="text"
              className="num-input text-xs offset-input"
              value={offsetDraft !== null ? offsetDraft : offsetStr}
              readOnly={!isOffsetEditable}
              onChange={handleOffsetInput}
              onFocus={() => setOffsetDraft(offsetStr)}
              onBlur={commitOffsetDraft}
              onKeyDown={handleOffsetKeyDown}
            />
          </div>
        </div>

        {/* DMG Trigger */}
        <div
          className={`sub-panel-trigger ${activeTrigger === 'dmg' ? 'is-active' : ''}`}
          onClick={() => { if ((row.damageInstances || []).length > 0) onTriggerClick(index, 'dmg'); }}
        >
          <div className="base-num-box" style={{ width: '100%', padding: '2px 0.3125rem' }}>
            <input
              type="text"
              className={`num-input text-xs ${totalDmg === 0 ? 'text-dim' : ''} ${isStale && totalDmg > 0 ? 'dmg-dimmed' : ''}`}
              value={totalDmg ? Math.floor(totalDmg).toLocaleString() : '0'}
              readOnly
            />
          </div>
        </div>

        {/* Forte Gauges */}
        <MultiForteGauge
          unit={selectedUnit}
          stateData={row}
          activeTrigger={activeTrigger}
          onGaugeClick={trigger => onTriggerClick(index, trigger)}
        />

        {/* Concerto Gauge */}
        <div className={`sub-panel-trigger ${activeTrigger === 'concerto' ? 'is-active' : ''}`} onClick={() => onTriggerClick(index, 'concerto')}>
          <DialGauge name="Concerto" value={row.concerto?.[selectedUnit] || 0} max={100} />
        </div>

        {/* Energy Gauge */}
        <div className={`sub-panel-trigger ${activeTrigger === 'energy' ? 'is-active' : ''}`} onClick={() => onTriggerClick(index, 'energy')}>
          <VerticalGauge name="Energy" value={row.energy?.[selectedUnit] || 0} max={DataLoader.characterDB[selectedUnit]?.maxEnergy || 100} />
        </div>

        {/* Tune Gauge */}
        <div className={`sub-panel-trigger ${activeTrigger === 'tune' ? 'is-active' : ''}`} onClick={() => onTriggerClick(index, 'tune')}>
          <DialGauge name="Tune" value={row.enemyTune || 0} max={row.enemyMaxTune || 40} />
        </div>
      </div>

      {isLoopEnd && (
        <div
          className="loop-end-tag"
          draggable
          onDragStart={onLoopEndMarkerDragStart}
          onDragEnd={onLoopEndMarkerDragEnd}
          onMouseEnter={e => TooltipManager.show(e.currentTarget, '<div>Loop ends here — drag to move</div>')}
          onMouseLeave={() => TooltipManager.hide()}
        >
          <span className="loop-tag-icon">⟳</span>
          <span className="loop-tag-label">LOOP END</span>
          <button
            className="loop-tag-reset"
            onClick={e => { e.stopPropagation(); onResetLoopEnd?.(); }}
            onMouseEnter={e => { e.stopPropagation(); TooltipManager.show(e.currentTarget, '<div>Remove the Ending Rotation split</div>'); }}
            onMouseLeave={() => TooltipManager.hide()}
          >
            ↺
          </button>
        </div>
      )}

      {isRepeatEnd && (
        <div
          className="repeat-end-tag"
          draggable
          onDragStart={onRepeatEndMarkerDragStart}
          onDragEnd={onRepeatMarkerDragEnd}
          onMouseEnter={e => TooltipManager.show(e.currentTarget, '<div>Repeat block ends here — drag to move</div>')}
          onMouseLeave={() => TooltipManager.hide()}
        >
          <span className="loop-tag-icon">↻</span>
          <span className="loop-tag-label">REPEAT END</span>
          <span
            className="repeat-final-timing-pill"
            draggable={false}
            onMouseDown={e => e.stopPropagation()}
            onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}
            onMouseEnter={e => { e.stopPropagation(); }}
            onMouseLeave={() => TooltipManager.hide()}
          >
            <span className="repeat-final-timing-label">Final rep timing</span>
            <Dropdown
              className="base-select text-xs has-value"
              value={repeatFinalTiming || ''}
              onChange={(v: string) => onRepeatFinalTimingChange?.(v === '' ? undefined : v)}
              options={[{ value: '', label: 'Same' }, ...availableTimings.map((t: TimingOption) => ({ value: t.val, label: t.label, tooltip: t.title }))]}
            />
          </span>
        </div>
      )}

      {/* Error / Warning Strips -- one panel per message, not just the first */}
      {rowErrors.map((msg, i) => (
        <div key={`err-${i}`} className="status-msg-strip is-error-strip">{msg}</div>
      ))}
      {rowWarnings.map((msg, i) => (
        <div key={`warn-${i}`} className="status-msg-strip is-warning-strip">{msg}</div>
      ))}

      {/* Sub Panel Container */}
      {activeTrigger && (
        <div
          onMouseDown={() => setIsDraggable(false)}
          onMouseUp={() => setIsDraggable(true)}
          onMouseLeave={() => setIsDraggable(true)}
        >
          <SubPanel trigger={activeTrigger} row={row} />
        </div>
      )}
    </div>
  );
};