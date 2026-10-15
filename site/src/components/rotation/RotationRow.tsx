import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRotationStore } from '../../store/useRotationStore';
import { useRosterStore } from '../../store/useRosterStore';
import { DataLoader } from '../../utils/DataLoader';
import { BuilderUtils } from '../../utils/BuilderUtils';
import { BUILDER_CATEGORIES, ENEMY_DEFAULTS } from '../../data/db';
import { resourceCap } from '../../logic/resources';
import { DEFAULT_REPEAT_COUNT } from '../../logic/rotationRows';
import { SYSTEM_NAMESPACE } from '../../utils/MechanicKey';
import { FastForwardIcon } from '../common/icons';
import { ContextManager } from '../../logic/ContextManager';
import { getMechanicOwners, getCastableMechanics, OWNER_KIND_ORDER } from '../../logic/MechanicOwners';
import type { MechanicOwner } from '../../logic/MechanicOwners';
import type { TeamSlot } from '../../types';
import { DSLParser } from '../../logic/dsl/dslParser';
import { DialGauge, VerticalGauge, MultiForteGauge } from './Gauge';
import { SubPanel } from './SubPanel';
import { Dropdown } from '../common/Dropdown';
import type { DropdownGroup } from '../common/Dropdown';
import { TooltipManager, getCharacterThemeColor, tip } from '../../utils/Common';
import { teamCharacters } from '../../utils/TeamUtils';
import { toFrames, secondsToFrames, framesToSeconds, formatFramesAsClock } from '../../utils/Frames';
import { applyBuilderOverridesFor } from '../../workers/builderOverridePayload';
import { useLinkedRowStore } from '../../store/useLinkedRowStore';
import { useTimelineViewStore } from '../../store/useTimelineViewStore';
import { TWO_MIN } from '../../logic/rotationRows';

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
  onResetLoopStart?: () => void;
  isLoopEnd?: boolean;
  onResetLoopEnd?: () => void;
  // Sub-loop start; `manual` if set by the row's loopSplit.
  loopSplit?: { label: string; manual: boolean };
  onSetLoopSplit?: (index: number, value: boolean | undefined) => void;
  isEndRotationStart?: boolean;
  endRotationStartsEarlier?: boolean;
  onToggleEndRotationStartsEarlier?: (val: boolean) => void;
  onMarkerDragStart?: (e: React.DragEvent, marker: DraggedMarker) => void;
  onMarkerDragEnd?: () => void;
  // Repeat block handlers take the block's groupId.
  onRepeatCountChange?: (groupId: string, n: number) => void;
  onRemoveRepeatBlock?: (groupId: string) => void;
  onRepeatFinalTimingChange?: (groupId: string, val: string | undefined) => void;
}

