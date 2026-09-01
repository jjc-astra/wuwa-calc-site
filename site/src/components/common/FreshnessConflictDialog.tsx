// src/components/common/FreshnessConflictDialog.tsx
// Mounted once at the App root. Renders whenever useFreshnessConflictStore has a pending
// conflict -- a data-freshness check (src/utils/dataFreshness.ts) found that an entity's
// mechanic JSON changed on the server while the user still has unsaved local edits to it in the
// Mechanics Builder, so it can't be silently evicted the way an unedited stale entry would be.
import React from 'react';
import { useFreshnessConflictStore } from '../../utils/dataFreshness';

export const FreshnessConflictDialog: React.FC = () => {
  const { conflicts, keep, discard } = useFreshnessConflictStore();
  if (conflicts.length === 0) return null;

  return (
    <div className="modal-overlay" onClick={keep}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <button type="button" className="modal-close-x" onClick={keep} aria-label="Close">×</button>
        <div className="modal-content">
          <h3>Data updated on the server</h3>
          <p className="text-dim">
            {conflicts.length === 1
              ? `${conflicts[0].itemName}'s mechanic data has changed on the server, but you have unsaved edits to it in the Mechanics Builder.`
              : `These have changed on the server, but you have unsaved edits to them in the Mechanics Builder: ${conflicts.map(c => c.itemName).join(', ')}.`}
            {' '}Keep your local edits, or discard them and load the latest version?
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="base-btn text-xs" onClick={keep}>Keep My Edits</button>
          <button type="button" className="base-btn text-xs btn-primary" onClick={discard}>Discard &amp; Use Latest</button>
        </div>
      </div>
    </div>
  );
};
