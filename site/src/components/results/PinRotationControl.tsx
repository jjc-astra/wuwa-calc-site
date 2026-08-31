// src/components/results/PinRotationControl.tsx
import React, { useRef, useState } from 'react';
import { useComparisonStore } from '../../store/useComparisonStore';
import { PinComparisonPicker } from './PinComparisonPicker';
import { tip } from '../../utils/Common';

export const PinRotationControl: React.FC = () => {
  const { pinned, status, pinFromFile, unpin } = useComparisonStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerSource, setPickerSource] = useState<'history' | 'rankings' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (pinned) {
    return (
      <div className="pin-chip">
        <span className="pin-chip-label" {...tip(pinned.label)}>{pinned.label}</span>
        <button type="button" className="pin-chip-remove" onClick={unpin} {...tip('Unpin comparison')}>×</button>
      </div>
    );
  }

  return (
    <div className="pin-control">
      <input
        type="file"
        ref={fileInputRef}
        accept=".json"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) pinFromFile(file);
          setMenuOpen(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }}
      />
      <button
        type="button"
        className="base-btn text-xs"
        disabled={status === 'loading'}
        onClick={() => setMenuOpen(o => !o)}
      >
        {status === 'loading' ? 'Calculating…' : 'Pin Comparison'}
      </button>
      {menuOpen && (
        <>
          <div className="pin-menu-backdrop" onClick={() => setMenuOpen(false)} />
          <div className="pin-menu">
            <button type="button" className="pin-menu-item" onClick={() => fileInputRef.current?.click()}>
              Import JSON…
            </button>
            <button
              type="button"
              className="pin-menu-item"
              onClick={() => { setMenuOpen(false); setPickerSource('history'); }}
            >
              From History
            </button>
            <button
              type="button"
              className="pin-menu-item"
              onClick={() => { setMenuOpen(false); setPickerSource('rankings'); }}
            >
              From Rankings
            </button>
          </div>
        </>
      )}
      {pickerSource && <PinComparisonPicker source={pickerSource} onClose={() => setPickerSource(null)} />}
    </div>
  );
};
