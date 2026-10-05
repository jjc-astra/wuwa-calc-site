import React, { useEffect } from 'react';
import { RotationTimeline } from '../timeline/RotationTimeline';
import { useRotationStore } from '../../store/useRotationStore';
import { useRosterStore } from '../../store/useRosterStore';
import { useTimelineViewStore } from '../../store/useTimelineViewStore';
import { tip } from '../../utils/Common';

/** The Results panel's Timeline tab: the rotation's moves, every unit's buffs, enemy and System
 * effects, and trackers. */
export const TimelineTab: React.FC = () => {
  const timelineRows = useRotationStore(s => s.timelineRows);
  const loopStartIndex = useRotationStore(s => s.timelineLoopStartIndex);
  const setTimelineActive = useRotationStore(s => s.setTimelineActive);
  const team = useRosterStore(s => s.team);
  const showPermanent = useTimelineViewStore(s => s.showPermanent);
  const setShowPermanent = useTimelineViewStore(s => s.setShowPermanent);

  // Hit dots need priced hits, which recalculating only does while this tab is open.
  useEffect(() => {
    setTimelineActive(true);
    return () => setTimelineActive(false);
  }, [setTimelineActive]);

  if (!timelineRows.some(row => row?.unit)) {
    return <div className="results-empty">Add moves in Step 2 to see the timeline.</div>;
  }

  return (
    <div className="results-timeline">
      <div className="results-timeline-toolbar">
        <label className="toolbar-toggle-label" {...tip('Show always-on passives')}>
          <input type="checkbox" checked={showPermanent} onChange={e => setShowPermanent(e.target.checked)} /> Permanent
        </label>
      </div>
      <RotationTimeline
        evaluatedRows={timelineRows}
        team={team}
        loopStartIndex={loopStartIndex}
        showInputs={false}
        withEffects
        linkToTable
        className="results-timeline-view"
      />
    </div>
  );
};
