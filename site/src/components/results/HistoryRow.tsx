// src/components/results/HistoryRow.tsx
import React, { useState } from 'react';
import { TeamPreview } from '../common/TeamPreview';
import { StackedContributionBar } from '../rankings/StackedContributionBar';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ExportRotationDialog } from '../common/ExportRotationDialog';
import { ActionsMenuButton } from '../common/ActionsMenuButton';
import { useRotationHistoryStore } from '../../store/useRotationHistoryStore';
import type { HistoryEntry } from '../../store/useRotationHistoryStore';
import { loadSavedRotation } from '../../store/loadSavedRotation';
import { teamCharacters } from '../../utils/TeamUtils';
import { useComparisonStore } from '../../store/useComparisonStore';
import { tip } from '../../utils/Common';
import { defaultEnemyStats } from '../../data/db';

interface HistoryRowProps {
  entry: HistoryEntry;
}

export const HistoryRow: React.FC<HistoryRowProps> = ({ entry }) => {
  const toggleFavorite = useRotationHistoryStore(s => s.toggleFavorite);
  const removeEntry = useRotationHistoryStore(s => s.removeEntry);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const unitNames = teamCharacters(entry.team);
  const label = unitNames.join(' · ');
  const dps = entry.results.dpsStats.twoMinDps ?? 0;
  const segments = entry.results.contribution.twoMin?.team ?? [];
  const unitBreakdowns = entry.results.contribution.twoMin?.units ?? {};

  const handleRestoreConfirm = async () => {
    await loadSavedRotation(entry);
    setConfirmOpen(false);
  };

  return (
    <div className="history-row">
      <div className="history-row-top">
        <div className="history-row-icons">
          <TeamPreview team={entry.team} />
        </div>
        <button
          type="button"
          className={`base-btn icon-btn history-favorite-btn ${entry.isFavorite ? 'is-active' : ''}`}
          onClick={() => toggleFavorite(entry.id)}
          {...tip(entry.isFavorite ? 'Unfavorite' : 'Favorite')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={entry.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>
      </div>

      <div className="history-row-bottom">
        <div className="history-row-main">
          <div className="history-row-label-line">
            <span className="history-row-label">{label || 'Empty Team'}</span>
            <span className="history-row-timestamp">{new Date(entry.timestamp).toLocaleString()}</span>
          </div>
          <StackedContributionBar
            segments={segments}
            unitNames={unitNames}
            unitBreakdowns={unitBreakdowns}
            widthPct={100}
            dpsValue={dps}
            showPercentage={false}
          />
        </div>

        <div className="history-row-menu-wrap">
          <ActionsMenuButton
            triggerClassName="base-btn icon-btn"
            iconSize={14}
            items={[
              { label: 'Export', onClick: () => setExportOpen(true) },
              { label: 'Restore Rotation', onClick: () => setConfirmOpen(true) },
              // Instant -- this entry already carries full RotationResults (dmgOverTimeSeries included).
              { label: 'Pin to Comparison', onClick: () => useComparisonStore.getState().pinFromHistoryEntry(entry.team, entry.results) },
              { label: 'Remove', onClick: () => removeEntry(entry.id), danger: true }
            ]}
          />
        </div>
      </div>

      {confirmOpen && (
        <ConfirmDialog
          title="Restore this rotation?"
          message="This replaces the team and rotation currently in Step 1 and Step 2 with this saved snapshot. Any unsaved changes will be lost."
          confirmLabel="Restore"
          onConfirm={handleRestoreConfirm}
          onCancel={() => setConfirmOpen(false)}
        />
      )}

      {exportOpen && (
        <ExportRotationDialog
          source={{
            rotation: entry.rotation,
            team: entry.team,
            settings: entry.settings,
            enemy: entry.enemy ?? defaultEnemyStats(),
            customResults: entry.results
          }}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
};
