import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useRotationStore } from '../../store/useRotationStore';
import { useRosterStore } from '../../store/useRosterStore';
import { RotationToolbar } from './RotationToolbar';
import { RotationRow } from './RotationRow';
import { useAccordionAnimDone } from '../../hooks/useAccordionAnimDone';
import { useCollapseMaxHeight } from '../../hooks/useCollapseMaxHeight';
import { CommonUtils, getCharacterThemeColor } from '../../utils/Common';
import { DataLoader } from '../../utils/DataLoader';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ExportResultsDialog } from '../common/ExportResultsDialog';

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

export const RotationBuilder: React.FC<RotationBuilderProps> = ({ isOpen, onToggle }) => {
  const isCollapsed = !isOpen;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const animDone = useAccordionAnimDone(isOpen, wrapperRef);
  const contentRef = useRef<HTMLDivElement>(null);
  const maxHeight = useCollapseMaxHeight(isOpen, contentRef);
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
    setLoopEndOverride,
    resetLoopEnd,
    endingRotationEnabled,
    endRotationStartsEarlier,
    setEndRotationStartsEarlier,
    recalculate,
    results,
    isStale
  } = useRotationStore();

  const { team, importTeam } = useRosterStore();

  // One-time refresh for a rehydrated rotation that's never been recalculated.
  // markStale=false: don't flag a fresh result stale. includeDamage=true: damageInstances isn't persisted.
  useEffect(() => {
    recalculate(false, true);
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

  const [activeSubPanel, setActiveSubPanel] = useState<{ rowIndex: number; trigger: string } | null>(null);

  const [draggedIndices, setDraggedIndices] = useState<number[]>([]);
  const [dragOverInfo, setDragOverInfo] = useState<{ index: number; position: 'top' | 'bottom' } | null>(null);

  // Loop marker drag: separate gesture from row reordering -- relocates the loop start/end
  // flag, not rows. Reuses dragOverInfo for the placement indicator.
  const [draggedMarker, setDraggedMarker] = useState<'start' | 'end' | null>(null);

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
            // Follow the selected block down by one instead of leaving it pinned to the new blank row.
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

    if (!draggedMarker && draggedIndices.includes(targetIndex)) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isBelow = e.clientY > rect.top + rect.height / 2;
    setDragOverInfo({ index: targetIndex, position: isBelow ? 'bottom' : 'top' });
  };

  const handleDragLeave = () => {
    setDragOverInfo(null);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();

    if (draggedMarker) {
      let adjustedTarget = targetIndex;
      if (dragOverInfo?.position === 'bottom') adjustedTarget++;
      if (rows[adjustedTarget]?.unit) {
        if (draggedMarker === 'start') setLoopStartOverride(adjustedTarget);
        else setLoopEndOverride(adjustedTarget);
      }
      setDraggedMarker(null);
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

  // Built by handleExport, downloaded only once the dialog below confirms it --
  // lets the user rename/credit themselves first.
  const [exportPending, setExportPending] = useState<{ exportObject: Record<string, unknown>; filename: string } | null>(null);

  const handleExport = () => {
    if (rows.length === 0) return alert('Rotation is empty.');

    // Include results only when not stale, so the export doubles as Rankings-ready.
    // dmgOverTimeSeries omitted either way -- cheap to regenerate via recalculate.
    const includeResults = !!results && !isStale;
    const exportObject: Record<string, unknown> = {
      rotation: rows.map(({ unit, action, timing, loopStartOverride, loopEndOverride }) => ({
        unit,
        action,
        timing,
        ...(loopStartOverride === true && { loopStartOverride: true }),
        ...(loopEndOverride === true && { loopEndOverride: true })
      })),
      team: team.map(slot => {
        const { domRef, ...cleanData } = slot;
        return cleanData;
      }),
      settings: { startEnergy, startConcerto, endingRotationEnabled, endRotationStartsEarlier }
    };
    if (includeResults) {
      const { dmgOverTimeSeries, ...resultsWithoutDmgOverTime } = results!;
      exportObject.results = resultsWithoutDmgOverTime;
    }

    const names = CommonUtils.buildTeamIds(team);
    const suffix = includeResults ? '_Results' : '';
    const filename = names.length > 0 ? `Rotation_${names.join('_')}${suffix}.json` : `Rotation_Config${suffix}.json`;
    setExportPending({ exportObject, filename });
  };

  // Set only when the imported team matches Step 1's roster (same characters+sequences) --
  // holds the parsed file while asking whether to overwrite the build. Other imports apply immediately.
  const [pendingImport, setPendingImport] = useState<{ rawData: any; rotData: any[] } | null>(null);

  const applyImport = async (rawData: any, rotData: any[], includeTeam: boolean) => {
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

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const rawData = JSON.parse(ev.target?.result as string);
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
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // No auto-detection for loop end (unlike loop start) -- always an explicit tag, or absent.
  const loopEndIndex = rows.findIndex(r => r.loopEndOverride === true);
  // Derived from loopEndIndex rather than its own flag, to avoid drifting out of sync with it.
  const hasEndRotationContent = loopEndIndex !== -1 && !!rows[loopEndIndex + 1]?.unit;
  const scrollbarSegments = useMemo(
    () => buildRotationScrollbarSegments(rows, loopStartIndex, loopEndIndex),
    [rows, loopStartIndex, loopEndIndex]
  );

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
                isLoopEnd={i === loopEndIndex}
                onLoopEndMarkerDragStart={handleLoopEndMarkerDragStart}
                onLoopEndMarkerDragEnd={handleLoopMarkerDragEnd}
                onResetLoopEnd={resetLoopEnd}
                isEndRotationStart={i === loopEndIndex + 1 && hasEndRotationContent}
                endRotationStartsEarlier={endRotationStartsEarlier}
                onToggleEndRotationStartsEarlier={setEndRotationStartsEarlier}
              />
            ))}
          </div>
        </div>
      </div>

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

      {exportPending && (
        <ExportResultsDialog
          defaultFilename={exportPending.filename}
          onConfirm={(filename, author) => {
            const exportObject = author ? { ...exportPending.exportObject, author } : exportPending.exportObject;
            CommonUtils.downloadJson(exportObject, filename);
            setExportPending(null);
          }}
          onCancel={() => setExportPending(null)}
        />
      )}
    </div>
  );
};