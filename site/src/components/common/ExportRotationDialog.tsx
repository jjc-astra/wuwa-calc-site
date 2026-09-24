// src/components/common/ExportRotationDialog.tsx
// Export Rotation / History's Export: names the rotation and results files, credits the
// author, picks the results' build, then calculates and downloads both.
import React, { useState } from 'react';
import { SegmentedToggle } from './SegmentedToggle';
import { CommonUtils } from '../../utils/Common';
import { buildExportFiles } from '../../utils/rotationExport';
import type { ExportSource } from '../../utils/rotationExport';
import type { ResultsBuild } from '../../types/results';

interface ExportRotationDialogProps {
  source: ExportSource;
  onClose: () => void;
}

const withJsonExtension = (name: string, fallback: string): string => {
  const trimmed = name.trim() || fallback;
  return trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`;
};

export const ExportRotationDialog: React.FC<ExportRotationDialogProps> = ({ source, onClose }) => {
  const defaultRotationName = CommonUtils.exportFilename('Rotation', source.team);
  const defaultResultsName = CommonUtils.exportFilename('Results', source.team);
  const [rotationName, setRotationName] = useState(defaultRotationName);
  const [resultsName, setResultsName] = useState(defaultResultsName);
  const [author, setAuthor] = useState('');
  const [build, setBuild] = useState<ResultsBuild>('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const rotationFilename = withJsonExtension(rotationName, defaultRotationName);
      const { rotationFile, resultsFile } = await buildExportFiles(source, { rotationFilename, author: author.trim(), build });
      CommonUtils.downloadJson(rotationFile, rotationFilename);
      CommonUtils.downloadJson(resultsFile, withJsonExtension(resultsName, defaultResultsName));
      onClose();
    } catch (err: any) {
      setError(`Couldn't calculate the results: ${err?.message || err}`);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <button type="button" className="modal-close-x" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        <div className="modal-content">
          <h3>Export Rotation</h3>
          <div className="modal-field">
            <label className="modal-field-label caps-label">Rotation File Name</label>
            <input type="text" className="modal-field-input" value={rotationName} onChange={e => setRotationName(e.target.value)} />
          </div>
          <div className="modal-field">
            <label className="modal-field-label caps-label">Results File Name</label>
            <input type="text" className="modal-field-input" value={resultsName} onChange={e => setResultsName(e.target.value)} />
          </div>
          <div className="modal-field">
            <label className="modal-field-label caps-label">Results Build</label>
            <SegmentedToggle
              ariaLabel="Results build"
              value={build}
              onChange={setBuild}
              options={[
                { value: 'default', label: 'Default', tooltip: 'Recommended echo layout, main stats and substats. Used for Rotation Rankings.' },
                { value: 'custom', label: 'Custom', tooltip: 'Your echoes as entered, for sharing or saving.' }
              ]}
            />
          </div>
          <div className="modal-field">
            <label className="modal-field-label caps-label">Author</label>
            <input type="text" className="modal-field-input" value={author} placeholder="Optional" onChange={e => setAuthor(e.target.value)} />
          </div>
          {error && <p className="modal-error">{error}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="base-btn text-xs" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="base-btn text-xs btn-primary" onClick={handleConfirm} disabled={busy}>
            {busy ? 'Calculating...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
};