/** A dragged loop or Hold Repeat marker. */
export interface DraggedMarker {
  role: 'start' | 'end';
  groupId?: string;
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

type LinkedState = ReturnType<typeof useLinkedRowStore.getState>;
const isLinkedIn = (s: LinkedState, rowId?: string) => s.source === 'timeline' && !!rowId && s.rowIds.includes(rowId);

/** One rotation row and its open sub-panel. Memoized; handlers must be stable. */
export const RotationRow = React.memo<RotationRowProps>(({
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
  onResetLoopStart,
  isLoopEnd,
  onResetLoopEnd,
  loopSplit,
  onSetLoopSplit,
  isEndRotationStart,
  endRotationStartsEarlier,
  onToggleEndRotationStartsEarlier,
  onMarkerDragStart,
  onMarkerDragEnd,
  onRepeatCountChange,
  onRemoveRepeatBlock,
  onRepeatFinalTimingChange
}) => {
  const updateRowField = useRotationStore(s => s.updateRowField);
  const updateRowFields = useRotationStore(s => s.updateRowFields);
  const setRowUnit = useRotationStore(s => s.setRowUnit);
  const isStale = useRotationStore(s => s.isStale);
  const team = useRosterStore(s => s.team);
  const rowRef = useRef<HTMLDivElement>(null);
  const hoverLinked = useLinkedRowStore(s => s.hover);
  const [isDraggable, setIsDraggable] = useState(true);
  const [offsetDraft, setOffsetDraft] = useState<string | null>(null);
  const [repeatCountDraft, setRepeatCountDraft] = useState<string | null>(null);

  // Timeline-hover highlight, toggled on the DOM for speed. Re-applied every render.
  useLayoutEffect(() => {
    rowRef.current?.classList.toggle('is-linked', isLinkedIn(useLinkedRowStore.getState(), row.id));
  });
  useEffect(() => useLinkedRowStore.subscribe(s => {
    rowRef.current?.classList.toggle('is-linked', isLinkedIn(s, row.id));
  }), [row.id]);

  const teamUnits = teamCharacters(team);
  const selectedUnit = row.unit || '';
  const repeatCount: number = row.repeatCount || DEFAULT_REPEAT_COUNT;

  const dbChar: Record<string, any> = selectedUnit ? DataLoader.characterDB[selectedUnit] || {} : {};
  const themeColor = getCharacterThemeColor(dbChar);

  // Action groups filtered by trigger rules.
  const getActionGroups = (): ActionGroup[] => {
    if (!selectedUnit) return [];
    // Rules read the pre-cast state.
    const ctx = ContextManager.buildContext(row.dropdownState ?? row, selectedUnit, team);
    const skillGroupNames = dbChar.skillGroupNames || {};
    const slot = team.find(t => t.character === selectedUnit);
    const activeMode = slot?.mode && slot.mode !== 'None' ? slot.mode : null;

    const isHoldStarter = (m: any): boolean =>
      Array.isArray(m.effects) && m.effects.some((e: any) => e?.type === 'tracker' && e.name === 'Hold_Start' && e.action === 'set');
    const isHoldReleaser = (m: any): boolean => m.inputType === 'Release' && !!m.holdConfig;

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
      if (ctx) {
        const holdingThisInput = ctx.self.getTracker('Hold_Unit') === selectedUnit && ctx.self.getTracker('Hold_Input') === m.input;
        if (isHoldReleaser(m) && !holdingThisInput) return false;
        if (isHoldStarter(m) && holdingThisInput) return false;
      }
      return true;
    };

    const resolvePriority = (priority: number | string | undefined): number =>
      typeof priority === 'number' ? priority : (priority ? DSLParser.evaluateMath(String(priority), ctx, selectedUnit) : 0);

    interface Candidate { id: string; m: any; groupLabel: string; isValid: boolean }
    const candidates: Candidate[] = [];

    // Move owners; ties resolve character > echo > System.
    const owners = getMechanicOwners([slot ?? ({ character: selectedUnit } as TeamSlot)])
      .sort((a, b) => OWNER_KIND_ORDER.indexOf(a.kind) - OWNER_KIND_ORDER.indexOf(b.kind));
    const groupLabelFor = (owner: MechanicOwner, m: any): string => {
      if (owner.kind === 'system') return SYSTEM_NAMESPACE;
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

    // One move per (input, inputType): the highest-priority valid one, plus the current selection.
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
      const winner = winnerPool.reduce((best, cur) => (resolvePriority(cur.m.priority) > resolvePriority(best.m.priority) ? cur : best));
      finalCandidates.push(winner);
      const current = group.find(c => c.id === row.action && c.id !== winner.id);
      if (current) finalCandidates.push(current);
    });

    // Prefix echo moves with the echo name unless already present.
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

    // Highest priority first.
    Object.values(groupsMap).forEach(options => options.sort((a, b) => resolvePriority(b.priority) - resolvePriority(a.priority)));

    // Builder category order, then Echo Skill, then System.
    const groupOrder = [...BUILDER_CATEGORIES, 'Echo Skill'];
    const groupRank = (label: string): number => {
      if (label === SYSTEM_NAMESPACE) return groupOrder.length;
      const category = label.includes(': ') ? label.slice(0, label.indexOf(': ')) : label;
      const idx = groupOrder.indexOf(category);
      return idx === -1 ? groupOrder.length - 1 : idx;
    };

    return Object.entries(groupsMap)
      .map(([label, options]) => ({ label, options }))
      .sort((a, b) => groupRank(a.label) - groupRank(b.label));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const actionGroups = useMemo(getActionGroups, [row, team]);

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

  // Local draft; committed on blur/Enter.
  const handleOffsetInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setOffsetDraft(e.target.value);
  };

