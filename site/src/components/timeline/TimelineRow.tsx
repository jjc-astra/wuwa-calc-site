import React, { useState } from 'react';
import { CommonUtils, TooltipManager } from '../../utils/Common';
import { IMAGE_FOLDERS } from '../../data/db';
import { TimelineClip, buildClipTooltipHtml } from './TimelineClip';
import { ROW_HEIGHT_PX, CLIP_INSET_PX, simultaneousLineHeightPx } from './timelineLayout';
import { nearestMarker, trackPointer } from './trackPointer';
import type { UnitRowData } from './timelineLayout';

interface TimelineRowProps {
  data: UnitRowData;
  // A caret beside the unit's pill that shows/hides the rows nested under it (its effects).
  expander?: { open: boolean; count: number; onToggle: () => void };
}

/** One unit's row: icon, name, clips and hit dots. Hovering near a dot snaps the tooltip to that hit. */
export const TimelineRow: React.FC<TimelineRowProps> = ({ data, expander }) => {
  const [activeDot, setActiveDot] = useState<number | null>(null);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const pointer = trackPointer(e);
    const nearest = nearestMarker(data.hitDots, pointer);
    if (nearest !== -1) {
      const dot = data.hitDots[nearest];
      const at = pointer.toClient(dot.xPx, dot.yPx);
      setActiveDot(nearest);
      TooltipManager.showAtPoint(at.x, at.y, buildClipTooltipHtml({ type: 'onfield', row: dot.row }, dot.hitNumber, data.withSystemHits));
      return;
    }

    setActiveDot(null);
    // Later segments draw on top, so the last one under the cursor wins.
    const inClipBand = pointer.y >= CLIP_INSET_PX && pointer.y <= ROW_HEIGHT_PX - CLIP_INSET_PX;
    const segment = inClipBand ? [...data.segments].reverse().find(s => pointer.x >= s.xPx && pointer.x < s.xPx + s.widthPx) : undefined;
    if (segment) TooltipManager.showAtPoint(e.clientX, e.clientY, buildClipTooltipHtml(segment, undefined, data.withSystemHits));
    else TooltipManager.hide();
  };

  const handleLeave = () => {
    setActiveDot(null);
    TooltipManager.hide();
  };

  const pill = (
    <div className="timeline-row-pill outline-badge">
      <img className="timeline-row-icon" src={CommonUtils.getIconPath(data.unit, IMAGE_FOLDERS.CHARACTERS)} alt={data.unit} />
      <span className="timeline-row-name">{data.unit}</span>
    </div>
  );

  return (
    <div
      className="timeline-row"
      style={{ height: ROW_HEIGHT_PX, '--char-theme-raw': data.themeColor } as React.CSSProperties}
    >
      <div className="timeline-row-header" style={{ width: 'var(--timeline-header-width)' }}>
        {expander ? (
          // The whole label opens/closes the unit's effects, like a section header.
          <button
            type="button"
            className={`timeline-expander ${expander.open ? 'is-open' : ''}`}
            onClick={expander.onToggle}
            disabled={expander.count === 0}
            aria-expanded={expander.open}
            aria-label={`${expander.open ? 'Hide' : 'Show'} ${data.unit}'s effects`}
          >
            <span className="timeline-expander-caret">▾</span>
            {pill}
            <span className="timeline-expander-count">{expander.count}</span>
          </button>
        ) : pill}
      </div>
      <div className="timeline-row-track" onMouseMove={handleMove} onMouseLeave={handleLeave}>
        {data.segments.map((segment, i) => (
          <TimelineClip key={i} segment={segment} />
        ))}
        {data.simultaneousLines.map((line, i) => (
          <div
            key={`sim-${i}`}
            className="timeline-simultaneous-line"
            style={{ left: line.xPx, width: line.widthPx, height: simultaneousLineHeightPx() }}
          />
        ))}
        {data.hitDots.map((dot, i) => (
          <div
            key={`hit-${i}`}
            className={`timeline-hit-dot${i === activeDot ? ' is-active' : ''}`}
            style={{ left: dot.xPx, top: dot.yPx }}
          />
        ))}
      </div>
    </div>
  );
};
