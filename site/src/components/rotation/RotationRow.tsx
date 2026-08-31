// src/components/rotation/RotationRow.tsx
import React, { useState } from 'react';
import { useRotationStore } from '../../store/useRotationStore';
import { useRosterStore } from '../../store/useRosterStore';
import { DataLoader } from '../../utils/DataLoader';
import { BuilderUtils } from '../../utils/BuilderUtils';
import { ContextManager } from '../../logic/ContextManager';
import { DSLParser } from '../../logic/DSLParser';
import { DialGauge, VerticalGauge, MultiForteGauge } from './Gauge';
import { SubPanel } from './SubPanel';
import { Dropdown } from '../common/Dropdown';
import type { DropdownGroup } from '../common/Dropdown';
import { TooltipManager, getCharacterThemeColor } from '../../utils/Common';
import { toFrames, secondsToFrames, framesToSeconds, formatFramesAsSeconds } from '../../utils/Frames';

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
  onResetLoopStart
}) => {
  const { updateRowField, updateRowFields, addRow, isStale } = useRotationStore();
  const { team } = useRosterStore();
  const [isDraggable, setIsDraggable] = useState(true);
  const [offsetDraft, setOffsetDraft] = useState<string | null>(null);

  const teamUnits = team.map(t => t.character).filter(Boolean);
  const selectedUnit = row.unit || '';

  const dbChar: Record<string, any> = selectedUnit ? DataLoader.characterDB[selectedUnit] || {} : {};
  const themeColor = getCharacterThemeColor(dbChar);

  // Build categorized action groups filtered by DSL trigger rules
  const getActionGroups = (): ActionGroup[] => {
    if (!selectedUnit) return [];
    const ctx = ContextManager.buildContext(row, selectedUnit, team);
    const groupsMap: Record<string, ActionOption[]> = {};
    const skillGroupNames = dbChar.skillGroupNames || {};

    const checkValid = (k: string, m: any) => {
      if (!m || m.isPassive) return false;
      if (row.action === k) return true; // Always retain currently selected action in options
      if (m.triggerRule && m.triggerRule.trim() !== '') {
        if (!m._compiledRule || typeof m._compiledRule.evaluate !== 'function') {
          m._compiledRule = DSLParser.compile(m.triggerRule);
        }
        if (m._compiledRule && typeof m._compiledRule.evaluate === 'function' && ctx) {
          return m._compiledRule.evaluate(ctx, selectedUnit);
        }
      }
      return true;
    };

    // 1. Character Mechanics
    const charKeys = DataLoader.mechanicsIndex[selectedUnit] || [];
    charKeys.forEach(k => {
      const m = DataLoader.mechanicsDB[k];
      if (checkValid(k, m)) {
        const cat = m.category || BuilderUtils.guessCategory(m);
        const groupName = skillGroupNames[cat];
        const groupLabel = groupName ? `${cat}: ${groupName}` : cat;
        if (!groupsMap[groupLabel]) groupsMap[groupLabel] = [];
        groupsMap[groupLabel].push({ id: k, name: m.name || k, priority: m.priority });
      }
    });

    // 2. Equipped Echo Skill from Roster Slot
    const slot = team.find(t => t.character === selectedUnit);
    if (slot?.mainEcho) {
      const echoKeys = DataLoader.mechanicsIndex[slot.mainEcho] || [];
      echoKeys.forEach(k => {
        const m = DataLoader.mechanicsDB[k];
        if (checkValid(k, m)) {
          const groupLabel = 'Echo Skill';
          if (!groupsMap[groupLabel]) groupsMap[groupLabel] = [];
          groupsMap[groupLabel].push({ id: k, name: m.name || k, priority: m.priority });
        }
      });
    }

    // 3. System Mechanics (Dodge, Jump, etc.)
    const sysKeys = DataLoader.mechanicsIndex['System'] || [];
    sysKeys.forEach(k => {
      const m = DataLoader.mechanicsDB[k];
      if (checkValid(k, m)) {
        const groupLabel = 'Uncategorized (System)';
        if (!groupsMap[groupLabel]) groupsMap[groupLabel] = [];
        groupsMap[groupLabel].push({ id: k, name: m.name || k, priority: m.priority });
      }
    });

    // --- SORT OPTIONS WITHIN EACH GROUP BY PRIORITY (Highest First) ---
    Object.keys(groupsMap).forEach(label => {
      groupsMap[label].sort((a, b) => {
        const prioA = typeof a.priority === 'number' ? a.priority : (a.priority ? DSLParser.evaluateMath(String(a.priority), ctx, selectedUnit) : 0);
        const prioB = typeof b.priority === 'number' ? b.priority : (b.priority ? DSLParser.evaluateMath(String(b.priority), ctx, selectedUnit) : 0);
        return prioB - prioA;
      });
    });

    return Object.entries(groupsMap).map(([label, options]) => ({
      label,
      options
    }));
  };

  const actionGroups = getActionGroups();

  const handleUnitChange = async (newUnit: string) => {
    if (newUnit) {
      await DataLoader.loadMechanic('characters', newUnit);
      const slot = team.find(t => t.character === newUnit);
      if (slot?.mainEcho) {
        await DataLoader.loadMechanic('echoes', slot.mainEcho);
      }
    }
    updateRowField(index, 'unit', newUnit);
    updateRowField(index, 'action', '');

    const totalRows = useRotationStore.getState().rows.length;
    if (index === totalRows - 1 && newUnit) {
      addRow('', '', totalRows);
    }
  };

  const handleActionChange = (newAction: string) => {
    updateRowField(index, 'action', newAction);
  };

  const handleTimingChange = (newTiming: string) => {
    updateRowField(index, 'timing', newTiming);
  };

  // Buffered locally instead of committing on every keystroke: a controlled input that
  // reformats to "X.XX" on each change would stomp a lone "-" or trailing "." before the
  // user can finish typing a negative or decimal offset. Commit only on blur/Enter.
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

  const timeStart = row.gameTimeStart !== undefined ? formatFramesAsSeconds(toFrames(row.gameTimeStart)) : '0.00s';
  // row.offset is Frames; convert to seconds once here -- the sign is preserved by scaling, so
  // this same value still drives the offset-pos/offset-neg styling below.
  const offsetVal = framesToSeconds(toFrames(row.offset || 0));
  const offsetStr = `${offsetVal > 0 ? '+' : ''}${offsetVal.toFixed(2)}`;
  const totalDmg = (row.damageInstances || []).reduce((acc: number, d: any) => acc + (d.total || 0), 0);

  const availableTimings: TimingOption[] = row.availableTimings || [
    { val: 'Auto', label: 'Auto', title: 'Quickest valid timing for all hits' },
    { val: 'Full', label: 'Full', title: 'Full Duration' }
  ];

  const hasError = !!row.errorMsg;
  const hasWarning = !!row.warningMsg;

  // Every error/warning analyzeLoop found across the loop's second repetition -- not just the
  // first one -- so the tag's tooltip gives the full picture instead of hiding all but one
  // issue behind repeated hover-fix-hover cycles.
  const loopIssues = [
    ...(loopErrors || []).map(text => ({ text, isError: true })),
    ...(loopWarnings || []).map(text => ({ text, isError: false }))
  ];
  const loopTagMsg = loopIssues.length > 0
    ? `${loopIssues[0].text}${loopIssues.length > 1 ? ` (+${loopIssues.length - 1} more)` : ''}`
    : null;
  const loopTagTooltip = loopIssues.length > 0
    ? loopIssues.map(({ text, isError }) =>
        `<div style="color:${isError ? 'var(--danger-text)' : 'var(--warning)'}">${isError ? '✕' : '⚠'} ${text}</div>`
      ).join('')
    : '<div>Loop begins here — drag to move</div>';

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
      {isLoopStart && (
        <div
          className={`loop-start-tag ${loopIssues.some(i => i.isError) ? 'loop-tag-error' : loopIssues.length > 0 ? 'loop-tag-warning' : ''}`}
          draggable
          onDragStart={onLoopMarkerDragStart}
          onDragEnd={onLoopMarkerDragEnd}
          onMouseEnter={e => TooltipManager.show(e.currentTarget, loopTagTooltip)}
          onMouseLeave={() => TooltipManager.hide()}
        >
          <span className="loop-tag-icon">⟳</span>
          <span className="loop-tag-label">LOOP START</span>
          {loopTagMsg && <span className="loop-tag-msg">{loopTagMsg}</span>}
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
      )}
      <div className="row-grid-layer">
        {/* Index & Checkbox Cell */}
        <div
          className={`index-cell ${hasError ? 'is-error' : hasWarning ? 'is-warning' : ''}`}
          onMouseEnter={e => {
            const msg = row.errorMsg || row.warningMsg;
            if (!msg) return;
            TooltipManager.show(e.currentTarget, `<span class="${hasError ? 'text-red' : 'text-gold'} text-bold">${msg}</span>`);
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
          <div className="base-num-box" style={{ width: '100%', padding: '2px 5px' }}>
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

        {/* Offset Trigger */}
        <div
          className={`sub-panel-trigger ${activeTrigger === 'offset' ? 'is-active' : ''}`}
          onClick={() => { if (row.timing !== 'Simultaneous') onTriggerClick(index, 'offset'); }}
        >
          <div className={`base-num-box ${offsetVal > 0 ? 'offset-pos' : offsetVal < 0 ? 'offset-neg' : ''}`} style={{ width: '100%', padding: '2px 5px' }}>
            <input
              type="text"
              className="num-input text-xs offset-input"
              value={offsetDraft !== null ? offsetDraft : offsetStr}
              readOnly={row.timing !== 'Simultaneous'}
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
          <div className="base-num-box" style={{ width: '100%', padding: '2px 5px' }}>
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

      {/* Error / Warning Strip */}
      {row.errorMsg && (
        <div className="status-msg-strip is-error-strip">{row.errorMsg}</div>
      )}
      {!row.errorMsg && row.warningMsg && (
        <div className="status-msg-strip is-warning-strip">{row.warningMsg}</div>
      )}

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