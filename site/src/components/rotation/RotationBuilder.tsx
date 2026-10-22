import React, { useRef, useState, useEffect, useMemo, useDeferredValue } from 'react';
import { useRotationStore } from '../../store/useRotationStore';
import { useRosterStore } from '../../store/useRosterStore';
import { RotationToolbar } from './RotationToolbar';
import { RotationRow, type DraggedMarker } from './RotationRow';
import { CollapsibleSection } from '../common/CollapsibleSection';
import { CommonUtils, getCharacterThemeColor, tip } from '../../utils/Common';
import { DataLoader } from '../../utils/DataLoader';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ExportRotationDialog } from '../common/ExportRotationDialog';
import type { CalcInput } from '../../types/results';
import { toSavedRow } from '../../store/useRotationStore';
import { loopEndIndexOf, loopSplitRowIndices } from '../../logic/rotationRows';
import { useLatestCallback } from '../../hooks/useLatestCallback';
import { subscribeLinkedScroll } from '../../store/useLinkedRowStore';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTimelineViewStore } from '../../store/useTimelineViewStore';
import { SortIcon } from '../common/icons';

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

// Scrollbar minimap: a bar per same-unit run, plus loop and sub-loop markers.
function buildRotationScrollbarSegments(rows: any[], loopStartIndex: number, loopEndIndex: number, splitIndices: number[]): ScrollbarSegment[] {
  const n = rows.length;
  if (n === 0) return [];

  const segments: ScrollbarSegment[] = [];
  // Gap between bars, in percent.
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

  const markerHeight = Math.max(0.5, 100 / n / 3);
  if (loopStartIndex >= 0 && loopStartIndex < n) {
    segments.push({ key: 'loop-start', top: (loopStartIndex / n) * 100, height: markerHeight, isMarker: true });
  }
  if (loopEndIndex >= 0 && loopEndIndex < n) {
    segments.push({ key: 'loop-end', top: Math.max(0, ((loopEndIndex + 1) / n) * 100 - markerHeight), height: markerHeight, isMarker: true });
  }
  splitIndices.forEach(index => {
    segments.push({ key: `loop-split-${index}`, top: (index / n) * 100, height: markerHeight, isMarker: true });
  });

  return segments;
}

// Unmeasured row height.
const ROW_ESTIMATE_PX = 32;
const SCROLL_MARGIN_PX = 8;

// Once per page load, across remounts.
let hasRunLoadRefresh = false;

