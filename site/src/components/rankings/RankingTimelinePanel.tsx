// src/components/rankings/RankingTimelinePanel.tsx
// Only file importing both RotationTimeline and Rankings types -- keeps the timeline component
// page-agnostic while this wrapper owns Rankings-specific data fetching.
import React from 'react';
import { RotationTimeline } from '../timeline/RotationTimeline';
import { useRotationTimelineData } from '../timeline/useRotationTimelineData';
import type { RankingEntry } from '../../store/useRankingsStore';

interface RankingTimelinePanelProps {
  entry: RankingEntry;
}

export const RankingTimelinePanel: React.FC<RankingTimelinePanelProps> = ({ entry }) => {
  const { status, evaluatedRows, loopStartIndex, team, error } = useRotationTimelineData(entry.id);

  return (
    <div className="ranking-timeline-panel">
      {status === 'loading' && <div className="results-empty">Calculating timeline...</div>}
      {status === 'error' && <div className="results-empty">Failed to load timeline: {error}</div>}
      {status === 'ready' && <RotationTimeline evaluatedRows={evaluatedRows} team={team} loopStartIndex={loopStartIndex} />}
    </div>
  );
};
