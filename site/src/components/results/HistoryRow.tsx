// src/components/results/HistoryRow.tsx
import React, { useState } from 'react';
import { TeamPreview } from '../common/TeamPreview';
import { StackedContributionBar } from '../rankings/StackedContributionBar';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ActionsMenuButton } from '../common/ActionsMenuButton';
import { useRotationHistoryStore } from '../../store/useRotationHistoryStore';
import type { HistoryEntry } from '../../store/useRotationHistoryStore';
import { useRotationStore } from '../../store/useRotationStore';
import { useRosterStore } from '../../store/useRosterStore';
import { useComparisonStore } from '../../store/useComparisonStore';
import { tip, CommonUtils } from '../../utils/Common';

interface HistoryRowProps {
  entry: HistoryEntry;
}

function buildFilename(entry: HistoryEntry, suffix: string): string {
  const names = CommonUtils.buildTeamIds(entry.team);
  return names.length > 0 ? `Rotation_${names.join('_')}${suffix}.json` : `Rotation_Config${suffix}.json`;
}

export const HistoryRow: React.FC<HistoryRowProps> = ({ entry }) => {
  const toggleFavorite = useRotationHistoryStore(s => s.toggleFavorite);
  const removeEntry = useRotationHistoryStore(s => s.removeEntry);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const unitNames = entry.team.filter(s => s.character).map(s => s.character);
  const label = unitNames.join(' · ');
  const dps = entry.results.dpsStats.twoMinDps ?? 0;
  const segments = entry.results.contribution.twoMin?.team ?? [];
  const unitBreakdowns = entry.results.contribution.twoMin?.units ?? {};

  const handleSaveResults = () => {
    // A superset of what Export Rotation writes (same rotation/team/settings shape, so this
    // file alone round-trips through Restore Rotation with no separate export needed) plus the
    // already-computed results -- drop straight into public/data/character_results/ and the
    // Rankings page's loader picks up dpsStats/contribution instead of recalculating them.
    // dmgOverTimeSeries is the one piece left out -- Rankings/Restore never read it, and it's
    // cheap to regenerate from the rotation if something later needs it (just recalculate).
    // substatWorth stays in even though nothing reads it yet -- it's what a future Character
    // Guide page would need this file to carry.
    const { dmgOverTimeSeries, ...resultsWithoutDmgOverTime } = entry.results;
    CommonUtils.downloadJson(
      { rotation: entry.rotation, team: entry.team, settings: entry.settings, results: resultsWithoutDmgOverTime },
      buildFilename(entry, '_Results')
    );
  };

  const handleRestoreConfirm = async () => {
    await useRosterStore.getState().importTeam(entry.team);
    useRotationStore.getState().importRotation(entry.rotation, entry.settings);
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
              { label: 'Save Results', onClick: handleSaveResults },
              { label: 'Restore Rotation', onClick: () => setConfirmOpen(true) },
              // Instant -- this entry already carries a full RotationResults (dmgOverTimeSeries
              // included) from the live Calculate press that produced it.
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
    </div>
  );
};
