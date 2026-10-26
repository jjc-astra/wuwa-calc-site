// Input flag lanes along the top; poles are drawn by RotationTimeline.
import React from 'react';
import { LANE_HEIGHT_PX, FLAG_LABEL_HEIGHT_PX, flagTrackHeightPx } from './timelineLayout';
import type { LaidOutFlag } from './timelineLayout';
import { MouseClickIcon } from './MouseClickIcon';

interface TimelineFlagTrackProps {
  flags: LaidOutFlag[];
}

export const TimelineFlagTrack: React.FC<TimelineFlagTrackProps> = ({ flags }) => {
  return (
    <div className="timeline-flag-track" style={{ height: flagTrackHeightPx(flags) }}>
      <div className="timeline-ruler-spacer" style={{ width: 'var(--timeline-header-width)' }} />
      <div className="timeline-flag-track-lanes">
        {flags.map((flag, i) => {
          const spamTitle = flag.spamState === 'spam' ? 'Spam Click OK' : flag.spamState === 'wait' ? 'Wait For It' : null;
          return (
            <React.Fragment key={i}>
            {flag.holdWidthPx !== undefined && (
              <span
                className="timeline-flag-hold-bar"
                title={`${flag.label} held`}
                style={{ left: flag.xPx, width: flag.holdWidthPx, top: flag.lane * LANE_HEIGHT_PX, height: FLAG_LABEL_HEIGHT_PX, borderColor: flag.themeColor, background: `color-mix(in srgb, ${flag.themeColor} 18%, transparent)` }}
              />
            )}
            {/* Sized to content; widthPx is an estimate. */}
            <span
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
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
