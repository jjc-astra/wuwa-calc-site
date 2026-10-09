// Export Rotation / History's Export: names and classifies the rotation file, optionally names and
// picks the build of a results file, credits the author on both, then calculates and downloads them.
import React, { useState } from 'react';
import { SegmentedToggle } from './SegmentedToggle';
import { CommonUtils, tip } from '../../utils/Common';
import { buildExportFiles } from '../../utils/rotationExport';
import type { ExportSource } from '../../utils/rotationExport';
import type { ResultsBuild } from '../../types/results';
import { ROTATION_TYPE_LABELS } from '../../store/useRankingsStore';

type RotationTypeChoice = keyof typeof ROTATION_TYPE_LABELS;

interface ExportRotationDialogProps {
  source: ExportSource;
  onClose: () => void;
}

const withJsonExtension = (name: string, fallback: string): string => {
  const trimmed = name.trim() || fallback;
  return trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`;
};

export const ExportRotationDialog: React.FC<ExportRotationDialogProps> = ({ source, onClose }) => {
  const [author, setAuthor] = useState('');
  const [includeResults, setIncludeResults] = useState(true);
  const [build, setBuild] = useState<ResultsBuild>('default');
  const [rotationType, setRotationType] = useState<RotationTypeChoice>('unclassified');
  // Presets end in the rotation type (none when unclassified) and follow it until edited; null = the preset.
  const typeSuffix = rotationType === 'unclassified' ? '' : `_${ROTATION_TYPE_LABELS[rotationType]}`;
  const defaultRotationName = CommonUtils.exportFilename('Rotation', source.team, typeSuffix);
  const defaultResultsName = CommonUtils.exportFilename('Results', source.team, typeSuffix);
  const [editedRotationName, setRotationName] = useState<string | null>(null);
  const [editedResultsName, setResultsName] = useState<string | null>(null);
  const rotationName = editedRotationName ?? defaultRotationName;
  const resultsName = editedResultsName ?? defaultResultsName;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const rotationFilename = withJsonExtension(rotationName, defaultRotationName);
      const { rotationFile, resultsFile } = await buildExportFiles(source, {
        author: author.trim(),
        rotationType: rotationType === 'unclassified' ? null : rotationType,
        results: includeResults ? { build } : null
      });
      CommonUtils.downloadJson(rotationFile, rotationFilename);
      if (resultsFile) CommonUtils.downloadJson(resultsFile, withJsonExtension(resultsName, defaultResultsName));
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
            <label className="modal-field-label caps-label">Rotation Type</label>
            <SegmentedToggle
              ariaLabel="Rotation type"
              value={rotationType}
              onChange={setRotationType}
              options={(Object.keys(ROTATION_TYPE_LABELS) as RotationTypeChoice[]).map(value => ({ value, label: ROTATION_TYPE_LABELS[value] }))}
            />
          </div>

          <hr className="modal-divider" />

          <div className="modal-field">
            <label className="toolbar-toggle-label" {...tip('Also calculate and download a results file, which Rotation Rankings submissions need')}>
              <input type="checkbox" checked={includeResults} onChange={e => setIncludeResults(e.target.checked)} /> Export Results
            </label>
          </div>
          {includeResults && (
            <>
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
                    { value: 'default', label: 'Default', tooltip: 'Recommended substats and weapon at R1; everything else as entered. Used for Rotation Rankings.' },
                    { value: 'custom', label: 'Custom', tooltip: 'Your echoes as entered, for sharing or saving.' }
                  ]}
                />
              </div>
            </>
          )}

          {/* Credited in both files. */}
          <hr className="modal-divider" />

          <div className="modal-field">
            <label className="modal-field-label caps-label">Author</label>
            <input type="text" className="modal-field-input" value={author} placeholder="Optional" onChange={e => setAuthor(e.target.value)} />
          </div>
          {error && <p className="modal-error">{error}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="base-btn text-xs" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="base-btn text-xs btn-primary" onClick={handleConfirm} disabled={busy}>
            {busy ? (includeResults ? 'Calculating...' : 'Exporting...') : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
};
