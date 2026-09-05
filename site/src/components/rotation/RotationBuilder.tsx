// src/components/rotation/RotationBuilder.tsx
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

// A VS Code "overview ruler" style minimap, rendered onto .rotation-scrollbar-map -- a plain,
// non-scrolling element sitting directly behind #rotation-builder's own scrollbar (see
// calculator.css for why a real element, not the scrollbar-track's own background, is what
// draws this). Two kinds of segment, both absolutely positioned by percent of the total row
// count:
//  - One rounded, narrow bar per *contiguous run* of same-unit rows (not one per row -- adjacent
//    rows for the same unit merge into a single bar with a small gap opening up only where the
//    active unit actually changes), colored to match that unit's own dimmed input-field
//    background (.rotation-row .base-select's own color-mix formula) rather than the full-
//    strength theme color used elsewhere, so it reads as a quiet backdrop, not another bright UI
//    element.
//  - One wide, flat accent-colored mark per loop start/end boundary, layered on top -- wider
//    than the unit bars (extends past the gutter's own edges) but much shorter, the same
//    "thick tick, not a bar" convention VS Code uses for its own overview-ruler decorations.
function buildRotationScrollbarSegments(rows: any[], loopStartIndex: number, loopEndIndex: number): ScrollbarSegment[] {
  const n = rows.length;
  if (n === 0) return [];

  const segments: ScrollbarSegment[] = [];
  // Small fixed gap (in track percent) between two consecutive bars for *different* units --
  // shrinks each run's own rect in from both ends rather than adding margin, since these are
  // percent-positioned absolutely (no box model to hang a margin off). Capped so it can't
  // swallow a very short run entirely on a long rotation (100/n/4 shrinks toward 0 as n grows).
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

  // The actual rendered width of #rotation-builder's own scrollbar -- offsetWidth-clientWidth
  // measures whatever the browser really reserved for it (scrollbar-color's "thin" rendering
  // doesn't correspond to any fixed CSS pixel value the same way an explicit
  // ::-webkit-scrollbar{width} would), so .rotation-scrollbar-map can be sized to match exactly
  // instead of guessing a constant and risking a visible seam down one edge. Re-measured via
  // ResizeObserver (covers the box resizing) and whenever the row count changes (overflow can
  // appear/disappear, changing whether there's a scrollbar to measure at all).
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

  // Refreshes gauges/timings/per-row DMG once when the calculator page is actually opened, in
  // case a rotation was rehydrated from a previous session but never recalculated since. This is
  // the only place recalculate() runs on load -- it used to run app-wide (even on the landing
  // page) from the store's persist rehydration hook, since the store module loads regardless of
  // route. markStale=false: results/isStale are now cached too (see useRotationStore's
  // partialize), so this refresh shouldn't itself stamp a freshly-rehydrated "still fresh"
  // result as stale -- only an actual edit (triggerRecalc, setStartEnergy/Concerto,
  // importRotation) should do that. includeDamage=true: row.damageInstances isn't persisted
  // either, so without this the rotation table's own DMG column would sit blank/0 after every
  // reload despite the Results panel above it looking fully cached.
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
    // Catches the accordion's own open/close max-height CSS transition settling (300ms,
    // useCollapseMaxHeight) -- a measurement taken mid-transition (e.g. right on mount, before
    // ResizeObserver's first callback fires or while the box is still animating toward its
    // final height) can under/over-report versus the fully-settled box, and nothing else is
    // guaranteed to trigger a re-measure afterward if the row count doesn't happen to also
    // change around the same time.
    const settleTimer = setTimeout(measure, 350);
    return () => {
      ro.disconnect();
      clearTimeout(settleTimer);
    };
  }, [rows.length]);

  // Active Sub-Panel state: { rowIndex: number, trigger: string }
  const [activeSubPanel, setActiveSubPanel] = useState<{ rowIndex: number; trigger: string } | null>(null);

  // Drag and Drop state
  const [draggedIndices, setDraggedIndices] = useState<number[]>([]);
  const [dragOverInfo, setDragOverInfo] = useState<{ index: number; position: 'top' | 'bottom' } | null>(null);

  // Loop marker drag state -- a separate gesture from row reordering above: dragging a tag
  // relocates which row is flagged as the loop start/end, it never reorders rows. 'start' vs
  // 'end' picks which flag handleDrop moves. Shares dragOverInfo with row reordering so the
  // top/bottom placement indicator looks and behaves identically for both.
  const [draggedMarker, setDraggedMarker] = useState<'start' | 'end' | null>(null);

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
    CommonUtils.downloadJson(exportObject, filename);
  };

  // Set only when an imported file's team shares the same characters+sequences as the roster
  // already in Step 1 (see teamMatchesRoster below) -- holds the parsed file just long enough to
  // ask whether to overwrite that roster's build (weapon/echoes/stats) or keep it and only bring
  // in the rotation/settings. Any other import (no team in the file, or a genuinely different
  // roster) applies immediately with no prompt, same as before.
  const [pendingImport, setPendingImport] = useState<{ rawData: any; rotData: any[] } | null>(null);

  const applyImport = async (rawData: any, rotData: any[], includeTeam: boolean) => {
    if (includeTeam && rawData.team) {
      await importTeam(rawData.team);
    }
    importRotation(rotData, rawData.settings);
    // The rotation section may still be collapsed (e.g. import triggered while the Team step
    // is open) -- open it first so the newly-imported rows, including the trailing placeholder
    // row, are actually visible, then scroll to reveal the end.
    if (!isOpen) onToggle();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = document.getElementById('rotation-builder');
        container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      });
    });
  };

  // Order-sensitive signature of a team's slots by character+sequence only -- deliberately
  // ignores weapon/echoes/stats, since those are exactly the build details this prompt exists
  // to let the user keep instead of silently losing to whatever the imported file happened to
  // carry for the same roster.
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

  // No auto-detection for loop end (unlike loop start) -- it's always an explicit tag, or
  // absent entirely (the whole loop runs to the end of the rows array, today's behavior).
  const loopEndIndex = rows.findIndex(r => r.loopEndOverride === true);
  // The "END ROTATION" marker is derived from loopEndIndex rather than its own persisted flag
  // -- it's always the row immediately after LOOP END, whenever that row actually has content
  // (an empty trailing row there means there's no Ending Rotation content to mark). Deriving it
  // avoids a second per-row flag that could drift out of sync with loopEndOverride.
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
          {/* A plain, non-scrolling element painted directly behind #rotation-builder's own
              scrollbar (translucent, see calculator.css) -- not a background on the scrollbar
              track itself, since current Chromium silently ignores a gradient/image background
              there for the real native scrollbar widget even though it reports the rule as
              matched. This sits at the same fixed screen position as the scrollbar gutter
              regardless of #rotation-builder's own scroll offset, since it's a sibling outside
              the scrolling box, not a child of it. Top/bottom inset by the scrollbar's own
              measured thickness -- Windows Chrome/Edge draws a square arrow button at each end of
              a "classic" (explicit scrollbar-color) scrollbar, roughly as tall as it is wide, so
              this keeps segments out of that dead zone instead of running the full track height. */}
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
    </div>
  );
};