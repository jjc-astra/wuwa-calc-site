// src/components/timeline/TimelineFlagTrack.tsx
// The "video editor" marker lane along the top: one label per player input (a key
// press/hold/release, or a character swap), laid into as many stacked lanes as needed so
// closely-timed flags never overlap (see timelineLayout.ts's assignFlagLanes). Each flag's own
// full-height vertical pole is rendered separately by RotationTimeline.tsx (it needs to span
// every row + the ruler below, not just this track's own small height).
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
          // 'spam' = whatever's currently playing outranks this row's own action, so this key
          // can't cut it short -- pressing it early costs nothing. 'wait' = this row's own action
          // is at least as high priority as what's playing, so pressing it too early risks cutting
          // the current move's remaining damage short -- better to actually wait for it. See
          // timelineLayout.ts's describeSpamState.
          const spamTitle = flag.spamState === 'spam' ? 'Spam Click OK' : flag.spamState === 'wait' ? 'Wait For It' : null;
          return (
            // No explicit width here -- flag.widthPx is only an *estimate* (timelineLayout.ts's
            // per-character heuristic), used solely to reserve lane space so flags don't collide;
            // forcing the rendered box to that estimated width left visible slack around text it
            // over-estimated (multi-character labels especially, e.g. "Shift"). Letting the box
            // size to its own real content is always exact.
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