/** Step 2: rotation table, toolbar and minimap. */
export const RotationBuilder: React.FC<RotationBuilderProps> = ({ isOpen, onToggle }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timeCountdown = useTimelineViewStore(s => s.timeCountdown);
  const toggleTimeCountdown = useTimelineViewStore(s => s.toggleTimeCountdown);

  // Measured scrollbar width, for the minimap.
  const rotationBuilderRef = useRef<HTMLDivElement>(null);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);

  const {
    rows: liveRows,
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
    loopStartIndex: liveLoopStartIndex,
    loopStartIsOverride: liveLoopStartIsOverride,
    loopErrors: liveLoopErrors,
    loopWarnings: liveLoopWarnings,
    setLoopStartOverride,
    resetLoopStart,
    setLoopEndOverride,
    resetLoopEnd,
    setLoopSplit,
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
    isStale
  } = useRotationStore();

  const { team, importTeam } = useRosterStore();

  // Deferred rows so a recalc renders in the background. Handlers use the same copy.
  const table = useDeferredValue(useMemo(
    () => ({ rows: liveRows, loopStartIndex: liveLoopStartIndex, loopStartIsOverride: liveLoopStartIsOverride, loopErrors: liveLoopErrors, loopWarnings: liveLoopWarnings }),
    [liveRows, liveLoopStartIndex, liveLoopStartIsOverride, liveLoopErrors, liveLoopWarnings]
  ));
  const { rows, loopStartIndex, loopStartIsOverride, loopErrors, loopWarnings } = table;

  // Virtualized; rows are measured once shown.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => rotationBuilderRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    getItemKey: i => rows[i].id,
    overscan: 8,
    scrollPaddingStart: SCROLL_MARGIN_PX,
    scrollPaddingEnd: SCROLL_MARGIN_PX
  });
  const windowRows = virtualizer.getVirtualItems();
  const padTop = windowRows[0]?.start ?? 0;
  const padBottom = Math.max(0, virtualizer.getTotalSize() - (windowRows[windowRows.length - 1]?.end ?? 0));

  // Scrolls a Timeline-hovered move's row into view.
  const scrollToRow = useLatestCallback((id: string) => {
    const index = rows.findIndex(r => r.id === id);
    if (index !== -1) virtualizer.scrollToIndex(index, { align: 'auto', behavior: 'smooth' });
  });
  useEffect(() => subscribeLinkedScroll(s => (s.source === 'timeline' && s.scroll ? s.rowIds[0] : undefined), scrollToRow), [scrollToRow]);

  // Backfill damageInstances once per page load, then check Builder staleness.
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
    // Re-measure after the accordion transition.
    const settleTimer = setTimeout(measure, 350);
    return () => {
      ro.disconnect();
      clearTimeout(settleTimer);
    };
  }, [rows.length]);

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

  // Marker drag, separate from row reordering.
  const [draggedMarker, setDraggedMarker] = useState<DraggedMarker | null>(null);

  // Keyboard shortcuts.
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

      // preventDefault only if the action did something.
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

  // Start tags render above their row, end tags below.
  const markerDropTarget = (targetIndex: number, role: 'start' | 'end'): number => {
    const position = dragOverInfo?.position;
    if (role === 'start') return position === 'bottom' ? targetIndex + 1 : targetIndex;
    return position === 'top' ? targetIndex - 1 : targetIndex;
  };

  const handleDragOver = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (!draggedMarker && draggedIndices.includes(targetIndex)) return;

    // Measure the content area, excluding marker bands.
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
      const { role, groupId } = draggedMarker;
      const adjustedTarget = markerDropTarget(targetIndex, role);
      if (rows[adjustedTarget]?.unit) {
        if (groupId) (role === 'start' ? setRepeatBlockStartIndex : setRepeatBlockEndIndex)(groupId, adjustedTarget);
        else (role === 'start' ? setLoopStartOverride : setLoopEndOverride)(adjustedTarget);
      }
      handleMarkerDragEnd();
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

  const handleMarkerDragStart = (e: React.DragEvent, marker: DraggedMarker) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    setDraggedMarker(marker);
  };

  const handleMarkerDragEnd = () => {
    setDraggedMarker(null);
    setDragOverInfo(null);
  };

  // Stable handlers for memoized rows.
  const rowHandlers = {
    onSelectRow: useLatestCallback(handleSelectRow),
    onTriggerClick: useLatestCallback(handleTriggerClick),
    onDragStart: useLatestCallback(handleDragStart),
    onDragOver: useLatestCallback(handleDragOver),
    onDragLeave: useLatestCallback(handleDragLeave),
    onDrop: useLatestCallback(handleDrop),
    onMarkerDragStart: useLatestCallback(handleMarkerDragStart),
    onMarkerDragEnd: useLatestCallback(handleMarkerDragEnd)
  };

  const [exportSource, setExportSource] = useState<CalcInput | null>(null);
  // Stale stats: Calculate may still refresh cached data, so confirm first (allowed for debugging).
  const [confirmStaleExport, setConfirmStaleExport] = useState(false);

  const handleExport = () => {
    if (rows.length === 0) return alert('Rotation is empty.');
    if (isStale && !confirmStaleExport) return setConfirmStaleExport(true);
    setConfirmStaleExport(false);
    setExportSource({
      rotation: rows.map(toSavedRow),
      team,
      settings: { startEnergy, startConcerto, endingRotationEnabled, endRotationStartsEarlier },
      enemy: { ...useRosterStore.getState().enemy }
    });
  };

  // Import awaiting the overwrite-build prompt (same roster only).
  const [pendingImport, setPendingImport] = useState<{ rawData: any; rotData: any[] } | null>(null);

  const applyImport = async (rawData: any, rotData: any[], includeTeam: boolean) => {
    if (rawData.enemy) useRosterStore.getState().setEnemy(rawData.enemy);
    if (includeTeam && rawData.team) {
      await importTeam(rawData.team);
    }
    importRotation(rotData, rawData.settings);
    if (!isOpen) onToggle();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = document.getElementById('rotation-builder');
        container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      });
    });
  };

  // Character + sequence only.
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

  const loopEndIndex = loopEndIndexOf(rows);
  const hasContent = rows.some(r => r.unit);
  const hasEndRotationContent = loopEndIndex !== -1 && !!rows[loopEndIndex + 1]?.unit;
  // Sub-loop tags, numbered when there are several.
  const mainDps = team[0]?.character;
  const splitIndices = useMemo(
    () => loopSplitRowIndices(rows, loopStartIndex, endingRotationEnabled, mainDps),
    [rows, loopStartIndex, endingRotationEnabled, mainDps]
  );
  const loopSplits = useMemo(() => new Map(splitIndices.map((rowIndex, i) => [rowIndex, {
    label: splitIndices.length > 1 ? String(i + 1) : '',
    manual: rows[rowIndex]?.loopSplit === true
  }])), [splitIndices, rows]);
  const scrollbarSegments = useMemo(
    () => buildRotationScrollbarSegments(rows, loopStartIndex, loopEndIndex, splitIndices),
    [rows, loopStartIndex, loopEndIndex, splitIndices]
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
          <button
            className="base-btn"
            onClick={handleExport}
            {...(isStale ? tip('Stats changed: press Calculate before exporting') : {})}
          >
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

      {confirmStaleExport && (
        <ConfirmDialog
          title="Stats changed"
          message="Calculate hasn't run since the stats changed, and it can still refresh cached data. Export anyway (e.g. to debug a calculation error)?"
          confirmLabel="Export Anyway"
          onConfirm={handleExport}
          onCancel={() => setConfirmStaleExport(false)}
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
          <div><span className="rotation-header-time">
            <button
              type="button"
              className="rotation-time-sort"
              onClick={toggleTimeCountdown}
              {...tip(timeCountdown ? 'Counting down from 120s' : 'Counting up from 0s')}
            >
              <SortIcon size={12} descending={timeCountdown} />
            </button>
            Time
          </span></div>
          <div>Timing</div>
          <div>Offset</div>
          <div>DMG</div>
          <div>Fortes</div>
          <div>Concerto</div>
          <div>Energy</div>
          <div>Tune</div>
        </div>

        <div className="rotation-list-wrap">
          {/* Behind the native scrollbar; Chromium ignores track backgrounds. */}
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
            <div style={{ flexShrink: 0, paddingTop: padTop, paddingBottom: padBottom }}>
              {windowRows.map(({ index: i }) => {
                const row = rows[i];
                return (
                  <div key={row.id} data-index={i} ref={virtualizer.measureElement}>
                    <RotationRow
                      index={i}
                      row={row}
                      isSelected={selectedIndices.includes(i)}
                      activeTrigger={activeSubPanel?.rowIndex === i ? activeSubPanel.trigger : null}
                      onSelectRow={rowHandlers.onSelectRow}
                      onTriggerClick={rowHandlers.onTriggerClick}
                      onDragStart={rowHandlers.onDragStart}
                      onDragOver={rowHandlers.onDragOver}
                      onDragLeave={rowHandlers.onDragLeave}
                      onDrop={rowHandlers.onDrop}
                      dragOverPosition={dragOverInfo?.index === i ? dragOverInfo.position : null}
                      isLastRow={i === rows.length - 1}
                      isLoopStart={i === loopStartIndex && hasContent}
                      isLoopStartOverride={loopStartIsOverride && i === loopStartIndex}
                      loopErrors={i === loopStartIndex ? loopErrors : undefined}
                      loopWarnings={i === loopStartIndex ? loopWarnings : undefined}
                      onResetLoopStart={resetLoopStart}
                      isLoopEnd={i === loopEndIndex}
                      onResetLoopEnd={resetLoopEnd}
                      loopSplit={loopSplits.get(i)}
                      onSetLoopSplit={setLoopSplit}
                      isEndRotationStart={i === loopEndIndex + 1 && hasEndRotationContent}
                      endRotationStartsEarlier={endRotationStartsEarlier}
                      onToggleEndRotationStartsEarlier={setEndRotationStartsEarlier}
                      onMarkerDragStart={rowHandlers.onMarkerDragStart}
                      onMarkerDragEnd={rowHandlers.onMarkerDragEnd}
                      onRepeatCountChange={setRepeatCount}
                      onRemoveRepeatBlock={removeRepeatBlock}
                      onRepeatFinalTimingChange={setRepeatFinalTiming}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
    </CollapsibleSection>
  );
};