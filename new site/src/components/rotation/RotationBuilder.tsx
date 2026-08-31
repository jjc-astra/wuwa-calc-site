// src/components/rotation/RotationBuilder.tsx
import React, { useRef, useState, useEffect } from 'react';
import { useRotationStore } from '../../store/useRotationStore';
import { useRosterStore } from '../../store/useRosterStore';
import { RotationToolbar } from './RotationToolbar';
import { RotationRow } from './RotationRow';
import { useAccordionAnimDone } from '../../hooks/useAccordionAnimDone';
import { useCollapseMaxHeight } from '../../hooks/useCollapseMaxHeight';

interface RotationBuilderProps {
  isOpen: boolean;
  onToggle: () => void;
}

export const RotationBuilder: React.FC<RotationBuilderProps> = ({ isOpen, onToggle }) => {
  const isCollapsed = !isOpen;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const animDone = useAccordionAnimDone(isOpen, wrapperRef);
  const contentRef = useRef<HTMLDivElement>(null);
  const maxHeight = useCollapseMaxHeight(isOpen, contentRef);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    rows,
    startEnergy,
    startConcerto,
    selectedIndices,
    setSelectedIndices,
    clipboard,
    setClipboard,
    addRow,
    deleteRows,
    moveRows,
    pasteRows,
    undo,
    redo,
    importRotation,
    loopStartIndex,
    loopStartIsOverride,
    loopErrors,
    loopWarnings,
    setLoopStartOverride,
    resetLoopStart,
    recalculate,
    results,
    isStale
  } = useRotationStore();

  const { team, importTeam } = useRosterStore();

  // Refreshes gauges/timings once when the calculator page is actually opened, in case a
  // rotation was rehydrated from a previous session but never recalculated since. This is the
  // only place recalculate() runs on load -- it used to run app-wide (even on the landing page)
  // from the store's persist rehydration hook, since the store module loads regardless of route.
  useEffect(() => {
    recalculate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Active Sub-Panel state: { rowIndex: number, trigger: string }
  const [activeSubPanel, setActiveSubPanel] = useState<{ rowIndex: number; trigger: string } | null>(null);

  // Drag and Drop state
  const [draggedIndices, setDraggedIndices] = useState<number[]>([]);
  const [dragOverInfo, setDragOverInfo] = useState<{ index: number; position: 'top' | 'bottom' } | null>(null);

  // Loop-start tag drag state -- a separate gesture from row reordering above: dragging the
  // tag relocates which row is flagged as the loop start, it never reorders rows. It shares
  // dragOverInfo with row reordering so the top/bottom placement indicator looks and behaves
  // identically for both.
  const [draggedLoopMarker, setDraggedLoopMarker] = useState(false);

  // Global Keyboard Shortcuts (Delete, Undo/Redo, Copy/Paste, Insert Above/Below).
  // Mirrors the equivalent buttons/logic in RotationToolbar -- same duplication pattern
  // already used there for Delete, since each component owns its own store subscription.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const inputType = active && active.tagName === 'INPUT' ? (active as HTMLInputElement).type : '';
      const isEditingInput =
        active &&
        (active.tagName === 'SELECT' || active.tagName === 'TEXTAREA' ||
          (active.tagName === 'INPUT' && inputType !== 'checkbox' && inputType !== 'radio' && inputType !== 'button'));

      const lastIndex = rows.length - 1;
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (!isEditingInput) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          const deletable = selectedIndices.filter(i => i !== lastIndex);
          if (deletable.length > 0) {
            e.preventDefault();
            deleteRows(deletable);
          }
        } else if (isCtrlOrCmd && key === 'c') {
          const validIndices = selectedIndices.filter(i => i !== lastIndex);
          const selectedRows = rows.filter((_, i) => validIndices.includes(i));
          if (selectedRows.length > 0) {
            e.preventDefault();
            setClipboard(selectedRows.map(({ unit, action, timing }) => ({ unit, action, timing })));
            setSelectedIndices([]);
          }
        } else if (isCtrlOrCmd && key === 'v') {
          if (clipboard.length > 0) {
            e.preventDefault();
            pasteRows();
          }
        } else if (isCtrlOrCmd && e.key === 'ArrowUp') {
          if (selectedIndices.length > 0) {
            e.preventDefault();
            addRow('', '', selectedIndices[0]);
            // The new blank row pushes the selected block down by one; follow it rather
            // than leaving the selection pinned to the row index (now the new blank row).
            setSelectedIndices(selectedIndices.map(i => i + 1));
          }
        } else if (isCtrlOrCmd && e.key === 'ArrowDown') {
          if (selectedIndices.length > 0) {
            e.preventDefault();
            addRow('', '', selectedIndices[selectedIndices.length - 1] + 1);
          }
        }
      }

      if (isCtrlOrCmd && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (isCtrlOrCmd && key === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndices, rows, clipboard, deleteRows, setClipboard, setSelectedIndices, pasteRows, addRow, undo, redo]);

  const handleSelectRow = (index: number, shiftKey: boolean) => {
    if (shiftKey && selectedIndices.length > 0) {
      const last = selectedIndices[selectedIndices.length - 1];
      const start = Math.min(last, index);
      const end = Math.max(last, index);
      const range = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      setSelectedIndices(range);
    } else {
      if (selectedIndices.includes(index) && selectedIndices.length === 1) {
        setSelectedIndices([]);
      } else {
        setSelectedIndices([index]);
      }
    }
  };

  const handleTriggerClick = (rowIndex: number, trigger: string) => {
    if (activeSubPanel?.rowIndex === rowIndex && activeSubPanel?.trigger === trigger) {
      setActiveSubPanel(null);
    } else {
      setActiveSubPanel({ rowIndex, trigger });
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (index === rows.length - 1) {
      e.preventDefault();
      return;
    }
    const toDrag = (selectedIndices.includes(index) ? selectedIndices : [index]).filter(i => i !== rows.length - 1);
    setDraggedIndices(toDrag);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (!draggedLoopMarker && draggedIndices.includes(targetIndex)) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isBelow = e.clientY > rect.top + rect.height / 2;
    setDragOverInfo({ index: targetIndex, position: isBelow ? 'bottom' : 'top' });
  };

  const handleDragLeave = () => {
    setDragOverInfo(null);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();

    if (draggedLoopMarker) {
      let adjustedTarget = targetIndex;
      if (dragOverInfo?.position === 'bottom') adjustedTarget++;
      if (rows[adjustedTarget]?.unit) setLoopStartOverride(adjustedTarget);
      setDraggedLoopMarker(false);
      setDragOverInfo(null);
      return;
    }

    if (draggedIndices.length === 0 || draggedIndices.includes(targetIndex)) {
      setDragOverInfo(null);
      setDraggedIndices([]);
      return;
    }

    let adjustedTarget = targetIndex;
    if (dragOverInfo?.position === 'bottom') adjustedTarget++;

    moveRows(draggedIndices, adjustedTarget);
    setDragOverInfo(null);
    setDraggedIndices([]);
  };

  const handleLoopMarkerDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    setDraggedLoopMarker(true);
  };

  const handleLoopMarkerDragEnd = () => {
    setDraggedLoopMarker(false);
    setDragOverInfo(null);
  };

  const handleExport = () => {
    if (rows.length === 0) return alert('Rotation is empty.');

    // A rotation/team/settings-only export and History's "Save Results" export were
    // needlessly separate files for what's usually the same data -- if the current results
    // still match what's on screen (calculated, not stale from an edit since), fold them in
    // here too instead of making a Rankings-ready file only reachable via History. Left out
    // when stale, since bundling results next to a rotation they no longer match would be
    // actively misleading; dmgOverTimeSeries is left out either way (nothing reads it from a
    // saved file, and it's cheap to regenerate via a real recalculate).
    const includeResults = !!results && !isStale;
    const exportObject: Record<string, unknown> = {
      rotation: rows.map(({ unit, action, timing, loopStartOverride }) => ({
        unit,
        action,
        timing,
        ...(loopStartOverride === true && { loopStartOverride: true })
      })),
      team: team.map(slot => {
        const { domRef, ...cleanData } = slot;
        return cleanData;
      }),
      settings: { startEnergy, startConcerto }
    };
    if (includeResults) {
      const { dmgOverTimeSeries, ...resultsWithoutDmgOverTime } = results!;
      exportObject.results = resultsWithoutDmgOverTime;
    }

    const names = team
      .filter(s => s.character)
      .map(s => {
        let id = s.character.replace(/\s+/g, '');
        if (s.weapon) {
          const initials = s.weapon.match(/\b\w/g) || [];
          id += `-${initials.join('').toUpperCase()}`;
        }
        return id;
      });

    const suffix = includeResults ? '_Results' : '';
    const filename = names.length > 0 ? `Rotation_${names.join('_')}${suffix}.json` : `Rotation_Config${suffix}.json`;
    const blob = new Blob([JSON.stringify(exportObject, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const rawData = JSON.parse(ev.target?.result as string);
        const rotData = Array.isArray(rawData) ? rawData : rawData.rotation;

        if (rawData.team) {
          await importTeam(rawData.team);
        }

        if (rotData) {
          importRotation(rotData, rawData.settings);
          // The rotation section may still be collapsed (e.g. import triggered while the
          // Team step is open) -- open it first so the newly-imported rows, including the
          // trailing placeholder row, are actually visible, then scroll to reveal the end.
          if (!isOpen) onToggle();
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const container = document.getElementById('rotation-builder');
              container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
            });
          });
        }
      } catch (err) {
        console.error('[RotationBuilder] Error loading rotation:', err);
        alert('Error loading rotation.');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div ref={wrapperRef} className={`section-wrapper ${isCollapsed ? 'is-collapsed' : ''} ${animDone ? 'anim-done' : ''}`} id="step2-wrapper">
      <div
        className="section-header"
        id="rotation-header"
        onClick={e => {
          const target = e.target as HTMLElement;
          if (target.classList.contains('toggle-icon')) {
            onToggle();
            return;
          }
          if (target.tagName !== 'BUTTON' && target.tagName !== 'INPUT') {
            onToggle();
          }
        }}
      >
        <div className="header-left">
          <button className={`toggle-icon ${isCollapsed ? 'collapsed' : ''}`}>▼</button>
          <h2 className="section-title">Step 2: Build Rotation</h2>
        </div>
        <div className="header-right">
          <input type="file" ref={fileInputRef} accept=".json" style={{ display: 'none' }} onChange={handleImport} />
          <button className="base-btn" onClick={() => fileInputRef.current?.click()}>
            Import Rotation
          </button>
          <button className="base-btn" onClick={handleExport}>
            Export Rotation
          </button>
        </div>
      </div>

      <div
        id="rotation-content"
        ref={contentRef}
        className="collapsible-content"
        style={{ maxHeight }}
        aria-hidden={isCollapsed}
      >
        <RotationToolbar />

        <div className="rotation-header-row">
          <div></div>
          <div>Unit</div>
          <div>Action</div>
          <div>Time</div>
          <div>Timing</div>
          <div>Offset</div>
          <div>DMG</div>
          <div>Fortes</div>
          <div>Concerto</div>
          <div>Energy</div>
          <div>Tune</div>
        </div>

        <div id="rotation-builder" className="flex-col gap-sm" style={{ padding: 0 }}>
          {rows.map((row, i) => (
            <RotationRow
              key={i}
              index={i}
              row={row}
              isSelected={selectedIndices.includes(i)}
              activeTrigger={activeSubPanel?.rowIndex === i ? activeSubPanel.trigger : null}
              onSelectRow={handleSelectRow}
              onTriggerClick={handleTriggerClick}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              dragOverPosition={dragOverInfo?.index === i ? dragOverInfo.position : null}
              isLastRow={i === rows.length - 1}
              isLoopStart={i === loopStartIndex && rows.some(r => r.unit)}
              isLoopStartOverride={loopStartIsOverride && i === loopStartIndex}
              loopErrors={i === loopStartIndex ? loopErrors : undefined}
              loopWarnings={i === loopStartIndex ? loopWarnings : undefined}
              onLoopMarkerDragStart={handleLoopMarkerDragStart}
              onLoopMarkerDragEnd={handleLoopMarkerDragEnd}
              onResetLoopStart={resetLoopStart}
            />
          ))}
        </div>
      </div>
    </div>
  );
};