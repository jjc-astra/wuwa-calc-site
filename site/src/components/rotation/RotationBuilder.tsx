import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useRotationStore } from '../../store/useRotationStore';
import { useRosterStore } from '../../store/useRosterStore';
import { RotationToolbar } from './RotationToolbar';
import { RotationRow } from './RotationRow';
import { CollapsibleSection } from '../common/CollapsibleSection';
import { CommonUtils, getCharacterThemeColor } from '../../utils/Common';
import { DataLoader } from '../../utils/DataLoader';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ExportRotationDialog } from '../common/ExportRotationDialog';
import type { ExportSource } from '../../utils/rotationExport';
import { findBlocks } from '../../logic/RepeatBlocks';
import { toSavedRow } from '../../store/useRotationStore';

interface RotationBuilderProps {
  isOpen: boolean;
  onToggle: () => void;
}

interface ScrollbarSegment {
  key: string;
  top: number;
  height: number;
  isMarker: boolean;
  color?: string;
}

// VS Code "overview ruler" style minimap for .rotation-scrollbar-map, behind the real scrollbar.
// One dimmed bar per contiguous same-unit run, plus a tick mark for each loop start/end.
function buildRotationScrollbarSegments(rows: any[], loopStartIndex: number, loopEndIndex: number): ScrollbarSegment[] {
  const n = rows.length;
  if (n === 0) return [];

  const segments: ScrollbarSegment[] = [];
  // Percent-domain gap between two different-unit bars, capped so it can't swallow a short run.
  const gap = Math.min(0.4, 100 / n / 4);
  let i = 0;
  while (i < n) {
    const unit = rows[i].unit;
    let j = i;
    while (j < n && rows[j].unit === unit) j++;
    if (unit) {
      const top = (i / n) * 100 + gap;
      const bottom = (j / n) * 100 - gap;
      if (bottom > top) {
        const dimmed = `color-mix(in srgb, ${getCharacterThemeColor(DataLoader.characterDB[unit])} 30%, #202022)`;
        segments.push({ key: `unit-${i}`, top, height: bottom - top, isMarker: false, color: dimmed });
      }
    }
    i = j;
  }

  // Floored so a marker stays visibly a mark (not a hairline) even on a very long rotation.
  const markerHeight = Math.max(0.5, 100 / n / 3);
  if (loopStartIndex >= 0 && loopStartIndex < n) {
    segments.push({ key: 'loop-start', top: (loopStartIndex / n) * 100, height: markerHeight, isMarker: true });
  }
  if (loopEndIndex >= 0 && loopEndIndex < n) {
    segments.push({ key: 'loop-end', top: Math.max(0, ((loopEndIndex + 1) / n) * 100 - markerHeight), height: markerHeight, isMarker: true });
  }

  return segments;
}

// Module-level, not component state -- this component remounts on every navigation to this
// route, but the backfill below should only run once per page load.
let hasRunLoadRefresh = false;

