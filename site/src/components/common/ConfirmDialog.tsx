// src/components/common/ConfirmDialog.tsx
// A styled confirmation prompt for destructive actions (e.g. Restore Rotation, which overwrites
// whatever's currently in Step 1/2) -- reuses the site's own .modal-* CSS (components.css),
// which existed but had no consumer yet, instead of the browser's plain confirm().
import React from 'react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel
}) => (
  <div className="modal-overlay" onClick={onCancel}>
    <div className="modal-box" onClick={e => e.stopPropagation()}>
      <button type="button" className="modal-close-x" onClick={onCancel} aria-label="Close">×</button>
      <div className="modal-content">
        <h3>{title}</h3>
        <p className="text-dim">{message}</p>
      </div>
      <div className="modal-actions">
        <button type="button" className="base-btn text-xs" onClick={onCancel}>{cancelLabel}</button>
        <button type="button" className="base-btn text-xs btn-primary" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </div>
);
