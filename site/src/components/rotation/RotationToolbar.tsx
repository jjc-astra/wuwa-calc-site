// src/components/rotation/RotationToolbar.tsx
import React from 'react';
import { useRotationStore } from '../../store/useRotationStore';
import { tip } from '../../utils/Common';

export const RotationToolbar: React.FC = () => {
  const {
    rows,
    startEnergy,
    startConcerto,
    endingRotationEnabled,
    canUndo,
    canRedo,
    isStale,
    isCalculating,
    selectedIndices,
    clipboard,
    setStartEnergy,
    setStartConcerto,
    setEndingRotationEnabled,
    setClipboard,
    setSelectedIndices,
    addRow,
    deleteRows,
    pasteRows,
    calculateDamage,
    undo,
    redo
  } = useRotationStore();

  const lastIndex = rows.length - 1;
  const hasSelection = selectedIndices.some(i => i !== lastIndex);
  // endingRotationEnabled can outlive its tag -- e.g. a plain multi-row delete removes the
  // loop-end row without going through resetLoopEnd, which is what normally clears the flag.
  // So "checked" is gated on the tag actually existing, not just the stored flag.
  const hasEndingRotationMarker = rows.some(r => r.loopEndOverride === true);

  const handleCopy = () => {
    const validIndices = selectedIndices.filter(i => i !== lastIndex);
    const selectedRows = rows.filter((_, i) => validIndices.includes(i));
    if (selectedRows.length > 0) {
      setClipboard(selectedRows.map(({ unit, action, timing }) => ({ unit, action, timing })));
    }
    setSelectedIndices([]);
  };

  const handlePaste = () => {
    pasteRows();
  };

  const handleDelete = () => {
    const deletable = selectedIndices.filter(i => i !== lastIndex);
    if (deletable.length > 0) deleteRows(deletable);
  };

  const handleInsertAbove = () => {
    if (selectedIndices.length === 0) return;
    addRow('', '', selectedIndices[0]);
    setSelectedIndices(selectedIndices.map(i => i + 1));
  };

  const handleInsertBelow = () => {
    if (selectedIndices.length === 0) return;
    addRow('', '', selectedIndices[selectedIndices.length - 1] + 1);
  };

  return (
    <div className="rotation-toolbar">
      <div className="flex-row gap-sm">
        
        <div className="btn-group">
          <button className="base-btn text-xs" onClick={handleCopy} disabled={!hasSelection}>Copy</button>
          <button className={`base-btn text-xs ${clipboard.length > 0 ? 'btn-highlight' : ''}`} onClick={handlePaste} disabled={clipboard.length === 0}>Paste</button>
          <button className="base-btn icon-btn" onClick={handleDelete} {...tip('Delete Selected Rows')} disabled={!hasSelection}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>

        <div className="separator-v"></div>

        <div className="btn-group">
          <button className="base-btn icon-btn" onClick={handleInsertAbove} {...tip('Insert Row Above')} disabled={!hasSelection}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="12" y1="2" x2="12" y2="22"></line>
              <polyline points="8 7 12 3 16 7"></polyline>
            </svg>
          </button>
          <button className="base-btn icon-btn" onClick={handleInsertBelow} {...tip('Insert Row Below')} disabled={!hasSelection}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="12" y1="2" x2="12" y2="22"></line>
              <polyline points="8 17 12 21 16 17"></polyline>
            </svg>
          </button>
        </div>
        
        <div className="separator-v"></div>
        
        <div className="btn-group">
          <button className="base-btn icon-btn" onClick={undo} disabled={!canUndo} {...tip('Undo')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>
          </button>
          <button className="base-btn icon-btn" onClick={redo} disabled={!canRedo} {...tip('Redo')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6"></path><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"></path></svg>
          </button>
        </div>
        
        <div className="separator-v"></div>
        
        <div className="flex-row gap-sm" style={{ marginLeft: '8px' }}>
          <label className="toolbar-toggle-label" {...tip('Start combat with max Resonance Energy')}>
            <input type="checkbox" checked={startEnergy} onChange={e => setStartEnergy(e.target.checked)} /> Full Energy
          </label>
          <label className="toolbar-toggle-label" {...tip('Start combat with max Concerto')}>
            <input type="checkbox" checked={startConcerto} onChange={e => setStartConcerto(e.target.checked)} /> Full Concerto
          </label>
          <label className="toolbar-toggle-label" {...tip('For the 2-Minute window: simulate the in-between loops, then run a custom sequence for the final stretch instead of an arbitrarily-truncated loop repeat')}>
            <input type="checkbox" checked={endingRotationEnabled && hasEndingRotationMarker} onChange={e => setEndingRotationEnabled(e.target.checked)} /> Ending Rotation
          </label>
        </div>
        
      </div>
      
      <div style={{ flex: 1 }}></div>

      {isCalculating && (
        <span className="calc-loading-msg" style={{ display: 'flex' }}>
          <span className="calc-loading-spinner" />
          <span>CALCULATING…</span>
        </span>
      )}
      {isStale && (
        <span className="calc-warning-msg" style={{ display: 'flex' }}>
          <span>STATS CHANGED</span>
          <svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
        </span>
      )}
      <button className="base-btn text-xs" {...tip('Calculate Timeline')} onClick={calculateDamage}>Calculate</button>

    </div>
  );
};