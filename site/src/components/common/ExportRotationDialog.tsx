// Exports a rotation file; scripts/recalc-results.mjs generates its ranked results.
import React, { useState } from 'react';
import { SegmentedToggle } from './SegmentedToggle';
import { CommonUtils } from '../../utils/Common';
import { buildRotationFile, nonDefaultSetTag } from '../../utils/rotationExport';
import type { CalcInput } from '../../types/results';
import { ROTATION_TYPE_LABELS } from '../../store/useRankingsStore';

type RotationTypeChoice = keyof typeof ROTATION_TYPE_LABELS;

interface ExportRotationDialogProps {
  source: CalcInput;
  onClose: () => void;
}

const withJsonExtension = (name: string, fallback: string): string => {
  const trimmed = name.trim() || fallback;
  return trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`;
};

export const ExportRotationDialog: React.FC<ExportRotationDialogProps> = ({ source, onClose }) => {
  const [author, setAuthor] = useState('');
  const [rotationType, setRotationType] = useState<RotationTypeChoice>('unclassified');
  // Name presets end in the rotation type; null = preset.
  const typeSuffix = rotationType === 'unclassified' ? '' : `_${ROTATION_TYPE_LABELS[rotationType]}`;
  // Non-default sets can change the rotation, so they tag its name.
  const defaultRotationName = CommonUtils.exportFilename('Rotation', source.team, typeSuffix, nonDefaultSetTag);
  const [editedRotationName, setRotationName] = useState<string | null>(null);
  const rotationName = editedRotationName ?? defaultRotationName;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const rotationFile = await buildRotationFile(source, {
        author: author.trim(),
        rotationType: rotationType === 'unclassified' ? null : rotationType
      });
      CommonUtils.downloadJson(rotationFile, withJsonExtension(rotationName, defaultRotationName));
      onClose();
    } catch (err: any) {
      setError(`Couldn't export the rotation: ${err?.message || err}`);
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
            <label className="modal-field-label caps-label">Author</label>
            <input type="text" className="modal-field-input" value={author} placeholder="Optional" onChange={e => setAuthor(e.target.value)} />
          </div>
          {error && <p className="modal-error">{error}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="base-btn text-xs" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="base-btn text-xs btn-primary" onClick={handleConfirm} disabled={busy}>
            {busy ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
};
