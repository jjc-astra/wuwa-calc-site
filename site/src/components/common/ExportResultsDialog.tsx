// src/components/common/ExportResultsDialog.tsx
// Shown before a rotation-results JSON downloads (Export Rotation, History's Save Results) --
// lets the author credit themselves/tweak filename. Reuses .modal-* CSS instead of prompt().
import React, { useState } from 'react';

interface ExportResultsDialogProps {
  defaultFilename: string;
  onConfirm: (filename: string, author: string) => void;
  onCancel: () => void;
}

export const ExportResultsDialog: React.FC<ExportResultsDialogProps> = ({
  defaultFilename, onConfirm, onCancel
}) => {
  const [filename, setFilename] = useState(defaultFilename);
  const [author, setAuthor] = useState('');

  const handleConfirm = () => {
    const trimmed = filename.trim() || defaultFilename;
    onConfirm(trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`, author.trim());
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <button type="button" className="modal-close-x" onClick={onCancel} aria-label="Close">×</button>
        <div className="modal-content">
          <h3>Export Rotation</h3>
          <div className="modal-field">
            <label className="modal-field-label">File Name</label>
            <input
              type="text"
              className="modal-field-input"
              value={filename}
              onChange={e => setFilename(e.target.value)}
            />
          </div>
          <div className="modal-field">
            <label className="modal-field-label">Author</label>
            <input
              type="text"
              className="modal-field-input"
              value={author}
              placeholder="Optional"
              onChange={e => setAuthor(e.target.value)}
            />
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="base-btn text-xs" onClick={onCancel}>Cancel</button>
          <button type="button" className="base-btn text-xs btn-primary" onClick={handleConfirm}>Export</button>
        </div>
      </div>
    </div>
  );
};
