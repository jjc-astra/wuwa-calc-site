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
import { TooltipManager, getCharacterThemeColor } from '../../utils/Common';

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
  isLastRow
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

  const handleUnitChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newUnit = e.target.value;
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

  const handleActionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateRowField(index, 'action', e.target.value);
  };

  const handleTimingChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateRowField(index, 'timing', e.target.value);
  };

  // Buffered locally instead of committing on every keystroke: a controlled input that
  // reformats to "X.XX" on each change would stomp a lone "-" or trailing "." before the
  // user can finish typing a negative or decimal offset. Commit only on blur/Enter.
  const handleOffsetInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setOffsetDraft(e.target.value);
  };

  const commitOffsetDraft = () => {
    if (offsetDraft === null) return;
    const num = parseFloat(offsetDraft) || 0;
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

  const timeStart = row.gameTimeStart !== undefined ? `${row.gameTimeStart.toFixed(2)}s` : '0.00s';
  const offsetVal = row.offset || 0;
  const offsetStr = `${offsetVal > 0 ? '+' : ''}${offsetVal.toFixed(2)}`;
  const totalDmg = (row.damageInstances || []).reduce((acc: number, d: any) => acc + (d.total || 0), 0);

  const availableTimings: TimingOption[] = row.availableTimings || [
    { val: 'Auto', label: 'Auto', title: 'Quickest valid timing for all hits' },
    { val: 'Full', label: 'Full', title: 'Full Duration' }
  ];

  const hasError = !!row.errorMsg;
  const hasWarning = !!row.warningMsg;

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
        <select
          className={`base-select unit-select text-bold ${selectedUnit ? 'has-value' : ''}`}
          value={selectedUnit}
          onChange={handleUnitChange}
        >
          <option value="" disabled hidden>-</option>
          {teamUnits.map(u => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>

        {/* Categorized Action Select */}
        <select
          className={`base-select move-select ${row.action ? 'has-value' : ''}`}
          value={row.action || ''}
          disabled={!selectedUnit}
          onChange={handleActionChange}
        >
          <option value="" disabled hidden>{selectedUnit ? 'Select Action' : 'Select Unit'}</option>
          {actionGroups.map(group => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </optgroup>
          ))}
        </select>

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
        <select
          className="base-select timing-select text-xs has-value"
          value={row.timing || 'Auto'}
          onChange={handleTimingChange}
        >
          {availableTimings.map((t: TimingOption) => (
            <option key={t.val} value={t.val} title={t.title}>{t.label}</option>
          ))}
        </select>

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