  const commitOffsetDraft = () => {
    if (offsetDraft === null) return;
    const num = secondsToFrames(parseFloat(offsetDraft) || 0);
    setOffsetDraft(null);
    updateRowFields(index, { offset: num, manualOffset: num });
  };

  // Enter commits; Escape discards.
  const draftKeyDown = (dropDraft: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') dropDraft();
    if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
  };

  const commitRepeatCountDraft = () => {
    if (repeatCountDraft === null) return;
    const draft = repeatCountDraft;
    setRepeatCountDraft(null);
    if (row.repeatBlockStart) onRepeatCountChange?.(row.repeatBlockStart, parseInt(draft, 10) || 1);
  };

  const stepRepeatCount = (delta: number) => {
    setRepeatCountDraft(null);
    if (row.repeatBlockStart) onRepeatCountChange?.(row.repeatBlockStart, Math.max(1, repeatCount + delta));
  };

  const timeCountdown = useTimelineViewStore(s => s.timeCountdown);
  const gameTime = toFrames(row.gameTimeStart ?? 0);
  const timeStart = formatFramesAsClock(timeCountdown ? toFrames(TWO_MIN - gameTime) : gameTime);
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

  // One panel per loop issue.
  const loopIssues = [
    ...(loopErrors || []).map(text => ({ text, isError: true })),
    ...(loopWarnings || []).map(text => ({ text, isError: false }))
  ];

  let dragClass = '';
  if (dragOverPosition === 'top') dragClass = 'drag-over-top';
  if (dragOverPosition === 'bottom') dragClass = 'drag-over-bottom';