/** Step 2: the rotation table, its toolbar and minimap. */
export const RotationBuilder: React.FC<RotationBuilderProps> = ({ isOpen, onToggle }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Actual scrollbar width (offsetWidth - clientWidth) so the minimap matches it exactly.
  // Re-measured on resize and row-count change.
  const rotationBuilderRef = useRef<HTMLDivElement>(null);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);

  const {
    rows,
    startEnergy,
    startConcerto,
    selectedIndices,
    setSelectedIndices,
    clipboard,
    deleteRows,
    moveRows,
    pasteRows,
    copySelectedRows,
    insertRowAboveSelection,
    insertRowBelowSelection,
    undo,
    redo,
    importRotation,
    loopStartIndex,
    loopStartIsOverride,
    loopErrors,
    loopWarnings,
    setLoopStartOverride,
    resetLoopStart,
    setLoopEndOverride,
    resetLoopEnd,
    removeRepeatBlock,
    setRepeatCount,
    setRepeatFinalTiming,
    setRepeatBlockStartIndex,
    setRepeatBlockEndIndex,
    endingRotationEnabled,
    endRotationStartsEarlier,
    setEndRotationStartsEarlier,
    recalculate,
    checkBuilderStaleness,
    results,
    isStale
  } = useRotationStore();

  const { team, importTeam } = useRosterStore();

  // Backfills damageInstances (not persisted) once per page load, without flagging isStale.
  // checkBuilderStaleness then dims the results if a Builder edit since the last Calculate
  // press makes them stale.
  useEffect(() => {
    if (!hasRunLoadRefresh) {
      hasRunLoadRefresh = true;
      recalculate(false, true);
    }
    checkBuilderStaleness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = rotationBuilderRef.current;
    if (!el) return;
    const measure = () => setScrollbarWidth(el.offsetWidth - el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Re-measures after the accordion transition settles -- mid-transition reads can be off.
    const settleTimer = setTimeout(measure, 350);
    return () => {
      ro.disconnect();
      clearTimeout(settleTimer);
    };
  }, [rows.length]);

  // Sticky-to-bottom
  const isNearBottomRef = useRef(true);
  const prevRowCountRef = useRef(rows.length);
  useEffect(() => {
    const el = rotationBuilderRef.current;
    if (!el) return;
    const updateNearBottom = () => {
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    };
    updateNearBottom();
    el.addEventListener('scroll', updateNearBottom);
    return () => el.removeEventListener('scroll', updateNearBottom);
  }, []);
  useEffect(() => {
    const el = rotationBuilderRef.current;
    if (el && rows.length > prevRowCountRef.current && isNearBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
    prevRowCountRef.current = rows.length;
  }, [rows.length]);

  const [activeSubPanel, setActiveSubPanel] = useState<{ rowIndex: number; trigger: string } | null>(null);

  const [draggedIndices, setDraggedIndices] = useState<number[]>([]);
  const [dragOverInfo, setDragOverInfo] = useState<{ index: number; position: 'top' | 'bottom' } | null>(null);

  // Loop marker drag: separate gesture from row reordering -- relocates the loop start/end
  // flag, not rows. Reuses dragOverInfo for the placement indicator.
  const [draggedMarker, setDraggedMarker] = useState<'start' | 'end' | null>(null);

  // Same idea for a Hold Repeat block's own start/end markers -- unlike the loop markers there
  // can be several independent blocks, so the dragged one is identified by groupId+role.
  const [draggedRepeatMarker, setDraggedRepeatMarker] = useState<{ groupId: string; role: 'start' | 'end' } | null>(null);

  // Global keyboard shortcuts (Delete, Undo/Redo, Copy/Paste, Insert Above/Below).
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

      // Copy/Insert Above/Insert Below return whether they did anything; preventDefault only then.
      if (!isEditingInput) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          const deletable = selectedIndices.filter(i => i !== lastIndex);
          if (deletable.length > 0) {
            e.preventDefault();
            deleteRows(deletable);
          }
        } else if (isCtrlOrCmd && key === 'c') {
          if (copySelectedRows()) e.preventDefault();
        } else if (isCtrlOrCmd && key === 'v') {
          if (clipboard.length > 0) {
            e.preventDefault();
            pasteRows();
          }
        } else if (isCtrlOrCmd && e.key === 'ArrowUp') {
          if (insertRowAboveSelection()) e.preventDefault();
        } else if (isCtrlOrCmd && e.key === 'ArrowDown') {
          if (insertRowBelowSelection()) e.preventDefault();
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
  }, [selectedIndices, rows, clipboard, deleteRows, pasteRows, copySelectedRows, insertRowAboveSelection, insertRowBelowSelection, undo, redo]);

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

  // A start-tag renders above its row, an end-tag below (RotationRow.tsx), so the same boundary
  // line maps to opposite rows depending on role.
  const markerDropTarget = (targetIndex: number, role: 'start' | 'end'): number => {
    const position = dragOverInfo?.position;
    if (role === 'start') return position === 'bottom' ? targetIndex + 1 : targetIndex;
    return position === 'top' ? targetIndex - 1 : targetIndex;
  };

  const handleDragOver = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (!draggedMarker && !draggedRepeatMarker && draggedIndices.includes(targetIndex)) return;

    // Measures the row's own content area, not the full wrapper -- a row already carrying a
    // loop/repeat marker band (or loop issue strips) renders extra height above its content, which
    // would otherwise drag the midpoint down and register "bottom" well before the visual halfway
    // point of the row people actually see.
    const target = e.currentTarget as HTMLElement;
    const content = target.querySelector('.row-grid-layer') as HTMLElement | null;
    const rect = (content ?? target).getBoundingClientRect();
    const isBelow = e.clientY > rect.top + rect.height / 2;
    setDragOverInfo({ index: targetIndex, position: isBelow ? 'bottom' : 'top' });
  };

  const handleDragLeave = () => {
    setDragOverInfo(null);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();

    if (draggedMarker) {
      const adjustedTarget = markerDropTarget(targetIndex, draggedMarker);
      if (rows[adjustedTarget]?.unit) {
        if (draggedMarker === 'start') setLoopStartOverride(adjustedTarget);
        else setLoopEndOverride(adjustedTarget);
      }
      setDraggedMarker(null);
      setDragOverInfo(null);
      return;
    }

    if (draggedRepeatMarker) {
      const adjustedTarget = markerDropTarget(targetIndex, draggedRepeatMarker.role);
      if (rows[adjustedTarget]?.unit) {
        if (draggedRepeatMarker.role === 'start') setRepeatBlockStartIndex(draggedRepeatMarker.groupId, adjustedTarget);
        else setRepeatBlockEndIndex(draggedRepeatMarker.groupId, adjustedTarget);
      }
      setDraggedRepeatMarker(null);
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
    setDraggedMarker('start');
  };

  const handleLoopEndMarkerDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    setDraggedMarker('end');
  };

  const handleLoopMarkerDragEnd = () => {
    setDraggedMarker(null);
    setDragOverInfo(null);
  };

  const handleRepeatMarkerDragStart = (groupId: string, role: 'start' | 'end') => (e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    setDraggedRepeatMarker({ groupId, role });
  };

  const handleRepeatMarkerDragEnd = () => {
    setDraggedRepeatMarker(null);
    setDragOverInfo(null);
  };

  // Snapshot handed to the export dialog, which names, calculates and downloads the files.
  const [exportSource, setExportSource] = useState<ExportSource | null>(null);

  const handleExport = () => {
    if (rows.length === 0) return alert('Rotation is empty.');
    setExportSource({
      rotation: rows.map(toSavedRow),
      team,
      settings: { startEnergy, startConcerto, endingRotationEnabled, endRotationStartsEarlier },
      enemy: { ...useRosterStore.getState().enemy },
      // Current results skip a recalculation for a Custom-build export.
      customResults: results && !isStale ? results : undefined
    });
  };

  // Set only when the imported team matches Step 1's roster (same characters+sequences) --
  // holds the parsed file while asking whether to overwrite the build. Other imports apply immediately.
  const [pendingImport, setPendingImport] = useState<{ rawData: any; rotData: any[] } | null>(null);

  const applyImport = async (rawData: any, rotData: any[], includeTeam: boolean) => {
    if (rawData.enemy) useRosterStore.getState().setEnemy(rawData.enemy);
    if (includeTeam && rawData.team) {
      await importTeam(rawData.team);
    }
    importRotation(rotData, rawData.settings);
    // Open the rotation section first (may be collapsed) so imported rows are visible, then scroll to the end.
    if (!isOpen) onToggle();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = document.getElementById('rotation-builder');
        container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      });
    });
  };

  // Signature by character+sequence only -- ignores weapon/echoes/stats, which the prompt
  // lets the user keep instead of losing to the imported file.
  const teamSignature = (t: any[]): string => (t || []).map(s => `${s?.character || ''}|${s?.sequence || 0}`).join(',');

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    try {
      const rawData = JSON.parse(await CommonUtils.readTextFile(file));
      const rotData = Array.isArray(rawData) ? rawData : rawData.rotation;
      if (!rotData) return;

      const sameRoster = rawData.team && teamSignature(rawData.team) === teamSignature(team);
      if (sameRoster) {
        setPendingImport({ rawData, rotData });
      } else {
        await applyImport(rawData, rotData, true);
      }
    } catch (err) {
      console.error('[RotationBuilder] Error loading rotation:', err);
      alert('Error loading rotation.');
    }
  };

  // Hold Repeat blocks, unlike Loop Start/End, are never singletons -- several can coexist, each
  // identified by its own groupId shared between its repeatBlockStart/repeatBlockEnd rows.
  const repeatBlocksByGroup = useMemo(() => findBlocks(rows), [rows]);

  // No auto-detection for loop end (unlike loop start) -- always an explicit tag, or absent.
  const loopEndIndex = rows.findIndex(r => r.loopEndOverride === true);
  // Derived from loopEndIndex rather than its own flag, to avoid drifting out of sync with it.
  const hasEndRotationContent = loopEndIndex !== -1 && !!rows[loopEndIndex + 1]?.unit;
  const scrollbarSegments = useMemo(
    () => buildRotationScrollbarSegments(rows, loopStartIndex, loopEndIndex),
    [rows, loopStartIndex, loopEndIndex]
  );

  return (
    <CollapsibleSection
      isOpen={isOpen}
      onToggle={onToggle}
      title="Step 2: Build Rotation"
      ids={{ wrapper: 'step2-wrapper', header: 'rotation-header', content: 'rotation-content' }}
      headerRight={
        <>
          <input type="file" ref={fileInputRef} accept=".json" style={{ display: 'none' }} onChange={handleImport} />
          <button className="base-btn" onClick={() => fileInputRef.current?.click()}>
            Import Rotation
          </button>
          <button className="base-btn" onClick={handleExport}>
            Export Rotation
          </button>
        </>
      }
      overlays={
        <>
      {pendingImport && (
        <ConfirmDialog
          title="Same team already in Step 1"
          message="This rotation's team has the same characters and sequences already loaded. Replace the current build (weapon/echoes/stats) with the one from this file, or keep the current build and just import the rotation?"
          confirmLabel="Replace Team"
          cancelLabel="Keep Existing"
          onConfirm={async () => {
            await applyImport(pendingImport.rawData, pendingImport.rotData, true);
            setPendingImport(null);
          }}
          onCancel={async () => {
            await applyImport(pendingImport.rawData, pendingImport.rotData, false);
            setPendingImport(null);
          }}
        />
      )}

      {exportSource && <ExportRotationDialog source={exportSource} onClose={() => setExportSource(null)} />}
        </>
      }
    >
        <RotationToolbar />

        <div className="rotation-header-row caps-label">
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

        <div className="rotation-list-wrap">
          {/* Sibling layer behind the native scrollbar -- Chromium ignores backgrounds set on
              the scrollbar track directly. Inset top/bottom clears Windows' arrow buttons. */}
          {scrollbarWidth > 0 && (
            <div className="rotation-scrollbar-map" style={{ width: scrollbarWidth, top: scrollbarWidth, bottom: scrollbarWidth }}>
              {scrollbarSegments.map(seg => (
                <div
                  key={seg.key}
                  className={seg.isMarker ? 'rotation-scrollbar-segment-marker' : 'rotation-scrollbar-segment-unit'}
                  style={{ top: `${seg.top}%`, height: `${seg.height}%`, ...(seg.color ? { background: seg.color } : {}) }}
                />
              ))}
            </div>
          )}
          <div id="rotation-builder" ref={rotationBuilderRef} className="flex-col gap-sm" style={{ padding: 0 }}>
            {rows.map((row, i) => (
              <RotationRow
                key={row.id}
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
                isLoopEnd={i === loopEndIndex}
                onLoopEndMarkerDragStart={handleLoopEndMarkerDragStart}
                onLoopEndMarkerDragEnd={handleLoopMarkerDragEnd}
                onResetLoopEnd={resetLoopEnd}
                isEndRotationStart={i === loopEndIndex + 1 && hasEndRotationContent}
                endRotationStartsEarlier={endRotationStartsEarlier}
                onToggleEndRotationStartsEarlier={setEndRotationStartsEarlier}
                isRepeatStart={!!row.repeatBlockStart}
                repeatCount={row.repeatBlockStart ? repeatBlocksByGroup.get(row.repeatBlockStart)?.count : undefined}
                onRepeatCountChange={row.repeatBlockStart ? (n: number) => setRepeatCount(row.repeatBlockStart!, n) : undefined}
                onRepeatMarkerDragStart={row.repeatBlockStart ? handleRepeatMarkerDragStart(row.repeatBlockStart, 'start') : undefined}
                onRepeatMarkerDragEnd={handleRepeatMarkerDragEnd}
                onRemoveRepeatBlock={row.repeatBlockStart ? () => removeRepeatBlock(row.repeatBlockStart!) : undefined}
                isRepeatEnd={!!row.repeatBlockEnd}
                onRepeatEndMarkerDragStart={row.repeatBlockEnd ? handleRepeatMarkerDragStart(row.repeatBlockEnd, 'end') : undefined}
                repeatFinalTiming={row.repeatFinalTiming}
                onRepeatFinalTimingChange={row.repeatBlockEnd ? (v: string | undefined) => setRepeatFinalTiming(row.repeatBlockEnd!, v) : undefined}
              />
            ))}
          </div>
        </div>
    </CollapsibleSection>
  );
};