// src/components/timeline/TimelineFlagTrack.tsx
// Marker lane along the top: one label per player input (press/hold/release, or a swap),
// stacked into as many lanes as needed so close flags don't overlap (assignFlagLanes in
// timelineLayout.ts). Each flag's vertical pole is drawn separately by RotationTimeline.tsx.
import React from 'react';
import { HEADER_COL_WIDTH_PX, LANE_HEIGHT_PX, FLAG_LABEL_HEIGHT_PX, FLAG_TRACK_MIN_HEIGHT_PX } from './timelineLayout';
import type { LaidOutFlag } from './timelineLayout';
import { MouseClickIcon } from './MouseClickIcon';

interface TimelineFlagTrackProps {
  flags: LaidOutFlag[];
}

export const TimelineFlagTrack: React.FC<TimelineFlagTrackProps> = ({ flags }) => {
  const maxLane = flags.reduce((max, f) => Math.max(max, f.lane), -1);
  const height = Math.max(FLAG_TRACK_MIN_HEIGHT_PX, (maxLane + 1) * LANE_HEIGHT_PX);

  return (
    <div className="timeline-flag-track" style={{ height }}>
      <div className="timeline-ruler-spacer" style={{ width: HEADER_COL_WIDTH_PX }} />
      <div className="timeline-flag-track-lanes">
        {flags.map((flag, i) => {
          // 'spam': current action outranks this one, so pressing early costs nothing. 'wait':
          // this action is at least as high priority, so pressing early risks cutting the
          // current move's damage short. See timelineLayout.ts's describeSpamState.
          const spamTitle = flag.spamState === 'spam' ? 'Spam Click OK' : flag.spamState === 'wait' ? 'Wait For It' : null;
          return (
            // No explicit width -- flag.widthPx is only an estimate (timelineLayout.ts's
            // per-character heuristic) used to reserve lane space. Forcing the box to that width
            // left visible slack on over-estimated labels (e.g. "Shift"); sizing to real content
            // is exact.
            <span
              key={i}
              className={`timeline-flag-label${flag.spamState ? ` timeline-flag-label-${flag.spamState}` : ''}`}
              title={spamTitle ? `${flag.label} — ${spamTitle}` : flag.label}
              style={{
                left: flag.xPx,
                top: flag.lane * LANE_HEIGHT_PX,
                height: FLAG_LABEL_HEIGHT_PX,
                borderColor: flag.themeColor,
                color: flag.themeColor
              }}
            >
              {flag.icon === 'mouse-left' ? (
                <>
                  {flag.prefix && <span className="timeline-flag-prefix">{flag.prefix} </span>}
                  <MouseClickIcon />
                </>
              ) : (
                flag.label
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
};