  return (
    <div
      ref={rowRef}
      className={`rotation-row ${isSelected ? 'selected' : ''} ${dragClass}`}
      style={{ '--char-theme-raw': themeColor } as React.CSSProperties}
      onMouseEnter={() => { if (row.unit && row.id) hoverLinked([row.id], 'table'); }}
      onMouseLeave={() => hoverLinked([], 'table')}
      draggable={!isLastRow && isDraggable}
      onDragStart={e => onDragStart(e, index)}
      onDragOver={e => onDragOver(e, index)}
      onDragLeave={onDragLeave}
      onDrop={e => onDrop(e, index)}
    >
      {isEndRotationStart && (
        <>
          <div className="ending-rotation-cut">
            <div className="ending-rotation-cut-track">
              <FastForwardIcon className="ending-rotation-cut-ff" />
            </div>
          </div>
          <div className="end-rotation-tag" {...tip('The tail of the 2-Minute window.')}>
            <span className="loop-tag-icon">⟳</span>
            <span className="loop-tag-label">END ROTATION</span>
            <label
              className="end-rotation-check-wrap"
              onClick={e => e.stopPropagation()}
              {...tip('Cuts one loop cycle so the Ending Rotation replaces the final loop instead of appending after it.')}
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
            onDragStart={e => onMarkerDragStart?.(e, { role: 'start' })}
            onDragEnd={onMarkerDragEnd}
            {...(loopIssues.length === 0 ? tip('Loop begins here — drag to move') : {})}
          >
            <span className="loop-tag-icon">⟳</span>
            <span className="loop-tag-label">LOOP START</span>
            {isLoopStartOverride && (
              <button
                className="loop-tag-reset"
                onClick={e => { e.stopPropagation(); onResetLoopStart?.(); }}
                {...tip('Reset to auto-detected position')}
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

      {loopSplit && (
        <div
          className="loop-split-tag"
          {...tip(loopSplit.manual
            ? 'Sub-loop starts here (set by Split Loop). Ending Rotation can start after any sub-loop.'
            : 'Sub-loop starts here, after the main DPS Outro. Ending Rotation can start after any sub-loop.')}
        >
          <span className="loop-tag-icon">⟳</span>
          <span className="loop-tag-label">SUB-LOOP{loopSplit.label && ` ${loopSplit.label}`}</span>
          {!loopSplit.manual && <span className="loop-split-auto">AUTO</span>}
          <button
            className="loop-tag-reset"
            onClick={e => { e.stopPropagation(); onSetLoopSplit?.(index, loopSplit.manual ? undefined : false); }}
            {...tip(loopSplit.manual ? 'Reset to auto-detection' : 'Remove this split')}
          >
            {loopSplit.manual ? '↺' : '✕'}
          </button>
        </div>
      )}

      {row.repeatBlockStart && (
        <div
          className="repeat-start-tag"
          draggable
          onDragStart={e => onMarkerDragStart?.(e, { role: 'start', groupId: row.repeatBlockStart })}
          onDragEnd={onMarkerDragEnd}
          {...tip('Repeat block begins here — drag to move')}
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
              style={{ width: `${String(repeatCountDraft ?? repeatCount).length}ch` }}
              value={repeatCountDraft ?? repeatCount}
              onClick={e => e.stopPropagation()}
              onFocus={() => setRepeatCountDraft(String(repeatCount))}
              onChange={e => setRepeatCountDraft(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={commitRepeatCountDraft}
              onKeyDown={draftKeyDown(() => setRepeatCountDraft(null))}
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
            onClick={e => { e.stopPropagation(); onRemoveRepeatBlock?.(row.repeatBlockStart); }}
            {...tip('Remove this repeat block')}
          >
            ✕
          </button>
        </div>
      )}
      <div className="row-grid-layer">
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

        <Dropdown
          className={`base-select unit-select text-bold ${selectedUnit ? 'has-value' : ''}`}
          value={selectedUnit}
          onChange={handleUnitChange}
          placeholder="-"
          options={teamUnits.map(u => ({ value: u, label: u }))}
          accentColor={themeColor}
        />

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

        <div
          className={`col-time center-content sub-panel-trigger ${activeTrigger === 'time' ? 'is-active' : ''}`}
          onClick={() => onTriggerClick(index, 'time')}
        >
          <div className="base-num-box">
            <input type="text" className="num-input text-xs" value={timeStart} readOnly />
          </div>
        </div>

        <Dropdown
          className="base-select timing-select text-xs has-value"
          value={row.timing || 'Auto'}
          onChange={handleTimingChange}
          options={availableTimings.map((t: TimingOption) => ({ value: t.val, label: t.label, tooltip: t.title }))}
          accentColor={themeColor}
        />

        <div
          className={`sub-panel-trigger ${activeTrigger === 'offset' ? 'is-active' : ''}`}
          onClick={() => { if (!isOffsetEditable) onTriggerClick(index, 'offset'); }}
        >
          <div className={`base-num-box ${offsetVal > 0 ? 'offset-pos' : offsetVal < 0 ? 'offset-neg' : ''}`}>
            <input
              type="text"
              className="num-input text-xs offset-input"
              value={offsetDraft !== null ? offsetDraft : offsetStr}
              readOnly={!isOffsetEditable}
              onChange={handleOffsetInput}
              onFocus={() => setOffsetDraft(offsetStr)}
              onBlur={commitOffsetDraft}
              onKeyDown={draftKeyDown(() => setOffsetDraft(null))}
            />
          </div>
        </div>

        <div
          className={`sub-panel-trigger ${activeTrigger === 'dmg' ? 'is-active' : ''}`}
          onClick={() => { if ((row.damageInstances || []).length > 0) onTriggerClick(index, 'dmg'); }}
        >
          <div className="base-num-box">
            <input
              type="text"
              className={`num-input text-xs ${totalDmg === 0 ? 'text-dim' : ''} ${isStale && totalDmg > 0 ? 'dmg-dimmed' : ''}`}
              value={totalDmg ? Math.floor(totalDmg).toLocaleString() : '0'}
              readOnly
            />
          </div>
        </div>

        <MultiForteGauge
          unit={selectedUnit}
          stateData={row}
          activeTrigger={activeTrigger}
          onGaugeClick={trigger => onTriggerClick(index, trigger)}
        />

        <div className={`sub-panel-trigger ${activeTrigger === 'concerto' ? 'is-active' : ''}`} onClick={() => onTriggerClick(index, 'concerto')}>
          <DialGauge name="Concerto" value={row.concerto?.[selectedUnit] || 0} max={resourceCap(selectedUnit, 'concerto')} />
        </div>

        <div className={`sub-panel-trigger ${activeTrigger === 'energy' ? 'is-active' : ''}`} onClick={() => onTriggerClick(index, 'energy')}>
          <VerticalGauge name="Energy" value={row.energy?.[selectedUnit] || 0} max={resourceCap(selectedUnit, 'energy')} />
        </div>

        <div className={`sub-panel-trigger ${activeTrigger === 'tune' ? 'is-active' : ''}`} onClick={() => onTriggerClick(index, 'tune')}>
          <DialGauge name="Tune" value={row.enemyTune || 0} max={row.enemyMaxTune || ENEMY_DEFAULTS.maxTune} />
        </div>
      </div>

      {isLoopEnd && (
        <div
          className="loop-end-tag"
          draggable
          onDragStart={e => onMarkerDragStart?.(e, { role: 'end' })}
          onDragEnd={onMarkerDragEnd}
          {...tip('Loop ends here — drag to move')}
        >
          <span className="loop-tag-icon">⟳</span>
          <span className="loop-tag-label">LOOP END</span>
          <button
            className="loop-tag-reset"
            onClick={e => { e.stopPropagation(); onResetLoopEnd?.(); }}
            {...tip('Remove the Ending Rotation split')}
          >
            ↺
          </button>
        </div>
      )}

      {row.repeatBlockEnd && (
        <div
          className="repeat-end-tag"
          draggable
          onDragStart={e => onMarkerDragStart?.(e, { role: 'end', groupId: row.repeatBlockEnd })}
          onDragEnd={onMarkerDragEnd}
          {...tip('Repeat block ends here — drag to move')}
        >
          <span className="loop-tag-icon">↻</span>
          <span className="loop-tag-label">REPEAT END</span>
          <span
            className="repeat-final-timing-pill"
            draggable={false}
            onMouseDown={e => e.stopPropagation()}
            onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}
            onMouseLeave={() => TooltipManager.hide()}
          >
            <span className="repeat-final-timing-label">Final rep timing</span>
            <Dropdown
              className="base-select text-xs has-value"
              value={row.repeatFinalTiming || ''}
              onChange={(v: string) => onRepeatFinalTimingChange?.(row.repeatBlockEnd, v === '' ? undefined : v)}
              options={[{ value: '', label: 'Same' }, ...availableTimings.map((t: TimingOption) => ({ value: t.val, label: t.label, tooltip: t.title }))]}
            />
          </span>
        </div>
      )}

      {rowErrors.map((msg, i) => (
        <div key={`err-${i}`} className="status-msg-strip is-error-strip">{msg}</div>
      ))}
      {rowWarnings.map((msg, i) => (
        <div key={`warn-${i}`} className="status-msg-strip is-warning-strip">{msg}</div>
      ))}

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
});
